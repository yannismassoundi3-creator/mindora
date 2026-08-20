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

/**
 * Le jour tel que le client l'écrit : `YYYY-MM-DD`, en UTC.
 *
 * C'est sa convention, pas la nôtre, et c'est elle qu'il faut reprendre : passer
 * l'heure de Paris ici décalerait la frontière de deux heures et ferait mentir la
 * comparaison ci-dessous chaque nuit entre minuit et 2 h.
 */
export function jourDuClient(maintenant = new Date()): string {
  return maintenant.toISOString().slice(0, 10);
}

/**
 * Les coches des routines valent-elles encore pour aujourd'hui ?
 *
 * Le décochage quotidien n'a jamais lieu ici : c'est le client qui, à l'ouverture,
 * compare la date qu'il a posée au jour courant et remet tout à zéro. Tant que
 * personne n'ouvre l'app, la base garde donc les coches de la veille — et la
 * notification qui les lit telles quelles félicite au réveil pour un travail qui
 * n'a pas commencé. C'est ce qui est parti un matin à 10 h 50 (« Félicitations, tu
 * as terminé tous tes exercices »), une heure avant que l'app, ouverte, montre les
 * six tâches intactes. Rien n'avait échoué côté serveur : la donnée était juste
 * vieille d'un jour, et parfaitement plausible.
 *
 * On tranche donc sur la date que le client a lui-même écrite (`last_routine_date`),
 * avec exactement son test : ce que le serveur conclut est ce que l'écran montrera.
 * Une date absente ou abîmée est périmée — le client la traite pareil, et décochera.
 */
export function cochesDuJour(jour: unknown, maintenant = new Date()): boolean {
  return typeof jour === 'string' && jour.slice(0, 10) === jourDuClient(maintenant);
}

/**
 * @param cochesValides `false` quand les coches datent d'un autre jour : tout
 * repasse alors en « à faire », dans l'ordre où l'app les affiche. Les objectifs,
 * eux, ne se décochent pas la nuit et gardent le défaut.
 */
export function separerTaches(valeur: unknown, cochesValides = true): TachesTriees {
  const restantes: string[] = [];
  const faites: string[] = [];
  if (!Array.isArray(valeur)) return { restantes, faites };

  for (const entree of valeur) {
    const elements = Array.isArray((entree as any)?.items) ? (entree as any).items : [entree];
    for (const el of elements) {
      const titre = el?.title || el?.name;
      if (typeof titre !== 'string' || !titre.trim()) continue;
      (cochesValides && el?.done ? faites : restantes).push(titre);
    }
  }
  return { restantes, faites };
}

/**
 * Les routines du jour, telles que l'app les montrera.
 *
 * C'est le seul point d'entrée à utiliser pour une notification : il ne peut pas
 * oublier la date, là où `separerTaches` seul le pouvait — et le faisait partout.
 */
export function tachesDuJour(
  sync: { routines?: unknown; last_routine_date?: string | null } | null | undefined,
  maintenant = new Date(),
): TachesTriees {
  return separerTaches(sync?.routines, cochesDuJour(sync?.last_routine_date, maintenant));
}
