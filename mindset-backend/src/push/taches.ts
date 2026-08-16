/**
 * Ce qui reste à faire, et ce qui est déjà fait.
 *
 * Les routines et les objectifs arrivent du client en JSON libre, tantôt à plat,
 * tantôt groupés dans `items`. Toute notification qui cite une tâche part d'ici :
 * sans ce tri, le coach réclame des tâches que la personne vient de cocher — le
 * réflexe le plus sûr pour faire désinstaller une app de coaching.
 *
 * Une seule définition, partagée par le brief du matin et le coup de pouce : deux
 * copies finiraient par diverger, et l'une des deux se remettrait à réclamer du
 * travail déjà fait sans que rien ne le signale.
 */
export interface TachesTriees {
  restantes: string[];
  faites: string[];
}

export function separerTaches(valeur: unknown): TachesTriees {
  const restantes: string[] = [];
  const faites: string[] = [];
  if (!Array.isArray(valeur)) return { restantes, faites };

  for (const entree of valeur) {
    const elements = Array.isArray((entree as any)?.items) ? (entree as any).items : [entree];
    for (const el of elements) {
      const titre = el?.title || el?.name;
      if (typeof titre !== 'string' || !titre.trim()) continue;
      (el?.done ? faites : restantes).push(titre);
    }
  }
  return { restantes, faites };
}
