/**
 * Le fournisseur de secours, quand Groq ne répond plus.
 *
 * Groq est gratuit et rapide, et ses limites sont comptées par modèle et par jour.
 * Tant qu'il tient, il n'y a aucune raison de payer. Mais son plan Developer est
 * fermé — « temporarily unavailable due to high demand », signalé sur leur forum
 * depuis mai 2026 : on ne peut pas acheter davantage de capacité, même en le
 * voulant. Le produit dépend donc entièrement d'un quota gratuit qu'il partage
 * avec tout le monde, et le coach est précisément ce que l'abonnement fait payer.
 *
 * D'où ce dernier maillon : il ne s'ajoute qu'**après** toute la chaîne gratuite,
 * il ne travaille donc que sur les requêtes que Groq a refusées. À quelques
 * dizaines de messages par jour, cela se compte en centimes — et le coach cesse
 * de ne pas répondre.
 *
 * **Rien n'est codé en dur au fournisseur.** L'adresse, le modèle et la clé
 * viennent de l'environnement : le jour où Groq rouvre, où le secours devient
 * moins cher ailleurs, ou où celui-ci ferme à son tour, c'est une variable à
 * changer sur Render, pas un déploiement. Tout service exposant l'API de complétion
 * au format OpenAI convient — c'est le format qu'utilise déjà chaque appel du
 * projet, Groq compris.
 */

/** Là où le secours répond, si rien n'est précisé. */
const URL_PAR_DEFAUT = 'https://openrouter.ai/api/v1/chat/completions';

export interface FournisseurSecours {
  url: string;
  apiKey: string;
  modele: string;
}

/**
 * La configuration du secours, ou `null` s'il n'y en a pas.
 *
 * **L'absence de clé est le cas normal, pas une erreur.** Sans elle, la chaîne se
 * limite aux modèles gratuits et l'application se comporte exactement comme avant
 * — c'est ce qui permet de déployer ce code avant d'avoir un compte, et de couper
 * la dépense en retirant une variable.
 */
export function lireFournisseurSecours(): FournisseurSecours | null {
  const apiKey = process.env.SECOURS_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;

  const modele = process.env.SECOURS_MODELE;
  if (!modele || !modele.trim()) {
    /*
      Une clé sans modèle ne peut pas marcher : l'identifiant n'est pas devinable,
      il change d'un fournisseur à l'autre. On le dit une fois, fort, plutôt que de
      laisser la chaîne échouer sur un 400 que personne ne reliera à ceci.
    */
    console.error(
      '[Secours] SECOURS_API_KEY est définie mais SECOURS_MODELE manque : le secours reste inactif.',
    );
    return null;
  }

  return {
    url: process.env.SECOURS_API_URL?.trim() || URL_PAR_DEFAUT,
    apiKey: apiKey.trim(),
    modele: modele.trim(),
  };
}
