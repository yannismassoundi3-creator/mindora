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
import { trouverIndex } from './correspondance';

// Re-exporté : les tests de ce module l'utilisent, et c'est ici que se décide ce
// qu'une « cible » veut dire pour le coach.
export { trouverIndex };

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
  /** Pour `task.set` : le créneau d'arrivée, quand la tâche change de moment. */
  vers?: string;
}

export interface ResultatEditions {
  /** Ce qui a réellement été écrit, en clair, pour l'annoncer à la personne. */
  appliquees: string[];
  /** Ce qui n'a pas pu l'être, et pourquoi. Jamais tu. */
  refusees: string[];
}

/** Ce que rend une demande de validation. Miroir de `journee.ResultatValidation`. */
export interface ValidationTache {
  etat: 'cochee' | 'deja-faite' | 'introuvable';
  titre?: string;
}

/** Les listes que ce module a le droit de lire et d'écrire, et aucune autre. */
export interface AccesListes {
  lire: (cle: string) => any[];
  ecrire: (cle: string, valeur: any[]) => void;
  /**
   * Cocher une tâche, avec tout ce que ça entraîne — XP, monnaie, rythme, crédit
   * serveur, score du jour.
   *
   * **Injecté plutôt qu'appelé directement**, pour la même raison que `lire` et
   * `ecrire` : ce module ne connaît ni `localStorage`, ni l'XP, ni le serveur, et
   * reste donc testable sans navigateur. Absent, l'opération est refusée
   * proprement au lieu de planter.
   */
  validerTache?: (titre: string) => ValidationTache;
}

const CLE_HABITUDES = 'mindset_habits';
const CLE_ROUTINES = 'mindset_routines';
const CLE_NUTRITION = 'mindset_nutrition';
const CLE_MICRO = 'mindset_micro_obj';
const CLE_MACRO = 'mindset_macro_obj';

/** Au-delà, ce n'est plus une retouche : c'est un plan qui n'a pas dit son nom. */
export const MAX_EDITIONS = 3;

/**
 * Les validations ont leur propre plafond, bien plus haut.
 *
 * Le plafond de trois existe pour empêcher qu'on reconstruise un plan par la
 * petite porte — il protège des opérations qui **écrivent ou effacent**.
 * `task.done` ne fait ni l'un ni l'autre : elle coche ce qui existe déjà.
 *
 * Et la limite se voyait tout de suite : mesuré le 27 août 2026, « j'ai fini ma
 * routine du matin » fait produire au modèle une validation par tâche. Une
 * routine de quatre tâches en aurait donc vu deux refusées, sur la phrase la plus
 * banale de l'application. Dix couvre toute routine réaliste sans ouvrir la porte
 * à autre chose.
 */
export const MAX_VALIDATIONS = 10;

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

/**
 * Où se trouve vraiment cette tâche, tous créneaux confondus.
 *
 * **On ne se fie pas au champ `routine` du modèle**, et c'est mesuré : le 26 août
 * 2026, sur « mets mes squats le soir plutôt que le matin », `gpt-oss-120b` a
 * répondu `routine: "EVENING"` — la destination — alors que le champ désigne
 * l'emplacement actuel. Chercher là où il le dit aurait fait échouer la retouche
 * la plus naturelle qui soit, sur une subtilité de champ.
 *
 * La tâche est donc cherchée partout. Si elle est dans un seul créneau, on sait
 * d'où elle part, quel que soit ce que le modèle a écrit ; si son titre existe
 * dans deux créneaux, on refuse plutôt que de choisir.
 */
export function localiserTache(
  routines: any[],
  cible: string,
): { routine: any; index: number } | null {
  const trouves = routines
    .map((routine) => ({
      routine,
      index: Array.isArray(routine?.items) ? trouverIndex(routine.items, cible, (t: any) => t?.title) : -1,
    }))
    .filter((e) => e.index !== -1);

  return trouves.length === 1 ? trouves[0] : null;
}

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

  /*
    Au-delà de trois, ce n'est plus une retouche : c'est un plan qui n'a pas dit
    son nom, et il a son propre schéma. On applique les trois premières plutôt que
    de tout refuser — la personne a demandé quelque chose — **mais on dit combien
    sont restées dehors**.

    Les taire serait le défaut qu'on passe la journée à traquer, en plus petit :
    elle a demandé cinq changements, elle en voit trois, et rien ne lui explique
    pourquoi les deux autres manquent. Elle en conclut que le coach fait les
    choses à moitié.
  */
  const demandees = edits as Edition[];
  const gardees = new Set<Edition>([
    // Deux plafonds parce que les deux familles ne courent pas le même risque :
    // cocher ne peut rien détruire, écrire et effacer, si.
    ...demandees.filter((e) => e?.op === 'task.done').slice(0, MAX_VALIDATIONS),
    ...demandees.filter((e) => e?.op !== 'task.done').slice(0, MAX_EDITIONS),
  ]);
  // L'ordre d'origine est conservé : le coach a écrit ses opérations dans un
  // sens, et une confirmation qui les réordonne se lit comme une autre réponse.
  const aTraiter = demandees.filter((e) => gardees.has(e));
  const ignorees = edits.length - aTraiter.length;
  if (ignorees > 0) {
    resultat.refusees.push(
      `${ignorees} changement${ignorees > 1 ? 's' : ''} de plus dans le même message — redemande-les-moi`,
    );
  }

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

      /*
        La retouche la plus demandée, et celle qui manquait.

        « Passe ma lecture à 20 minutes », « renomme mes squats en 4x15 », « mets
        mes pompes seulement le lundi », « déplace ma séance au soir » : quatre
        demandes banales que le coach ne savait pas honorer. Il devait répondre
        qu'il ne pouvait pas, ou reconstruire tout le plan pour changer un mot.

        **Une seule opération plutôt que quatre**, avec des champs facultatifs. Le
        schéma est payé à chaque message qui ressemble à une retouche : quatre
        lignes pour décrire quatre opérations coûteraient quatre fois plus cher
        que celle-ci, pour exactement le même pouvoir.
      */
      case 'task.set': {
        const routines = acces.lire(CLE_ROUTINES);
        const emplacement = localiserTache(routines, cible);

        if (!emplacement) {
          resultat.refusees.push(`tâche « ${cible} » introuvable`);
          break;
        }

        const source = emplacement.routine;
        const items = source.items;
        const i = emplacement.index;
        const tache = { ...items[i] };
        const ancien = tache.title;
        const changements: string[] = [];

        if (valeur && valeur !== tache.title) {
          tache.title = valeur;
          changements.push(`renommée « ${valeur} »`);
        }
        if (Number(edit?.duration) > 0) {
          tache.time = `${Number(edit?.duration)} min`;
          changements.push(`${Number(edit?.duration)} min`);
        }
        if (edit?.jours !== undefined) {
          tache.jours = normaliserJours(edit.jours);
          changements.push('jours mis à jour');
        }

        /*
          La destination : « vers » si le modèle l'a écrit, sinon « routine ».

          Les deux sont acceptés parce que le modèle confond les deux champs — et
          la confusion est sans risque ici : on sait déjà d'où la tâche part, donc
          un créneau qui diffère de sa position réelle ne peut vouloir dire qu'une
          chose. S'il désigne le créneau où elle est déjà, il n'y a pas de
          déplacement, et le reste de la retouche s'applique quand même.
        */
        const demandee = edit?.vers ?? edit?.routine;
        const arrivee = demandee ? MOMENTS[String(demandee).toUpperCase()] : undefined;
        if (arrivee && arrivee !== source.id) {
          const destination = routines.find((r: any) => r?.id === arrivee);
          if (!destination) {
            resultat.refusees.push(`routine « ${edit?.vers} » introuvable`);
            break;
          }
          if (!Array.isArray(destination.items)) destination.items = [];
          // Elle garde son état du jour : la déplacer d'un créneau à l'autre ne
          // défait pas ce qui a déjà été fait ce matin.
          items.splice(i, 1);
          destination.items.push(tache);
          changements.push(`déplacée vers ta ${destination.title ?? arrivee}`);
        } else {
          items[i] = tache;
        }

        if (changements.length === 0) {
          // Une opération qui ne change rien n'est pas un succès : la personne
          // attendrait un effet qu'elle ne verrait pas.
          resultat.refusees.push(`rien à changer sur « ${ancien} »`);
          break;
        }

        acces.ecrire(CLE_ROUTINES, routines);
        resultat.appliquees.push(`${ancien} : ${changements.join(', ')}`);
        break;
      }

      /*
        « J'ai fait mes squats » doit cocher la case.

        Jusqu'ici le coach l'actait en paroles et la case restait vide : la
        personne devait aller cliquer ailleurs pour dire une seconde fois ce
        qu'elle venait d'affirmer. Le score de cette application est déclaratif —
        c'est elle qui coche — donc rien n'est gagné en intégrité à le lui
        réclamer deux fois, et tout est perdu en usage.

        La validation passe par `journee.validerTacheParTitre`, le même chemin que
        le doigt : XP, monnaie, rythme, crédit serveur, score du jour. **Elle ne
        décoche jamais** — une phrase affirme, elle ne bascule pas.
      */
      case 'task.done': {
        if (!acces.validerTache) {
          resultat.refusees.push('la validation n’est pas disponible ici');
          break;
        }
        const validation = acces.validerTache(cible);
        if (validation.etat === 'cochee') {
          resultat.appliquees.push(`coché : ${validation.titre ?? cible}`);
        } else if (validation.etat === 'deja-faite') {
          // Ni un succès ni une panne : un doublon. Le dire évite qu'elle croie
          // avoir gagné cinq points de plus.
          resultat.refusees.push(`« ${validation.titre ?? cible} » était déjà cochée`);
        } else {
          resultat.refusees.push(`tâche « ${cible} » introuvable`);
        }
        break;
      }

      case 'goal.rename': {
        let renomme = false;
        for (const cle of [CLE_MICRO, CLE_MACRO]) {
          const objectifs = acces.lire(cle);
          const i = trouverIndex(objectifs, cible, (o: any) => o?.title);
          if (i === -1 || !valeur) continue;
          const ancien = objectifs[i].title;
          objectifs[i] = { ...objectifs[i], title: valeur };
          acces.ecrire(cle, objectifs);
          resultat.appliquees.push(`« ${ancien} » devient « ${valeur} »`);
          renomme = true;
          break;
        }
        if (!renomme) resultat.refusees.push(`objectif « ${cible} » introuvable`);
        break;
      }

      case 'task.remove': {
        const routines = acces.lire(CLE_ROUTINES);
        // Cherchée partout, pour la même raison que `task.set` : le créneau annoncé
        // par le modèle n'est pas fiable, l'endroit où la tâche se trouve l'est.
        const emplacement = localiserTache(routines, cible);
        if (!emplacement) {
          resultat.refusees.push(`tâche « ${cible} » introuvable`);
          break;
        }
        const [retiree] = emplacement.routine.items.splice(emplacement.index, 1);
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
