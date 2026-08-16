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
  let prisma: { user: { findMany: jest.Mock } };

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

  beforeEach(async () => {
    prisma = { user: { findMany: jest.fn() } };
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
