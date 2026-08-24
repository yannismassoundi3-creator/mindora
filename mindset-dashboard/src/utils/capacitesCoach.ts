/*
  Ce que le coach sait faire, et ce que cette personne en a déjà vu.

  Le produit vend un coach ; la plupart des comptes n'en ont vu qu'un tiers. Les
  propositions de `SuggestionsCoach` ne s'affichaient qu'avant le tout premier
  mot — `messages.length === 1` — donc quelqu'un qui a écrit une fois ne les
  revoit **jamais**. Or c'est exactement le profil dominant : 5 comptes sur 34
  avaient parlé au coach une seule fois. Ils ont vu trois phrases, en ont cliqué
  une, et n'ont plus rien découvert.

  Le rappel daté est le cas le plus coûteux du lot : rien à l'écran ne laisse
  imaginer qu'une phrase tapée dans un chat fera sonner un téléphone. Une
  capacité qu'on ne peut pas deviner et qu'on ne montre qu'une fois n'existe pas.

  Ce module tient donc la liste, et surtout **ce qui a déjà été essayé** — pour
  proposer la suite plutôt que de répéter. C'est la différence entre un tutoriel,
  qui explique tout au moment où ça n'intéresse personne, et une découverte qui
  avance au rythme de l'usage.
*/

const CLE_ESSAYEES = 'mindset_capacites_essayees';

/** Les familles de capacités, telles qu'on les propose. */
export type IdCapacite = 'plan' | 'rappel' | 'lecture' | 'habitude';

export interface Capacite {
  id: IdCapacite;
  /** Ce que la capacité fait, en trois mots. Pour l'accueil, où il n'y a pas de conversation. */
  titre: string;
  /** Le vrai message envoyé au coach. C'est lui qui démontre, pas le titre. */
  phrase: string;
}

/**
 * Les mots que le serveur guette pour joindre le schéma du plan (`MOTS_PLAN`).
 *
 * Recopiés ici volontairement partiels : une proposition qui n'en contient aucun
 * obtiendrait une réponse en prose là où la personne attend un plan appliqué dans
 * l'application. Ce n'est pas une duplication du filtre serveur — c'est une
 * contrainte de rédaction pour les phrases ci-dessous, vérifiée par les tests.
 */
export const MOTS_PLAN_CLIENT = /plan|habitude|étape|routine|objectif|repas/i;

/** Une liste du stockage local, tolérante à tout ce qui n'est pas un tableau. */
function liste(cle: string): any[] {
  try {
    const parse = JSON.parse(localStorage.getItem(cle) || '[]');
    return Array.isArray(parse) ? parse : [];
  } catch {
    return [];
  }
}

/**
 * Les capacités déjà essayées par cette personne, quel que soit le chemin.
 *
 * Le stockage peut être refusé (navigation privée) : on rend alors une liste
 * vide, ce qui remontre les propositions. Remontrer coûte un rang de boutons ;
 * masquer à tort coûte une capacité jamais découverte.
 */
export function capacitesEssayees(): IdCapacite[] {
  const brut = liste(CLE_ESSAYEES);
  return brut.filter((x): x is IdCapacite =>
    x === 'plan' || x === 'rappel' || x === 'lecture' || x === 'habitude',
  );
}

/** Retient qu'une capacité vient d'être exercée. Idempotent. */
export function retenirCapacite(id: IdCapacite): void {
  try {
    const deja = capacitesEssayees();
    if (deja.includes(id)) return;
    localStorage.setItem(CLE_ESSAYEES, JSON.stringify([...deja, id]));
  } catch {
    // Stockage plein ou refusé : les propositions reviendront, et c'est le bon
    // sens de l'erreur.
  }
}

/**
 * Reconnaît la capacité exercée par un message tapé à la main.
 *
 * Sans ça, quelqu'un qui pose un rappel de lui-même se verrait proposer « pose
 * un rappel » au message suivant — ce qui apprend en une ligne que l'application
 * ne suit pas ce qu'elle vient de faire.
 *
 * Le doute ne retient rien : mieux vaut reproposer une capacité déjà vue que
 * d'en marquer une comme découverte alors qu'elle ne l'est pas.
 */
export function retenirCapaciteDepuisMessage(texte: string): void {
  const t = (texte || '').toLowerCase();
  if (/rappell?e|réveille|reveille|préviens|previens/.test(t)) retenirCapacite('rappel');
  if (/plan|programme|routine|séance|seance/.test(t)) retenirCapacite('plan');
  if (/habitude/.test(t)) retenirCapacite('habitude');
  if (/compris de moi|tu penses de moi|analyse-moi|mes points faibles/.test(t)) {
    retenirCapacite('lecture');
  }
}

/** Combien de journées ce compte a-t-il vraiment vécues ? */
function joursVecus(): number {
  try {
    const scores = JSON.parse(localStorage.getItem('mindset_daily_scores') || '{}');
    return scores && typeof scores === 'object' ? Object.keys(scores).length : 0;
  } catch {
    return 0;
  }
}

/**
 * Les quatre capacités, formulées selon l'état du compte.
 *
 * Une suggestion à côté de la plaque coûte plus qu'aucune : elle apprend que
 * l'app ne suit pas. « Fais-moi un plan » à quelqu'un qui en a déjà un, ou
 * « qu'as-tu compris de moi » le premier jour — quand il n'y a rien à comprendre
 * — sont les deux façons les plus rapides de perdre la confiance qu'on cherche
 * précisément à installer ici.
 */
export function toutesLesCapacites(): Capacite[] {
  const aUnPlan = liste('mindset_routines').length > 0;
  const jours = joursVecus();

  return [
    {
      id: 'plan',
      titre: 'Construire ton plan',
      phrase: aUnPlan
        ? "J'ai décroché hier, adapte mon plan pour aujourd'hui"
        : 'Fais-moi un plan pour la semaine',
    },
    {
      id: 'rappel',
      titre: 'Te rappeler à l’heure',
      phrase: 'Rappelle-moi de méditer ce soir à 22 h 30',
    },
    {
      id: 'habitude',
      titre: 'Poser une habitude',
      phrase: 'Propose-moi deux habitudes simples à tenir',
    },
    {
      id: 'lecture',
      titre: 'Te dire ce qu’il voit',
      phrase:
        jours >= 3
          ? "Qu'est-ce que tu as compris de moi ?"
          : 'Que dois-je faire en priorité aujourd’hui ?',
    },
  ];
}

/**
 * Ce qu'il reste à découvrir, au plus `combien`.
 *
 * **Trois au maximum, jamais quatre.** Quatre tiendraient encore à l'écran, et
 * c'est justement le problème : un menu se lit, trois phrases se choisissent.
 */
export function capacitesADecouvrir(combien = 3): Capacite[] {
  const vues = capacitesEssayees();
  return toutesLesCapacites()
    .filter((c) => !vues.includes(c.id))
    .slice(0, combien);
}

/** Vrai quand il n'y a plus rien à montrer : la découverte est finie. */
export function toutEssaye(): boolean {
  return capacitesADecouvrir(1).length === 0;
}
