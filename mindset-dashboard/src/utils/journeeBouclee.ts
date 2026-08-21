/**
 * Ce qui s'affiche quand la journée est à 100 %.
 *
 * L'écran disait « **Bravo Champion 🔥 — Tu as accompli toutes tes routines.
 * Repose-toi bien.** » Trois problèmes dans deux lignes :
 *
 * 1. **C'est un compliment vide**, sur un écran qui connaît la série en cours, le
 *    nombre de jours tenus cette semaine et le score moyen. Le coach du produit a
 *    une règle qui interdit exactement ça — « pas de fait à citer, pas de
 *    compliment » — et l'application se contredisait dans sa propre voix.
 * 2. **« Repose-toi bien » ferme la journée et ne donne aucune raison de revenir**,
 *    au moment précis où la personne est la plus disposée à en accepter une. Le
 *    mur du produit est le jour 2 : c'est ici qu'il se joue, pas dans un e-mail.
 * 3. Le même texte pour quelqu'un à son premier jour et à son trentième. Le
 *    premier a besoin d'entendre qu'un jour ne prouve rien ; le trentième, qu'il
 *    est à quatre jours d'un mois plein.
 *
 * **Rien n'est inventé ici.** Toutes les phrases se construisent sur des chiffres
 * déjà affichés ailleurs sur le même écran — série, jours tenus, moyenne. C'est la
 * règle de tout ce que le produit écrit : pas de fait, pas de phrase.
 */

/**
 * Les paliers qui donnent envie de revenir demain.
 *
 * Ils sont serrés au début (3, 7) et s'espacent ensuite : quelqu'un à deux jours
 * a besoin d'un horizon atteignable, quelqu'un à quarante n'a plus besoin qu'on
 * l'appâte. Au-delà du dernier, on cesse d'en promettre un — inventer « 500 jours »
 * à quelqu'un qui en tient 365 est une façon de lui dire que ça ne finit jamais.
 */
const PALIERS = [3, 7, 14, 30, 60, 100, 200, 365];

function prochainPalier(serie: number): number | null {
  return PALIERS.find((p) => p > serie) ?? null;
}

function jours(n: number): string {
  return n === 1 ? '1 jour' : `${n} jours`;
}

export interface EtatJour {
  /** Jours consécutifs, aujourd'hui compris. */
  serie: number;
  /** Jours de la semaine écoulée où quelque chose a été fait. */
  joursTenus: number;
  /** Score moyen de ces jours-là, en pourcentage. */
  moyenne: number;
}

/**
 * Le titre et le corps du message de fin de journée.
 *
 * Le titre porte le fait ; le corps porte ce qui se joue demain. Jamais l'inverse
 * — c'est le chiffre qu'on lit en premier, et c'est lui qui doit être vrai.
 */
export function messageJourneeBouclee({ serie, joursTenus, moyenne }: EtatJour): {
  titre: string;
  corps: string;
} {
  /*
    Le tout premier jour, ou le premier d'après une série cassée.

    Le féliciter serait faux : un jour ne démontre rien, et il le sait. Lui dire
    que le deuxième est le seul qui compte est à la fois vrai et exactement ce
    qu'on veut qu'il fasse.
  */
  if (serie <= 1) {
    return {
      titre: 'Journée bouclée.',
      corps: "Un jour, tout le monde y arrive. C'est le deuxième qui sépare. Reviens demain.",
    };
  }

  const palier = prochainPalier(serie);

  if (palier) {
    const reste = palier - serie;
    return {
      titre: `${jours(serie)} d'affilée.`,
      corps:
        reste === 1
          ? `Demain, c'est ${palier}. Ça se joue en une journée.`
          : `Encore ${jours(reste)} et tu es à ${palier}. Ça commence demain.`,
    };
  }

  /*
    Au-delà du dernier palier, on rend la semaine plutôt qu'un objectif.

    À ce stade la série n'est plus une nouveauté, et c'est la régularité récente
    qui dit quelque chose d'utile — c'est aussi le seul chiffre qui peut baisser
    sans que la série se casse.
  */
  return {
    titre: `${jours(serie)} d'affilée.`,
    corps: `${joursTenus} jours tenus cette semaine, ${moyenne} % de moyenne. Demain fait ${serie + 1}.`,
  };
}
