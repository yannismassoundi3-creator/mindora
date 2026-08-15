import { getSecurePoints } from './secureStorage';
import { lireXp } from './progression';

/**
 * Ce que ce navigateur détient, et comment savoir si le serveur l'a déjà reçu.
 *
 * Deux besoins distincts se servent du même état : la remontée l'envoie, et le
 * contrôle « reste-t-il du travail non sauvegardé ? » en calcule l'empreinte. Les
 * faire lire deux constructions différentes serait la garantie qu'un jour l'une
 * dise « tout est en sécurité » d'un état que l'autre n'a jamais envoyé.
 */

/** Les listes qu'un plan complète, et le nom qu'elles portent à l'écran. */
export const LISTES_DU_PLAN: ReadonlyArray<readonly [string, string]> = [
  ['mindset_habits', 'tes habitudes'],
  ['mindset_routines', 'tes routines'],
  ['mindset_nutrition', 'ton alimentation'],
  ['mindset_micro_obj', 'tes objectifs'],
  ['mindset_macro_obj', 'tes objectifs long terme'],
];

/**
 * Toutes les clés que la synchro couvre — donc tout ce qu'une adoption de la
 * version du serveur peut remplacer, et tout ce qu'une copie de secours doit
 * contenir pour être fidèle.
 */
export const CLES_SYNCHRONISEES = [
  'mindset_routines',
  'mindset_micro_obj',
  'mindset_macro_obj',
  'mindset_habits',
  'mindset_nutrition',
  'mindset_daily_scores',
  'mindset_rewards',
  'mindset_inventory_rewards',
  'mindset_owned_cosmetics',
  'mindset_ai_skin_id',
  'mindset_last_routine_date',
  'mindset_last_habit_date',
  'mindset_join_date',
  'mental_score',
  'bonus_mental_score',
] as const;

/**
 * Les listes qu'on n'arrive pas à relire, sous leur nom lisible.
 *
 * Une clé **absente** n'en fait pas partie, et c'est la distinction qui compte :
 * n'avoir jamais rien écrit est l'état normal d'un compte neuf, où le plan a
 * précisément vocation à tout créer. Seul ce qui est présent mais indéchiffrable —
 * JSON invalide, ou valide mais qui n'est pas un tableau — mérite qu'on s'arrête.
 */
export interface ListeIllisible {
  cle: string;
  nom: string;
}

export function listesIllisibles(): ListeIllisible[] {
  return LISTES_DU_PLAN.filter(([cle]) => {
    const brut = localStorage.getItem(cle);
    if (brut === null) return false;
    try {
      return !Array.isArray(JSON.parse(brut));
    } catch {
      return true;
    }
  }).map(([cle, nom]) => ({ cle, nom }));
}

/**
 * Repart d'une liste vide, sans jeter ce qu'on n'a pas su lire.
 *
 * Refuser d'appliquer un plan protège le travail existant, mais laissait la
 * personne enfermée : plus aucun plan ne s'appliquait, et le seul conseil qu'on
 * savait lui donner — « ouvre l'écran concerné pour vérifier » — n'était pas une
 * réparation, c'était un vœu. Il fallait une porte de sortie.
 *
 * La valeur illisible est mise de côté plutôt que supprimée. Elle ne sert plus à
 * l'application, mais elle contient peut-être encore des mois de travail lisible à
 * l'œil nu, et rien ne justifie de la détruire pour gagner quelques octets.
 */
export function reparerListe(cle: string): void {
  const brut = localStorage.getItem(cle);
  if (brut !== null) {
    try {
      localStorage.setItem(`mindset_illisible_${cle}`, brut);
    } catch {
      // Stockage plein : la mise de côté échoue, la réparation doit avoir lieu
      // quand même — c'est elle que la personne a demandée.
    }
  }
  localStorage.setItem(cle, '[]');
}

/** Relit une liste, en rendant `[]` sur tout ce qui n'est pas un tableau. */
function liste(cle: string): any[] {
  try {
    const parse = JSON.parse(localStorage.getItem(cle) || '[]');
    return Array.isArray(parse) ? parse : [];
  } catch {
    return [];
  }
}

/**
 * L'état à envoyer au serveur.
 *
 * L'ordre des clés est significatif : `JSON.stringify` le respecte, et l'empreinte
 * qui en découle doit être stable d'un appel à l'autre. Réordonner ce littéral
 * ferait croire à un changement à chaque construction, donc à du travail non
 * sauvegardé en permanence.
 */
export function construireEtatLocal(): Record<string, any> {
  return {
    routines: liste('mindset_routines'),
    micro_objectives: liste('mindset_micro_obj'),
    macro_objectives: liste('mindset_macro_obj'),
    habits: liste('mindset_habits'),
    nutrition: liste('mindset_nutrition'),
    points: getSecurePoints(),
    xp: lireXp(),
    mental_score: parseInt(localStorage.getItem('mental_score') || '0', 10),
    bonus_score: parseInt(localStorage.getItem('bonus_mental_score') || '0', 10),
    daily_scores: (() => {
      try {
        const parse = JSON.parse(localStorage.getItem('mindset_daily_scores') || '{}');
        return parse && typeof parse === 'object' ? parse : {};
      } catch {
        return {};
      }
    })(),
    rewards: liste('mindset_rewards'),
    inventory: liste('mindset_inventory_rewards'),
    owned_cosmetics: liste('mindset_owned_cosmetics'),
    ai_skin_id: localStorage.getItem('mindset_ai_skin_id') || '',
    last_routine_date: localStorage.getItem('mindset_last_routine_date') || '',
    last_habit_date: localStorage.getItem('mindset_last_habit_date') || '',
    join_date: localStorage.getItem('mindset_join_date') || '',
    settings: {
      encryption: localStorage.getItem('mindset_sec_encryption') !== 'false',
      biometric: localStorage.getItem('mindset_sec_biometric') === 'true',
      localHistory: localStorage.getItem('mindset_sec_local') !== 'false',
    },
  };
}

/**
 * Nombre de jours de score conservés.
 *
 * `mindset_daily_scores` gagnait une entrée par jour et n'en perdait jamais : la
 * charge de synchro grossissait donc indéfiniment, et c'est elle qui finit par
 * franchir le plafond de 64 Ko au-delà duquel une requête `keepalive` échoue — la
 * requête même qui protège la sauvegarde au moment où l'on quitte l'application.
 * Autrement dit : plus quelqu'un utilisait l'app, plus sa sauvegarde risquait de
 * cesser de fonctionner.
 *
 * Quatre cents jours couvrent largement le damier d'un an affiché sur le tableau
 * de bord, avec de quoi voir l'année précédente déborder par le bord.
 */
const JOURS_DE_SCORE_CONSERVES = 400;

/**
 * Oublie les scores trop anciens pour être affichés.
 *
 * Rend le nombre d'entrées retirées, `0` si rien n'a bougé — l'appelant n'écrit
 * alors rien, ce qui évite de déclencher une remontée pour une purge qui n'a rien
 * purgé, à chaque démarrage.
 */
export function purgerScoresAnciens(): number {
  let scores: Record<string, unknown>;
  try {
    const parse = JSON.parse(localStorage.getItem('mindset_daily_scores') || '{}');
    if (!parse || typeof parse !== 'object' || Array.isArray(parse)) return 0;
    scores = parse as Record<string, unknown>;
  } catch {
    return 0;
  }

  // Même convention de clé que le reste de l'application : `AAAA-MM-JJ`, ce qui se
  // compare directement en chaîne sans repasser par un objet `Date` — et sans
  // rejouer le décalage de fuseau que cette convention existe pour éviter.
  const limite = new Date(Date.now() - JOURS_DE_SCORE_CONSERVES * 86400000)
    .toLocaleDateString('sv-SE');

  const gardees = Object.keys(scores).filter((jour) => jour >= limite);
  const retirees = Object.keys(scores).length - gardees.length;
  if (retirees <= 0) return 0;

  const propre: Record<string, unknown> = {};
  for (const jour of gardees) propre[jour] = scores[jour];
  localStorage.setItem('mindset_daily_scores', JSON.stringify(propre));

  return retirees;
}
