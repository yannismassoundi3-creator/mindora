import { MODELES_COURTS } from './modeles';
import { lireFournisseurSecours } from './fournisseur-secours';
import { corpsGroq, DemandeGroq } from './groq';

/**
 * La chaîne des textes courts : les modèles gratuits, puis le fournisseur payant.
 *
 * **Le chat avait un filet, les six autres fonctions n'en avaient aucun.** Le
 * brief du matin, le coup de pouce, le bilan du dimanche, la mémoire longue et
 * l'analyse complète — celle que l'abonnement fait payer — parlaient à Groq et à
 * personne d'autre. Le jour où le quota gratuit tombe, elles retombent toutes sur
 * leurs textes locaux **en silence**, comme du 16 au 19 août 2026.
 *
 * Le plafond n'est pas lointain : trois modèles à 200 K jetons par jour font
 * 600 K, un message de coach en coûte ~5 500, et un abonné a droit à 50 messages
 * par jour. Deux abonnés bavards suffisent. Ce n'est donc pas une précaution
 * théorique — c'est la limite que le produit atteindra en grandissant, et le seul
 * choix offert est entre payer quelques centimes et s'appauvrir sans le dire.
 *
 * Le maillon payant est **toujours dernier** : il ne travaille que sur ce que la
 * chaîne gratuite a refusé.
 *
 * **La dépense est bornée par le nombre de comptes, pas par l'usage** : un brief
 * par personne et par jour, un coup de pouce, une note de mémoire, un bilan par
 * semaine. Ce n'est pas le cas du chat, où une seule personne peut demander
 * cinquante réponses dans la journée — d'où le plafond qui existe là-bas et
 * l'absence de plafond ici.
 *
 * **La phrase d'ouverture du coach n'est délibérément pas dans cette chaîne.**
 * Elle est la seule dont l'échec a été conçu pour être invisible : une version
 * composée localement s'affiche déjà, et rester muet ne dégrade rien de visible.
 * La faire descendre chez un fournisseur payant ferait payer chaque ouverture de
 * chat pour remplacer une phrase correcte par une autre. Les cinq autres, elles,
 * n'ont pas d'équivalent local à la hauteur.
 */
export interface MaillonCourt {
  modele: string;
  url: string;
  apiKey: string;
  /** Vrai pour le fournisseur payant. Mérite une ligne de journal à chaque usage. */
  paye: boolean;
}

const URL_GROQ = 'https://api.groq.com/openai/v1/chat/completions';

export function chaineCourte(cleGroq?: string): MaillonCourt[] {
  const gratuits: MaillonCourt[] = cleGroq
    ? MODELES_COURTS.map((modele) => ({ modele, url: URL_GROQ, apiKey: cleGroq, paye: false }))
    : [];

  const secours = lireFournisseurSecours();
  if (!secours) return gratuits;

  return [...gratuits, { modele: secours.modele, url: secours.url, apiKey: secours.apiKey, paye: true }];
}

/**
 * Un appel sur un maillon, quel qu'en soit le fournisseur.
 *
 * **Le réglage de raisonnement part ici aussi, y compris chez le payant, et c'est
 * une différence assumée avec le chat.** Le chat accorde 1500 jetons, assez pour
 * qu'un modèle réfléchisse puis écrive ; ces textes-ci en accordent 80 à 300, et
 * sans le réglage un modèle à raisonnement les dépense entièrement à réfléchir et
 * ne rend rien. Payer un fournisseur pour qu'il produise du vide serait le pire
 * des deux mondes.
 *
 * Le vocabulaire se déduit du nom du modèle, pas du fournisseur — mais rien ne
 * garantit qu'un service tiers accepte le paramètre. **Un 400 qui le nomme vaut
 * donc un second essai sans lui**, une fois, sur le même maillon : perdre le
 * dernier filet sur une option refusée serait absurde, et ce cas ne peut pas être
 * vérifié d'ici faute d'avoir la clé du secours en local.
 */
export async function appelerMaillon(
  maillon: MaillonCourt,
  demande: Omit<DemandeGroq, 'modele'>,
  signal: AbortSignal,
): Promise<Response> {
  const corps = corpsGroq({ ...demande, modele: maillon.modele });

  const envoyer = (charge: Record<string, any>) =>
    fetch(maillon.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${maillon.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(charge),
      signal,
    });

  const reponse = await envoyer(corps);
  if (reponse.status !== 400 || !corps.reasoning_effort) return reponse;

  const detail = await reponse.text().catch(() => '');
  if (!detail.includes('reasoning_effort')) {
    // Un 400 pour une autre raison : le rendre tel quel, avec son corps intact.
    return new Response(detail, { status: 400, statusText: reponse.statusText });
  }

  const { reasoning_effort: _refuse, ...sansReglage } = corps;
  return envoyer(sansReglage);
}
