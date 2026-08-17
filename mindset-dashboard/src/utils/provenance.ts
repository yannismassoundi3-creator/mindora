/*
  D'où vient la personne qui vient de s'inscrire.

  Rien ne le captait : une soirée à treize arrivées ne disait pas laquelle des
  publications les avait fait venir, donc laquelle refaire. C'est le seul chiffre
  dont l'absence rend tous les autres inutilisables au moment où l'on distribue.

  Le paramètre est lu au tout premier chargement et retenu jusqu'à l'inscription :
  entre le clic et la création du compte il y a l'écran d'accueil, l'écran de
  connexion et parfois un rechargement, et l'adresse a perdu son paramètre bien
  avant qu'on en ait besoin.
*/

const CLE = 'mindset_source';

/**
 * Les noms de paramètre acceptés, dans l'ordre où on les regarde.
 *
 * `s` est le nôtre, court parce qu'il s'écrit à la main dans une bio ou une
 * réponse en message privé. Les `utm_*` sont là parce que tout outil de
 * publication en ajoute d'office, et qu'ignorer ce que les autres écrivent
 * reviendrait à ne rien mesurer dès qu'on utilise un raccourcisseur de liens.
 */
const PARAMETRES = ['s', 'utm_source', 'ref'];

/**
 * La première provenance vue gagne.
 *
 * Quelqu'un qui arrive par une story puis revient par le lien de la bio s'est
 * décidé sur la story : écraser à chaque visite attribuerait l'inscription au
 * dernier lien cliqué, c'est-à-dire presque toujours au lien de la bio, et la
 * mesure dirait alors que tout vient de la bio.
 */
export function retenirProvenance(): void {
  try {
    if (localStorage.getItem(CLE)) return;

    const params = new URLSearchParams(window.location.search);
    for (const nom of PARAMETRES) {
      const valeur = params.get(nom);
      if (valeur && valeur.trim()) {
        // Rangée telle quelle : le nettoyage se fait au serveur, seul endroit qui
        // décide de ce qui est comptable. Deux normalisations, l'une ici et
        // l'autre là-bas, finiraient par ne plus donner la même étiquette.
        localStorage.setItem(CLE, valeur.trim().slice(0, 64));
        return;
      }
    }
  } catch {
    /* Stockage indisponible : on renonce à mesurer, jamais à faire entrer la personne. */
  }
}

/** La provenance retenue, à joindre à l'inscription. `undefined` si on ne sait pas. */
export function lireProvenance(): string | undefined {
  try {
    return localStorage.getItem(CLE) || undefined;
  } catch {
    return undefined;
  }
}
