/**
 * Lecture d'une réponse de l'API Groq.
 *
 * `finish_reason` n'était lu nulle part dans le projet. Or une réponse arrêtée net
 * par `max_tokens` a exactement la même forme qu'une réponse terminée : même statut
 * 200, même `choices[0].message.content`, aucune exception. Le code prenait donc le
 * morceau pour le tout, et rien dans les journaux ne permettait de s'en apercevoir.
 *
 * Les dégâts dépendent entièrement de l'endroit, et c'est pourquoi cette fonction se
 * contente de rapporter le fait au lieu de décider à la place de l'appelant : une
 * note de mémoire longue amputée est réécrite en base puis renvoyée au modèle chaque
 * jour, tandis qu'une notification du matin est de toute façon ramenée à 160
 * caractères, ce qui absorbe la coupure sans que personne ne la voie jamais.
 */

import { effortDeRaisonnement } from './modeles';

export interface ReponseGroq {
  /** Le texte rendu par le modèle, sans espaces de bord, ou `null` s'il est vide. */
  texte: string | null;
  /**
   * Vrai quand c'est `max_tokens` qui a arrêté le modèle, et non le modèle lui-même.
   *
   * L'absence de `finish_reason` vaut « terminé » : c'est ce que rend un fournisseur
   * qui ne renseigne pas le champ, et supposer l'inverse ferait rejeter des réponses
   * parfaitement complètes.
   */
  tronque: boolean;
}

export function lireReponseGroq(data: any): ReponseGroq {
  const choix = data?.choices?.[0];
  const contenu = typeof choix?.message?.content === 'string' ? choix.message.content.trim() : '';

  return { texte: contenu || null, tronque: choix?.finish_reason === 'length' };
}

/**
 * Le corps d'un appel de complétion, construit en un seul endroit.
 *
 * Sept appels distincts écrivaient leur propre littéral. C'est le même défaut que
 * les cinq listes de modèles du 18 août : le jour où un réglage manque à tous, il
 * faut le retrouver sept fois, et on en oublie. Le réglage en question est
 * `reasoning_effort`, sans lequel les modèles actuels dépensent en réflexion tout
 * le budget des textes courts et ne rendent rien — voir `effortDeRaisonnement`.
 */
export interface DemandeGroq {
  modele: string;
  messages: any[];
  temperature: number;
  /** `max_tokens` : la réponse **et** le raisonnement se servent dedans. */
  jetons: number;
}

export function corpsGroq({ modele, messages, temperature, jetons }: DemandeGroq): Record<string, any> {
  const effort = effortDeRaisonnement(modele);
  return {
    model: modele,
    messages,
    temperature,
    max_tokens: jetons,
    ...(effort ? { reasoning_effort: effort } : {}),
  };
}

/**
 * Le même corps, réadressé au maillon suivant de la chaîne.
 *
 * Le chat compose son corps une fois puis le repasse de modèle en modèle. Le
 * réglage de raisonnement, lui, **ne se transporte pas** : `low` est valide chez
 * GPT-OSS et refusé par Qwen d'un 400 sec. Reconduire l'ancienne valeur ferait
 * échouer le maillon de secours au seul moment où l'on compte dessus — et
 * l'échec ressemblerait à un modèle mort. D'où le retrait avant recalcul.
 *
 * `avecEffort: false` pour le fournisseur de secours : son modèle vient d'une
 * variable d'environnement, chez un service dont on ne sait rien. Il ne travaille
 * que sur le chat, dont le budget de 1500 jetons absorbe un raisonnement complet.
 * Ne rien lui envoyer est donc sans coût, là où un paramètre refusé coûterait le
 * dernier maillon de la chaîne.
 */
export function pourModele(
  corps: Record<string, any>,
  modele: string,
  avecEffort = true,
): Record<string, any> {
  const { reasoning_effort: _ignore, ...reste } = corps;
  const effort = avecEffort ? effortDeRaisonnement(modele) : undefined;
  return { ...reste, model: modele, ...(effort ? { reasoning_effort: effort } : {}) };
}
