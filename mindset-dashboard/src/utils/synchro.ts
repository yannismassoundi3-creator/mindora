import { CLES_ACCOMPAGNANTES, CLES_SYNCHRONISEES } from './etatLocal';

/**
 * Savoir si ce navigateur porte du travail que le serveur n'a jamais reçu.
 *
 * La descente d'état réécrit trente clés de `localStorage` sans comparer quoi que
 * ce soit, et s'exécute à chaque retour sur l'onglet. Tant que la remontée réussit,
 * c'est sans conséquence. Mais elle échoue en silence — réseau coupé, session
 * expirée, requête tuée en arrière-plan — et la séquence devenait : la synchro
 * rate, la personne continue de cocher ses tâches, elle change d'application, elle
 * revient, et le serveur plus ancien écrase sa matinée. Sans un mot.
 *
 * **La question posée ici est la seule qui suffise à ne rien détruire :** l'état
 * présent est-il exactement celui que le serveur a accusé la dernière fois ?
 *
 * Une empreinte du contenu, et non un compteur d'écritures. La première version de
 * ce garde-fou comptait les appels à `localStorage.setItem`, ce qui la rendait
 * dépendante d'une instrumentation posée ailleurs : le jour où du code aurait
 * écrit par un autre chemin, le compteur aurait sous-compté et la protection aurait
 * cessé d'agir **sans rien dire** — exactement la famille de panne qu'elle existe
 * pour empêcher. L'empreinte, elle, ne peut pas se tromper : elle regarde ce qui
 * est là. Elle rattrape au passage l'aller-retour (une case cochée puis décochée
 * ne compte plus comme un changement) et se moque de l'ordre des écritures.
 */

const CLE_EMPREINTE = 'mindset_empreinte_confirmee';
const CLE_VERSION = 'mindset_version_serveur';
const CLE_CONFLIT = 'mindset_copie_conflit';
const CLE_IMPOSITION = 'mindset_imposer_version';

/**
 * La comptabilité de la synchro : ce que ce module écrit **sur** la synchro, et non
 * ce que la personne a fait.
 *
 * **L'instrumentation de `localStorage.setItem` doit les ignorer**, sans quoi c'est
 * une boucle sans fin : une remontée réussie appelle `confirmerEtat`, qui écrit deux
 * clés en `mindset_`, dont chacune reprogramme une remontée cinq cents millisecondes
 * plus tard, qui réussit, qui réécrit… Un envoi toutes les demi-secondes, pour
 * toujours, sur chaque appareil connecté — et le moindre chevauchement dans ce flot
 * fait rendre 409 au serveur, donc affiche « Tes données ont changé ailleurs » à
 * quelqu'un qui n'a qu'un seul appareil.
 *
 * Cette garde existait sous le nom `CLES_COMPTEUR`, du temps où la synchro comptait
 * les écritures. Elle a disparu avec le compteur quand l'empreinte l'a remplacé
 * (`d8a8218`) — alors que les nouvelles clés en avaient exactement le même besoin.
 * Une protection qui ne vit que dans la mécanique qu'elle protège s'en va avec elle :
 * elle est donc déclarée ici, à côté des clés, et non chez celui qui la consulte.
 *
 * `mindset_copie_conflit` en fait partie pour une deuxième raison : c'est une copie
 * de tout le reste, et déclencher une remontée en la rangeant reviendrait à envoyer
 * l'état au moment précis où l'on vient de constater qu'il est en litige.
 */
export const CLES_TENUE_SYNCHRO: ReadonlySet<string> = new Set([
  CLE_EMPREINTE,
  CLE_VERSION,
  CLE_CONFLIT,
  CLE_IMPOSITION,
]);

/**
 * Au-delà, le drapeau d'imposition est oublié.
 *
 * Il désarme la détection de conflit : tant qu'il est posé, ce navigateur écrase
 * le serveur sans lui demander son avis. C'est ce qu'on veut le temps qu'une
 * décision explicite parte, jamais au-delà — un appareil resté hors ligne une
 * semaine ne doit pas se réveiller avec le droit d'effacer une semaine de travail
 * fait ailleurs.
 */
const DUREE_IMPOSITION_MS = 24 * 3600 * 1000;

/**
 * Empreinte courte et stable d'une valeur sérialisable.
 *
 * FNV-1a : quelques instructions par caractère, aucune dépendance, et une collision
 * demanderait deux états différents tombant sur le même entier de 32 bits. Le pire
 * cas d'une collision ici est une remontée que l'on croit inutile — pas une perte,
 * puisque la moindre écriture suivante relance le cycle.
 */
export function empreinte(valeur: unknown): string {
  let texte: string;
  try {
    texte = JSON.stringify(valeur) ?? '';
  } catch {
    // Un état qu'on ne sait pas sérialiser ne sera pas envoyable non plus : on rend
    // une empreinte qui ne correspondra à aucune confirmation, donc « à remonter ».
    return 'illisible-' + Date.now();
  }

  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Reste-t-il ici du travail que le serveur n'a jamais accusé ?
 *
 * **Sans confirmation enregistrée, la réponse est non**, et c'est le point le plus
 * délicat de tout ce mécanisme.
 *
 * Il est tentant de répondre « oui par précaution » : dans le doute, on protégerait
 * le local. Ce serait un désastre, et le raisonnement se retourne complètement sur
 * un appareil neuf. Là, rien n'a jamais été confirmé et l'état local est **vide** :
 * répondre « oui » ferait remonter ce vide par-dessus le compte réel avant même la
 * première descente. Chaque connexion sur un nouveau téléphone effacerait le
 * travail de la personne.
 *
 * L'absence de confirmation ne veut pas dire « j'ai du travail à sauver », elle veut
 * dire « je ne sais rien de ce que le serveur détient ». Dans ce cas, c'est lui qui
 * fait autorité, et la descente qui suit confirme l'état — tout ce qui vient après
 * est protégé.
 *
 * Les deux autres cas tombent juste d'eux-mêmes. Après une déconnexion volontaire,
 * `oublierLaSession()` a effacé la confirmation avec les données : le serveur fait
 * autorité, ce qui est correct. Après une session expirée, `terminerSession()` a
 * gardé les deux : la comparaison a un sens, et le travail non remonté est protégé.
 */
export function aDesModificationsNonSynchronisees(etat: unknown): boolean {
  const confirmee = localStorage.getItem(CLE_EMPREINTE);
  if (confirmee === null) return false;
  return empreinte(etat) !== confirmee;
}

/**
 * Le serveur a accusé cet état précis.
 *
 * On enregistre l'empreinte de ce qui a été **envoyé**, pas de ce qui est présent
 * à l'instant où la réponse arrive : une case cochée pendant que la requête voyage
 * n'était pas dans le corps sérialisé, et la déclarer en sécurité l'effacerait de
 * la mémoire du garde-fou — c'est précisément elle que la prochaine descente
 * écraserait.
 */
export function confirmerEtat(etatEnvoye: unknown, versionServeur?: string | null): void {
  localStorage.setItem(CLE_EMPREINTE, empreinte(etatEnvoye));
  if (typeof versionServeur === 'string' && versionServeur) {
    localStorage.setItem(CLE_VERSION, versionServeur);
  }
}

/**
 * Sait-on seulement ce que le serveur détient ?
 *
 * Tant que la réponse est non, **ce navigateur n'a rien à dire au serveur**, et
 * surtout pas son état local. Sur un appareil qui vient de se connecter, cet état
 * est vide : le remonter effacerait le compte. Or l'écriture du jeton de session
 * déclenche elle-même la remontée temporisée, qui partait donc en course avec la
 * première descente — et gagnait dès que le réseau était lent.
 *
 * La descente confirme l'état qu'elle installe : tout ce qui suit est protégé
 * normalement. Un compte tout neuf n'est pas bloqué pour autant, le serveur créant
 * sa ligne à la première lecture.
 */
export function baseDeComparaisonConnue(): boolean {
  return localStorage.getItem(CLE_EMPREINTE) !== null;
}

/** L'horodatage de la ligne serveur telle qu'on la connaît, pour détecter les conflits. */
export function versionServeurConnue(): string | null {
  return localStorage.getItem(CLE_VERSION);
}

export function memoriserVersionServeur(version: unknown): void {
  if (typeof version === 'string' && version) localStorage.setItem(CLE_VERSION, version);
}

/**
 * Efface toute trace de synchro.
 *
 * Appelé quand on adopte l'état du serveur de force : garder une empreinte qui ne
 * décrit plus rien ferait croire à du travail en attente indéfiniment.
 */
export function oublierEmpreinte(): void {
  localStorage.removeItem(CLE_EMPREINTE);
}

export interface CopieDeConflit {
  date: string;
  donnees: Record<string, string | null>;
}

/**
 * Met la version locale de côté avant d'adopter celle d'un autre appareil.
 *
 * Deux appareils qui écrivent chacun de leur côté ne peuvent pas être départagés
 * sans inventer une intention que personne n'a exprimée : fusionner deux listes
 * ressusciterait ce que l'un a supprimé, et choisir arbitrairement ferait perdre le
 * travail de l'autre. Le seul geste honnête est de ne rien détruire — on adopte la
 * version du serveur, qui est la plus récente, et on garde l'autre à portée de
 * main. C'est à la personne, et à elle seule, de dire laquelle était la bonne.
 */
export function mettreDeCoteAvantConflit(): boolean {
  try {
    const donnees: Record<string, string | null> = {};
    let quelqueChose = false;

    for (const cle of CLES_SYNCHRONISEES) {
      const valeur = localStorage.getItem(cle);
      donnees[cle] = valeur;
      if (valeur && valeur !== '[]' && valeur !== '{}' && valeur !== '0') quelqueChose = true;
    }

    // Emportées, jamais comptées : voir `CLES_ACCOMPAGNANTES`.
    for (const cle of CLES_ACCOMPAGNANTES) {
      donnees[cle] = localStorage.getItem(cle);
    }

    // Rien à sauver : proposer de revenir à un état vide n'aurait aucun sens, et
    // ferait apparaître un bouton qui ne rend service à personne.
    if (!quelqueChose) return false;

    localStorage.setItem(CLE_CONFLIT, JSON.stringify({ date: new Date().toISOString(), donnees }));
    return true;
  } catch {
    return false;
  }
}

/** La copie mise de côté, si elle existe. */
export function copieDeConflit(): CopieDeConflit | null {
  try {
    const brut = localStorage.getItem(CLE_CONFLIT);
    if (!brut) return null;
    const copie = JSON.parse(brut);
    return copie && copie.donnees ? copie : null;
  } catch {
    return null;
  }
}

/**
 * Ce navigateur a reçu l'ordre d'imposer sa version au serveur.
 *
 * Le seul appelant est la récupération d'une copie de conflit, et c'est une
 * décision que la personne a prise elle-même, en lisant la question. Sans ce
 * drapeau, la remontée qui suit repart avec la `base_version` d'avant : le serveur
 * la refuse pour cause de conflit, la version tout juste récupérée est remise de
 * côté, et celle du serveur revient à l'écran. Le bouton « Récupérer ma version »
 * rendait alors exactement ce qu'il venait de reprendre — sans un mot, et
 * indéfiniment si l'autre appareil continuait d'écrire.
 *
 * On renonce donc sciemment à la détection de conflit pour cet envoi-là : il n'y a
 * plus rien à départager, quelqu'un a tranché.
 */
export function exigerImposition(): void {
  localStorage.setItem(CLE_IMPOSITION, String(Date.now()));
}

export function impositionExigee(): boolean {
  const pose = Number(localStorage.getItem(CLE_IMPOSITION) || 0);
  if (!pose) return false;
  if (Date.now() - pose > DUREE_IMPOSITION_MS) {
    impositionTerminee();
    return false;
  }
  return true;
}

export function impositionTerminee(): void {
  localStorage.removeItem(CLE_IMPOSITION);
}

/**
 * Déclare qu'il reste ici du travail que le serveur n'a jamais reçu.
 *
 * L'empreinte posée ne peut correspondre à aucun état réel : c'est exactement ce
 * qu'on veut. Tant qu'une remontée n'a pas abouti, `downloadCloudState` refusera
 * de descendre et la reprise automatique continuera d'essayer.
 *
 * Sans elle, une copie récupérée pendant une coupure réseau était perdue au
 * premier retour d'onglet : le garde-fou répond « rien en attente » quand aucune
 * confirmation n'est enregistrée — c'est la bonne réponse sur un appareil neuf,
 * c'est la pire ici.
 */
export function marquerNonSynchronise(): void {
  localStorage.setItem(CLE_EMPREINTE, 'jamais-' + Date.now());
}

/** Remet la version mise de côté en place. Rend `false` s'il n'y avait rien. */
export function restaurerCopieDeConflit(): boolean {
  const copie = copieDeConflit();
  if (!copie) return false;

  for (const cle of [...CLES_SYNCHRONISEES, ...CLES_ACCOMPAGNANTES]) {
    const valeur = copie.donnees[cle];
    /*
      Une clé absente au moment de la photo doit le redevenir, sinon on mélangerait
      les deux versions — le seul résultat que personne n'a demandé.

      Exception : une copie prise avant que les compteurs signés n'entrent dans la
      liste ne les contient pas du tout. Effacer sur la foi de son silence
      remettrait les coins et le niveau à zéro, alors qu'elle n'a jamais prétendu
      les décrire. Une clé que la photo ignore est laissée telle quelle.
    */
    if (!(cle in copie.donnees)) continue;
    if (valeur == null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  }

  /*
    Les deux garde-fous sont posés ici, et pas chez l'appelant.

    Restaurer une copie de conflit sans eux est une opération qui a l'air d'avoir
    réussi et qui ne survit pas au prochain retour d'onglet. Les rendre
    indissociables de la restauration est le seul moyen d'être sûr qu'un futur
    appelant ne les oubliera pas.
  */
  marquerNonSynchronise();
  exigerImposition();

  oublierCopieDeConflit();
  window.dispatchEvent(new Event('storage'));
  return true;
}

export function oublierCopieDeConflit(): void {
  localStorage.removeItem(CLE_CONFLIT);
}

/**
 * Plafond au-delà duquel `keepalive` refuse la requête.
 *
 * La spécification `fetch` limite à 64 Ko le corps d'une requête `keepalive`, et
 * c'est cette option qui permet à la synchro de survivre à la mise en
 * arrière-plan. Au-delà, la requête échoue — silencieusement, par le même chemin
 * que toutes les autres pannes de synchro.
 *
 * On garde de la marge sous les 64 Ko : la limite porte sur l'ensemble des requêtes
 * `keepalive` en vol, pas sur une seule. Au-dessus, mieux vaut une requête
 * ordinaire — que le système peut tuer en arrière-plan — qu'une requête `keepalive`
 * qui, elle, échouera à coup sûr.
 */
const PLAFOND_KEEPALIVE = 56 * 1024;

export function keepaliveAcceptable(corps: unknown): boolean {
  try {
    return JSON.stringify(corps).length <= PLAFOND_KEEPALIVE;
  } catch {
    return false;
  }
}

/**
 * La même empreinte, mais insensible à l'ordre des clés.
 *
 * Elle sert à une question précise, et à une seule : **après avoir adopté la
 * version du serveur, quelque chose a-t-il réellement changé ici ?** Si la réponse
 * est non, le « conflit » que le serveur vient de signaler n'oppose pas deux
 * versions — il oppose un état à lui-même, et il n'y a rien à faire trancher par
 * la personne.
 *
 * L'ordre des clés doit être neutralisé, sans quoi la comparaison répondrait
 * toujours « oui » : les colonnes de synchro sont du `jsonb` PostgreSQL, un type
 * qui **ne conserve pas l'ordre des clés d'un objet**. Un aller-retour par le
 * serveur suffit donc à réécrire le même contenu dans un autre ordre, et
 * `JSON.stringify` en tirerait une empreinte différente pour des données
 * identiques.
 *
 * `empreinte` elle-même n'est délibérément pas touchée : sa stabilité repose sur
 * l'ordre littéral de `construireEtatLocal()`, c'est écrit là-bas, et lui faire
 * trier ses clés changerait le sens de toutes les confirmations déjà enregistrées.
 */
export function empreinteCanonique(valeur: unknown): string {
  const trier = (v: any): any => {
    if (Array.isArray(v)) return v.map(trier);
    if (v && typeof v === 'object') {
      const range: Record<string, any> = {};
      for (const cle of Object.keys(v).sort()) range[cle] = trier(v[cle]);
      return range;
    }
    return v;
  };

  return empreinte(trier(valeur));
}
