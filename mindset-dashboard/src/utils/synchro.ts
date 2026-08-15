/**
 * Savoir si ce navigateur porte du travail que le serveur n'a jamais reçu.
 *
 * La descente d'état (`downloadCloudState`) écrase trente clés de `localStorage`
 * sans comparer quoi que ce soit, et elle s'exécute à chaque retour sur l'onglet.
 * Tant que la remontée réussit, c'est sans conséquence. Mais la remontée échoue en
 * silence — réseau coupé, session expirée, requête tuée par le système en
 * arrière-plan — et la séquence devenait alors : la synchro rate, la personne
 * continue de cocher ses tâches, elle change d'application, elle revient, et le
 * serveur — plus ancien — écrase tout ce qu'elle vient de faire. Sans un mot.
 *
 * D'où ces deux compteurs. Ils ne datent rien et ne fusionnent rien : ils
 * répondent à une seule question, celle qui suffit à ne rien détruire — **reste-t-il
 * ici des changements que le serveur n'a pas accusés ?** Si oui, on remonte avant
 * de redescendre, et on renonce à redescendre tant que la remontée n'est pas
 * passée. Le pire cas devient un appareil en retard sur les autres, au lieu d'un
 * appareil qui perd une journée de travail.
 *
 * Pourquoi un compteur plutôt qu'un horodatage : l'heure d'un navigateur se règle
 * à la main et se désynchronise, alors qu'un entier qui monte n'a besoin de se
 * comparer qu'à lui-même.
 */

const CLE_MODIF = 'mindset_modif_locale';
const CLE_CONFIRME = 'mindset_modif_confirmee';

/**
 * Les deux clés du compteur lui-même, à exclure de l'instrumentation d'écriture.
 *
 * `api.ts` remplace `localStorage.setItem` pour déclencher la synchro. Sans cette
 * liste, écrire le compteur repasserait par ce remplacement, qui incrémenterait le
 * compteur, ce qui l'écrirait à nouveau : une récursion infinie dès la première
 * case cochée. Elles ne décrivent d'ailleurs aucune donnée de l'utilisateur — les
 * remonter n'aurait aucun sens.
 */
export const CLES_COMPTEUR: ReadonlySet<string> = new Set([CLE_MODIF, CLE_CONFIRME]);

/**
 * Les deux clés portent le préfixe `mindset_`, et ce n'est pas cosmétique.
 *
 * `oublierLaSession()` efface tout ce qui commence par `mindset_` : à la
 * déconnexion volontaire, les compteurs partent donc avec les données qu'ils
 * décrivent, et le compte suivant démarre sur un serveur qui fait autorité.
 * `terminerSession()` (session expirée) ne les efface pas — et c'est exactement ce
 * qu'il faut, puisque les données locales non synchronisées survivent, elles aussi.
 */
function lire(cle: string): number {
  const brut = Number(localStorage.getItem(cle));
  return Number.isFinite(brut) && brut > 0 ? brut : 0;
}

/** Appelé à chaque écriture locale d'une donnée synchronisable. */
export function marquerModificationLocale(): void {
  localStorage.setItem(CLE_MODIF, String(lire(CLE_MODIF) + 1));
}

/**
 * Le numéro à confirmer si la remontée qui part maintenant aboutit.
 *
 * Relevé **avant** l'envoi, et pas après : une case cochée pendant que la requête
 * voyage n'est pas dans le corps qui a été sérialisé. La confirmer aussi
 * l'effacerait de la mémoire du compteur, et c'est précisément elle que la
 * prochaine descente écraserait.
 */
export function releverModifications(): number {
  return lire(CLE_MODIF);
}

/** La remontée a abouti : tout ce qui était compté à son départ est en sécurité. */
export function confirmerModifications(releve: number): void {
  // Jamais en arrière : deux remontées peuvent se croiser, et la plus lente ne doit
  // pas rouvrir ce que la plus rapide a déjà refermé.
  if (releve > lire(CLE_CONFIRME)) localStorage.setItem(CLE_CONFIRME, String(releve));
}

/** Reste-t-il ici du travail que le serveur n'a jamais accusé ? */
export function aDesModificationsNonSynchronisees(): boolean {
  return lire(CLE_MODIF) > lire(CLE_CONFIRME);
}

/**
 * Plafond au-delà duquel `keepalive` refuse la requête.
 *
 * La spécification `fetch` limite à 64 Ko le corps d'une requête `keepalive`, et
 * c'est cette option qui permet à la synchro de survivre à la mise en
 * arrière-plan. Au-delà, la requête échoue — silencieusement, par le même chemin
 * que toutes les autres pannes de synchro. Le piège est que la charge grossit avec
 * l'usage : `daily_scores` gagne une entrée par jour et ne perd jamais rien. Plus
 * quelqu'un utilisait l'application, plus sa sauvegarde risquait de cesser de
 * fonctionner sans rien dire.
 *
 * On garde de la marge sous les 64 Ko : la limite porte sur l'ensemble des
 * requêtes `keepalive` en vol, pas sur une seule.
 */
const PLAFOND_KEEPALIVE = 56 * 1024;

/**
 * `keepalive` seulement si le corps peut passer.
 *
 * Au-dessus du plafond, mieux vaut une requête ordinaire — que le système peut tuer
 * en arrière-plan — qu'une requête `keepalive` qui, elle, échouera à coup sûr. Et
 * comme une remontée ratée ne détruit plus rien désormais, le pire cas est un envoi
 * remis au prochain démarrage.
 */
export function keepaliveAcceptable(corps: unknown): boolean {
  try {
    return JSON.stringify(corps).length <= PLAFOND_KEEPALIVE;
  } catch {
    return false;
  }
}
