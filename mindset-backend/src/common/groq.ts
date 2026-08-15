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
