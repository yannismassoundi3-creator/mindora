import { Test, TestingModule } from '@nestjs/testing';
import { CoupDePouceService, Situation } from './coup-de-pouce.service';

/**
 * Ce qui est vérifié ici est la retenue, pas la rédaction.
 *
 * Un service de relance qui trouve toujours une raison d'écrire fait couper les
 * notifications — et un refus navigateur ne se redemande jamais. Les tests
 * portent donc sur les cas où le service doit se taire, qui sont les plus
 * nombreux et les seuls dont l'erreur soit irréversible. Le texte, lui, peut être
 * mauvais un jour sans conséquence durable.
 */
describe('CoupDePouceService', () => {
  let service: CoupDePouceService;

  const JOUR = 86400000;

  /** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
  const cle = (recul: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - recul);
    return d.toISOString().slice(0, 10);
  };

  /** Des scores journaliers pour les jours donnés (en recul depuis aujourd'hui). */
  const scores = (...reculs: number[]) => {
    const s: Record<string, number> = {};
    for (const r of reculs) s[cle(r)] = 50;
    return s;
  };

  const taches = (restantes: string[], faites: string[] = []) => [
    {
      items: [
        ...restantes.map((title) => ({ title, done: false })),
        ...faites.map((title) => ({ title, done: true })),
      ],
    },
  ];

  const etat = (o: Partial<Parameters<CoupDePouceService['situation']>[0]> = {}) => ({
    dailyScores: null,
    routines: null,
    // Par défaut, les coches sont celles d'aujourd'hui : c'est l'état d'un compte
    // dont l'app a été ouverte ce matin. Les cas où elles datent d'un autre jour
    // sont testés à part — c'est de là qu'est venue la fausse félicitation.
    jourDesRoutines: cle(0),
    objectifs: null,
    dernierCoupDePouce: null,
    derniereSynchro: new Date(),
    ...o,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CoupDePouceService],
    }).compile();
    service = module.get<CoupDePouceService>(CoupDePouceService);
  });

  describe('quand il ne faut rien envoyer', () => {
    it("se tait si un coup de pouce est parti il y a moins de trois jours", () => {
      const situation = service.situation(
        etat({
          dailyScores: scores(3, 4),
          routines: taches(['Sport']),
          dernierCoupDePouce: new Date(Date.now() - 1 * JOUR),
        }),
      );
      expect(situation).toBeNull();
    });

    it("se tait si la journée est déjà bouclée", () => {
      const situation = service.situation(
        etat({ dailyScores: scores(0, 1, 2), routines: taches([], ['Sport', 'Lecture']) }),
      );
      expect(situation).toBeNull();
    });

    it("se tait pour un compte parti depuis trop longtemps", () => {
      // Et ce, même s'il lui reste des tâches non cochées — c'est le cas de tout
      // compte abandonné. Sans garde de dormance placé avant les trois
      // situations, ces comptes-là recevaient une relance tous les trois jours,
      // indéfiniment.
      const situation = service.situation(
        etat({ dailyScores: scores(30), routines: taches(['Sport']) }),
      );
      expect(situation).toBeNull();
    });

    it("se tait pour un compte qui a des routines mais n'a jamais rien coché", () => {
      const situation = service.situation(etat({ routines: taches(['Sport', 'Lecture']) }));
      expect(situation).toBeNull();
    });

    it("se tait pour un compte qui n'a jamais rien fait et n'a rien de prévu", () => {
      // Ni tâche à citer, ni série à défendre, ni retour à provoquer : il n'y a
      // aucun fait sur lequel écrire, donc rien à envoyer.
      expect(service.situation(etat())).toBeNull();
    });

    it("se tait pour un simple jour de pause", () => {
      // Un jour sans rien n'est pas un décrochage. Le signaler ferait du coach un
      // surveillant.
      const situation = service.situation(
        etat({ dailyScores: scores(1, 2, 3), routines: taches([], ['Sport']) }),
      );
      expect(situation).toBeNull();
    });
  });

  describe('quand il y a quelque chose à dire', () => {
    it('reconnaît un décrochage après une série', () => {
      const situation = service.situation(etat({ dailyScores: scores(3, 4, 5) }));
      expect(situation?.raison).toBe('reprise');
      expect(situation?.joursSansRien).toBe(3);
    });

    it("reconnaît une journée non entamée avec des tâches devant", () => {
      const situation = service.situation(
        etat({ dailyScores: scores(1, 2), routines: taches(['Courir 20 min']) }),
      );
      expect(situation?.raison).toBe('aFinir');
      expect(situation?.restantes).toContain('Courir 20 min');
    });

    it('ne tient pas pour cochées les cases de la veille', () => {
      // Mêmes données que le jour de pause ci-dessus, à un détail près : les coches
      // datent d'hier. Le client les effacera à la prochaine ouverture, la journée
      // est donc entière devant. Les lire comme faites, c'est se taire au moment où
      // il y avait quelque chose à dire — et, au matin, féliciter pour rien.
      const situation = service.situation(
        etat({ dailyScores: scores(1, 2, 3), routines: taches([], ['Sport']), jourDesRoutines: cle(1) }),
      );
      expect(situation?.raison).toBe('aFinir');
      expect(situation?.restantes).toContain('Sport');
      expect(situation?.faites).toEqual([]);
    });

    it('reconnaît une série en cours à prolonger', () => {
      const situation = service.situation(
        etat({ dailyScores: scores(0, 1, 2, 3), routines: taches(['Lecture'], ['Sport']) }),
      );
      expect(situation?.raison).toBe('serie');
      expect(situation?.serie).toBe(3);
    });

    it('envoie de nouveau une fois les trois jours écoulés', () => {
      const situation = service.situation(
        etat({
          dailyScores: scores(3, 4),
          routines: taches(['Sport']),
          dernierCoupDePouce: new Date(Date.now() - 4 * JOUR),
        }),
      );
      expect(situation).not.toBeNull();
    });
  });

  describe("l'invite envoyée au modèle", () => {
    const situation = (o: Partial<Situation> = {}): Situation => ({
      raison: 'aFinir',
      serie: 0,
      joursSansRien: 1,
      restantes: [],
      faites: [],
      ...o,
    });

    it('interdit explicitement de réclamer une tâche déjà cochée', () => {
      const invite = service.construireInvite(
        'Léa',
        situation({ restantes: ['Lecture'], faites: ['Sport'] }),
      );
      expect(invite).toContain('DÉJÀ FAIT');
      expect(invite).toContain('Sport');
    });

    it("ne propose aucune tâche à citer quand la personne n'en a pas", () => {
      // C'est ainsi qu'un compte sans la moindre routine s'était vu ordonner
      // « 10m de footing » : l'invite réclamait une tâche précise sans en fournir.
      const invite = service.construireInvite('Léa', situation({ raison: 'reprise' }));
      expect(invite).toContain('Aucune tâche planifiée');
      expect(invite).not.toContain('Cite UNE tâche précise');
    });
  });

  describe('la phrase de repli, quand l’IA ne répond pas', () => {
    it("cite la vraie tâche plutôt qu'un encouragement creux", () => {
      const texte = service.texteFactuel('Léa', {
        raison: 'aFinir',
        serie: 0,
        joursSansRien: 1,
        restantes: ['Courir 20 min'],
        faites: [],
      });
      expect(texte).toContain('Courir 20 min');
    });

    it("dit les jours d'absence sans reproche ni promesse", () => {
      const texte = service.texteFactuel('Léa', {
        raison: 'reprise',
        serie: 5,
        joursSansRien: 3,
        restantes: [],
        faites: [],
      });
      expect(texte).toContain('3 jours');
      expect(texte).toContain('5 jours');
      expect(texte.toLowerCase()).not.toContain('bravo');
      expect(texte.toLowerCase()).not.toContain('courage');
    });
  });

  describe('les compteurs', () => {
    it("compte la série à partir d'hier, sans inclure aujourd'hui", () => {
      // Aujourd'hui ne compte pas : la journée n'est pas finie, et l'y inclure
      // ferait afficher une série qui peut encore retomber.
      expect(CoupDePouceService.serie(scores(0, 1, 2))).toBe(2);
    });

    it('rend zéro jour sans rien quand la personne a agi aujourd’hui', () => {
      expect(CoupDePouceService.joursSansRien(scores(0))).toBe(0);
    });

    it("rend l'infini pour un compte sans le moindre historique", () => {
      expect(CoupDePouceService.joursSansRien({})).toBe(Infinity);
    });
  });
});
