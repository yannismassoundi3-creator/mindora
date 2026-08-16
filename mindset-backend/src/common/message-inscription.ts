/**
 * Le message que la fin du questionnaire envoie au coach à la place de la
 * personne, pour qu'elle reçoive son plan sans avoir à le réclamer.
 *
 * Il est légitime — c'est lui qui évite de déposer quelqu'un devant un tableau de
 * bord vide après six questions — mais il n'est pas une conversation. Enregistré
 * comme n'importe quel message avec `sender: 'user'`, il fait surcompter toute
 * requête qui mesure l'usage du coach : le tableau du jour affichait « 9 inscrits,
 * 9 ont parlé au coach », une conversion parfaite et entièrement mécanique.
 *
 * Recopié depuis `Onboarding.tsx` plutôt que partagé avec lui : le client est
 * déployé séparément, et une constante importée d'ici ne l'atteindrait pas. Si la
 * phrase change là-bas, les lignes déjà en base gardent l'ancienne — il faudra
 * alors ajouter la nouvelle ici plutôt que remplacer.
 *
 * La comparaison est exacte, jamais par mots-clés : une correspondance
 * approximative exclurait de vrais messages, et on retomberait sur la même panne
 * dans l'autre sens — un chiffre faux, d'apparence normale.
 */
export const MESSAGE_AUTOMATIQUE_INSCRIPTION =
  "Je viens de terminer mon inscription. Donne-moi mon plan pour aujourd'hui : mes routines, mes habitudes et mes objectifs.";

/** Le filtre Prisma qui ne retient que les messages réellement écrits par la personne. */
export const FILTRE_MESSAGES_ECRITS = {
  sender: 'user',
  text: { not: MESSAGE_AUTOMATIQUE_INSCRIPTION },
} as const;
