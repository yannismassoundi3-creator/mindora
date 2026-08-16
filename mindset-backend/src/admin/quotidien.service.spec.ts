import { Test, TestingModule } from '@nestjs/testing';
import { QuotidienService } from './quotidien.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ce qu'on vérifie ici n'est pas que la fonction répond, mais qu'elle ne se
 * trompe pas de journée.
 *
 * Le serveur tourne en UTC et le tableau se lit à Paris : un compte créé à
 * 00 h 30 heure française appartient au jour d'après, côté serveur. L'erreur ne
 * fait rien planter — elle range simplement une inscription dans la mauvaise
 * colonne, ce qui est le pire cas possible pour un chiffre qu'on regarde le matin
 * pour savoir si la veille a servi à quelque chose.
 */
describe('QuotidienService', () => {
  let service: QuotidienService;
  let prisma: {
    user: { findMany: jest.Mock };
    chatMessage: { findMany: jest.Mock };
  };

  /** Le message que la fin du questionnaire envoie à la place de la personne. */
  const MESSAGE_AUTOMATIQUE =
    "Je viens de terminer mon inscription. Donne-moi mon plan pour aujourd'hui : mes routines, mes habitudes et mes objectifs.";

  /**
   * Le service interroge la table des messages deux fois : une fois en excluant
   * le message automatique, une fois pour ne compter que lui. Le double est donc
   * aiguillé sur le filtre, sinon les deux requêtes rendraient la même chose et
   * le test ne prouverait rien.
   */
  const avec = async (utilisateurs: any[], messages: any[] = [], automatiques: any[] = []) => {
    prisma.user.findMany.mockResolvedValue(utilisateurs);
    prisma.chatMessage.findMany.mockImplementation(async (args: any) =>
      args?.where?.text?.not === MESSAGE_AUTOMATIQUE ? messages : automatiques,
    );
    return service.getStatsQuotidiennes();
  };

  const compte = (opts: {
    id: string;
    creeLe: Date;
    sessions?: number;
    questionnaire?: boolean;
  }) => ({
    id: opts.id,
    first_name: 'Test',
    email: `${opts.id}@exemple.fr`,
    created_at: opts.creeLe,
    email_verifie_le: null,
    _count: { refresh_tokens: opts.sessions ?? 1 },
    ai_profile: (opts.questionnaire ?? true) ? { id: 'p' } : null,
  });

  beforeEach(async () => {
    prisma = {
      user: { findMany: jest.fn() },
      chatMessage: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuotidienService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<QuotidienService>(QuotidienService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Fige l'horloge à un instant UTC donné. */
  const maintenantEst = (isoUTC: string) => {
    jest.useFakeTimers().setSystemTime(new Date(isoUTC));
  };

  it("range une inscription de 00 h 30 à Paris dans la journée parisienne, pas dans la veille UTC", async () => {
    // 15 août 22 h 30 UTC = 16 août 00 h 30 à Paris (heure d'été, UTC+2).
    maintenantEst('2025-08-16T09:00:00Z');
    const stats = await avec([compte({ id: 'a', creeLe: new Date('2025-08-15T22:30:00Z') })]);

    expect(stats.aujourdhui.date).toBe('2025-08-16');
    expect(stats.aujourdhui.inscrits).toBe(1);
    expect(stats.hier?.inscrits).toBe(0);
  });

  it("compte comme « a parlé le jour même » un message du même jour local", async () => {
    maintenantEst('2025-08-16T09:00:00Z');
    const stats = await avec(
      [compte({ id: 'a', creeLe: new Date('2025-08-16T07:00:00Z') })],
      [{ user_id: 'a', created_at: new Date('2025-08-16T08:00:00Z') }],
    );

    expect(stats.aujourdhui.inscritsAyantParleAuCoach).toBe(1);
    expect(stats.inscritsDuJour[0].messagesAuCoach).toBe(1);
  });

  it("ne compte pas comme « a parlé le jour même » un message écrit le lendemain", async () => {
    maintenantEst('2025-08-16T09:00:00Z');
    const stats = await avec(
      [compte({ id: 'a', creeLe: new Date('2025-08-15T07:00:00Z') })],
      [{ user_id: 'a', created_at: new Date('2025-08-16T08:00:00Z') }],
    );

    // L'inscription est d'hier, le message d'aujourd'hui : la journée d'hier n'a
    // pas converti, même si la personne a fini par parler.
    expect(stats.hier?.inscrits).toBe(1);
    expect(stats.hier?.inscritsAyantParleAuCoach).toBe(0);
    // En revanche le coach a bien servi aujourd'hui, à quelqu'un d'inscrit avant.
    expect(stats.aujourdhui.ontParleAuCoach).toBe(1);
    expect(stats.aujourdhui.inscrits).toBe(0);
  });

  it("compte une personne une seule fois, quel que soit son nombre de messages", async () => {
    maintenantEst('2025-08-16T09:00:00Z');
    const stats = await avec(
      [compte({ id: 'a', creeLe: new Date('2025-08-16T07:00:00Z') })],
      [
        { user_id: 'a', created_at: new Date('2025-08-16T08:00:00Z') },
        { user_id: 'a', created_at: new Date('2025-08-16T08:05:00Z') },
        { user_id: 'a', created_at: new Date('2025-08-16T08:09:00Z') },
      ],
    );

    expect(stats.aujourdhui.ontParleAuCoach).toBe(1);
    expect(stats.aujourdhui.messages).toBe(3);
  });

  it('rend toujours quatorze journées, y compris celles sans personne', async () => {
    maintenantEst('2025-08-16T09:00:00Z');
    const stats = await avec([]);

    expect(stats.jours).toHaveLength(14);
    expect(stats.jours[0].date).toBe('2025-08-03');
    expect(stats.jours[13].date).toBe('2025-08-16');
    expect(stats.jours.every((j) => j.inscrits === 0)).toBe(true);
  });

  it("ne saute ni ne répète un jour autour du passage à l'heure d'hiver", async () => {
    // Le changement d'heure a lieu dans la nuit du 25 au 26 octobre 2025.
    maintenantEst('2025-10-28T09:00:00Z');
    const stats = await avec([]);

    const dates = stats.jours.map((j) => j.date);
    expect(new Set(dates).size).toBe(14);
    expect(dates).toContain('2025-10-25');
    expect(dates).toContain('2025-10-26');
    expect(dates).toContain('2025-10-27');
  });

  it("ne demande à la base que les messages écrits par la personne, pas les réponses du coach", async () => {
    maintenantEst('2025-08-16T09:00:00Z');
    await avec([]);

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sender: 'user' }),
      }),
    );
  });

  /**
   * La fin du questionnaire envoie un message au coach à la place de la personne,
   * pour qu'elle reçoive son plan sans avoir à le réclamer. Compté comme une
   * conversation, il affichait « 9 inscrits, 9 ont parlé au coach » : une
   * conversion parfaite et entièrement mécanique, sur un écran fait pour décider
   * quoi corriger.
   */
  describe('le message envoyé automatiquement par le questionnaire', () => {
    it('ne compte pas comme une conversation', async () => {
      maintenantEst('2025-08-16T09:00:00Z');
      const stats = await avec(
        [compte({ id: 'a', creeLe: new Date('2025-08-16T07:00:00Z') })],
        [],
        [{ user_id: 'a', created_at: new Date('2025-08-16T07:00:05Z') }],
      );

      expect(stats.aujourdhui.inscritsAyantParleAuCoach).toBe(0);
      expect(stats.aujourdhui.ontParleAuCoach).toBe(0);
      expect(stats.aujourdhui.messages).toBe(0);
      expect(stats.inscritsDuJour[0].messagesAuCoach).toBe(0);
    });

    it('est montré à part plutôt que caché', async () => {
      // L'exclure sans le dire remplacerait un chiffre trompeur par un chiffre
      // inexplicable : « 0 conversation » alors qu'on voit passer des échanges.
      maintenantEst('2025-08-16T09:00:00Z');
      const stats = await avec(
        [compte({ id: 'a', creeLe: new Date('2025-08-16T07:00:00Z') })],
        [],
        [{ user_id: 'a', created_at: new Date('2025-08-16T07:00:05Z') }],
      );

      expect(stats.aujourdhui.plansAutomatiques).toBe(1);
    });

    it("laisse compter le message que la personne écrit ensuite", async () => {
      maintenantEst('2025-08-16T09:00:00Z');
      const stats = await avec(
        [compte({ id: 'a', creeLe: new Date('2025-08-16T07:00:00Z') })],
        [{ user_id: 'a', created_at: new Date('2025-08-16T07:30:00Z') }],
        [{ user_id: 'a', created_at: new Date('2025-08-16T07:00:05Z') }],
      );

      expect(stats.aujourdhui.inscritsAyantParleAuCoach).toBe(1);
      expect(stats.aujourdhui.messages).toBe(1);
      expect(stats.aujourdhui.plansAutomatiques).toBe(1);
    });
  });
});
