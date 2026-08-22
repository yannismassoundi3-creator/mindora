/*
  « Cette personne a un plan. »

  Le moment où l'application devient utile, et donc le seul moment où lui demander
  quelque chose se défend. Avant, on demandait à l'arrivée : la carte d'installation
  surgissait trois secondes après le premier écran, sur un compte encore vide, et la
  réponse à une exigence formulée par un produit qu'on n'a pas encore vu marcher est
  non — définitivement non dans le cas des notifications, que le navigateur ne
  repropose jamais.

  Deux façons de le savoir, et il faut les deux : l'événement pour l'instant précis
  où le plan tombe (la personne est devant son écran, elle vient de voir le produit
  faire son travail), la lecture du stockage pour toutes les fois d'après.
*/

/** Émis quand un plan vient d'être appliqué dans l'app. */
export const EVENEMENT_PLAN = 'mindset:plan-applique';

/** Une liste du stockage local, tolérante à tout ce qui n'est pas un tableau. */
function liste(cle: string): unknown[] {
  try {
    const parse = JSON.parse(localStorage.getItem(cle) || '[]');
    return Array.isArray(parse) ? parse : [];
  } catch {
    return [];
  }
}

/**
 * Vrai dès qu'un plan existe dans cette application.
 *
 * Routines **ou** habitudes : le coach rend parfois l'un sans l'autre — « commence
 * petit, une seule habitude » est une des trois propositions du premier écran, et
 * elle ne crée aucune routine. Exiger les deux ferait passer ce plan-là pour une
 * absence de plan.
 */
export function aUnPlan(): boolean {
  return liste('mindset_routines').length > 0 || liste('mindset_habits').length > 0;
}

/** À appeler une fois le plan écrit dans le stockage, jamais avant. */
export function signalerPlanApplique(): void {
  window.dispatchEvent(new Event(EVENEMENT_PLAN));
}
