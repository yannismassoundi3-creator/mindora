import { cochesDuJour, separerTaches, tachesDuJour } from './taches';

/**
 * Le tri des tâches est la source unique de tout ce que les notifications
 * affirment : ce qui reste, ce qui est fait, et donc s'il y a lieu de féliciter.
 *
 * Ce qu'on vérifie ici est surtout la date. Le décochage quotidien n'a jamais lieu
 * sur le serveur — c'est le client qui efface les cases à l'ouverture — si bien que
 * la base garde la veille tant que l'app n'est pas ouverte. Un tri qui ignore cette
 * date ne se plante jamais : il rend une réponse plausible, et c'est la pire
 * espèce de panne. Elle s'est payée un matin à 10 h 50, par un « Félicitations, tu
 * as terminé tous tes exercices » envoyé à quelqu'un dont les six tâches étaient
 * intactes.
 */
/** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
const jour = (recul: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - recul);
  return d.toISOString().slice(0, 10);
};

describe('separerTaches', () => {
  it('lit les deux formes envoyées par le client, groupée et à plat', () => {
    const groupe = separerTaches([{ items: [{ title: 'Sport', done: true }, { title: 'Lire' }] }]);
    expect(groupe.faites).toEqual(['Sport']);
    expect(groupe.restantes).toEqual(['Lire']);

    const plat = separerTaches([{ name: 'Sport', done: true }, { name: 'Lire' }]);
    expect(plat.faites).toEqual(['Sport']);
    expect(plat.restantes).toEqual(['Lire']);
  });

  it('renvoie tout en « à faire » quand les coches ne valent plus', () => {
    // Et dans l'ordre d'affichage : la première tâche citée par le coach doit être
    // celle que la personne verra en haut de son écran.
    const triees = separerTaches(
      [{ items: [{ title: 'Squats', done: true }, { title: 'Pompes' }, { title: 'Tractions', done: true }] }],
      false,
    );
    expect(triees.restantes).toEqual(['Squats', 'Pompes', 'Tractions']);
    expect(triees.faites).toEqual([]);
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
  const routines = [{ items: [{ title: 'Squats (4×12)', done: true }, { title: 'Pompes (3×15)', done: true }] }];

  it('garde les coches du jour', () => {
    const triees = tachesDuJour({ routines, last_routine_date: jour(0) });
    expect(triees.faites).toHaveLength(2);
    expect(triees.restantes).toEqual([]);
  });

  it('rend la journée entière à faire quand les coches datent de la veille', () => {
    const triees = tachesDuJour({ routines, last_routine_date: jour(1) });
    expect(triees.faites).toEqual([]);
    expect(triees.restantes).toEqual(['Squats (4×12)', 'Pompes (3×15)']);
  });

  it('supporte un compte sans aucune synchronisation', () => {
    expect(tachesDuJour(null)).toEqual({ restantes: [], faites: [] });
    expect(tachesDuJour(undefined)).toEqual({ restantes: [], faites: [] });
    expect(tachesDuJour({})).toEqual({ restantes: [], faites: [] });
  });
});
