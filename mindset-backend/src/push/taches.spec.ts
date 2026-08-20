import {
  aDesRoutines,
  cochesDuJour,
  objectifsDeLaSemaine,
  semaineDuClient,
  separerTaches,
  tachesDuJour,
} from './taches';

/**
 * Le tri des tâches est la source unique de tout ce que les notifications
 * affirment : ce qui reste, ce qui est fait, et donc s'il y a lieu de féliciter.
 *
 * Ce qu'on vérifie ici est surtout la **date**. Le client décoche les routines
 * chaque nuit et remet les objectifs à zéro chaque lundi ; le serveur ne remet
 * jamais rien, si bien que la base garde la veille — ou la semaine passée — tant
 * que l'app n'est pas ouverte. Un tri qui ignore ces échéances ne se plante
 * jamais : il rend une réponse plausible, et c'est la pire espèce de panne. Elle
 * s'est payée un matin à 10 h 50, par un « Félicitations, tu as terminé tous tes
 * exercices » envoyé à quelqu'un dont les six tâches étaient intactes.
 */

/** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
const jour = (recul: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - recul);
  return d.toISOString().slice(0, 10);
};

/** Un mercredi et un dimanche fixes, pour que la récurrence ne dépende pas du jour du test. */
const MERCREDI = new Date('2026-08-19T09:00:00Z');
const DIMANCHE = new Date('2026-08-16T09:00:00Z');

describe('separerTaches', () => {
  it('lit les deux formes envoyées par le client, groupée et à plat', () => {
    const groupe = separerTaches([{ items: [{ title: 'Sport', done: true }, { title: 'Lire' }] }]);
    expect(groupe.faites).toEqual(['Sport']);
    expect(groupe.restantes).toEqual(['Lire']);

    const plat = separerTaches([{ name: 'Sport', done: true }, { name: 'Lire' }]);
    expect(plat.faites).toEqual(['Sport']);
    expect(plat.restantes).toEqual(['Lire']);
  });

  it("écarte ce qui n'a pas de titre lisible", () => {
    expect(separerTaches([{ items: [{ done: true }, { title: '   ' }, { title: 'Sport' }] }])).toEqual({
      restantes: ['Sport'],
      faites: [],
    });
  });
});

describe('cochesDuJour', () => {
  it("reconnaît la date d'aujourd'hui, dans la convention du client (UTC)", () => {
    expect(cochesDuJour(jour(0))).toBe(true);
    expect(cochesDuJour(jour(1))).toBe(false);
  });

  it('tient une date absente ou abîmée pour périmée', () => {
    // Le client fait le même choix : son test est `lastDate !== today`, donc il
    // décoche. Conclure l'inverse ici ferait dire au serveur ce que l'écran contredit.
    expect(cochesDuJour(null)).toBe(false);
    expect(cochesDuJour(undefined)).toBe(false);
    expect(cochesDuJour('')).toBe(false);
    expect(cochesDuJour(20250820 as any)).toBe(false);
  });

  it('se juge à une date donnée, pas seulement à maintenant', () => {
    // Le paramètre existe pour que les tournées puissent être rejouées et testées
    // à une heure choisie, sans dépendre de l'horloge de la machine.
    const veille = new Date('2026-08-19T22:00:00Z');
    expect(cochesDuJour('2026-08-19', veille)).toBe(true);
    expect(cochesDuJour('2026-08-20', veille)).toBe(false);
  });
});

describe('tachesDuJour', () => {
  const routines = [
    { items: [{ title: 'Squats (4×12)', done: true }, { title: 'Pompes (3×15)', done: true }] },
  ];

  it('garde les coches du jour', () => {
    const triees = tachesDuJour({ routines, last_routine_date: jour(0) });
    expect(triees.faites).toHaveLength(2);
    expect(triees.restantes).toEqual([]);
  });

  it('rend la journée entière à faire quand les coches datent de la veille', () => {
    // Et dans l'ordre d'affichage : la première tâche que le coach cite doit être
    // celle que la personne verra en haut de son écran.
    const triees = tachesDuJour({ routines, last_routine_date: jour(1) });
    expect(triees.faites).toEqual([]);
    expect(triees.restantes).toEqual(['Squats (4×12)', 'Pompes (3×15)']);
  });

  it('supporte un compte sans aucune synchronisation', () => {
    expect(tachesDuJour(null)).toEqual({ restantes: [], faites: [] });
    expect(tachesDuJour(undefined)).toEqual({ restantes: [], faites: [] });
    expect(tachesDuJour({})).toEqual({ restantes: [], faites: [] });
  });

  /*
    La récurrence, que le serveur ignorait complètement.

    Le coach lui-même est invité à poser un champ `jours` sur la plupart des tâches
    qu'il propose — c'est écrit dans son invite, muscu comprise. Les lire tous les
    jours revient donc à réclamer le dimanche une séance prévue le mardi, et à
    empêcher « journée pleine » de se déclencher pour quiconque suit un programme :
    il reste toujours des tâches d'un autre jour à cocher, invisibles à l'écran.
  */
  it("écarte une tâche qui n'est pas prévue aujourd'hui", () => {
    const sync = {
      routines: [{ items: [{ title: 'Squats', jours: ['mardi', 'jeudi'] }, { title: 'Méditer' }] }],
      last_routine_date: '2026-08-16',
    };

    expect(tachesDuJour(sync, DIMANCHE).restantes).toEqual(['Méditer']);
  });

  it('garde la tâche le jour où elle est prévue', () => {
    const sync = {
      routines: [{ items: [{ title: 'Squats', jours: ['mercredi'] }] }],
      last_routine_date: '2026-08-19',
    };
    expect(tachesDuJour(sync, MERCREDI).restantes).toEqual(['Squats']);
  });

  it('traite comme quotidienne une tâche sans jours, ou déclarée sur les sept', () => {
    // C'est le comportement de tout ce qui existait avant la récurrence : rien à
    // migrer, et une liste complète ne dit rien de plus que « tous les jours ».
    const sync = {
      routines: [
        { items: [{ title: 'Sans jours' }] },
        {
          items: [
            {
              title: 'Sept jours',
              jours: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
            },
          ],
        },
        { items: [{ title: 'Liste vide', jours: [] }] },
      ],
      last_routine_date: '2026-08-16',
    };
    expect(tachesDuJour(sync, DIMANCHE).restantes).toEqual(['Sans jours', 'Sept jours', 'Liste vide']);
  });

  it('lit le jour de la semaine à Paris et non en UTC', () => {
    // 23 h 30 à Paris un mercredi, c'est encore mercredi — mais 21 h 30 en UTC.
    // Se fier au fuseau du serveur ferait apparaître les tâches du jeudi deux
    // heures trop tôt et disparaître celles du mercredi ; le client, lui, lit
    // l'heure de l'appareil.
    const mercrediSoir = new Date('2026-08-19T21:30:00Z');
    const sync = {
      routines: [{ items: [{ title: 'Squats', jours: ['mercredi'] }] }],
      last_routine_date: '2026-08-19',
    };
    expect(tachesDuJour(sync, mercrediSoir).restantes).toEqual(['Squats']);
  });
});

describe('aDesRoutines', () => {
  it('distingue le compte sans programme du jour sans séance', () => {
    // Les deux journées sont vides à l'écran ; l'une appelle « dis-moi ce que tu veux
    // faire », l'autre ne doit rien réclamer du tout. Sans ce partage, quelqu'un qui
    // suit un programme trois fois par semaine s'entend dire quatre matins sur sept
    // que sa journée est vide.
    expect(aDesRoutines(null)).toBe(false);
    expect(aDesRoutines({ routines: [] })).toBe(false);
    expect(aDesRoutines({ routines: [{ items: [] }] })).toBe(false);
    expect(aDesRoutines({ routines: [{ items: [{ title: 'Squats', jours: ['mardi'] }] }] })).toBe(true);
  });
});

describe('objectifsDeLaSemaine', () => {
  it('rend le lundi de la semaine, comme le repère du client', () => {
    expect(semaineDuClient('2026-08-19')).toBe('2026-08-17');
    expect(semaineDuClient('2026-08-17')).toBe('2026-08-17');
    // Un dimanche appartient à la semaine qui l'a commencé, pas à celle qui suit.
    expect(semaineDuClient('2026-08-16')).toBe('2026-08-10');
  });

  it('garde un objectif atteint cette semaine', () => {
    const triees = objectifsDeLaSemaine(
      [{ title: 'Aller à la salle 3×', done: true, awardedDate: '2026-08-18' }],
      MERCREDI,
    );
    expect(triees.faites).toEqual(['Aller à la salle 3×']);
  });

  it('rend à faire un objectif atteint la semaine dernière', () => {
    // Le lundi, le client remet les micro-objectifs à zéro. Tant qu'il ne l'a pas
    // fait, la base montre une semaine entièrement bouclée et le coach n'avait
    // plus aucun objectif en cours à citer — au moment précis où ils redeviennent
    // tous ouverts.
    const triees = objectifsDeLaSemaine(
      [{ title: 'Aller à la salle 3×', done: true, awardedDate: '2026-08-14' }],
      MERCREDI,
    );
    expect(triees.restantes).toEqual(['Aller à la salle 3×']);
    expect(triees.faites).toEqual([]);
  });

  it('garde la coche quand aucune date ne prouve le contraire', () => {
    // Ne pas mentionner un objectif est un petit défaut ; réclamer celui que la
    // personne vient de terminer en est un grand. Sans preuve, on se tait.
    const triees = objectifsDeLaSemaine([{ title: 'Lire 50 pages', done: true }], MERCREDI);
    expect(triees.faites).toEqual(['Lire 50 pages']);
  });

  it("laisse à faire ce qui n'a jamais été coché", () => {
    const triees = objectifsDeLaSemaine(
      [{ title: 'Courir 20 km', done: false, progress: 8, awardedDate: '2026-08-14' }],
      MERCREDI,
    );
    expect(triees.restantes).toEqual(['Courir 20 km']);
  });
});
