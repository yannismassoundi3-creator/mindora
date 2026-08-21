/**
 * Ce qui se joue aujourd'hui, en une ligne.
 *
 * Le bandeau disait ce qui était **fait** — un score, une série, un décompte de
 * tâches. Aucun de ces trois chiffres n'est une raison de rouvrir l'application :
 * ils décrivent le passé. « 100 » ne demande rien.
 *
 * **La distinction qui porte toute cette ligne : une série ne demande pas une
 * journée pleine, elle demande une seule tâche.** Un jour compte dès que le score
 * dépasse zéro (`calculateStreak`). Quelqu'un qui a treize jours derrière lui et
 * six tâches devant croit risquer sa série ; il ne risque rien, il lui suffit d'en
 * cocher une. Le lui dire transforme une journée intimidante en un geste — et
 * c'est vrai, ce qui est la seule raison de l'écrire.
 *
 * Une fois cette tâche cochée, la série est acquise pour aujourd'hui : l'enjeu
 * change, et la phrase aussi. Continuer à agiter la série serait un mensonge par
 * insistance.
 */

export interface EnJeu {
  serie: number;
  faites: number;
  total: number;
}

/**
 * Rend la phrase, ou `null` quand il n'y a honnêtement rien à mettre en jeu.
 *
 * `null` sur un compte neuf sans série et sans tâches : inventer un enjeu à
 * quelqu'un qui n'a encore rien posé, c'est le premier pas vers les promesses que
 * ce produit s'interdit.
 */
export function enJeuAujourdhui({ serie, faites, total }: EnJeu): string | null {
  if (total === 0) return null;

  const restantes = total - faites;

  // Journée bouclée : ce qui se joue n'est plus aujourd'hui, c'est demain.
  if (restantes <= 0) {
    return serie >= 2 ? `${serie} jours d'affilée. Demain fait ${serie + 1}.` : null;
  }

  /*
    Rien de coché, et une série à protéger : c'est le seul moment où une phrase
    peut changer la journée de quelqu'un. Une tâche, pas six.
  */
  if (faites === 0 && serie >= 2) {
    return `Une seule tâche suffit à garder tes ${serie} jours.`;
  }

  if (faites === 0) {
    return restantes === 1
      ? 'Une tâche aujourd’hui, et la série démarre.'
      : `${restantes} tâches aujourd’hui. La première lance la série.`;
  }

  // La série est acquise pour aujourd'hui — ne pas continuer à l'agiter.
  return restantes === 1
    ? 'Série tenue. Il reste une tâche pour la journée pleine.'
    : `Série tenue. Il reste ${restantes} tâches pour la journée pleine.`;
}
