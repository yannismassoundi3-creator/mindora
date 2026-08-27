/**
 * Les retouches chirurgicales que le coach peut appliquer, une ligne à la fois.
 *
 * ## Ce que ça remplace
 *
 * Jusqu'ici le coach n'avait qu'un outil : le bloc `<PLAN>` complet. Pour « change
 * ma méditation en 5 minutes », il devait émettre `replaceHabits: true` **et
 * recomposer toute la liste de mémoire**. Tout ce qu'il oubliait de recopier
 * disparaissait, avec son historique et son XP — changer une ligne coûtait la
 * liste entière. Et le schéma qui décrit cette opération pèse 1 951 jetons, contre
 * 504 pour celui-ci : sur une limite de 8 000 jetons par minute partagée par toute
 * l'application, c'est ce qui décide du nombre de personnes qu'on peut servir.
 *
 * ## La règle qui tient ce fichier
 *
 * **Une opération dont la cible n'existe pas est refusée, jamais devinée.** Le
 * modèle recopie le nom depuis les données qu'on lui a envoyées ; s'il l'invente,
 * la bonne réponse est de ne rien faire et de le dire. Renommer « la mauvaise
 * habitude parce qu'elle ressemblait » est pire que ne pas renommer : la personne
 * ne l'a pas demandé et ne saura pas pourquoi sa liste a changé.
 *
 * C'est pour ça que `appliquerEditions` rend **deux** listes. Ce qui a été fait
 * est annoncé, ce qui a été refusé aussi. Le silence est ce qu'on cherche à
 * éliminer, pas ce qu'on produit.
 *
 * ## Pourquoi les entrées/sorties sont injectées
 *
 * Ce module ne touche pas `localStorage` lui-même : il reçoit un lecteur et un
 * écrivain. C'est ce qui permet de le tester sans navigateur, et c'est aussi ce
 * qui garantit qu'il n'écrit rien d'autre que les cinq listes qu'on lui confie.
 */

import { normaliserJours } from './recurrence';

export interface Edition {
  op?: string;
  /** Jours où la tâche s'applique. Absent, elle tombe tous les jours. */
  jours?: unknown;
  /** Le nom exact de la ligne visée, recopié depuis les données de la personne. */
  target?: string;
  /** Le nouveau contenu : nom d'habitude, titre de tâche, détail de repas… */
  value?: string;
  /** Pour `task.*` : MORNING, MIDDAY ou EVENING. */
  routine?: string;
  duration?: number;
  description?: string;
  /** Pour `goal.add` : micro ou macro. */
  scope?: string;
}

export interface ResultatEditions {
  /** Ce qui a réellement été écrit, en clair, pour l'annoncer à la personne. */
  appliquees: string[];
  /** Ce qui n'a pas pu l'être, et pourquoi. Jamais tu. */
  refusees: string[];
}

/** Les listes que ce module a le droit de lire et d'écrire, et aucune autre. */
export interface AccesListes {
  lire: (cle: string) => any[];
  ecrire: (cle: string, valeur: any[]) => void;
}

const CLE_HABITUDES = 'mindset_habits';
const CLE_ROUTINES = 'mindset_routines';
const CLE_NUTRITION = 'mindset_nutrition';
const CLE_MICRO = 'mindset_micro_obj';
const CLE_MACRO = 'mindset_macro_obj';

/** Au-delà, ce n'est plus une retouche : c'est un plan qui n'a pas dit son nom. */
export const MAX_EDITIONS = 3;

/**
 * Compare deux libellés comme un humain les lirait.
 *
 * Le modèle recopie « Méditation 10 min » depuis un contexte où le titre est
 * peut-être « Méditation 10min » ou « méditation 10 minutes ». Exiger l'égalité
 * stricte ferait échouer la moitié des retouches sur une espace — et un refus
 * pour une espace se lit comme une panne, pas comme une précaution.
 *
 * **Les diacritiques sont retirés par leur point de code, jamais collés en clair.**
 * Écrits littéralement, les accents combinants sont invisibles à la relecture et
 * un éditeur les recompose sans prévenir — on ne saurait plus ce que la plage
 * contient vraiment. Ce sont U+0300 à U+036F, ce que `NFD` produit en séparant
 * « é » en « e » plus son accent.
 */
const PREMIER_DIACRITIQUE = 0x300;
const DERNIER_DIACRITIQUE = 0x36f;

function normaliser(texte: unknown): string {
  let sansAccent = '';
  for (const caractere of String(texte ?? '').toLowerCase().normalize('NFD')) {
    const point = caractere.codePointAt(0) as number;
    if (point < PREMIER_DIACRITIQUE || point > DERNIER_DIACRITIQUE) sansAccent += caractere;
  }

  return sansAccent.replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * L'index de la ligne visée, ou -1.
 *
 * Trois passes, de la plus sûre à la plus tolérante : égalité, puis préfixe, puis
 * inclusion. **La première passe qui trouve UNE seule ligne gagne** ; si une passe
 * en trouve plusieurs, on s'arrête là et on refuse. Deux habitudes qui contiennent
 * « lecture » ne se départagent pas au hasard : renommer la mauvaise est la seule
 * faute vraiment coûteuse que ce fichier puisse commettre.
 */
export function trouverIndex(lignes: any[], cible: string, titreDe: (l: any) => unknown): number {
  const vise = normaliser(cible);
  if (!vise) return -1;

  const titres = lignes.map((l) => normaliser(titreDe(l)));

  /*
    La dernière passe compare sans aucun séparateur.

    « Méditation 10min » et « Méditation 10 min » désignent la même ligne, et le
    modèle produit l'une ou l'autre selon son humeur. Sans cette passe, la retouche
    échouait sur une espace — un refus pour une espace se lit comme une panne.
  */
  const colle = (t: string) => t.replace(/ /g, '');

  for (const correspond of [
    (t: string) => t === vise,
    (t: string) => t.startsWith(vise) || vise.startsWith(t),
    (t: string) => t.includes(vise) || vise.includes(t),
    (t: string) => colle(t) === colle(vise) || colle(t).includes(colle(vise)),
  ]) {
    const trouves = titres.reduce<number[]>((acc, t, i) => (t && correspond(t) ? [...acc, i] : acc), []);
    if (trouves.length === 1) return trouves[0];
    // Plusieurs candidats : on s'arrête là plutôt que de tenter une passe encore
    // plus tolérante, qui en trouverait davantage et choisirait au hasard.
    if (trouves.length > 1) return -1;
  }

  return -1;
}

/** Les trois moments de la journée, tels que le modèle les nomme et tels qu'on les stocke. */
const MOMENTS: Record<string, string> = {
  MORNING: 'morning',
  MATIN: 'morning',
  MIDDAY: 'midday',
  MIDI: 'midday',
  AFTERNOON: 'midday',
  EVENING: 'evening',
  SOIR: 'evening',
  SOIREE: 'evening',
};

function identifiantUnique(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 11);
}

const COULEURS = ['#3b82f6', '#ec4899', '#8b5cf6', '#10b981', '#fcd34d', '#ef4444'];

/**
 * Applique les retouches demandées par le coach.
 *
 * **Chaque opération est indépendante.** Une cible introuvable n'annule pas les
 * autres : c'est la différence avec le plan complet, qui refuse en bloc parce
 * qu'il réécrit tout. Ici, trois retouches dont une rate laissent deux retouches
 * faites et une phrase qui dit laquelle a manqué.
 */
export function appliquerEditions(edits: unknown, acces: AccesListes): ResultatEditions {
  const resultat: ResultatEditions = { appliquees: [], refusees: [] };
  if (!Array.isArray(edits) || edits.length === 0) return resultat;

  // Au-delà de trois, ce n'est plus une retouche. On applique les trois premières
  // plutôt que de tout refuser : la personne a demandé quelque chose.
  const aTraiter = (edits as Edition[]).slice(0, MAX_EDITIONS);

  for (const edit of aTraiter) {
    const op = String(edit?.op ?? '').trim();
    const cible = String(edit?.target ?? '').trim();
    const valeur = String(edit?.value ?? '').trim();

    switch (op) {
      case 'habit.add': {
        if (!valeur) {
          resultat.refusees.push('une habitude sans nom');
          break;
        }
        const habitudes = acces.lire(CLE_HABITUDES);
        // Demander deux fois « ajoute-moi de la lecture » ne crée pas deux
        // habitudes : la seconde serait comptée deux fois dans le score du jour.
        if (trouverIndex(habitudes, valeur, (h) => h?.title ?? h?.name) !== -1) {
          resultat.refusees.push(`« ${valeur} » existait déjà`);
          break;
        }
        habitudes.push({
          id: identifiantUnique(),
          title: valeur,
          icon: 'target',
          color: COULEURS[Math.floor(Math.random() * COULEURS.length)],
          xp: 0,
          level: 1,
          history: [],
        });
        acces.ecrire(CLE_HABITUDES, habitudes);
        resultat.appliquees.push(`habitude ajoutée : ${valeur}`);
        break;
      }

      case 'habit.rename': {
        const habitudes = acces.lire(CLE_HABITUDES);
        const i = trouverIndex(habitudes, cible, (h) => h?.title ?? h?.name);
        if (i === -1 || !valeur) {
          resultat.refusees.push(`habitude « ${cible} » introuvable`);
          break;
        }
        const ancien = habitudes[i].title ?? habitudes[i].name;
        // On renomme sans toucher au reste : l'historique et l'XP appartiennent à
        // la personne, pas au titre.
        habitudes[i] = { ...habitudes[i], title: valeur };
        acces.ecrire(CLE_HABITUDES, habitudes);
        resultat.appliquees.push(`« ${ancien} » devient « ${valeur} »`);
        break;
      }

      case 'habit.remove': {
        const habitudes = acces.lire(CLE_HABITUDES);
        const i = trouverIndex(habitudes, cible, (h) => h?.title ?? h?.name);
        if (i === -1) {
          resultat.refusees.push(`habitude « ${cible} » introuvable`);
          break;
        }
        const [retiree] = habitudes.splice(i, 1);
        acces.ecrire(CLE_HABITUDES, habitudes);
        resultat.appliquees.push(`habitude retirée : ${retiree.title ?? retiree.name}`);
        break;
      }

      case 'task.add': {
        const moment = MOMENTS[String(edit?.routine ?? '').toUpperCase()] ?? 'morning';
        const routines = acces.lire(CLE_ROUTINES);
        const routine = routines.find((r: any) => r?.id === moment);
        if (!routine || !valeur) {
          resultat.refusees.push(`routine « ${edit?.routine ?? ''} » introuvable`);
          break;
        }
        if (!Array.isArray(routine.items)) routine.items = [];
        if (trouverIndex(routine.items, valeur, (t: any) => t?.title) !== -1) {
          resultat.refusees.push(`« ${valeur} » y était déjà`);
          break;
        }
        routine.items.push({
          id: identifiantUnique(),
          title: valeur,
          time: `${Number(edit?.duration) > 0 ? Number(edit?.duration) : 15} min`,
          done: false,
          // « ajoute du sport le mardi » ne veut rien dire si la tâche finit
          // quotidienne. Absent, elle reste quotidienne, comme le plan complet.
          jours: normaliserJours(edit?.jours),
        });
        acces.ecrire(CLE_ROUTINES, routines);
        resultat.appliquees.push(`tâche ajoutée à ta ${routine.title ?? moment} : ${valeur}`);
        break;
      }

      case 'task.remove': {
        const moment = MOMENTS[String(edit?.routine ?? '').toUpperCase()] ?? 'morning';
        const routines = acces.lire(CLE_ROUTINES);
        const routine = routines.find((r: any) => r?.id === moment);
        const items = Array.isArray(routine?.items) ? routine.items : [];
        const i = trouverIndex(items, cible, (t: any) => t?.title);
        if (!routine || i === -1) {
          resultat.refusees.push(`tâche « ${cible} » introuvable`);
          break;
        }
        const [retiree] = items.splice(i, 1);
        acces.ecrire(CLE_ROUTINES, routines);
        resultat.appliquees.push(`tâche retirée : ${retiree.title}`);
        break;
      }

      case 'meal.set': {
        if (!cible || !valeur) {
          resultat.refusees.push('un repas sans nom ni contenu');
          break;
        }
        const repas = acces.lire(CLE_NUTRITION);
        const i = trouverIndex(repas, cible, (n: any) => n?.title ?? n?.meal);
        if (i === -1) {
          // Un repas qu'il ne trouve pas, il le crée : « mets des œufs au petit
          // déjeuner » chez quelqu'un qui n'a pas encore de petit déjeuner est une
          // demande parfaitement claire, et la refuser serait absurde.
          repas.push({ id: identifiantUnique(), title: cible, details: valeur, done: false });
          resultat.appliquees.push(`repas ajouté : ${cible}`);
        } else {
          repas[i] = { ...repas[i], details: valeur };
          resultat.appliquees.push(`${repas[i].title ?? cible} mis à jour`);
        }
        acces.ecrire(CLE_NUTRITION, repas);
        break;
      }

      case 'meal.remove': {
        const repas = acces.lire(CLE_NUTRITION);
        const i = trouverIndex(repas, cible, (n: any) => n?.title ?? n?.meal);
        if (i === -1) {
          resultat.refusees.push(`repas « ${cible} » introuvable`);
          break;
        }
        const [retire] = repas.splice(i, 1);
        acces.ecrire(CLE_NUTRITION, repas);
        resultat.appliquees.push(`repas retiré : ${retire.title ?? cible}`);
        break;
      }

      case 'goal.add': {
        if (!valeur) {
          resultat.refusees.push('un objectif sans intitulé');
          break;
        }
        const macro = String(edit?.scope ?? 'micro').toLowerCase() === 'macro';
        const cle = macro ? CLE_MACRO : CLE_MICRO;
        const objectifs = acces.lire(cle);
        if (trouverIndex(objectifs, valeur, (o: any) => o?.title) !== -1) {
          resultat.refusees.push(`« ${valeur} » existait déjà`);
          break;
        }
        objectifs.push(
          macro
            ? { id: identifiantUnique(), title: valeur, category: 'Vision', deadline: 'Déc 2026', done: false }
            : { id: identifiantUnique(), title: valeur, category: 'Mindset', done: false },
        );
        acces.ecrire(cle, objectifs);
        resultat.appliquees.push(`objectif ajouté : ${valeur}`);
        break;
      }

      case 'goal.remove': {
        // La cible peut être dans l'une ou l'autre liste : le modèle ne sait pas
        // toujours laquelle, et le lui faire deviner ne servirait personne.
        let retire = false;
        for (const cle of [CLE_MICRO, CLE_MACRO]) {
          const objectifs = acces.lire(cle);
          const i = trouverIndex(objectifs, cible, (o: any) => o?.title);
          if (i === -1) continue;
          const [parti] = objectifs.splice(i, 1);
          acces.ecrire(cle, objectifs);
          resultat.appliquees.push(`objectif retiré : ${parti.title ?? cible}`);
          retire = true;
          break;
        }
        if (!retire) resultat.refusees.push(`objectif « ${cible} » introuvable`);
        break;
      }

      default:
        // Une opération inventée ne fait rien et se dit. Se taire ici, c'est
        // laisser croire que la demande a été honorée.
        resultat.refusees.push(`opération inconnue « ${op || '?'} »`);
    }
  }

  return resultat;
}

/**
 * La phrase ajoutée sous la réponse du coach.
 *
 * Elle nomme ce qui a changé — c'est la seule preuve que la personne a que sa
 * demande a été exécutée — et ce qui n'a pas pu l'être. Rend une chaîne vide
 * quand il n'y a rien à dire, pour ne rien coller sous une réponse ordinaire.
 */
export function resumerEditions(resultat: ResultatEditions): string {
  const morceaux: string[] = [];

  if (resultat.appliquees.length > 0) {
    morceaux.push(`\n\n✅ **C'est fait** — ${resultat.appliquees.join(', ')}.`);
  }
  if (resultat.refusees.length > 0) {
    morceaux.push(
      `\n\n⚠️ **Pas touché** — ${resultat.refusees.join(', ')}. Redis-le-moi avec le nom exact.`,
    );
  }

  return morceaux.join('');
}
