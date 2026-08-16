/**
 * Les messages que la fin du questionnaire envoie au coach à la place de la
 * personne, pour qu'elle reçoive son plan sans avoir à le réclamer.
 *
 * Ils sont légitimes — c'est ce qui évite de déposer quelqu'un devant un tableau
 * de bord vide après six questions — mais ce ne sont pas des conversations.
 * Enregistrés comme n'importe quel message avec `sender: 'user'`, ils font
 * surcompter toute requête qui mesure l'usage du coach : le tableau du jour
 * affichait « 9 inscrits, 9 ont parlé au coach », une conversion parfaite et
 * entièrement mécanique.
 *
 * **C'est une liste, et elle ne fait que s'allonger.** Les formulations sont
 * recopiées depuis `Onboarding.tsx` plutôt que partagées avec lui : le client est
 * déployé séparément, et une constante importée d'ici ne l'atteindrait pas.
 * Surtout, les lignes déjà en base gardent l'ancienne formulation pour toujours —
 * remplacer au lieu d'ajouter ferait silencieusement recompter comme des
 * conversations tous les questionnaires d'avant le changement.
 *
 * La comparaison est exacte, jamais par mots-clés : une correspondance
 * approximative exclurait de vrais messages, et on retomberait sur la même panne
 * dans l'autre sens — un chiffre faux, d'apparence normale.
 */
export const MESSAGES_AUTOMATIQUES_INSCRIPTION: readonly string[] = [
  // Depuis le 16 août 2026 : le plan s'ouvre sur une action faisable tout de suite.
  "Je viens de terminer mon inscription. Donne-moi d'abord UNE première action que je peux faire maintenant, en moins de 5 minutes. Ensuite seulement, mon plan complet : mes routines, mes habitudes et mes objectifs.",
  // La formulation d'origine. Conservée : les lignes déjà en base la portent.
  "Je viens de terminer mon inscription. Donne-moi mon plan pour aujourd'hui : mes routines, mes habitudes et mes objectifs.",
];

/** Le filtre Prisma qui ne retient que les messages réellement écrits par la personne. */
export const FILTRE_MESSAGES_ECRITS = {
  sender: 'user',
  text: { notIn: MESSAGES_AUTOMATIQUES_INSCRIPTION as string[] },
} as const;

/** L'inverse : uniquement les messages automatiques, comptés à part. */
export const FILTRE_MESSAGES_AUTOMATIQUES = {
  sender: 'user',
  text: { in: MESSAGES_AUTOMATIQUES_INSCRIPTION as string[] },
} as const;

/**
 * Vrai si ce texte est l'un des messages envoyés automatiquement.
 *
 * Utile là où l'on tient les messages en mémoire plutôt qu'en base — le filtre
 * Prisma ne s'applique qu'aux requêtes.
 */
export function estMessageAutomatique(texte: string | null | undefined): boolean {
  return !!texte && MESSAGES_AUTOMATIQUES_INSCRIPTION.includes(texte);
}
