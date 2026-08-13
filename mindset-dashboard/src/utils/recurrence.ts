/**
 * Récurrence hebdomadaire des tâches de routine.
 *
 * L'application ne savait faire que du quotidien : toute tâche apparaissait tous les
 * jours et se décochait chaque nuit. « Du sport trois fois par semaine » — la demande
 * la plus courante qui soit — était donc inexprimable, et le coach n'avait le choix
 * qu'entre en mettre tous les jours, ce qui est un mauvais conseil, ou faire semblant
 * en n'en mettant qu'un seul.
 *
 * Une tâche porte donc éventuellement les jours où elle s'applique. Sans cette
 * indication elle reste quotidienne : c'est le comportement de tout ce qui existait
 * avant, et rien n'a besoin d'être migré.
 */

/** Index JavaScript de `Date.getDay()` : dimanche vaut 0. */
const INDEX_PAR_NOM: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

const NOMS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/**
 * Traduit ce que le modèle a écrit en index de jours.
 *
 * On accepte les noms français comme les nombres : le schéma demande des noms, bien
 * plus sûrs pour un modèle qu'une convention d'index où l'on ne sait jamais si la
 * semaine commence le dimanche. Les accents et les majuscules sont ignorés, et tout
 * ce qui n'est pas reconnu est écarté plutôt que d'être rangé n'importe où.
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

    // Après décomposition NFD, les accents deviennent des caractères combinants
    // rangés entre U+0300 et U+036F. On les retire par point de code plutôt que par
    // une classe d'expression régulière : écrite en clair, celle-ci est invisible
    // dans un diff et se fait massacrer au premier outil qui touche au fichier.
    const propre = [...entree.trim().toLowerCase().normalize('NFD')]
      .filter((c) => {
        const point = c.codePointAt(0) ?? 0;
        return point < 0x300 || point > 0x36f;
      })
      .join('');
    if (propre in INDEX_PAR_NOM) index.add(INDEX_PAR_NOM[propre]);
  }

  // Une tâche prévue les sept jours est une tâche quotidienne : lui laisser une liste
  // afficherait « Lun · Mar · Mer · … » sous chaque ligne, pour ne rien dire de plus.
  if (index.size === 0 || index.size === 7) return undefined;
  return [...index].sort((a, b) => a - b);
}

/** Vrai si la tâche doit apparaître aujourd'hui. Sans jours déclarés, elle est quotidienne. */
export function estPourAujourdhui(tache: any, aujourdhui = new Date()): boolean {
  const jours = normaliserJours(tache?.jours);
  return !jours || jours.includes(aujourdhui.getDay());
}

/** « Lun · Mer · Ven », ou rien du tout si la tâche est quotidienne. */
export function libelleJours(tache: any): string {
  const jours = normaliserJours(tache?.jours);
  if (!jours) return '';
  return jours.map((j) => NOMS_COURTS[j]).join(' · ');
}
