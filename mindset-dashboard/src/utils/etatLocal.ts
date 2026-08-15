/**
 * Vérifier qu'on peut relire ce qu'on s'apprête à réécrire.
 *
 * Chaque bloc d'application d'un plan relit sa liste dans `localStorage` pour y
 * ajouter, puis réécrit le tout. La lecture était enveloppée dans un
 * `try { JSON.parse(...) } catch {}` qui laissait la variable à `[]` : une liste
 * illisible était donc traitée exactement comme une liste vide, et le plan la
 * **remplaçait** au lieu de la compléter — en affichant « ✨ a mis à jour tes
 * routines ». La panne annonçait un succès, ce qui est la pire façon d'échouer.
 */

/** Les listes qu'un plan complète, et le nom qu'elles portent à l'écran. */
export const LISTES_DU_PLAN: ReadonlyArray<readonly [string, string]> = [
  ['mindset_habits', 'tes habitudes'],
  ['mindset_routines', 'tes routines'],
  ['mindset_nutrition', 'ton alimentation'],
  ['mindset_micro_obj', 'tes objectifs'],
  ['mindset_macro_obj', 'tes objectifs long terme'],
];

/**
 * Les listes qu'on n'arrive pas à relire, sous leur nom lisible.
 *
 * Une clé **absente** n'en fait pas partie, et c'est la distinction qui compte :
 * n'avoir jamais rien écrit est l'état normal d'un compte neuf, où le plan a
 * précisément vocation à tout créer. Seul ce qui est présent mais indéchiffrable —
 * JSON invalide, ou valide mais qui n'est pas un tableau — mérite qu'on s'arrête.
 */
export function listesIllisibles(): string[] {
  return LISTES_DU_PLAN.filter(([cle]) => {
    const brut = localStorage.getItem(cle);
    if (brut === null) return false;
    try {
      return !Array.isArray(JSON.parse(brut));
    } catch {
      return true;
    }
  }).map(([, nom]) => nom);
}
