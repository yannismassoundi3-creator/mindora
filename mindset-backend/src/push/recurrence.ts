/**
 * Récurrence hebdomadaire des tâches de routine, côté serveur.
 *
 * Copie fidèle de `utils/recurrence.ts` du client, et il faut qu'elle le reste :
 * une tâche porte éventuellement les jours où elle s'applique (« du sport lundi,
 * mercredi, vendredi »), et sans cette indication elle est quotidienne.
 *
 * Le serveur l'ignorait complètement. Il lisait donc les sept jours d'une tâche
 * qui n'en compte que trois : le coach réclamait le dimanche une séance prévue le
 * mardi, et « journée pleine » ne pouvait plus jamais se déclencher pour quiconque
 * utilise la récurrence — il restait toujours des tâches d'un autre jour à cocher.
 * L'écran, lui, ne les montrait pas.
 */

/** Index de `Date.getDay()` : dimanche vaut 0. */
const INDEX_PAR_NOM: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

const INDEX_PAR_NOM_COURT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Le jour de la semaine **à Paris**, et non en UTC.
 *
 * Deux conventions cohabitent dans le client et il faut reprendre chacune telle
 * qu'elle est : les clés de jour sont écrites en UTC (`toISOString`), mais la
 * récurrence se lit sur `Date.getDay()`, c'est-à-dire l'heure de l'appareil. Pour
 * les gens à qui l'application s'adresse, c'est Paris. Le serveur tourne en UTC :
 * s'en remettre à son propre `getDay()` ferait basculer la semaine deux heures
 * trop tôt, et une tâche du lundi apparaîtrait le dimanche soir.
 */
export function jourDeSemaine(maintenant = new Date()): number {
  const court = maintenant.toLocaleDateString('en-US', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
  });
  return INDEX_PAR_NOM_COURT[court] ?? maintenant.getDay();
}

/**
 * Traduit ce que le client (ou le modèle) a écrit en index de jours.
 *
 * Accents et majuscules ignorés, valeurs inconnues écartées. Une liste vide ou
 * complète rend `undefined` : la tâche est quotidienne, ce qui est le cas de tout
 * ce qui existait avant la récurrence.
 */
export function normaliserJours(valeur: unknown): number[] | undefined {
  if (!Array.isArray(valeur) || valeur.length === 0) return undefined;

  const index = new Set<number>();
  for (const entree of valeur) {
    if (typeof entree === 'number' && Number.isInteger(entree) && entree >= 0 && entree <= 6) {
      index.add(entree);
      continue;
    }
    if (typeof entree !== 'string') continue;

    // Mêmes précautions que côté client : les accents sont retirés par point de
    // code après décomposition NFD, une classe d'expression régulière écrite en
    // clair étant invisible dans un diff.
    const propre = [...entree.trim().toLowerCase().normalize('NFD')]
      .filter((c) => {
        const point = c.codePointAt(0) ?? 0;
        return point < 0x300 || point > 0x36f;
      })
      .join('');
    if (propre in INDEX_PAR_NOM) index.add(INDEX_PAR_NOM[propre]);
  }

  if (index.size === 0 || index.size === 7) return undefined;
  return [...index].sort((a, b) => a - b);
}

/** Vrai si la tâche concerne ce jour de la semaine. Sans jours déclarés, elle est quotidienne. */
export function estPourAujourdhui(tache: any, jour: number): boolean {
  const jours = normaliserJours(tache?.jours);
  return !jours || jours.includes(jour);
}
