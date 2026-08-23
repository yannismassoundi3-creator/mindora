import { setSecurePoints } from '../utils/secureStorage';
import { definirXp } from '../utils/progression';
import { estIOS, estAndroid, estInstallee } from '../utils/plateforme';
import { nettoyerSemis } from '../utils/semis';
import { appliquerNouveauJour, signalerChangementRoutines } from '../utils/jourRoutines';
import { construireEtatLocal } from '../utils/etatLocal';
import { CLES_CACHE_AFFICHAGE } from '../utils/clesCache';
import {
  CLES_TENUE_SYNCHRO,
  aDesModificationsNonSynchronisees,
  baseDeComparaisonConnue,
  confirmerEtat,
  copieDeConflit,
  empreinteCanonique,
  impositionExigee,
  impositionTerminee,
  keepaliveAcceptable,
  memoriserVersionServeur,
  mettreDeCoteAvantConflit,
  oublierCopieDeConflit,
  oublierEmpreinte,
  versionServeurConnue,
} from '../utils/synchro';

/**
 * Ce que vaut l'état de la sauvegarde, à l'instant où on regarde.
 *
 * Publié sous forme d'événement plutôt que lu par sondage : l'interface n'a rien à
 * calculer, elle affiche ce qu'on lui dit. Le seul consommateur est la pastille
 * d'état, mais la faire dépendre d'un minuteur l'aurait rendue tantôt en avance,
 * tantôt en retard sur la réalité.
 */
export interface EtatSynchro {
  /** Du travail est présent ici sans avoir été accusé par le serveur. */
  enAttente: boolean;
  /** Une version locale a été mise de côté après un conflit entre appareils. */
  conflit: boolean;
  /** Le navigateur se déclare hors ligne : inutile d'accuser la synchro. */
  horsLigne: boolean;
}

export function lireEtatSynchro(): EtatSynchro {
  return {
    enAttente:
      !!localStorage.getItem('mindset_token') &&
      aDesModificationsNonSynchronisees(construireEtatLocal()),
    conflit: copieDeConflit() !== null,
    horsLigne: typeof navigator !== 'undefined' && navigator.onLine === false,
  };
}

/** Prévient l'interface que l'état de la sauvegarde a peut-être changé. */
export function signalerEtatSynchro(): void {
  try {
    window.dispatchEvent(new CustomEvent('synchroEtat', { detail: lireEtatSynchro() }));
  } catch {
    // Un environnement sans `window` (test, rendu serveur) n'a pas d'interface à
    // prévenir : l'absence de signal n'a alors aucune conséquence.
  }
}

/**
 * L'API est jointe sous notre propre domaine, et non à son adresse Render.
 *
 * Ce n'est pas une préférence d'écriture : `/api/*` est réécrit vers Render par
 * Vercel (`vercel.json`), si bien que le navigateur ne voit plus qu'un seul site
 * là où il en voyait deux. Le cookie de session cesse donc d'être un cookie
 * tiers — ceux-là, Safari les bloque tous par défaut, et sur iPhone tous les
 * navigateurs reposent sur WebKit. C'est ce qui renvoyait à l'écran de connexion
 * à chaque ouverture de l'application.
 *
 * En développement, front et API sont déjà deux serveurs locaux : `VITE_API_URL`
 * pointe alors directement sur le backend.
 */
// Exportée plutôt que recopiée : `utils/venue.ts` appelle l'API sans passer par
// `api.post`, et deux définitions de l'adresse de base finissent toujours par
// diverger — celle qu'on oublie étant celle qui casse en production seulement.
export const API_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Un seul rafraîchissement à la fois.
 *
 * Le dashboard lance plusieurs requêtes en parallèle : si chacune déclenchait sa
 * propre rotation, la première invaliderait le jeton des suivantes et la session
 * sauterait pour de bon — exactement ce qu'on cherche à éviter.
 */
let rafraichissementEnCours: Promise<boolean> | null = null;

/**
 * Réponses au questionnaire d'inscription que le serveur n'a pas encore acceptées.
 *
 * Le serveur est seul juge de « lui a-t-on déjà posé les questions » — il répond
 * d'après la table des profils. Tant que l'enregistrement n'a pas abouti, les
 * réponses attendent ici plutôt que d'être redemandées à leur auteur.
 */
export const CLE_PROFIL_EN_ATTENTE = 'mindset_profil_en_attente';

/**
 * Où en est un questionnaire commencé et pas terminé.
 *
 * Déclarée ici et non dans `Onboarding.tsx` pour une seule raison : la déconnexion
 * doit pouvoir l'effacer, et `Onboarding` importe déjà ce module — l'inverse
 * fermerait le cercle.
 */
export const CLE_QUESTIONNAIRE_EN_COURS = 'mindset_questionnaire_en_cours';

/**
 * Renvoie le questionnaire resté en attente. Rend `true` si le profil est
 * désormais enregistré — ou s'il n'y avait rien à envoyer.
 */
export async function renvoyerProfilEnAttente(): Promise<boolean> {
  const brut = localStorage.getItem(CLE_PROFIL_EN_ATTENTE);
  if (!brut) return false;

  try {
    await api.post('/ai-coaching/onboarding', JSON.parse(brut));
    localStorage.removeItem(CLE_PROFIL_EN_ATTENTE);
    return true;
  } catch (e) {
    console.warn('Profil en attente toujours pas enregistré', e);
    return false;
  }
}

/**
 * Range les deux jetons d'une réponse d'authentification.
 *
 * Le jeton de rafraîchissement n'était nulle part côté client : il ne vivait que
 * dans un cookie, et un cookie tiers ne survit pas à Safari. Il est remplacé à
 * chaque usage par le serveur, donc cette valeur doit être réécrite après chaque
 * rafraîchissement — garder l'ancienne reviendrait à rejouer un jeton consommé, ce
 * que le serveur traite comme un vol et qui révoque toutes les sessions du compte.
 */
export function memoriserSession(data: { access_token?: string; refresh_token?: string }) {
  if (data?.access_token) localStorage.setItem('mindset_token', data.access_token);
  if (data?.refresh_token) localStorage.setItem('mindset_refresh', data.refresh_token);
}

async function rafraichirSession(): Promise<boolean> {
  if (rafraichissementEnCours) return rafraichissementEnCours;

  const tentative = (async () => {
    try {
      // Deux chemins, dont un qui devrait désormais suffire.
      //
      // credentials: 'include' envoie le cookie de session. Depuis que l'API est
      // jointe sous notre propre domaine, ce cookie est de première partie et plus
      // rien ne le bloque — c'est le bon chemin, parce qu'un cookie `httpOnly`
      // échappe aux scripts et donc à une éventuelle faille XSS.
      //
      // Le jeton conservé ici part quand même, en second. Tant que le trajet du
      // cookie à travers la réécriture n'est pas prouvé par une vraie session de
      // plus de quinze minutes, le retirer, c'est risquer de renvoyer tout le monde
      // à l'écran de connexion pour la troisième fois. Le serveur prend le cookie
      // quand il l'a, ce corps sinon.
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: localStorage.getItem('mindset_refresh') || undefined }),
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data?.access_token) return false;
      memoriserSession(data);
      return true;
    } catch {
      return false;
    }
  })();

  rafraichissementEnCours = tentative;
  tentative.finally(() => {
    if (rafraichissementEnCours === tentative) rafraichissementEnCours = null;
  });
  return tentative;
}

function terminerSession() {
  localStorage.removeItem('mindset_token');
  // Le jeton de rafraîchissement part avec : le laisser derrière ferait présenter à
  // la connexion suivante un jeton que le serveur a déjà révoqué.
  localStorage.removeItem('mindset_refresh');
  // Et le questionnaire à moitié rempli, qui n'appartient qu'à la session qui
  // s'achève : le garder ferait rouvrir la connexion suivante sur les réponses de
  // quelqu'un d'autre, sur un téléphone prêté comme sur un compte changé.
  localStorage.removeItem(CLE_QUESTIONNAIRE_EN_COURS);
  window.location.href = '/?auth=true';
}

/**
 * Envoie la requête, et traduit le seul cas où fetch rejette vraiment.
 *
 * fetch ne rejette pas sur un 402 ou un 500 : il rejette quand la requête n'est
 * jamais partie — serveur injoignable, connexion coupée, tunnel bloqué. Le message
 * qu'il produit alors est écrit par le navigateur, en anglais et pour un
 * développeur : « Failed to fetch » sur Chrome, « NetworkError when attempting to
 * fetch resource » sur Firefox. L'écran de paiement affichait cette phrase telle
 * quelle sous le bouton — c'est-à-dire au moment précis où quelqu'un s'apprête à
 * donner sa carte, et où il faut être clair sur ce qui vient d'échouer.
 *
 * Le drapeau `reseau` permet aux écrans de distinguer « le serveur a refusé » de
 * « le serveur n'a rien reçu » : deux situations qui n'appellent pas la même phrase,
 * ni le même geste de la part de la personne.
 */
async function envoyer(lancer: () => Promise<Response>): Promise<Response> {
  try {
    return await lancer();
  } catch (cause) {
    const erreur: any = new Error(
      "Impossible de joindre le serveur. Vérifie ta connexion, puis réessaie.",
    );
    erreur.reseau = true;
    erreur.cause = cause;
    throw erreur;
  }
}

export const api = {
  get: async (endpoint: string) => {
    // Le jeton est relu à chaque tentative : après un rafraîchissement, c'est le
    // nouveau qu'il faut envoyer.
    const lancer = () =>
      fetch(`${API_URL}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('mindset_token')}` },
        credentials: 'include',
      });

    let res = await envoyer(lancer);

    // Le jeton d'accès ne dure que quinze minutes. Sans cette reprise, un 401
    // renvoyait à l'écran de connexion — et donc à un code 2FA par e-mail — quatre
    // fois par heure, au milieu de ce que la personne était en train de faire.
    if (res.status === 401 && !endpoint.startsWith('/auth/')) {
      if (await rafraichirSession()) res = await envoyer(lancer);
    }

    if (!res.ok) {
      if (res.status === 401) terminerSession();
      throw new Error('API Error');
    }
    return res.json();
  },
  post: async (endpoint: string, data: any, keepalive: boolean = false) => {
    const lancer = () =>
      fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('mindset_token')}`,
        },
        body: JSON.stringify(data),
        keepalive: keepalive,
        credentials: 'include',
      });

    let res = await envoyer(lancer);

    if (res.status === 401 && !endpoint.startsWith('/auth/')) {
      if (await rafraichirSession()) res = await envoyer(lancer);
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // On n'arrive ici sur un 401 qu'après un rafraîchissement déjà tenté et
        // refusé : la session est réellement finie.
        if (res.status === 401 && !endpoint.includes('/auth/')) {
          terminerSession();
        }
        // Le statut et le code sont conservés : le quota IA (402) doit pouvoir
        // ouvrir l'écran d'abonnement plutôt que d'afficher une erreur générique.
        const error: any = new Error(err.message || 'API Error');
        error.status = res.status;
        error.code = err.code;
        throw error;
    }
    return res.json();
  },

  /*
    Mêmes reprises et mêmes erreurs que `post` — seul le verbe change.

    Écrit à la main plutôt qu'en factorisant les deux : `post` porte un paramètre
    `keepalive` dont dépendent les envois de fin de session, et les fondre en une
    seule fonction ferait porter ce détail à un appel qui n'en a pas besoin.
  */
  patch: async (endpoint: string, data: any) => {
    const lancer = () =>
      fetch(`${API_URL}${endpoint}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('mindset_token')}`,
        },
        body: JSON.stringify(data),
        credentials: 'include',
      });

    let res = await envoyer(lancer);

    if (res.status === 401 && !endpoint.startsWith('/auth/')) {
      if (await rafraichirSession()) res = await envoyer(lancer);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401 && !endpoint.includes('/auth/')) {
        terminerSession();
      }
      const error: any = new Error(err.message || 'API Error');
      error.status = res.status;
      error.code = err.code;
      throw error;
    }
    return res.json();
  },

  /**
   * Une suppression, avec un corps.
   *
   * Elle n'existait pas : le client ne savait que lire, écrire et modifier. La
   * seule route qui en a besoin est la suppression de compte, et elle transporte
   * un mot de passe — d'où le corps, que `fetch` accepte parfaitement en DELETE
   * même si la méthode ne l'exige pas.
   *
   * Pas de rejeu après un 401 : cette route vit sous `/auth/`, où le
   * rafraîchissement ne s'applique pas, et une seconde tentative silencieuse sur
   * une action irréversible serait la dernière chose à souhaiter.
   */
  del: async (endpoint: string, data?: any) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('mindset_token')}`,
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error: any = new Error(err.message || 'API Error');
      error.status = res.status;
      error.code = err.code;
      throw error;
    }
    return res.json();
  },

  /**
   * Écrit l'état du serveur par-dessus le local, sans rien demander.
   *
   * C'est le geste destructeur : il n'a le droit de s'exécuter que lorsqu'on sait
   * qu'il n'écrase rien — soit parce que tout est remonté (`downloadCloudState`),
   * soit parce qu'on vient de mettre la version locale de côté (conflit).
   */
  adopterEtatDistant: async () => {
    // Le verrou vit ici, au plus près des écritures qu'il doit couvrir. Posé dans
    // un enrobage extérieur, il laissait passer toute écriture faite par un chemin
    // qui n'y était pas passé — et chacune relançait une remontée de l'état qu'on
    // était précisément en train de descendre.
    isSyncing = true;
    try {
      const data = await api.get('/sync/state');
      if (data) {
        // La version adoptée devient la base des prochaines remontées : sans elle,
        // le premier envoi qui suit se ferait refuser pour conflit à perpétuité.
        memoriserVersionServeur(data.updated_at);

        if (data.routines) localStorage.setItem('mindset_routines', JSON.stringify(data.routines));
        if (data.micro_objectives) localStorage.setItem('mindset_micro_obj', JSON.stringify(data.micro_objectives));
        if (data.macro_objectives) localStorage.setItem('mindset_macro_obj', JSON.stringify(data.macro_objectives));
        if (data.habits) localStorage.setItem('mindset_habits', JSON.stringify(data.habits));
        if (data.nutrition) localStorage.setItem('mindset_nutrition', JSON.stringify(data.nutrition));
        if (data.points !== undefined) setSecurePoints(data.points);
        /*
          L'expérience, et la reprise des comptes antérieurs à sa création.

          Le serveur fait autorité : une colonne renseignée est reprise telle
          quelle. Une colonne vide désigne un compte d'avant la séparation des
          deux compteurs — son solde de points tient alors lieu d'expérience de
          départ, une seule fois. Personne ne rétrograde à ce passage, et comme
          un niveau coûte désormais cinq fois moins, certains montent d'un rang.

          C'est ici que la reprise doit vivre, et pas dans un repli local :
          l'appareil qui se synchronise n'est pas forcément celui qui a joué.
        */
        if (typeof data.xp === 'number') definirXp(data.xp);
        else if (data.points !== undefined) definirXp(data.points);
        if (data.mental_score !== undefined) localStorage.setItem('mental_score', data.mental_score.toString());
        if (data.bonus_score !== undefined) localStorage.setItem('bonus_mental_score', data.bonus_score.toString());
        if (data.daily_scores) localStorage.setItem('mindset_daily_scores', JSON.stringify(data.daily_scores));
        if (data.rewards) localStorage.setItem('mindset_rewards', JSON.stringify(data.rewards));
        if (data.inventory) localStorage.setItem('mindset_inventory_rewards', JSON.stringify(data.inventory));
        if (data.owned_cosmetics) localStorage.setItem('mindset_owned_cosmetics', JSON.stringify(data.owned_cosmetics));
        if (data.ai_skin_id) localStorage.setItem('mindset_ai_skin_id', data.ai_skin_id);
        if (data.last_routine_date) localStorage.setItem('mindset_last_routine_date', data.last_routine_date);
        if (data.last_habit_date) localStorage.setItem('mindset_last_habit_date', data.last_habit_date);
        if (data.join_date) localStorage.setItem('mindset_join_date', data.join_date);
        if (data.settings) {
          if (data.settings.encryption !== undefined) localStorage.setItem('mindset_sec_encryption', data.settings.encryption.toString());
          if (data.settings.biometric !== undefined) localStorage.setItem('mindset_sec_biometric', data.settings.biometric.toString());
          if (data.settings.localHistory !== undefined) localStorage.setItem('mindset_sec_local', data.settings.localHistory.toString());
          /*
            La personnalisation. Une chaîne vide veut dire « rien de posé de ce
            côté-là » et ne doit donc rien écraser ici — même convention que pour
            l'apparence du coach, juste au-dessus.

            Le thème et les particules s'appliquent tout seuls : les deux écoutent
            `storage`, que la descente émet en repartant.
          */
          if (data.settings.aiName) localStorage.setItem('mindset_ai_name', data.settings.aiName);
          if (data.settings.appThemeId) localStorage.setItem('mindset_app_theme_id', data.settings.appThemeId);
          if (data.settings.textColor) localStorage.setItem('mindset_text_color', data.settings.textColor);
          if (data.settings.particles !== undefined) localStorage.setItem('mindset_particles', data.settings.particles.toString());
        }
        
        /*
          L'état adopté est celui du serveur : il est donc, par définition, en
          sécurité. Le confirmer ici évite qu'un état fraîchement descendu paraisse
          « non sauvegardé » et déclenche une remontée inutile — voire, sur un
          compte qui n'a jamais confirmé, une remontée en boucle.

          On recompose l'état plutôt que de réutiliser `data` : ce qui compte est
          l'empreinte de ce que `construireEtatLocal` lira, et le serveur peut avoir
          borné une liste ou refusé une XP en chemin.
        */
        confirmerEtat(construireEtatLocal(), data.updated_at);

        // Force React components to re-render with new data
        window.dispatchEvent(new Event('storage'));
      }
    } catch (e) {
      console.error('Failed to download state', e);
    } finally {
      isSyncing = false;

      /*
        Le ménage se fait **après** la levée du verrou, et volontairement.

        Le serveur renvoie encore aux anciens comptes les objectifs et routines que
        l'application distribuait d'office. Nettoyer pendant la descente les
        retirerait de l'écran mais pas du serveur, qui les réexpédierait à la
        connexion suivante, indéfiniment. Écrire hors de cette fenêtre déclenche la
        remontée automatique et referme le sujet pour de bon.
      */
      if (nettoyerSemis()) window.dispatchEvent(new Event('storage'));

      /*
        L'état qu'on vient d'adopter peut dater d'hier : le serveur ne décoche
        jamais rien, c'est le navigateur qui le fait à l'ouverture. Il faut donc le
        ramener à aujourd'hui — et **hors du verrou**, pour la même raison que le
        ménage ci-dessus : une écriture faite pendant la descente ne déclenche
        aucune remontée, et ce décochage-là resterait sur cet appareil seul.
      */
      if (appliquerNouveauJour()) signalerChangementRoutines();

      signalerEtatSynchro();
    }
  },

  /**
   * Descend l'état du serveur, sans jamais écraser du travail qu'il n'a pas reçu.
   *
   * C'est l'entrée publique : tout ce qui n'est pas la résolution d'un conflit doit
   * passer par ici. On tente de remonter d'abord ; si ça ne passe toujours pas, on
   * renonce à descendre. L'appareil reste alors en retard sur les autres, ce qui se
   * rattrape à la requête suivante — là où l'écrasement, lui, ne se rattrape jamais.
   */
  downloadCloudState: async () => {
    if (aDesModificationsNonSynchronisees(construireEtatLocal())) {
      await api.syncStateToCloud();

      if (aDesModificationsNonSynchronisees(construireEtatLocal())) {
        console.warn(
          '[synchro] Descente annulée : des changements locaux ne sont pas encore remontés. ' +
            'Ils seraient écrasés par une version plus ancienne du serveur.',
        );
        signalerEtatSynchro();
        return;
      }
    }

    await api.adopterEtatDistant();
  },

  /**
   * Remonte l'état local, **une remontée à la fois**. Rend `true` si le serveur l'a
   * accusé.
   *
   * Neuf endroits déclenchent une remontée : le débounce de 500 ms qui suit chaque
   * écriture, le passage en arrière-plan, la reprise à la minute, le retour du
   * réseau, et cinq appels directs (Boutique, Inventaire, Profil, pastille de
   * sauvegarde). Rien ne les empêchait de se chevaucher — et deux remontées
   * simultanées lisent forcément la **même** `base_version`, puisque ni l'une ni
   * l'autre n'a encore rapporté la nouvelle.
   *
   * La première passe et fait avancer la ligne du serveur ; la seconde arrive avec
   * une version devenue périmée, le serveur rend 409, et l'appareil **déclare un
   * conflit contre lui-même** : « Tes données ont changé ailleurs », copie mise de
   * côté, alors qu'aucun autre appareil n'existe. Signalé par Yannis, deux fois en
   * dix minutes. C'est d'autant plus fréquent sur téléphone que le backend est sur
   * une instance qui s'endort : une requête peut durer plusieurs secondes, et la
   * fenêtre de chevauchement dure autant.
   *
   * Reproduit avant correction : deux appels concurrents produisaient six envois,
   * tous portant la même `base_version`, et une copie de conflit.
   *
   * On sérialise donc, sans jamais rien perdre : une demande arrivée pendant un
   * envoi n'est pas jetée, elle est **regroupée** — un seul envoi de plus partira à
   * la fin, avec la version que celui en cours aura rapportée et l'état tel qu'il
   * sera à ce moment-là. Les conflits entre deux vrais appareils, eux, remontent
   * toujours.
   */
  syncStateToCloud: (): Promise<boolean> => {
    if (envoiEnCours) {
      envoiRedemande = true;
      return envoiEnCours;
    }

    envoiEnCours = (async () => {
      try {
        let abouti = await api.remonterEtatUneFois();
        // `while` et non `if` : le regroupement doit tenir même si des écritures
        // continuent d'arriver pendant l'envoi de rattrapage. Chaque tour coûte un
        // aller-retour réseau, la boucle ne peut donc pas s'emballer.
        while (envoiRedemande) {
          envoiRedemande = false;
          abouti = await api.remonterEtatUneFois();
        }
        return abouti;
      } finally {
        envoiEnCours = null;
        envoiRedemande = false;
      }
    })();

    return envoiEnCours;
  },

  /**
   * Un envoi, et un seul. **Ne pas appeler directement** : passer par
   * `syncStateToCloud`, qui garantit qu'il n'y en a jamais deux en vol.
   *
   * L'état est construit par `construireEtatLocal`, la même fonction que celle dont
   * on calcule l'empreinte : les faire diverger reviendrait un jour à déclarer en
   * sécurité un état que le serveur n'a jamais reçu.
   */
  remonterEtatUneFois: async (): Promise<boolean> => {
    /*
      On ne remonte rien tant qu'on ignore ce que le serveur détient.

      Écrire le jeton de session déclenche l'instrumentation, donc une remontée
      temporisée : sur un appareil qui vient de se connecter, elle partait en course
      avec la première descente, avec un état local encore vide. Réseau lent, la
      course est perdue, et le compte est effacé par son propre propriétaire.

      La descente confirme l'état qu'elle installe : cette porte se rouvre d'
      elle-même dès le premier échange réussi, et un compte neuf n'est pas bloqué
      puisque le serveur crée sa ligne à la première lecture.
    */
    if (!baseDeComparaisonConnue()) return false;

    const state = construireEtatLocal();

    /*
      Une décision explicite ne se fait pas refuser pour cause de conflit.

      Quand quelqu'un vient d'appuyer sur « Récupérer ma version », il n'y a plus
      rien à départager : il a lu la question et répondu. Renvoyer sa `base_version`
      d'avant ferait rendre 409 au serveur, remettrait de côté ce qu'on vient de
      reprendre, et rendrait à l'écran la version qu'il a précisément refusée.
      L'absence de `base_version` est acceptée par le serveur — c'est la porte de
      sortie prévue, et c'est ici qu'elle sert.
    */
    const impose = impositionExigee();

    try {
      /*
        `base_version` dit sur quelle version du serveur ce travail a été construit.

        Le serveur remplace toute la ligne d'un coup : sans cette information, deux
        appareils qui écrivent l'un après l'autre s'effacent mutuellement, et le
        perdant ne l'apprend jamais. Le serveur rend 409 plutôt que d'écraser.
      */
      const reponse: any = await api.post(
        '/sync/state',
        impose ? state : { ...state, base_version: versionServeurConnue() },
        keepaliveAcceptable(state),
      );

      // Le droit d'écraser ne vaut que pour l'envoi qui portait la décision. Il est
      // rendu dès qu'elle est arrivée, et pas avant : une coupure réseau doit laisser
      // les tentatives suivantes bénéficier du même passe-droit.
      if (impose) impositionTerminee();

      // On confirme l'empreinte de ce qui a été **envoyé**, pas de ce qui est là
      // maintenant : une case cochée pendant que la requête voyageait n'était pas
      // dans le corps sérialisé, et c'est précisément elle qu'une descente
      // écraserait si on la déclarait en sécurité.
      confirmerEtat(state, reponse?.updated_at);
      signalerEtatSynchro();
      return true;
    } catch (e: any) {
      if (e?.status === 409) {
        /*
          Un autre appareil a écrit entre-temps.

          On ne peut pas départager deux versions sans inventer une intention que
          personne n'a exprimée. Le seul geste honnête est de ne rien détruire : on
          met la copie locale de côté, on adopte celle du serveur — la plus
          récente — et on laisse la personne trancher, avec un bouton pour revenir.
        */
        const avantAdoption = empreinteCanonique(construireEtatLocal());
        const copieFaite = mettreDeCoteAvantConflit();

        // L'empreinte est oubliée avant d'adopter : sans ça, l'état distant qu'on
        // s'apprête à écrire serait comparé à une confirmation qui décrit l'état
        // local, et tout paraîtrait « non sauvegardé » pour toujours.
        oublierEmpreinte();
        await api.adopterEtatDistant();

        /*
          Un conflit contre soi-même ne se raconte pas à la personne.

          Le 409 dit « la version du serveur a bougé depuis celle sur laquelle tu
          t'es appuyé ». Il ne dit pas que les deux versions **diffèrent**. Or le
          cas le plus courant, de loin, est celui où elles sont identiques : deux
          onglets du même navigateur, ou l'application installée à côté du site,
          partagent le même stockage local et envoient donc le même contenu. Le
          premier fait avancer la ligne, le second se fait refuser — et l'écran
          demandait alors de départager deux versions rigoureusement égales. C'est
          ce que les utilisateurs ont signalé comme « ça revient souvent ».

          La question honnête n'est pas « le serveur a-t-il bougé ? » mais
          « quelque chose a-t-il changé ici en adoptant ? ». Si rien n'a changé,
          on efface la copie mise de côté, on ne dit rien, et le travail continue.
          Un vrai conflit entre deux appareils, lui, modifie l'écran : il reste
          signalé, exactement comme avant.
        */
        if (empreinteCanonique(construireEtatLocal()) === avantAdoption) {
          if (copieFaite) oublierCopieDeConflit();
          console.info('[synchro] Version du serveur adoptée : contenu identique, rien à départager.');
          signalerEtatSynchro();
          return true;
        }

        console.warn('[synchro] Conflit entre appareils : la version locale est mise de côté.');
        if (copieFaite) window.dispatchEvent(new Event('synchroConflit'));
        signalerEtatSynchro();
        return true;
      }

      // L'empreinte n'est pas confirmée : la descente refusera d'écraser tant que
      // cette remontée n'aura pas abouti. Rien n'est perdu, seulement retardé.
      console.error('Failed to sync state', e);
      signalerEtatSynchro();
      return false;
    }
  },

  /**
   * Crédite côté serveur les coins d'une action validée.
   *
   * Le solde qui autorise l'IA vit désormais en base : le total gardé en
   * localStorage ne sert plus qu'à l'affichage. `eventKey` doit identifier
   * l'action ET le jour, sinon cocher/décocher en boucle rapporterait à l'infini.
   * Volontairement silencieux : une action validée ne doit jamais échouer parce
   * que le réseau a hoqueté.
   */
  claimCoins: async (eventKey: string) => {
    try {
      return await api.post('/ai-coaching/coins/claim', { eventKey });
    } catch (e) {
      console.warn('Coins non crédités côté serveur:', e);
      return null;
    }
  },

  /**
   * Prévient le serveur de ce que l'appareil a répondu.
   *
   * Un refus ne laissait aucune trace ailleurs que dans une console que personne
   * n'ouvre. Impossible, dans ces conditions, de distinguer « ils refusent » de
   * « on ne leur a jamais posé la question » — deux problèmes sans rapport.
   */
  signalerPermissionPush: async (etat: EtatPush) => {
    try {
      await api.post('/push/permission', {
        etat,
        deviceId: identifiantAppareil(),
        plateforme: navigator.userAgent.slice(0, 200),
      });
    } catch (e) {
      // Une mesure ratée ne doit jamais empêcher l'abonnement lui-même.
      console.warn('État de permission non remonté', e);
    }
  },

  /**
   * @param demanderPermission `false` pour ne rien afficher : on se contente de
   * remettre l'abonnement en place quand la permission est déjà accordée. C'est le
   * cas au chargement de l'app — la demande, elle, part d'un clic dans notre carte.
   *
   * Appeler `Notification.requestPermission()` sans geste de l'utilisateur n'était pas
   * seulement brutal : Firefox l'ignore depuis sa version 72, si bien qu'aucun
   * utilisateur Firefox ne voyait jamais la question.
   *
   * **Rend ce qui s'est réellement passé, et non un booléen.** `false` désignait
   * aussi bien un refus qu'une panne, et surtout : une exception levée après
   * l'accord — la clé VAPID, l'abonnement, l'enregistrement côté serveur — était
   * rattrapée par l'appelant, qui relisait alors `Notification.permission`, y
   * trouvait « accordée » et faisait disparaître la carte. La personne repartait
   * convaincue d'être abonnée sans qu'aucun abonnement n'existe, et ne
   * l'apprendrait qu'en ne recevant jamais rien. Exactement la panne qui ne se
   * signale pas.
   */
  subscribeToPushNotifications: async (demanderPermission = true): Promise<ResultatAbonnement> => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      console.warn('Notifications_Not_Supported');
      const etat = estIOS() && !estInstallee() ? 'ios_a_installer' : 'non_supporte';
      await api.signalerPermissionPush(etat);
      return etat;
    }

    /*
      On repose la question même quand la réponse enregistrée est « refusé ».

      Elle ne coûte rien : un navigateur qui a bloqué l'origine résout la promesse
      sur-le-champ, sans rien afficher. En revanche, la refuser de notre côté
      condamnait des situations parfaitement rattrapables — quelqu'un qui vient de
      réautoriser le site dans ses réglages, un état lu au chargement puis devenu
      faux, une boîte de dialogue simplement écartée. Le bouton « Activer » doit
      toujours mener à une vraie demande : c'est la seule chose qu'il promet.
    */
    let permission = Notification.permission;
    if (permission !== 'granted') {
      if (!demanderPermission) return permission === 'denied' ? 'refuse' : 'a_demander';
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      console.warn('Permission_Denied');
      await api.signalerPermissionPush('refuse');
      return 'refuse';
    }

    /*
      À partir d'ici, la permission est acquise et tout ce qui échoue est de notre
      côté : clé VAPID injoignable, service de push qui refuse, serveur muet. C'est
      un échec technique, pas un refus, et il ne doit surtout pas se lire comme une
      réussite — d'où le `try` qui couvre le reste plutôt qu'une exception laissée à
      l'appelant.
    */
    try {
      return await api.enregistrerAbonnementPush();
    } catch (e) {
      console.error("Abonnement push impossible alors que la permission est accordée", e);
      return 'echec';
    }
  },

  /** La partie technique de l'abonnement, une fois la permission acquise. */
  enregistrerAbonnementPush: async (): Promise<ResultatAbonnement> => {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    const vapidResponse = await api.get('/push/vapid-public-key');
    const convertedVapidKey = urlBase64ToUint8Array(vapidResponse.publicKey);

    // Un abonnement est scellé à la clé VAPID qui l'a créé. Si le serveur signe
    // désormais avec une autre clé, le service de push rejette tous les envois — et
    // comme getSubscription() renvoie l'ancien abonnement, on le réenregistrerait
    // indéfiniment sans jamais en créer un valide. On compare donc les clés, et on
    // se désabonne pour repartir proprement quand elles diffèrent.
    if (subscription) {
      const cleActuelle = subscription.options?.applicationServerKey;
      const identique =
        !!cleActuelle &&
        new Uint8Array(cleActuelle).length === convertedVapidKey.length &&
        new Uint8Array(cleActuelle).every((octet, i) => octet === convertedVapidKey[i]);

      if (!identique) {
        console.warn('Clé VAPID changée : recréation de l\'abonnement push.');
        await subscription.unsubscribe();
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    }

    await api.post('/push/subscribe', { subscription, deviceId: identifiantAppareil() });
    await api.signalerPermissionPush('accorde');
    return 'accorde';
  },

  /**
   * Demande au serveur s'il faut reparler de l'abonnement, et sous quel angle.
   *
   * La décision ne peut pas se prendre ici : le navigateur ignore l'âge réel du
   * compte et l'usage réel, et sa mémoire de ce qu'on a déjà montré disparaît au
   * premier changement d'appareil — la même personne recevrait la même sollicitation
   * indéfiniment.
   */
  relanceOffre: async (): Promise<DecisionRelance> => {
    try {
      return await api.get('/subscriptions/relance');
    } catch (e) {
      // Une relance ratée ne doit jamais abîmer le dashboard : dans le doute, on se tait.
      console.warn('Relance non récupérée', e);
      return { afficher: false };
    }
  },

  repondreRelance: async (palier: string, action: 'vue' | 'reporte' | 'ouvert') => {
    try {
      await api.post('/subscriptions/relance/reponse', { palier, action });
    } catch (e) {
      console.warn('Réponse à la relance non remontée', e);
    }
  }
};

/** Ce que le serveur décide d'une relance vers l'abonnement. */
export interface DecisionRelance {
  afficher: boolean;
  raison?: 'abonne' | 'trop_jeune' | 'trop_recent' | 'palier_atteint';
  palier?: 'j3' | 'j7' | 'j21' | 'recurrent';
  angle?: 'coins' | 'quota' | 'temps';
  jours?: number;
  messagesUtilises?: number;
  messagesRestants?: number;
  coins?: number;
}

/** Ce que l'appareil a répondu, ou ce qui l'empêche de répondre. */
export type EtatPush = 'accorde' | 'refuse' | 'non_supporte' | 'ios_a_installer' | 'reporte';

/**
 * Ce qu'a donné une tentative d'abonnement.
 *
 * `echec` est la valeur qui manquait : la permission est accordée mais
 * l'abonnement n'existe pas. Sans elle, ce cas se confondait avec la réussite.
 */
export type ResultatAbonnement = Exclude<EtatPush, 'reporte'> | 'echec' | 'a_demander';

/**
 * Identifiant stable de ce navigateur. L'endpoint push, lui, change à chaque
 * recréation de l'abonnement : sans ce repère, le serveur garde l'ancienne
 * inscription en plus de la nouvelle et l'appareil reçoit tout en double.
 */
export function identifiantAppareil(): string {
  let deviceId = localStorage.getItem('mindset_device_id');
  if (!deviceId) {
    deviceId = (crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
    localStorage.setItem('mindset_device_id', deviceId);
  }
  return deviceId;
}

/*
  La reconnaissance de l'appareil vit désormais dans `utils/plateforme.ts`, et n'a
  qu'une seule définition.

  Elle était écrite ici, et `estIOS` y ratait **tous les iPad** : depuis iPadOS 13,
  Safari s'y annonce comme un Mac de bureau et le mot « ipad » a quitté la chaîne.
  Trois chemins en dépendent — la carte d'installation, l'état `ios_a_installer`
  des permissions push, et `cheminDeReautorisation()` — et les trois donnaient donc
  à un utilisateur iPad la consigne prévue pour un ordinateur.

  Réexporté pour les appelants existants. `plateforme.ts` ne dépend de rien, et
  surtout pas de ce fichier-ci, dont le simple import installe la surcharge de
  `localStorage.setItem`.
*/
export { estIOS, estAndroid, estInstallee };

/**
 * Où se réautorisent les notifications, sur cet appareil précisément.
 *
 * On envoyait tout le monde vers « le cadenas à gauche de l'adresse du site ».
 * Dans une application installée sur l'écran d'accueil, **il n'y a pas de barre
 * d'adresse** : le conseil décrivait un écran que la personne n'avait pas sous les
 * yeux, et la seule conclusion possible était que l'app se moquait d'elle. C'est ce
 * qu'on nous a rapporté, mot pour mot : « ça me dit d'appuyer sur un truc sur mon
 * navigateur ».
 *
 * Chaque système range ce réglage à un endroit différent, et l'installation change
 * la réponse : une PWA installée devient une application aux yeux du système, avec
 * sa propre entrée dans les réglages.
 */
export function cheminDeReautorisation(): string {
  const installee = estInstallee();

  if (estIOS()) {
    return installee
      ? 'Ouvre Réglages ▸ Notifications ▸ Disciplix, et autorise-les.'
      : "Touche « aA » à gauche de l'adresse ▸ Réglages du site, puis autorise les notifications.";
  }

  if (estAndroid()) {
    return installee
      ? "Appui long sur l'icône Disciplix ▸ Infos sur l'appli ▸ Notifications, et active-les."
      : 'Touche le cadenas à gauche de l’adresse ▸ Autorisations, puis autorise les notifications.';
  }

  return 'Clique sur le cadenas à gauche de l’adresse du site, puis autorise les notifications.';
}

/**
 * Ce qu'on peut faire pour cet appareil, ici et maintenant.
 *
 * `a_demander` est le seul cas où la carte a un bouton utile : ailleurs, soit c'est
 * déjà fait, soit le navigateur ne reposera plus la question, soit l'appareil en est
 * incapable tant qu'il n'a pas installé l'app.
 */
export function diagnostiquerPush(): EtatPush | 'a_demander' {
  if (estIOS() && !estInstallee()) return 'ios_a_installer';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'non_supporte';
  }
  if (Notification.permission === 'granted') return 'accorde';
  if (Notification.permission === 'denied') return 'refuse';
  return 'a_demander';
}

/**
 * Prévient quand la réponse de l'appareil change, pendant qu'on la regarde.
 *
 * Réautoriser les notifications se fait **hors de l'application** : dans les
 * réglages du système ou du navigateur. Sans cette surveillance, quelqu'un qui
 * suivait notre marche à suivre revenait sur une carte qui lui répétait que les
 * notifications étaient bloquées — il devait recharger la page pour que l'app
 * s'aperçoive de ce qu'il venait de faire. C'est le moment exact où l'on perd
 * quelqu'un qui vient de faire l'effort demandé.
 *
 * Deux sources, parce qu'aucune ne suffit seule : `permissions.onchange` prévient
 * immédiatement là où il existe (pas sur Safari, donc pas sur iPhone), et le retour
 * sur l'onglet couvre tout le reste — c'est précisément le geste que fait quelqu'un
 * qui revient des réglages.
 *
 * @returns de quoi arrêter la surveillance.
 */
export function surveillerPermissionPush(rappel: () => void): () => void {
  let vivant = true;
  let statut: any = null;
  const signaler = () => {
    if (vivant) rappel();
  };
  const surVisibilite = () => {
    if (document.visibilityState === 'visible') signaler();
  };

  document.addEventListener('visibilitychange', surVisibilite);
  // `focus` rattrape le navigateur de bureau, où changer une autorisation ne masque
  // jamais l'onglet — la boîte de réglages est une surcouche de la même page.
  window.addEventListener('focus', signaler);

  (navigator as any).permissions
    ?.query({ name: 'notifications' })
    .then((s: any) => {
      if (!vivant) return;
      statut = s;
      s.onchange = signaler;
    })
    .catch(() => {
      // Safari refuse cette requête pour les notifications : le retour d'onglet
      // reste alors la seule source, et il couvre le cas qui compte.
    });

  return () => {
    vivant = false;
    document.removeEventListener('visibilitychange', surVisibilite);
    window.removeEventListener('focus', signaler);
    if (statut) statut.onchange = null;
  };
}

// Utility function for VAPID key conversion
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Global debounced auto-sync hook
let syncTimeout: any;
let isSyncing = false;

/*
  La remontée en vol, et la demande arrivée pendant qu'elle voyageait.

  `isSyncing` ne couvre que la **descente** — il empêche les écritures d'une adoption
  de relancer une remontée. Rien ne couvrait la remontée elle-même, alors que neuf
  chemins peuvent la déclencher : deux qui se chevauchent envoient la même
  `base_version` et la seconde se fait refuser pour conflit. Voir `syncStateToCloud`.

  Déclarées ici, avec l'autre verrou, plutôt que près de leur usage : les trois
  décrivent le même sujet — qui a le droit d'écrire, et quand.
*/
let envoiEnCours: Promise<boolean> | null = null;
let envoiRedemande = false;

try {
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    originalSetItem.apply(this, [key, value]);

    /*
      La comptabilité de la synchro n'est pas du travail à sauvegarder.

      Sans cette sortie, une remontée réussie se reprogramme elle-même : elle appelle
      `confirmerEtat`, qui écrit `mindset_empreinte_confirmee` et
      `mindset_version_serveur`, deux clés en `mindset_` — donc deux remontées de
      plus, une demi-seconde après. Un envoi toutes les 500 ms, indéfiniment, sur
      chaque appareil connecté. Voir `CLES_TENUE_SYNCHRO`.
    */
    if (CLES_TENUE_SYNCHRO.has(key)) return;

    /*
      Un cache d'affichage n'est pas du travail à sauvegarder.

      Ces clés gardent au chaud ce que le serveur vient de nous dire, pour ne pas
      le redemander à chaque écran. Sans cette sortie, mettre en cache une phrase
      calculée à partir de l'état de quelqu'un déclencherait la remontée de tout
      cet état — un aller-retour réseau complet pour un cache. Voir `clesCache.ts`.
    */
    if (CLES_CACHE_AFFICHAGE.has(key)) return;

    // Ignore updates that are just downloading from cloud to prevent feedback loops
    if (isSyncing) return;

    if (key.startsWith('mindset_') || key.includes('mental_score')) {
      /*
        Cette instrumentation déclenche la remontée, elle ne décide plus de rien.

        Une première version comptait ici les écritures pour savoir s'il restait du
        travail non sauvegardé. C'était fragile : le jour où du code aurait écrit
        par un autre chemin, le compteur aurait sous-compté et la protection aurait
        cessé d'agir sans rien dire. La question est désormais tranchée par
        l'empreinte de l'état lui-même, qui ne dépend d'aucun passage obligé.

        **Le signal part après l'écriture en cours, jamais pendant.** Calculer cette
        empreinte relit tout l'état local, soldes signés compris — et une donnée qui
        tient en deux entrées de stockage est incohérente entre ses deux écritures.
        Appelé ici en direct, ce calcul tombait dans cet intervalle et lisait une
        valeur neuve accompagnée de la signature de l'ancienne : l'anti-triche se
        déclenchait contre l'application, et **valider une habitude remettait les
        coins et l'XP à zéro** (mesuré : 500 → 0, puis remonté au serveur).

        Les deux compteurs se défendent maintenant aussi de leur côté, mais la
        correction vit d'abord ici : lire l'état d'autrui au beau milieu de son
        écriture est un piège tendu à tout ce qui s'écrira un jour en deux temps, et
        le prochain à tomber dedans n'aurait aucune raison de s'en méfier.
      */
      queueMicrotask(signalerEtatSynchro);

      clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        try {
          if (localStorage.getItem('mindset_token')) {
            api.syncStateToCloud();
          }
        } catch (e) {}
      }, 500); // 500ms debounce
    }
  };

  /*
    Le passage d'un jour à l'autre, application ouverte.

    Le décochage quotidien ne se faisait qu'au montage du tableau de bord. Or une
    application installée n'est pas fermée le soir, elle est mise en veille : au
    réveil, le composant est toujours monté et la journée d'hier restait affichée,
    toute cochée. La première écriture venue la datait alors d'aujourd'hui et
    l'envoyait au serveur comme une journée déjà faite.

    Deux occasions de s'en apercevoir, parce qu'aucune ne suffit seule : le retour
    dans l'application couvre le téléphone, où l'onglet est masqué pendant la nuit,
    et la minute couvre l'écran resté allumé, où rien ne se passe jamais.
  */
  const verifierLeJour = () => {
    if (appliquerNouveauJour()) signalerChangementRoutines();
  };
  setInterval(verifierLeJour, 60000);

  // Force sync when page is hidden/closed to prevent data loss
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') verifierLeJour();

    if (localStorage.getItem('mindset_token')) {
      if (document.visibilityState === 'hidden') {
        api.syncStateToCloud();
      } else if (document.visibilityState === 'visible') {
        // Automatically fetch latest data when opening the app/switching tabs
        api.downloadCloudState();
      }
    }
  });

  /*
    Reprise automatique tant qu'il reste du travail non sauvegardé.

    Sans elle, le garde-fou tenait à un geste : il fallait quitter l'application et
    y revenir pour qu'une nouvelle tentative parte. Quelqu'un qui traverse un tunnel
    en cochant ses tâches restait donc bloqué sur « non sauvegardé » jusqu'à ce
    qu'il pense à changer d'onglet — c'est-à-dire, en pratique, jamais.

    Une minute entre deux tentatives : assez court pour que la pastille disparaisse
    d'elle-même dès que le réseau revient, assez long pour ne pas marteler un
    serveur qui refuse. Et la première chose que fait le navigateur en retrouvant le
    réseau, c'est nous prévenir — d'où l'écoute d'`online`, qui rend la reprise
    immédiate dans le cas le plus fréquent.
  */
  const reprendre = () => {
    if (!localStorage.getItem('mindset_token')) return;
    if (navigator.onLine === false) return;
    if (!aDesModificationsNonSynchronisees(construireEtatLocal())) return;
    api.syncStateToCloud();
  };

  setInterval(reprendre, 60000);
  window.addEventListener('online', () => {
    signalerEtatSynchro();
    reprendre();
  });
  window.addEventListener('offline', signalerEtatSynchro);
} catch (e) {
  console.warn('localStorage override failed');
}
