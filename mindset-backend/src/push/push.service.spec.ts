import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PushService } from './push.service';
import { MorningBriefService } from './morning-brief.service';
import { WeeklyReviewService } from './weekly-review.service';
import { CoupDePouceService } from './coup-de-pouce.service';
import { BilanHebdoService } from './bilan-hebdo.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({}),
}));

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ce qui mérite d'être verrouillé ici tient en trois points, tous invisibles à la
 * lecture d'une réponse HTTP :
 *
 * 1. la tournée ne doit jamais se dédoubler — deux tournées simultanées, c'est deux
 *    notifications par personne et deux fois le quota du fournisseur consommé ;
 * 2. le déclencheur manuel doit rendre la main avant la fin de l'envoi, sinon la
 *    requête expire à partir d'une quarantaine de comptes actifs ;
 * 3. un échec global ne doit ni faire tomber le process, ni disparaître sans trace.
 */
describe('PushService — tournée des briefs du matin', () => {
  let service: PushService;
  let prisma: any;
  let morningBrief: { isActive: jest.Mock; generate: jest.Mock; computeStreak: jest.Mock };
  let bilanHebdo: { lecture: jest.Mock };
  const frontendUrlInitiale = process.env.FRONTEND_URL;

  const compteActif = (id: string) => ({
    id,
    first_name: 'Yannis',
    push_subscriptions: [{ id: `s-${id}` }],
    sync_data: { updated_at: new Date() },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Les tâches planifiées journalisent beaucoup ; on garde la sortie des tests lisible.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      pushPermission: {
        upsert: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    bilanHebdo = { lecture: jest.fn().mockResolvedValue(null) };
    morningBrief = {
      isActive: jest.fn().mockReturnValue(true),
      generate: jest.fn().mockResolvedValue(null),
      // Sert au titre des notifications du soir, qui portent la jauge du jour.
      computeStreak: jest.fn().mockReturnValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: prisma },
        { provide: MorningBriefService, useValue: morningBrief },
        // Le bilan hebdomadaire ne concerne aucun de ces tests, mais le service en
        // dépend depuis qu'il ne raconte plus la même chose à tout le monde.
        { provide: WeeklyReviewService, useValue: new WeeklyReviewService() },
        // Idem pour le coup de pouce : sa logique est vérifiée dans son propre
        // fichier. Le vrai service convient ici — sans clé Groq il retombe sur la
        // phrase factuelle, et sans données il ne trouve rien à dire.
        { provide: CoupDePouceService, useValue: new CoupDePouceService() },
        // Le cache de la lecture hebdomadaire a ses propres tests ; ici on vérifie
        // seulement que la tournée l'appelle au bon moment et pour les bons comptes.
        { provide: BilanHebdoService, useValue: bilanHebdo },
      ],
    }).compile();

    service = module.get<PushService>(PushService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (frontendUrlInitiale === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = frontendUrlInitiale;
  });

  describe('garde anti-chevauchement', () => {
    it("raccroche un second appel à la tournée en vol au lieu d'en lancer une seconde", async () => {
      prisma.user.findMany.mockImplementation(async () => {
        await attendre(30);
        return [compteActif('u1')];
      });

      // Le cas réel : le cron de 10h tourne encore quand quelqu'un rejoue la tâche.
      const [parLeCron, parLaRoute] = await Promise.all([
        service.sendMorningBriefs('cron'),
        service.sendMorningBriefs('manuel'),
      ]);

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      // Même objet : le second appelant lit le résultat du premier, il n'en produit pas.
      expect(parLaRoute).toBe(parLeCron);
    });

    it('signale au déclencheur manuel que rien de neuf n’a été lancé', async () => {
      prisma.user.findMany.mockImplementation(async () => {
        await attendre(30);
        return [];
      });

      const premier = service.declencherTourneeBriefs('manuel:u1');
      const second = service.declencherTourneeBriefs('manuel:u1');

      expect(premier.demarre).toBe(true);
      expect(second.demarre).toBe(false);
      expect(second.dejaEnCours).toBe(true);

      await attendre(60);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    });

    it('accepte une nouvelle tournée une fois la précédente terminée', async () => {
      await service.sendMorningBriefs('cron');
      await service.sendMorningBriefs('manuel');

      expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('déclenchement en arrière-plan', () => {
    it('rend la main avant la fin de la tournée', async () => {
      let tourneeFinie = false;
      prisma.user.findMany.mockImplementation(async () => {
        await attendre(50);
        tourneeFinie = true;
        return [];
      });

      const reponse = service.declencherTourneeBriefs('manuel:u1');

      // C'est tout l'objet du changement : la réponse part maintenant, pas dans quatre
      // minutes. Si cette assertion tombe, la route est redevenue bloquante.
      expect(reponse.demarre).toBe(true);
      expect(tourneeFinie).toBe(false);
      expect(service.etatTournee().enCours).toBe(true);

      await attendre(80);
      expect(service.etatTournee().enCours).toBe(false);
    });

    it('conserve le décompte de la dernière tournée, cron compris', async () => {
      prisma.user.findMany.mockResolvedValue([compteActif('u1')]);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        first_name: 'Yannis',
        sync_data: { updated_at: new Date() },
      });

      await service.sendMorningBriefs('cron');
      const etat = service.etatTournee();

      expect(etat.enCours).toBe(false);
      expect(etat.derniereTournee?.declencheur).toBe('cron');
      expect(etat.derniereTournee?.erreur).toBeNull();
      // Aucun appareil abonné et pas de texte IA : un générique tenté, zéro dormant.
      expect(etat.derniereTournee?.resume).toMatchObject({
        comptesExamines: 1,
        generiques: 1,
        dormantsIgnores: 0,
        echecs: 0,
      });
    });

    it('ignore les comptes dormants sans payer un appel IA', async () => {
      prisma.user.findMany.mockResolvedValue([compteActif('u1')]);
      morningBrief.isActive.mockReturnValue(false);

      const resume = await service.sendMorningBriefs('cron');

      expect(resume.dormantsIgnores).toBe(1);
      expect(morningBrief.generate).not.toHaveBeenCalled();
    });

    it('enregistre un échec global au lieu de le perdre, sans faire tomber le process', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('base injoignable'));

      // Personne n'attend cette promesse : sans le catch du déclencheur, Node abattrait
      // le process sur le rejet non traité.
      service.declencherTourneeBriefs('manuel:u1');
      await attendre(20);

      const etat = service.etatTournee();
      expect(etat.enCours).toBe(false);
      expect(etat.derniereTournee?.erreur).toBe('base injoignable');
      expect(etat.derniereTournee?.resume).toBeNull();
    });
  });

  describe('mesure des permissions', () => {
    it('enregistre une réponse par appareil, sans écraser les autres', async () => {
      await service.enregistrerPermission('u1', 'refuse', 'appareil-A', 'Mozilla/5.0 Firefox');

      // La même personne peut refuser sur son ordinateur et accepter sur son
      // téléphone : c'est une information, pas un conflit à arbitrer.
      expect(prisma.pushPermission.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id_device_id: { user_id: 'u1', device_id: 'appareil-A' } },
          create: expect.objectContaining({ etat: 'refuse', device_id: 'appareil-A' }),
          update: expect.objectContaining({ etat: 'refuse' }),
        }),
      );
    });

    it('refuse un état inventé plutôt que de polluer la mesure', async () => {
      await expect(service.enregistrerPermission('u1', 'peut-etre', 'appareil-A')).rejects.toThrow(
        /peut-etre/,
      );
      expect(prisma.pushPermission.upsert).not.toHaveBeenCalled();
    });

    it('distingue ceux qui refusent de ceux à qui on n’a jamais demandé', async () => {
      prisma.user.count = jest.fn().mockResolvedValue(28);
      prisma.pushSubscription.count.mockResolvedValue(2);
      prisma.pushSubscription.findMany.mockResolvedValue([{ user_id: 'u1' }, { user_id: 'u2' }]);
      prisma.pushPermission.groupBy.mockResolvedValue([
        { etat: 'accorde', _count: { _all: 2 } },
        { etat: 'refuse', _count: { _all: 3 } },
      ]);
      prisma.pushPermission.findMany.mockResolvedValue([
        { user_id: 'u1' },
        { user_id: 'u2' },
        { user_id: 'u3' },
      ]);

      const stats = await service.statistiquesPermissions();

      expect(stats).toMatchObject({
        comptes: 28,
        comptesJoignables: 2,
        appareilsAbonnes: 2,
        etats: { accorde: 2, refuse: 3 },
      });
      // 25 comptes n'ont jamais répondu : c'est un défaut d'interface, pas un choix
      // des utilisateurs, et les deux appelaient des corrections opposées.
      expect(stats.comptesSansReponse).toBe(25);
    });
  });

  describe('lien ouvert au clic', () => {
    it('suit FRONTEND_URL et tolère la barre finale', async () => {
      process.env.FRONTEND_URL = 'https://disciplix-ai.vercel.app/';
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        first_name: 'Yannis',
        sync_data: { updated_at: new Date() },
      });
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);

      await service.sendMorningBriefTo('u1');

      const charge = JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);
      // Cette adresse était écrite en dur, seule rescapée du passage des autres
      // notifications par lienApp() : un changement de domaine l'aurait oubliée.
      expect(charge.url).toBe('https://disciplix-ai.vercel.app/?auth=true&vue=dashboard');
    });

    it('ignore une FRONTEND_URL qui ne désigne pas notre application', async () => {
      // Le cas réel : la variable pointait sur un « …-dashboard.onrender.com » qui
      // n'existe pas. Les sept notifications partaient quand même, et chaque clic
      // tombait sur « Not Found ». Une notification qui n'ouvre rien est pire que pas
      // de notification, et rien dans les logs ne le signale.
      process.env.FRONTEND_URL = 'https://mindset-dashboard.onrender.com';
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        first_name: 'Yannis',
        sync_data: { updated_at: new Date() },
      });
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);

      await service.sendMorningBriefTo('u1');

      const charge = JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);
      expect(charge.url).toBe('https://disciplix-ai.vercel.app/?auth=true&vue=dashboard');
    });

    it("envoie vers le chat la notification qui demande d'ouvrir le chat", async () => {
      process.env.FRONTEND_URL = 'https://disciplix-ai.vercel.app';
      // Quatre jours sans le moindre score : c'est le cas qui déclenche le message
      // « Ouvre le Chat IA pour réduire la difficulté de tes objectifs ».
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          push_subscriptions: [{ id: 's1' }],
          sync_data: { daily_scores: {} },
        },
      ]);
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);

      await service.checkStreaksAndWarn(20);

      const charge = JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);
      expect(charge.title).toContain('Stratégie');
      // Le corps promet le Chat IA ; l'adresse doit y mener, sinon la notification
      // ouvre l'accueil et la promesse tombe à plat.
      expect(charge.url).toBe('https://disciplix-ai.vercel.app/?auth=true&vue=chat');
    });
  });

  /**
   * Le bilan du dimanche soir prépare la lecture longue des abonnés.
   *
   * La notification qu'il envoie est précisément ce qui ramène les gens dans
   * l'application : calculer la lecture à leur arrivée leur ferait attendre un
   * aller-retour vers le modèle au moment le plus mal choisi.
   */
  describe('bilan hebdomadaire', () => {
    const compteAvecSemaine = (id: string, abonne: boolean) => {
      const scores: Record<string, number> = {};
      for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() - i * 86400000);
        scores[d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })] = 70;
      }
      return {
        id,
        first_name: 'Yannis',
        push_subscriptions: [{ id: `s-${id}` }],
        sync_data: { daily_scores: scores, habits: [] },
        subscription: abonne ? { status: 'ACTIVE' } : null,
      };
    };

    beforeEach(() => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);
    });

    it("prépare la lecture d'un abonné après avoir envoyé sa notification", async () => {
      prisma.user.findMany.mockResolvedValue([compteAvecSemaine('u1', true)]);
      bilanHebdo.lecture.mockResolvedValue('Ta semaine tient.');

      const r: any = await service.sendWeeklyReports();

      expect(r.lecturesPreparees).toBe(1);
      // Après l'envoi, jamais avant : un échec de génération ne doit pas empêcher
      // la notification de partir, c'est elle qui compte le plus.
      expect(bilanHebdo.lecture.mock.invocationCallOrder[0]).toBeGreaterThan(
        (webpush.sendNotification as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it("ne prépare rien pour un compte gratuit", async () => {
      prisma.user.findMany.mockResolvedValue([compteAvecSemaine('u1', false)]);

      const r: any = await service.sendWeeklyReports();

      // La lecture est l'avantage de l'abonnement : la calculer pour tout le monde
      // coûterait un appel au modèle par compte pour un texte jamais montré.
      expect(bilanHebdo.lecture).not.toHaveBeenCalled();
      expect(r.envoyes).toBe(1);
    });

    it("envoie quand même la notification si la lecture échoue", async () => {
      prisma.user.findMany.mockResolvedValue([compteAvecSemaine('u1', true)]);
      bilanHebdo.lecture.mockRejectedValue(new Error('modèle injoignable'));

      const r: any = await service.sendWeeklyReports();

      expect(r.envoyes).toBe(1);
      expect(r.lecturesPreparees).toBe(0);
      expect(webpush.sendNotification).toHaveBeenCalled();
    });
  });

  /**
   * La tournée de 15 h. Ce qui compte ici n'est pas le texte envoyé — il a son
   * propre fichier — mais la trace laissée derrière : c'est elle qui empêche la
   * même personne de recevoir un coup de pouce tous les jours.
   */
  describe('tournée des coups de pouce', () => {
    /** Un compte parti depuis trois jours : le cas « reprise ». */
    const compteDecroche = (id: string) => {
      const scores: Record<string, number> = {};
      for (const recul of [3, 4, 5]) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - recul);
        scores[d.toISOString().slice(0, 10)] = 50;
      }
      return {
        id,
        first_name: 'Yannis',
        push_subscriptions: [{ id: `s-${id}` }],
        sync_data: { daily_scores: scores, updated_at: new Date(), routines: null, micro_objectives: null },
        coup_de_pouce: null,
      };
    };

    beforeEach(() => {
      prisma.coupDePouce = { upsert: jest.fn().mockResolvedValue({}) };
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);
    });

    it('note la date du dernier envoi pour tenir le délai de trois jours', async () => {
      prisma.user.findMany.mockResolvedValue([compteDecroche('u1')]);

      const resume = await service.envoyerCoupsDePouce();

      expect(resume.envoyes).toBe(1);
      expect(prisma.coupDePouce.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'u1' } }),
      );
    });

    it("n'écrit aucune trace quand la notification n'a atteint aucun appareil", async () => {
      // Sinon un échec réseau consommerait le quota de trois jours : le coach se
      // tairait jusqu'à jeudi pour un message que personne n'a reçu.
      prisma.user.findMany.mockResolvedValue([compteDecroche('u1')]);
      prisma.pushSubscription.findMany.mockResolvedValue([]);

      const resume = await service.envoyerCoupsDePouce();

      expect(resume.envoyes).toBe(0);
      expect(prisma.coupDePouce.upsert).not.toHaveBeenCalled();
    });

    it("compte comme « rien à dire » un compte que rien ne justifie de relancer", async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          first_name: 'Yannis',
          push_subscriptions: [{ id: 's1' }],
          sync_data: { daily_scores: {}, updated_at: new Date() },
          coup_de_pouce: null,
        },
      ]);

      const resume = await service.envoyerCoupsDePouce();

      expect(resume.envoyes).toBe(0);
      expect(resume.riensADire).toBe(1);
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('ouvre le chat pour une reprise', async () => {
      process.env.FRONTEND_URL = 'https://disciplix-ai.vercel.app';
      prisma.user.findMany.mockResolvedValue([compteDecroche('u1')]);

      await service.envoyerCoupsDePouce();

      const charge = JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);
      expect(charge.url).toBe('https://disciplix-ai.vercel.app/?auth=true&vue=chat');
    });
  });
});
