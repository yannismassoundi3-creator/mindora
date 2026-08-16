/*
  Les clés qui ne sont qu'un cache d'affichage.

  Toute écriture dans `localStorage` sous le préfixe `mindset_` programme une
  remontée de l'état complet au serveur, cinq cents millisecondes plus tard : c'est
  l'instrumentation posée dans `api.ts`. C'est voulu — le travail de la personne ne
  doit jamais rester coincé dans le navigateur.

  Mais certaines clés ne sont pas du travail. Elles gardent au chaud ce que le
  serveur vient de nous dire, pour ne pas le redemander à chaque écran. Les faire
  déclencher une remontée reviendrait à envoyer tout l'état de quelqu'un parce
  qu'on a mis en cache une phrase qui vient justement d'en être calculée.

  Ce module ne dépend de rien, et c'est indispensable : `api.ts` doit pouvoir le
  lire au moment où il installe l'instrumentation, alors que les modules qui
  possèdent ces clés, eux, dépendent d'`api.ts` pour interroger le serveur.
  Déclarer les clés ici casse le cycle.

  Elles gardent le préfixe `mindset_` malgré tout : c'est lui qui les fait effacer
  à la déconnexion (`oublierLaSession`), et une observation est nominative.
*/

/** Le motif que le coach a repéré, et la dernière fois qu'il en a fait une bannière. */
export const CLE_OBSERVATION = 'mindset_observation';
export const CLE_OBSERVATION_BANNIERE = 'mindset_observation_banniere_le';

/**
 * Les clés que l'instrumentation de `localStorage.setItem` doit ignorer parce
 * qu'elles ne contiennent rien à sauvegarder.
 *
 * Distinct de `CLES_TENUE_SYNCHRO`, qui répond à un autre problème : là-bas il
 * s'agit d'éviter qu'une remontée se reprogramme elle-même sans fin. Ici il s'agit
 * de ne pas payer un aller-retour réseau pour un cache. Deux raisons différentes,
 * deux listes — les fondre ferait perdre celle qu'on relira dans six mois.
 */
export const CLES_CACHE_AFFICHAGE: ReadonlySet<string> = new Set([
  CLE_OBSERVATION,
  CLE_OBSERVATION_BANNIERE,
]);
