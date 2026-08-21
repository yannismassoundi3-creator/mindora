/**
 * Ce qu'un plan du coach ajoute vraiment, une fois retiré ce qui existe déjà.
 *
 * **Les quatre fusions du plan empilaient sans regarder.** Habitudes, tâches de
 * routine, repas et micro-objectifs faisaient tous `[...existants, ...entrants]`.
 * Demander deux fois « ajoute-moi de la lecture » créait donc deux habitudes
 * « Lecture », et le coach lui-même en redemande volontiers une qu'il a déjà
 * posée la semaine précédente.
 *
 * Vu sur une capture d'un vrai écran le 21 août 2026 : « Lecture 4/7, Sport 4/7,
 * Révisions 4/7, **Lecture 4/7, Sport 4/7** » dans le bilan de la semaine, et
 * « 11 tâches faites » pour une journée qui en comptait moins. Un doublon ne se
 * contente pas d'alourdir une liste : il compte deux fois dans le score du jour,
 * deux fois dans la semaine, et il faut le cocher deux fois pour boucler.
 *
 * **C'est l'existant qui gagne, jamais l'entrant.** La ligne déjà là porte son
 * historique, son XP, son état du jour ; la remplacer par une version neuve
 * effacerait tout ça pour n'apporter qu'un titre identique.
 *
 * Ne concerne que l'**ajout**. Un plan qui demande un remplacement complet
 * (`replaceHabits: true`) vide la liste avant, et ce fichier n'a alors rien à
 * comparer — ce qui est le comportement voulu : on repart de zéro.
 */

/**
 * Deux titres désignent-ils la même chose ?
 *
 * Accents retirés, casse ignorée, espaces resserrés : « Lecture », « lecture »
 * et « Lecture  » sont la même habitude pour la personne qui les lit, et le
 * modèle passe de l'une à l'autre sans y penser. La ponctuation, elle, est
 * gardée : « Squats (4×12) » et « Squats (3×15) » sont deux exercices distincts.
 */
export function titreNormalise(valeur: unknown): string {
  return String(valeur ?? '')
    // `NFD` sépare la lettre de son accent, `\p{Diacritic}` retire l'accent seul.
    // La classe nommée plutôt qu'un intervalle de codes : elle se lit, et elle ne
    // se corrompt pas au passage d'un éditeur à l'autre.
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Les entrants qui n'existent pas déjà, dans l'ordre où ils arrivent.
 *
 * Les doublons **à l'intérieur du lot entrant** sont écartés aussi : un modèle
 * qui répète une ligne dans son propre JSON ne doit pas la créer deux fois.
 *
 * Un titre vide n'est jamais considéré comme un doublon — sinon deux lignes mal
 * formées se supprimeraient l'une l'autre, et on perdrait un ajout réel au lieu
 * d'une simple redite.
 */
export function nouveautes<T>(
  existants: unknown[],
  entrants: T[],
  titreDe: (element: any) => unknown,
): T[] {
  const connus = new Set(
    existants.map((e) => titreNormalise(titreDe(e))).filter(Boolean),
  );

  const retenus: T[] = [];
  for (const entrant of entrants) {
    const cle = titreNormalise(titreDe(entrant));
    if (cle && connus.has(cle)) continue;
    if (cle) connus.add(cle);
    retenus.push(entrant);
  }
  return retenus;
}
