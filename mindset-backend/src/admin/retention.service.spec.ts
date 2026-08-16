import { Test, TestingModule } from '@nestjs/testing';
import { RetentionService } from './retention.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Un chiffre de rétention faux est pire qu'un chiffre absent : on prend des
 * décisions dessus. Ce qui est vérifié ici n'est pas que la fonction répond, mais
 * qu'elle ne ment pas dans les deux cas où ce genre de calcul ment presque
 * toujours — les comptes trop jeunes comptés comme des échecs, et le jour de
 * l'inscription pris pour un retour.
 */
describe('RetentionService', () => {
  let service: RetentionService;
  let prisma: {
    user: { findMany: jest.Mock };
    appOuverture: { groupBy: jest.Mock; aggregate: jest.Mock };
  };

  const JOUR = 24 * 60 * 60 * 1000;
  const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR);
  const cle = (d: Date) => d.toISOString().slice(0, 10);

  /** Un compte, décrit comme Prisma le rendrait. */
  const compte = (opts: {
    inscritIlYA: number;
    joursActifs?: number[]; // en jours écoulés depuis aujourd'hui
    messages?: number;
    statut?: string;
    derniereSynchro?: number;
    /** Nombre de jetons de session : zéro = n'est jamais entré dans l'app. */
    sessions?: number;
    /** Le questionnaire d'inscription a été mené jusqu'au bout. */
    questionnaire?: boolean;
  }) => {
    const daily_scores: Record<string, number> = {};
    for (const j of opts.joursActifs ?? []) daily_scores[cle(ilYA(j))] = 50;
    // Par défaut, un compte qui a franchi les deux premières marches : les tests
    // écrits avant qu'elles existent décrivent tous des gens entrés dans l'app.
    return {
      id: `u-${Math.random()}`,
      created_at: ilYA(opts.inscritIlYA),
      sync_data: {
        daily_scores,
        updated_at: ilYA(opts.derniereSynchro ?? opts.inscritIlYA),
      },
      subscription: opts.statut ? { status: opts.statut, plan_type: 'MONTHLY' } : null,
      _count: { chat_messages: opts.messages ?? 0, refresh_tokens: opts.sessions ?? 1 },
      ai_profile: (opts.questionnaire ?? true) ? { id: 'p1' } : null,
    };
  };

  const avec = async (comptes: any[]) => {
    prisma.user.findMany.mockResolvedValue(comptes);
    return service.getRetentionStats();
  };

  it("ne compte comme messages que ceux que la personne a écrits elle-même", async () => {
    // La fin du questionnaire réclame un plan au coach au nom de la personne, et
    // le coach répond : trois lignes en base pour zéro conversation. Sans ce
    // filtre, la marche « ont parlé au coach » était franchie par tout compte
    // ayant fini l'inscription — une marche qui ne mesurait plus rien.
    await avec([]);

    const requete = prisma.user.findMany.mock.calls[0][0];
    expect(requete.select._count.select.chat_messages).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ sender: 'user' }),
      }),
    );
  });

  /**
   * « Combien de fois elle revient » — la question que la rétention n'atteint pas.
   *
   * Elle range chacun dans « revenu » ou « pas revenu » ; à l'intérieur du premier
   * groupe, deux jours et vingt-cinq jours sont indiscernables. Les pièges de ce
   * calcul-là sont ailleurs : la moyenne tirée par un compte assidu, les comptes
   * jamais actifs qui écrasent la distribution, et un rythme calculé sur des
   * comptes d'un jour, mécaniquement parfait.
   */
  describe('fréquence de retour', () => {
    it('compte les jours distincts, pas les venues supposées', async () => {
      const stats = await avec([
        compte({ inscritIlYA: 20, joursActifs: [20, 18, 3] }),
        compte({ inscritIlYA: 20, joursActifs: [20] }),
        compte({ inscritIlYA: 20, joursActifs: [20, 19] }),
      ]);

      expect(stats.frequence.base).toBe(3);
      expect(stats.frequence.medianeJours).toBe(2);
      // Un seul des trois n'a jamais eu de deuxième jour.
      expect(stats.frequence.revenusAuMoinsUneFois).toBe(2);

      const palier = (cle: string) =>
        stats.frequence.distribution.find((d) => d.cle === cle)!.comptes;
      expect(palier('1')).toBe(1);
      expect(palier('2')).toBe(1);
      expect(palier('3-4')).toBe(1);
    });

    it("exclut les comptes jamais actifs plutôt que de les compter comme zéro", async () => {
      // Les mêler ici ferait dire « la moitié vient un jour ou moins », ce qui
      // confond ne pas commencer et ne pas continuer — deux problèmes qui ne se
      // réparent pas au même endroit. Ils sont comptés dans `jamaisActifs`.
      const stats = await avec([
        compte({ inscritIlYA: 20, joursActifs: [20, 19] }),
        compte({ inscritIlYA: 20, joursActifs: [] }),
        compte({ inscritIlYA: 20, joursActifs: [] }),
      ]);

      expect(stats.comptes.jamaisActifs).toBe(2);
      expect(stats.frequence.base).toBe(1);
      expect(stats.frequence.medianeJours).toBe(2);
    });

    it("montre la médiane à côté de la moyenne, qu'un seul assidu suffit à fausser", async () => {
      const stats = await avec([
        compte({ inscritIlYA: 40, joursActifs: Array.from({ length: 30 }, (_, i) => i + 1) }),
        compte({ inscritIlYA: 40, joursActifs: [40] }),
        compte({ inscritIlYA: 40, joursActifs: [40] }),
      ]);

      // La personne du milieu vient un jour. La moyenne en annonce plus de dix :
      // lue seule, elle décrirait un produit que personne n'utilise ainsi.
      expect(stats.frequence.medianeJours).toBe(1);
      expect(stats.frequence.moyenneJours).toBeGreaterThan(10);
    });

    it("ne calcule pas de rythme sur des comptes qui n'ont pas eu le temps", async () => {
      // Un compte créé aujourd'hui et venu aujourd'hui, c'est 10 jours sur 10 :
      // mécanique, et faux dès demain. Sous sept jours d'ancienneté, il sort.
      const stats = await avec([
        compte({ inscritIlYA: 0, joursActifs: [0] }),
        compte({ inscritIlYA: 1, joursActifs: [1, 0] }),
      ]);

      expect(stats.frequence.regularite.base).toBe(0);
      expect(stats.frequence.regularite.joursPourDix).toBeNull();
    });

    it('rapporte les jours actifs au temps écoulé depuis l’inscription', async () => {
      // Cinq jours d'activité sur dix d'ancienneté : la moitié du temps.
      const stats = await avec([
        compte({ inscritIlYA: 9, joursActifs: [9, 8, 7, 6, 5] }),
        compte({ inscritIlYA: 9, joursActifs: [9, 8, 7, 6, 5] }),
      ]);

      expect(stats.frequence.regularite.base).toBe(2);
      expect(stats.frequence.regularite.joursPourDix).toBe(5);
    });

    it("ignore les jours qui n'ont pas encore eu lieu", async () => {
      // Les clés viennent de l'horloge du navigateur. Un appareil réglé en avance
      // écrit des jours futurs : comptés, ils inventent des venues chez quelqu'un
      // qui n'est venu qu'une fois.
      const demain = new Date(Date.now() + JOUR);
      const compteAvecFutur = compte({ inscritIlYA: 10, joursActifs: [10] });
      (compteAvecFutur.sync_data.daily_scores as Record<string, number>)[cle(demain)] = 80;

      const stats = await avec([compteAvecFutur]);

      expect(stats.frequence.medianeJours).toBe(1);
      expect(stats.frequence.revenusAuMoinsUneFois).toBe(0);
    });
  });

  /**
   * Les ouvertures : la seule mesure d'usage qui ne dépende pas d'une action.
   *
   * Son piège n'est pas le calcul, c'est la lecture — mise en service bien après
   * les comptes qu'elle décrit, elle paraît catastrophique si rien ne dit à partir
   * de quand elle mesure. D'où `depuis`, vérifié ici comme le reste.
   */
  describe("ouvertures de l'application", () => {
    it('sépare le nombre d’ouvertures du nombre de jours ouverts', async () => {
      const a = compte({ inscritIlYA: 10, joursActifs: [10] });
      const b = compte({ inscritIlYA: 10, joursActifs: [10] });
      prisma.appOuverture.groupBy.mockResolvedValue([
        // Six ouvertures réparties sur deux jours : trois par jour de venue.
        { user_id: a.id, _sum: { nombre: 6 }, _count: { jour: 2 } },
        { user_id: b.id, _sum: { nombre: 2 }, _count: { jour: 2 } },
      ]);
      prisma.appOuverture.aggregate.mockResolvedValue({ _min: { jour: '2026-08-16' } });

      const stats = await avec([a, b]);

      expect(stats.ouvertures.base).toBe(2);
      expect(stats.ouvertures.total).toBe(8);
      expect(stats.ouvertures.medianeParPersonne).toBe(4);
      expect(stats.ouvertures.medianeJours).toBe(2);
      // (6/2 + 2/2) / 2 = 2 : la personne du milieu ouvre deux fois par jour de venue.
      expect(stats.ouvertures.medianeParJourOuvert).toBe(2);
      expect(stats.ouvertures.depuis).toBe('2026-08-16');
    });

    it("ne compte pas les ouvertures d'un compte supprimé", async () => {
      // `groupBy` ne sait pas filtrer sur la relation : sans le tri par identifiant,
      // un compte supprimé disparaîtrait du dénominateur en gardant ses ouvertures
      // au numérateur, et la médiane monterait toute seule.
      const vivant = compte({ inscritIlYA: 10, joursActifs: [10] });
      prisma.appOuverture.groupBy.mockResolvedValue([
        { user_id: vivant.id, _sum: { nombre: 4 }, _count: { jour: 2 } },
        { user_id: 'compte-supprime', _sum: { nombre: 99 }, _count: { jour: 30 } },
      ]);

      const stats = await avec([vivant]);

      expect(stats.ouvertures.base).toBe(1);
      expect(stats.ouvertures.total).toBe(4);
    });

    it("ne prétend rien quand la mesure vient d'être branchée", async () => {
      const stats = await avec([compte({ inscritIlYA: 30, joursActifs: [30, 20] })]);

      expect(stats.ouvertures.depuis).toBeNull();
      expect(stats.ouvertures.base).toBe(0);
      // Aucune médiane inventée à zéro : zéro ouverture par personne se lirait
      // comme « personne n'ouvre l'app », alors que rien n'a encore été mesuré.
      expect(stats.ouvertures.medianeParPersonne).toBeNull();
    });
  });

  beforeEach(async () => {
    prisma = {
      user: { findMany: jest.fn() },
      // Par défaut, aucune ouverture : la mesure est postérieure à la plupart des
      // comptes, et les tests écrits avant elle décrivent tous ce cas-là.
      appOuverture: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _min: { jour: null } }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [RetentionService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<RetentionService>(RetentionService);
  });

  it("n'accuse pas un compte trop jeune de ne pas être revenu", async () => {
    // Inscrit il y a deux jours : la question « est-il revenu à J+7 ? » n'a pas
    // encore de réponse. Le compter au dénominateur ferait afficher 0 % et
    // donnerait à croire que le produit vient de casser.
    const stats = await avec([compte({ inscritIlYA: 2, joursActifs: [2, 1] })]);

    const j7 = stats.retention.find((r) => r.fenetre === 7)!;
    expect(j7.base).toBe(0);
    expect(j7.taux).toBeNull();

    // À J+1, en revanche, il est éligible et il est bien revenu.
    const j1 = stats.retention.find((r) => r.fenetre === 1)!;
    expect(j1.base).toBe(1);
    expect(j1.taux).toBe(100);
  });

  it("ne prend pas le jour de l'inscription pour un retour", async () => {
    // Quelqu'un qui s'inscrit, essaie l'application dix minutes et ne revient
    // jamais a forcément un jour d'activité : celui de son inscription. Le
    // compter donnerait 100 % de rétention à un produit que personne ne garde.
    const stats = await avec([compte({ inscritIlYA: 10, joursActifs: [10] })]);

    expect(stats.retention.find((r) => r.fenetre === 7)!.taux).toBe(0);
    // Il a tout de même agi : ce n'est pas un compte mort-né.
    expect(stats.comptes.jamaisActifs).toBe(0);
    expect(stats.entonnoir.ontAgi).toBe(1);
  });

  it('ne compte pas un retour survenu après la fenêtre', async () => {
    // Revenu au bout de vingt jours : c'est un retour à J+30, pas à J+7.
    const stats = await avec([compte({ inscritIlYA: 40, joursActifs: [40, 20] })]);

    expect(stats.retention.find((r) => r.fenetre === 7)!.taux).toBe(0);
    expect(stats.retention.find((r) => r.fenetre === 30)!.taux).toBe(100);
  });

  it('sépare le compte jamais utilisé de celui qui est parti', async () => {
    // Les deux sont perdus, mais pas pour la même raison ni au même endroit : le
    // premier n'a jamais rien vu, le second a essayé. Confondre les deux fait
    // corriger le mauvais bout du produit.
    const stats = await avec([
      compte({ inscritIlYA: 30 }), // inscrit, jamais rien fait
      compte({ inscritIlYA: 30, joursActifs: [30, 29] }), // a essayé puis parti
    ]);

    expect(stats.comptes.jamaisActifs).toBe(1);
    expect(stats.entonnoir.ontAgi).toBe(1);
  });

  it("compte l'entonnoir dans l'ordre où on le perd", async () => {
    const stats = await avec([
      compte({ inscritIlYA: 20 }),
      compte({ inscritIlYA: 20, joursActifs: [20] }),
      compte({ inscritIlYA: 20, joursActifs: [20, 19], messages: 4 }),
      compte({ inscritIlYA: 20, joursActifs: [20, 19], messages: 9, statut: 'TRIALING' }),
      // Un abonnement résilié ne compte plus comme abonné.
      compte({ inscritIlYA: 20, joursActifs: [20], messages: 2, statut: 'CANCELED' }),
    ]);

    expect(stats.entonnoir).toEqual({
      inscrits: 5,
      ontOuvertUneSession: 5,
      ontFiniLeQuestionnaire: 5,
      ontAgi: 4,
      ontParleAuCoach: 3,
      abonnes: 1,
    });
  });

  it('distingue le mur du code de celui du questionnaire', async () => {
    /*
      Les deux produisent le même symptôme — un compte inscrit qui n'a jamais rien
      fait —, et c'est précisément le point : sans ces deux marches, neuf comptes
      perdus ne désignaient rien à réparer. Le premier n'a jamais pu entrer, le
      second est entré et a lâché devant les questions.
    */
    const stats = await avec([
      compte({ inscritIlYA: 20, sessions: 0, questionnaire: false }),
      compte({ inscritIlYA: 20, sessions: 1, questionnaire: false }),
      compte({ inscritIlYA: 20, joursActifs: [20, 19] }),
    ]);

    expect(stats.entonnoir.inscrits).toBe(3);
    expect(stats.entonnoir.ontOuvertUneSession).toBe(2);
    expect(stats.entonnoir.ontFiniLeQuestionnaire).toBe(1);
    // Les deux premiers sont indistinguables sur cette ligne-là, et c'était toute
    // l'information dont on disposait jusqu'ici.
    expect(stats.entonnoir.ontAgi).toBe(1);
  });

  it('groupe les cohortes par semaine et laisse la plus jeune sans taux', async () => {
    const stats = await avec([
      compte({ inscritIlYA: 20, joursActifs: [20, 18] }),
      compte({ inscritIlYA: 21, joursActifs: [21] }),
      compte({ inscritIlYA: 1, joursActifs: [1] }), // cette semaine : trop jeune
    ]);

    // La plus récente d'abord, pour qu'on lise l'état actuel sans faire défiler.
    expect(stats.cohortes[0].base).toBe(0);
    expect(stats.cohortes[0].tauxJ7).toBeNull();
    expect(stats.cohortes[0].inscrits).toBe(1);

    const anciennes = stats.cohortes.filter((c) => c.base > 0);
    expect(anciennes.reduce((n, c) => n + c.inscrits, 0)).toBe(2);
    expect(anciennes.reduce((n, c) => n + c.revenusJ7, 0)).toBe(1);
  });

  it('tient sans exception quand un compte n’a aucune donnée de synchro', async () => {
    // Le cas d'une inscription interrompue avant la première synchro : la ligne
    // `sync_data` n'existe pas encore.
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u1',
        created_at: ilYA(10),
        sync_data: null,
        subscription: null,
        _count: { chat_messages: 0 },
      },
    ]);

    const stats = await service.getRetentionStats();

    expect(stats.comptes.total).toBe(1);
    expect(stats.comptes.jamaisActifs).toBe(1);
    expect(stats.comptes.actifs7j).toBe(0);
  });

  it('ignore un daily_scores corrompu au lieu de tomber', async () => {
    // Le contenu vient du navigateur : il peut être une liste, une chaîne, ou
    // porter des clés qui ne sont pas des dates.
    for (const scores of [[], 'nimporte quoi', { pasunedate: 3 }, null]) {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          created_at: ilYA(10),
          sync_data: { daily_scores: scores, updated_at: ilYA(1) },
          subscription: null,
          _count: { chat_messages: 0 },
        },
      ]);

      const stats = await service.getRetentionStats();
      expect(stats.comptes.jamaisActifs).toBe(1);
    }
  });
});
