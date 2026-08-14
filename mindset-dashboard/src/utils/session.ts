/*
  Ce que la déconnexion doit laisser derrière elle.

  Jusqu'ici, se déconnecter effaçait une liste de treize clés écrite à la main.
  L'application en pose une soixantaine, et chaque fonction ajoutée depuis en a
  posé de nouvelles sans que personne pense à allonger la liste : la
  conversation avec le coach, les objectifs, le plan alimentaire, le score
  mental, la série, l'XP, l'énergie, les explications en attente — tout cela
  restait dans le navigateur après un « Se déconnecter ».

  Deux conséquences, dont la seconde est la plus grave :

  1. Sur un appareil partagé, la conversation avec le coach reste lisible par
     la personne suivante. C'est le contenu le plus intime de l'application.

  2. Ces données appartiennent au compte précédent, et l'application les
     remonte au serveur toute seule (`localStorage.setItem` est instrumenté).
     Quelqu'un qui se connecte ensuite sur un compte neuf — que le serveur ne
     peut donc écraser avec rien — hérite des routines et des objectifs de la
     personne d'avant, puis les téléverse sur son propre compte.

  D'où le principe inverse : on efface tout, et on nomme les rares exceptions.
  Une liste de ce qu'il faut effacer se périme à chaque fonction ajoutée ; une
  liste de ce qu'il faut garder, non — une clé oubliée est simplement effacée,
  ce qui est le comportement sûr.
*/

/**
 * Les seules clés qui survivent à une déconnexion.
 *
 * Le critère : elles décrivent le navigateur, pas la personne. Rien de ce qui
 * s'y trouve ne renseigne sur le compte précédent, et les effacer ne
 * protégerait personne — cela ne ferait que réinitialiser l'apparence et
 * refaire poser au navigateur des questions déjà réglées.
 */
const CLES_DE_L_APPAREIL = new Set([
  // Identifie ce navigateur (abonnement push, appairage), jamais son propriétaire.
  'mindset_device_id',
  // Comptabilité du vidage de cache entre deux versions déployées.
  'mindset_app_version',
  // Apparence choisie sur cet écran : une couleur d'accent, une couleur de texte,
  // des particules. Rien là-dedans ne renseigne sur qui était connecté, et les
  // effacer ne ferait que redonner un écran par défaut à quelqu'un qui revient.
  //
  // `mindset_app_theme_id` n'est volontairement pas de la liste : ce n'est pas un
  // réglage mais le cosmétique équipé, acheté en Boutique. Le garder laisserait à
  // la personne suivante un thème qui ne lui appartient pas, et que l'inventaire —
  // effacé, lui — dirait ne pas posséder.
  'mindset_theme',
  'mindset_text_color',
  'mindset_particles',
]);

/**
 * Les clés de l'application qui ne portent pas le préfixe `mindset_`.
 *
 * Elles datent d'avant la convention de nommage. Sans elles, la déconnexion
 * laisserait le score mental et l'état du questionnaire d'inscription.
 */
const CLES_SANS_PREFIXE = ['mental_score', 'hasCompletedOnboarding'];

/**
 * Efface du navigateur tout ce qui appartient au compte qui se déconnecte.
 *
 * Ne parle pas au serveur : la révocation de la session est faite par
 * `POST /auth/logout`, appelé séparément. Ici on ne s'occupe que de ce qui
 * reste sur l'appareil.
 */
export function oublierLaSession() {
  // La collecte précède la suppression : retirer une clé pendant qu'on parcourt
  // `localStorage.key(i)` décale les suivantes, et une clé sur deux survivrait.
  const aEffacer: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const cle = localStorage.key(i);
    if (!cle) continue;
    if (cle.startsWith('mindset_') && !CLES_DE_L_APPAREIL.has(cle)) {
      aEffacer.push(cle);
    }
  }

  for (const cle of CLES_SANS_PREFIXE) {
    if (localStorage.getItem(cle) !== null) aEffacer.push(cle);
  }

  for (const cle of aEffacer) localStorage.removeItem(cle);

  return aEffacer;
}
