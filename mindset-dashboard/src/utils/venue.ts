import { API_URL } from '../services/api';

/*
  « Combien de fois les gens ouvrent l'application. »

  Rien ne le mesurait. Tout ce que l'administration savait de l'activité venait de
  traces laissées par autre chose : une clé dans `daily_scores` parce qu'une tâche
  a été cochée, un `updated_at` parce qu'un état est remonté. Quelqu'un qui ouvre
  l'app, regarde sa journée et referme ne laissait rien — indistinguable de
  quelqu'un qui n'est jamais venu.

  Nommé `venue` et non `ouverture` : `utils/ouverture.ts` existe déjà et désigne
  la phrase d'accueil du coach. Deux fichiers au même nom dans un projet où l'on
  cherche par nom de fichier finissent par se faire ouvrir l'un pour l'autre.
*/

/**
 * Ce qui sépare deux ouvertures.
 *
 * Sans seuil, la mesure ne veut rien dire : dans une application d'une seule
 * page, revenir sur l'onglet compte comme une ouverture, et quelqu'un qui laisse
 * l'app dans un onglet de fond « l'ouvre » quarante fois par jour. Trente minutes
 * est la convention habituelle pour une session, et surtout elle correspond à ce
 * que la question veut dire — « elle y retourne dans la journée », pas « elle a
 * changé de fenêtre ».
 */
const SEUIL_SESSION_MS = 30 * 60 * 1000;

const CLE_DERNIERE_VENUE = 'mindset_derniere_venue';

/** Vrai si assez de temps a passé depuis la dernière ouverture comptée. */
function estUneNouvelleVenue(maintenant: number): boolean {
  const brut = localStorage.getItem(CLE_DERNIERE_VENUE);
  if (!brut) return true;

  const precedente = Number(brut);
  // Valeur illisible (écriture d'une version antérieure, stockage bricolé) : on
  // compte, plutôt que de ne plus jamais rien compter pour cet appareil.
  if (!Number.isFinite(precedente)) return true;

  /*
    Une valeur dans le futur ne peut venir que d'une horloge qui a reculé — un
    appareil remis à l'heure, un fuseau changé en voyage. Sans ce cas, l'écart
    reste négatif et l'appareil cesse définitivement de compter ses ouvertures,
    en silence.
  */
  if (precedente > maintenant) return true;

  return maintenant - precedente >= SEUIL_SESSION_MS;
}

/**
 * Compte une ouverture, si c'en est une.
 *
 * Ne rend rien et ne lève jamais : c'est une mesure, pas une fonction du produit.
 * Une panne de réseau ou un serveur absent ne doit pas se voir à l'écran, et
 * surtout ne doit pas empêcher l'application de démarrer.
 *
 * L'horodatage est écrit **avant** l'appel, pas après : deux déclenchements
 * rapprochés — le montage et un retour au premier plan dans la même seconde —
 * partiraient sinon tous les deux.
 */
export function signalerVenue(): void {
  const jeton = localStorage.getItem('mindset_token');
  if (!jeton) return;

  const maintenant = Date.now();
  if (!estUneNouvelleVenue(maintenant)) return;

  try {
    localStorage.setItem(CLE_DERNIERE_VENUE, String(maintenant));
  } catch {
    // Stockage plein ou navigation privée verrouillée : on renonce à compter
    // plutôt que de compter à chaque seconde faute de mémoire.
    return;
  }

  fetch(`${API_URL}/activite/ouverture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}` },
    credentials: 'include',
    // La fermeture d'onglet ne doit pas annuler l'envoi.
    keepalive: true,
  }).catch(() => {
    /*
      Silencieux, et volontairement sans reprise : ré-essayer ferait porter à un
      compteur le droit de rejouer des requêtes, donc de gonfler le chiffre qu'il
      mesure. Une ouverture perdue vaut mieux qu'une ouverture inventée.
    */
  });
}

/**
 * Branche la mesure : au démarrage, puis à chaque retour au premier plan.
 *
 * `visibilitychange` plutôt que `focus` : sur téléphone, l'application installée
 * n'est jamais « fermée », elle passe en arrière-plan. Sans cet écouteur, une
 * personne qui l'ouvre trois fois dans la journée sans jamais tuer l'application
 * ne compterait qu'une seule venue — c'est-à-dire que l'usage le plus assidu
 * serait le moins bien mesuré.
 *
 * Rend la fonction de désinscription, pour un `useEffect`.
 */
export function suivreLesVenues(): () => void {
  signalerVenue();

  const auRetour = () => {
    if (document.visibilityState === 'visible') signalerVenue();
  };

  document.addEventListener('visibilitychange', auRetour);
  return () => document.removeEventListener('visibilitychange', auRetour);
}
