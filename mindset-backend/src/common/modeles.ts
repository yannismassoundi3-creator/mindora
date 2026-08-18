/**
 * Les modèles appelés par le produit, en un seul endroit.
 *
 * **Ils étaient recopiés dans cinq fichiers, et c'est ce qui a rendu leur mort
 * invisible.** Groq a annoncé le 17 juin 2026 la dépréciation de
 * `llama-3.3-70b-versatile` et `llama-3.1-8b-instant`, éteints le **16 août
 * 2026**. Le 18, les cinq listes les nommaient encore. Conséquences, toutes
 * silencieuses et toutes constatées le même jour :
 *
 * - le brief du matin partait en version générique pour tout le monde ;
 * - le bilan du dimanche n'avait plus de lecture ;
 * - le coup de pouce de 15 h ne pouvait plus être écrit ;
 * - la mémoire longue n'était plus recompressée ;
 * - le chat perdait un aller-retour par message, et n'avait plus qu'un seul
 *   maillon gratuit vivant sur trois.
 *
 * Aucune de ces pannes ne lève d'erreur : chaque service retombe proprement sur
 * son repli local, ce qui est le bon comportement et exactement ce qui empêche
 * de s'apercevoir que plus rien n'est écrit par un modèle. C'est la deuxième
 * fois que ce projet le paie — la première, en août 2026 déjà, avec des modèles
 * interdits au niveau du projet Groq.
 *
 * **Une liste de modèles écrite en dur pourrit toute seule.** D'où ce fichier
 * unique, et surtout le contrôle `GET /admin/modeles`, qui appelle vraiment
 * chaque identifiant et dit lesquels répondent. Une liste qu'on ne teste jamais
 * n'est pas une configuration, c'est une supposition.
 */

/**
 * La chaîne du chat, dans l'ordre.
 *
 * L'ordre suit la capacité à produire le bloc `<PLAN>` en JSON valide, puisque
 * c'est ce qui casse en premier sur un petit modèle — le raisonnement d'origine
 * n'a pas changé, seuls les identifiants ont changé. Le plus capable d'abord, le
 * plus petit en dernier comme filet.
 *
 * `qwen/qwen3.6-27b` est en troisième position et **son identifiant n'est pas
 * vérifié en production** : Groq le recommande comme remplaçant, mais s'il est
 * faux la chaîne le traitera comme un modèle retiré et passera au suivant. Un
 * maillon incertain placé au milieu coûte au pire un aller-retour ; l'omettre
 * coûterait un filet le jour où les deux autres saturent.
 */
export const MODELES_CHAT = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
];

/**
 * Les textes courts : brief du matin, coup de pouce, bilan, mémoire longue.
 *
 * Le petit modèle d'abord, à l'inverse du chat. Ces textes font entre 160 et 900
 * caractères et n'ont aucun JSON à produire : la capacité supplémentaire du gros
 * modèle n'y change presque rien, alors que le quota qu'elle consomme, si. Le
 * gros reste derrière, pour que l'échec du premier ne coûte pas le texte.
 */
export const MODELES_COURTS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

/** Tous les identifiants distincts, pour le contrôle d'exploitation. */
export function tousLesModeles(): string[] {
  return [...new Set([...MODELES_CHAT, ...MODELES_COURTS])];
}
