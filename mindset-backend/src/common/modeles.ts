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

/**
 * Le budget d'une notification : brief du matin, coup de pouce, et le contrôle.
 *
 * **80 jetons étranglaient le modèle sans que rien ne le dise.** Mesuré contre le
 * vrai Groq le 21 août 2026, sur l'invite exacte du brief, 14 appels par budget :
 *
 * - à **80** : 4 textes utilisables. 4 réponses vides, 6 refusées pour troncature.
 * - à **200** : 12 textes utilisables. 2 vides, aucune troncature.
 *
 * La raison est visible dans `usage.completion_tokens_details` : le raisonnement
 * consomme entre 13 et 78 jetons selon l'humeur du modèle, sur le même budget que
 * la réponse. À 80, un raisonnement bavard ne laisse rien pour écrire — et
 * `reasoning_effort: low`, déjà envoyé, réduit cette dépense sans la borner.
 *
 * **Ce n'est pas le budget qui tenait la longueur, c'est l'invite.** La crainte
 * légitime était qu'un budget large produise des phrases coupées à
 * `PLAFOND_CARACTERES` : sur les douze textes obtenus à 200, le plus long faisait
 * 113 caractères, aucun n'a été coupé. La consigne « maximum 140 caractères » fait
 * ce travail toute seule.
 *
 * **Le coût ne suit pas le plafond**, il suit les jetons réellement écrits — une
 * soixantaine dans les deux cas. Seuls les raisonnements emballés coûtent
 * davantage, et ils étaient jusqu'ici payés pour ne rien rendre.
 *
 * Une seule constante pour les trois appels : le 19 août, un contrôle réglé à 200
 * quand la production en accordait 80 a certifié verts des modèles muets. Deux
 * budgets qui doivent rester égaux ne le restent que s'ils n'existent qu'une fois.
 */
export const JETONS_TEXTE_COURT = 200;

/** Tous les identifiants distincts, pour le contrôle d'exploitation. */
export function tousLesModeles(): string[] {
  return [...new Set([...MODELES_CHAT, ...MODELES_COURTS])];
}

/**
 * Le réglage de raisonnement à envoyer pour ce modèle, ou `undefined` s'il n'en
 * accepte aucun.
 *
 * **Les trois modèles qui ont remplacé les llama éteints réfléchissent avant
 * d'écrire, et leur réflexion se paie sur le même budget que leur réponse.**
 * Mesuré le 19 août 2026 contre le vrai Groq : `openai/gpt-oss-20b` à qui l'on
 * accorde 80 jetons — le budget du brief du matin — en dépense 80 en
 * raisonnement, rend `content: ""` et `finish_reason: "length"`. À 300 jetons,
 * il en dépense 298. À 500, 498. Le budget n'est jamais assez grand : ce n'est
 * pas une question de taille, c'est que rien ne borne le raisonnement tant qu'on
 * ne le borne pas explicitement.
 *
 * Conséquence, exactement celle de la panne précédente et par le même chemin :
 * brief du matin, coup de pouce, phrase d'ouverture, bilan du dimanche et
 * mémoire longue rendaient du vide, chaque service retombait proprement sur son
 * repli local, et **rien ne levait d'erreur**. Le correctif du 18 août avait
 * remplacé des modèles morts par des modèles muets.
 *
 * Avec le réglage ci-dessous, le même appel à 80 jetons dépense 6 jetons de
 * raisonnement et rend une vraie phrase. Le bloc `<PLAN>` du chat reste du JSON
 * valide sur les trois modèles — vérifié avant d'écrire cette ligne.
 *
 * **Le vocabulaire n'est pas le même d'une famille à l'autre, et une valeur
 * étrangère est un 400, pas un défaut ignoré** : les GPT-OSS n'acceptent que
 * `low`, `medium` ou `high` ; Qwen 3.6 n'accepte que `none` ou `default`.
 * D'où cette fonction plutôt qu'une constante — et `undefined` pour tout modèle
 * inconnu, car ne rien envoyer est le seul choix qui ne casse jamais un appel.
 */
export function effortDeRaisonnement(modele: string): string | undefined {
  if (modele.startsWith('openai/gpt-oss')) return 'low';
  if (modele.startsWith('qwen/')) return 'none';
  return undefined;
}
