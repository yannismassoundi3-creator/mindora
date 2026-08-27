import { describe, it, expect } from 'vitest';
import { appliquerEditions, resumerEditions, trouverIndex, type AccesListes } from './editionsPlan';

/*
  Ce module écrit dans les listes de quelqu'un. Ce qui se vérifie ici n'est donc
  pas « est-ce que ça marche » mais **est-ce que ça refuse quand il le faut** :
  une cible mal reconnue renomme la mauvaise habitude, et la personne ne saura
  jamais pourquoi sa liste a changé.
*/

/** Un magasin en mémoire : le module ne touche jamais localStorage lui-même. */
function magasin(initial: Record<string, any[]> = {}) {
  const donnees: Record<string, any[]> = JSON.parse(JSON.stringify(initial));
  const acces: AccesListes = {
    lire: (cle) => JSON.parse(JSON.stringify(donnees[cle] ?? [])),
    ecrire: (cle, valeur) => {
      donnees[cle] = JSON.parse(JSON.stringify(valeur));
    },
  };
  return { donnees, acces };
}

const habitude = (title: string, extra: Record<string, unknown> = {}) => ({
  id: title,
  title,
  icon: 'target',
  color: '#fff',
  xp: 120,
  level: 3,
  history: ['2026-08-25'],
  ...extra,
});

const routines = () => [
  { id: 'morning', title: 'Routine Matinale', icon: 'sun', items: [{ id: 't1', title: 'Squats (4x12)', time: '5 min', done: false }] },
  { id: 'midday', title: 'Routine de Midi', icon: 'sun', items: [] },
  { id: 'evening', title: 'Routine du Soir', icon: 'moon', items: [] },
];

describe('trouverIndex — reconnaître la ligne visée', () => {
  const lignes = [{ title: 'Méditation 10 min' }, { title: 'Pas de téléphone après 22h' }];
  const titre = (l: any) => l.title;

  it('accepte les écarts d’accent, de casse et d’espace', () => {
    // Le modèle recopie depuis un contexte où le titre peut être écrit autrement.
    // Refuser sur une espace se lit comme une panne, pas comme une précaution.
    expect(trouverIndex(lignes, 'meditation 10 min', titre)).toBe(0);
    expect(trouverIndex(lignes, 'MÉDITATION  10MIN', titre)).toBe(0);
    expect(trouverIndex(lignes, 'Méditation', titre)).toBe(0);
  });

  it('refuse quand deux lignes pourraient correspondre', () => {
    /*
      C'est la seule faute vraiment coûteuse de ce fichier : renommer la mauvaise
      habitude parce qu'elle ressemblait. Deux « lecture » ne se départagent pas
      au hasard — on ne fait rien, et on le dit.
    */
    const deux = [{ title: 'Lecture 10 pages' }, { title: 'Lecture du soir' }];
    expect(trouverIndex(deux, 'lecture', titre)).toBe(-1);
  });

  it('refuse une cible inventée', () => {
    expect(trouverIndex(lignes, 'course à pied', titre)).toBe(-1);
    expect(trouverIndex(lignes, '', titre)).toBe(-1);
  });
});

describe('les retouches du coach', () => {
  it('renomme sans toucher à l’historique ni à l’XP', () => {
    // Le titre appartient au plan, l'historique appartient à la personne. C'est
    // toute la raison d'exister de ce module : le plan complet les emportait.
    const { donnees, acces } = magasin({ mindset_habits: [habitude('Méditation 10 min')] });

    const r = appliquerEditions(
      [{ op: 'habit.rename', target: 'Méditation 10 min', value: 'Méditation 5 min' }],
      acces,
    );

    expect(donnees.mindset_habits[0].title).toBe('Méditation 5 min');
    expect(donnees.mindset_habits[0].xp).toBe(120);
    expect(donnees.mindset_habits[0].history).toEqual(['2026-08-25']);
    expect(r.appliquees).toEqual(['« Méditation 10 min » devient « Méditation 5 min »']);
    expect(r.refusees).toEqual([]);
  });

  it('ne renomme rien quand la cible n’existe pas, et le dit', () => {
    const { donnees, acces } = magasin({ mindset_habits: [habitude('Méditation 10 min')] });

    const r = appliquerEditions([{ op: 'habit.rename', target: 'Course', value: 'Marche' }], acces);

    expect(donnees.mindset_habits[0].title).toBe('Méditation 10 min');
    expect(r.appliquees).toEqual([]);
    expect(r.refusees[0]).toContain('introuvable');
  });

  it('n’ajoute pas deux fois la même habitude', () => {
    // Une habitude en double est comptée deux fois dans le score du jour.
    const { donnees, acces } = magasin({ mindset_habits: [habitude('Lecture')] });

    const r = appliquerEditions([{ op: 'habit.add', value: 'lecture' }], acces);

    expect(donnees.mindset_habits).toHaveLength(1);
    expect(r.refusees[0]).toContain('existait déjà');
  });

  it('ajoute et retire une tâche dans la bonne routine', () => {
    const { donnees, acces } = magasin({ mindset_routines: routines() });

    appliquerEditions(
      [{ op: 'task.add', routine: 'EVENING', value: 'Gainage (3x30s)', duration: 3 }],
      acces,
    );
    expect(donnees.mindset_routines[2].items[0]).toMatchObject({
      title: 'Gainage (3x30s)',
      time: '3 min',
      done: false,
    });

    const r = appliquerEditions(
      [{ op: 'task.remove', routine: 'MORNING', target: 'Squats' }],
      acces,
    );
    expect(donnees.mindset_routines[0].items).toHaveLength(0);
    expect(r.appliquees[0]).toContain('Squats (4x12)');
  });

  it('respecte les jours quand le coach en donne', () => {
    // « ajoute du sport le mardi » ne veut rien dire si la tâche finit
    // quotidienne. Sans ce champ, la retouche aurait dû remonter au schéma
    // complet — un aller-retour de plus pour une demande banale.
    const { donnees, acces } = magasin({ mindset_routines: routines() });

    appliquerEditions(
      [{ op: 'task.add', routine: 'MIDDAY', value: 'Course (5 km)', duration: 20, jours: ['mardi', 'jeudi'] }],
      acces,
    );

    // Stockés en numéros de jour, exactement comme le fait le plan complet :
    // c'est `normaliserJours` qui traduit, et les deux chemins doivent écrire la
    // même chose, sinon une tâche ajoutée par retouche ne se lirait pas comme
    // une tâche ajoutée par plan.
    expect(donnees.mindset_routines[1].items[0].jours).toEqual([2, 4]);
  });

  /*
    `task.set` remplace quatre opérations par une, avec des champs facultatifs.
    Quatre demandes banales que le coach ne savait pas honorer : renommer, changer
    la durée, restreindre les jours, déplacer d'un créneau à l'autre.
  */
  describe('modifier une tâche qui existe', () => {
    it('renomme et change la durée sans toucher au reste', () => {
      const { donnees, acces } = magasin({ mindset_routines: routines() });

      const r = appliquerEditions(
        [{ op: 'task.set', routine: 'MORNING', target: 'Squats', value: 'Squats (4x15)', duration: 8 }],
        acces,
      );

      expect(donnees.mindset_routines[0].items[0]).toMatchObject({
        id: 't1',
        title: 'Squats (4x15)',
        time: '8 min',
        done: false,
      });
      expect(r.refusees).toEqual([]);
    });

    it('ne change que ce qu’on lui donne', () => {
      // Seuls "routine" et "target" sont obligatoires : un champ absent doit
      // laisser la valeur existante, pas la remettre à un défaut.
      const { donnees, acces } = magasin({ mindset_routines: routines() });

      appliquerEditions([{ op: 'task.set', routine: 'MORNING', target: 'Squats', duration: 12 }], acces);

      expect(donnees.mindset_routines[0].items[0].title).toBe('Squats (4x12)');
      expect(donnees.mindset_routines[0].items[0].time).toBe('12 min');
    });

    it('déplace la tâche d’un créneau à l’autre en gardant son état', () => {
      // La déplacer ne défait pas ce qui a déjà été fait ce matin.
      const avecFait = routines();
      avecFait[0].items[0].done = true;
      const { donnees, acces } = magasin({ mindset_routines: avecFait });

      const r = appliquerEditions(
        [{ op: 'task.set', routine: 'MORNING', target: 'Squats', vers: 'EVENING' }],
        acces,
      );

      expect(donnees.mindset_routines[0].items).toHaveLength(0);
      expect(donnees.mindset_routines[2].items[0]).toMatchObject({ title: 'Squats (4x12)', done: true });
      expect(r.appliquees[0]).toContain('Routine du Soir');
    });

    it('refuse une modification qui ne modifierait rien', () => {
      // Un succès annoncé sans effet visible est pire qu'un refus : la personne
      // attend un changement qu'elle ne verra jamais.
      const { acces } = magasin({ mindset_routines: routines() });

      const r = appliquerEditions([{ op: 'task.set', routine: 'MORNING', target: 'Squats' }], acces);

      expect(r.appliquees).toEqual([]);
      expect(r.refusees[0]).toContain('rien à changer');
    });

    it('déplace même quand le modèle annonce le mauvais créneau de départ', () => {
      /*
        Mesuré le 26 août 2026 sur `gpt-oss-120b`, message « mets mes squats le
        soir plutôt que le matin » : il a répondu `routine: "EVENING"` — la
        destination — alors que le champ désigne l'emplacement actuel.

        Chercher là où il le dit aurait fait échouer la retouche la plus naturelle
        qui soit, sur une subtilité de champ. On sait d'où la tâche part en la
        cherchant ; un créneau qui diffère de sa position réelle ne peut donc
        vouloir dire qu'une chose.
      */
      const { donnees, acces } = magasin({ mindset_routines: routines() });

      const r = appliquerEditions(
        [{ op: 'task.set', routine: 'EVENING', target: 'Squats (4x12)' }],
        acces,
      );

      expect(donnees.mindset_routines[0].items).toHaveLength(0);
      expect(donnees.mindset_routines[2].items[0].title).toBe('Squats (4x12)');
      expect(r.refusees).toEqual([]);
    });

    it('refuse quand le même titre existe dans deux créneaux', () => {
      // Chercher partout élargit la reconnaissance, pas le droit de deviner :
      // deux « Lecture » ne se départagent pas au hasard.
      const deux = routines();
      deux[2].items.push({ id: 't9', title: 'Squats (4x12)', time: '5 min', done: false });
      const { acces } = magasin({ mindset_routines: deux });

      const r = appliquerEditions(
        [{ op: 'task.set', routine: 'MORNING', target: 'Squats', duration: 9 }],
        acces,
      );

      expect(r.appliquees).toEqual([]);
      expect(r.refusees[0]).toContain('introuvable');
    });
  });

  it('renomme un objectif dans l’une ou l’autre liste', () => {
    const { donnees, acces } = magasin({
      mindset_macro_obj: [{ id: '2', title: "Physique d'athlète" }],
    });

    appliquerEditions(
      [{ op: 'goal.rename', target: 'physique d athlete', value: 'Marathon en 2027' }],
      acces,
    );

    expect(donnees.mindset_macro_obj[0].title).toBe('Marathon en 2027');
  });

  it('crée le repas qu’il ne trouve pas plutôt que de refuser', () => {
    // « mets des œufs au petit déjeuner » chez quelqu'un qui n'en a pas encore est
    // une demande parfaitement claire.
    const { donnees, acces } = magasin({ mindset_nutrition: [] });

    const r = appliquerEditions(
      [{ op: 'meal.set', target: 'Petit-déjeuner', value: '3 oeufs + flocons - 550 kcal' }],
      acces,
    );

    expect(donnees.mindset_nutrition[0]).toMatchObject({ title: 'Petit-déjeuner', done: false });
    expect(r.refusees).toEqual([]);
  });

  it('retire un objectif quelle que soit la liste où il vit', () => {
    // Le modèle ne sait pas toujours si un objectif est micro ou macro, et le lui
    // faire deviner ne servirait personne.
    const { donnees, acces } = magasin({
      mindset_micro_obj: [{ id: '1', title: 'Trois séances' }],
      mindset_macro_obj: [{ id: '2', title: "Physique d'athlète" }],
    });

    appliquerEditions([{ op: 'goal.remove', target: "physique d athlete" }], acces);

    expect(donnees.mindset_macro_obj).toHaveLength(0);
    expect(donnees.mindset_micro_obj).toHaveLength(1);
  });

  it('applique les autres retouches même si l’une rate', () => {
    /*
      La différence avec le plan complet, qui refuse en bloc parce qu'il réécrit
      tout : ici chaque opération est indépendante. Deux faites, une nommée.
    */
    const { donnees, acces } = magasin({ mindset_habits: [habitude('Lecture')] });

    const r = appliquerEditions(
      [
        { op: 'habit.add', value: 'Marche 20 min' },
        { op: 'habit.rename', target: 'Inexistante', value: 'X' },
        { op: 'habit.remove', target: 'Lecture' },
      ],
      acces,
    );

    expect(donnees.mindset_habits.map((h: any) => h.title)).toEqual(['Marche 20 min']);
    expect(r.appliquees).toHaveLength(2);
    expect(r.refusees).toHaveLength(1);
  });

  it('s’arrête à trois opérations, et dit combien sont restées dehors', () => {
    /*
      Au-delà, ce n'est plus une retouche : c'est un plan qui n'a pas dit son nom.
      Mais taire les deux qui sautent serait le défaut qu'on traque partout
      ailleurs, en plus petit — elle en demande cinq, en voit trois, et rien ne
      lui dit pourquoi.
    */
    const { donnees, acces } = magasin({ mindset_habits: [] });

    const r = appliquerEditions(
      ['A', 'B', 'C', 'D', 'E'].map((v) => ({ op: 'habit.add', value: v })),
      acces,
    );

    expect(donnees.mindset_habits).toHaveLength(3);
    expect(r.appliquees).toHaveLength(3);
    expect(r.refusees[0]).toContain('2 changements de plus');
  });

  it('refuse une opération inventée au lieu de se taire', () => {
    // Se taire ici laisserait croire que la demande a été honorée.
    const { acces } = magasin({});
    const r = appliquerEditions([{ op: 'habit.explode', target: 'X' }], acces);
    expect(r.refusees[0]).toContain('inconnue');
  });

  it('ne fait rien sur une entrée qui n’est pas une liste', () => {
    const { acces } = magasin({});
    expect(appliquerEditions(null, acces)).toEqual({ appliquees: [], refusees: [] });
    expect(appliquerEditions('edits', acces)).toEqual({ appliquees: [], refusees: [] });
  });
});

/*
  Les blocs réellement produits par `openai/gpt-oss-120b` le 26 août 2026, sur les
  messages qui les ont produits. Recopiés tels quels, virgules comprises.

  Un module qui passe ses propres tests mais pas les sorties du modèle ne sert à
  rien : c'est le modèle qui écrit, pas nous. C'est aussi ce qui a révélé que le
  champ `routine` porte parfois la destination — la seule façon de le savoir était
  de lire ce qu'il envoie vraiment.
*/
describe('les réponses réelles du modèle, telles quelles', () => {
  const etat = () => ({
    mindset_routines: [
      {
        id: 'morning',
        title: 'Routine Matinale',
        icon: 'sun',
        items: [
          { id: 'a', title: 'Squats (4x12)', time: '5 min', done: false },
          { id: 'b', title: 'Planche (3x45s)', time: '3 min', done: false },
          { id: 'c', title: 'Lecture 10 pages', time: '10 min', done: false },
        ],
      },
      { id: 'midday', title: 'Routine de Midi', icon: 'sun', items: [] },
      { id: 'evening', title: 'Routine du Soir', icon: 'moon', items: [{ id: 'd', title: 'Bilan ecrit du jour', time: '5 min', done: false }] },
    ],
    mindset_micro_obj: [{ id: 'o', title: 'Trois seances completes cette semaine' }],
  });

  it('« passe ma lecture a 20 minutes »', () => {
    const { donnees, acces } = magasin(etat());
    const r = appliquerEditions(
      [{ op: 'task.set', routine: 'MORNING', target: 'Lecture 10 pages', value: 'Lecture 20 pages', duration: 20 }],
      acces,
    );
    expect(donnees.mindset_routines[0].items[2]).toMatchObject({ title: 'Lecture 20 pages', time: '20 min' });
    expect(r.refusees).toEqual([]);
  });

  it('« renomme mes squats en 4x15 »', () => {
    const { donnees, acces } = magasin(etat());
    const r = appliquerEditions(
      [{ op: 'task.set', routine: 'MORNING', target: 'Squats (4x12)', value: 'Squats (4x15)' }],
      acces,
    );
    expect(donnees.mindset_routines[0].items[0].title).toBe('Squats (4x15)');
    expect(r.refusees).toEqual([]);
  });

  it('« mets mes squats le soir plutot que le matin »', () => {
    // Le cas qui échouait : `routine` porte la destination, pas l'origine.
    const { donnees, acces } = magasin(etat());
    const r = appliquerEditions(
      [{ op: 'task.set', routine: 'EVENING', target: 'Squats (4x12)', value: 'Squats (4x12)', duration: 15 }],
      acces,
    );
    expect(donnees.mindset_routines[0].items.map((t: any) => t.title)).not.toContain('Squats (4x12)');
    expect(donnees.mindset_routines[2].items.map((t: any) => t.title)).toContain('Squats (4x12)');
    expect(r.refusees).toEqual([]);
  });

  it('« je veux faire la planche seulement lundi et jeudi »', () => {
    const { donnees, acces } = magasin(etat());
    const r = appliquerEditions(
      [{ op: 'task.set', routine: 'MORNING', target: 'Planche (3x45s)', jours: ['lundi', 'jeudi'] }],
      acces,
    );
    expect(donnees.mindset_routines[0].items[1].jours).toEqual([1, 4]);
    expect(r.refusees).toEqual([]);
  });

  it('« renomme mon objectif en quatre seances »', () => {
    const { donnees, acces } = magasin(etat());
    const r = appliquerEditions(
      [{ op: 'goal.rename', target: 'Trois seances completes cette semaine', value: 'Quatre seances completes cette semaine' }],
      acces,
    );
    expect(donnees.mindset_micro_obj[0].title).toBe('Quatre seances completes cette semaine');
    expect(r.refusees).toEqual([]);
  });
});

describe('ce que la personne lit sous la réponse', () => {
  it('ne colle rien sous une réponse ordinaire', () => {
    expect(resumerEditions({ appliquees: [], refusees: [] })).toBe('');
  });

  it('nomme ce qui a changé et ce qui n’a pas pu', () => {
    const texte = resumerEditions({
      appliquees: ['habitude retirée : Lecture'],
      refusees: ['habitude « Course » introuvable'],
    });

    expect(texte).toContain("C'est fait");
    expect(texte).toContain('Lecture');
    expect(texte).toContain('Pas touché');
    expect(texte).toContain('Course');
  });
});
