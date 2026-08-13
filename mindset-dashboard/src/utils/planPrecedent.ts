/**
 * Filet de sécurité avant qu'un plan n'en écrase un autre.
 *
 * « Refais-moi un plan » efface les routines, les habitudes, l'alimentation et les
 * objectifs pour repartir de zéro — c'est ce qu'on lui demande, et c'est ce qu'il
 * faut. Mais la version précédente n'existait alors plus nulle part : un plan
 * construit en plusieurs conversations, patiemment ajusté, disparaissait sur une
 * phrase de six mots et sur un modèle qui pouvait faire moins bien.
 *
 * On garde donc une copie de l'état d'avant, et un seul geste suffit à y revenir.
 * La copie porte un identifiant, et le bouton proposé sous la réponse du coach cite
 * le sien : deux plans plus tard, l'ancien bouton d'une conversation remontée ne
 * peut donc pas ressusciter un état qui n'a plus rien à voir avec ce qu'il annonce.
 */

const CLE = 'mindset_plan_precedent';

/** Ce qu'un plan touche, et donc ce qu'il faut savoir remettre en place. */
const CLES_DU_PLAN = [
  'mindset_routines',
  'mindset_habits',
  'mindset_nutrition',
  'mindset_micro_obj',
  'mindset_macro_obj',
] as const;

interface PlanSauvegarde {
  id: string;
  date: string;
  donnees: Record<string, string | null>;
}

function lire(): PlanSauvegarde | null {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return null;
    const plan = JSON.parse(brut);
    return plan && typeof plan.id === 'string' && plan.donnees ? plan : null;
  } catch {
    return null;
  }
}

/**
 * Photographie l'état courant avant remplacement. Rend l'identifiant de la copie,
 * ou `null` s'il n'y avait rien à sauvegarder — proposer de revenir à un plan vide
 * n'aurait aucun sens, et le bouton ne doit alors pas s'afficher.
 */
export function sauvegarderPlanPrecedent(): string | null {
  try {
    const donnees: Record<string, string | null> = {};
    let contenu = false;

    for (const cle of CLES_DU_PLAN) {
      const valeur = localStorage.getItem(cle);
      donnees[cle] = valeur;

      // Une liste vide, ou les trois créneaux de routine sans la moindre tâche, ne
      // valent pas la peine d'être restaurés : le bouton ne doit pas proposer de
      // revenir à rien.
      if (valeur && valeur !== '[]') {
        try {
          const parse = JSON.parse(valeur);
          if (Array.isArray(parse)) {
            const nonVide = parse.some((e: any) =>
              Array.isArray(e?.items) ? e.items.length > 0 : e != null,
            );
            if (nonVide) contenu = true;
          }
        } catch {
          contenu = true;
        }
      }
    }

    if (!contenu) return null;

    // L'horodatage seul ne suffit pas à identifier une copie : deux sauvegardes de la
    // même milliseconde porteraient le même nom, et le bouton d'une conversation
    // remontée redeviendrait actif sur une copie qui n'est pas la sienne. Improbable
    // en usage réel — il faut un aller-retour avec le modèle entre les deux — mais
    // c'est précisément ce que cet identifiant existe pour empêcher.
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLE, JSON.stringify({ id, date: new Date().toISOString(), donnees }));
    return id;
  } catch {
    return null;
  }
}

/** Vrai si la copie proposée par ce bouton est toujours celle qui est rangée. */
export function planPrecedentDisponible(id: string): boolean {
  return lire()?.id === id;
}

/**
 * Remet le plan sauvegardé en place. Rend `false` si la copie a depuis été remplacée
 * par une autre — mieux vaut ne rien faire et le dire que restaurer un état que la
 * personne n'a pas demandé.
 */
export function restaurerPlanPrecedent(id: string): boolean {
  const plan = lire();
  if (!plan || plan.id !== id) return false;

  for (const cle of CLES_DU_PLAN) {
    const valeur = plan.donnees[cle];
    // Une clé absente au moment de la photo doit le redevenir : la laisser en place
    // mélangerait l'ancien plan et le nouveau, ce qu'on cherche précisément à éviter.
    if (valeur == null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  }

  // La copie est consommée : la garder laisserait croire qu'on peut revenir en
  // arrière une seconde fois, vers un état qui n'existe plus.
  localStorage.removeItem(CLE);
  window.dispatchEvent(new Event('storage'));
  return true;
}
