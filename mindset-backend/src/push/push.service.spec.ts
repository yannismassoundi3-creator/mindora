import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PushService } from './push.service';
import { MorningBriefService } from './morning-brief.service';
import { WeeklyReviewService } from './weekly-review.service';
import { CoupDePouceService } from './coup-de-pouce.service';
import { BilanHebdoService } from './bilan-hebdo.service';
import { AnalyseHabitudesService } from './analyse-habitudes.service';
import { PrismaService } from '../prisma/prisma.service';
import { RappelService } from '../ai-coaching/rappel.service';

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
        {
          provide: RappelService,
          // Les rappels ont leur propre suite : ici on veut seulement que le
          // module se construise, et qu aucun rappel ne soit pose.
          useValue: {
            poser: jest.fn().mockResolvedValue([]),
            dus: jest.fn().mockResolvedValue([]),
            marquerEnvoye: jest.fn(),
            abandonnerLesPerimes: jest.fn().mockResolvedValue(0),
          },
        },
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
        AnalyseHabitudesService,
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

  /*
    L'heure du brief, choisie par la personne.

    Le brief partait à 10 h pour tout le monde : trop tard pour qui se lève à 6 h,
    et l'app ne pouvait donc pas « inciter à se lever ». L'avancer pour tous était
    exclu — une notification à 7 h chez quelqu'un qui dort fait couper les
    notifications, et un refus du navigateur ne se redemande jamais.

    Les deux points vérifiés ici sont ceux qui se paieraient sur tout le monde à la
    fois : le fuseau, et le sort de ceux qui n'ont rien réglé.
  */
  describe('le créneau du brief', () => {
    it('lit l’heure de Paris, pas celle du serveur', () => {
      /*
        Render tourne en UTC. Comparé à une heure locale sans conversion, le brief
        serait parti avec deux heures de décalage en été, tous les jours, sans rien
        signaler — le même piège que les rappels datés, mais subi par tous.
      */
      expect(PushService.creneauCourant(new Date('2026-08-18T05:10:00Z'))).toBe('07:00');
      expect(PushService.creneauCourant(new Date('2026-12-18T06:40:00Z'))).toBe('07:30');
    });

    it('sert à 10 h ceux qui n’ont rien réglé', () => {
      // Personne n'a à répondre à une question pour continuer à recevoir ce qu'il
      // recevait déjà. C'est ce qui rend ce changement sûr à déployer.
      expect(PushService.dansLeCreneau(null, '10:00')).toBe(true);
      expect(PushService.dansLeCreneau(undefined, '07:00')).toBe(false);
    });

    it('arrondit vers le bas au lieu d’exiger l’heure pile', () => {
      // Quelqu'un qui règle 7 h 15 ne recevrait jamais rien avec une égalité
      // stricte, et il n'aurait aucun moyen de le deviner.
      expect(PushService.dansLeCreneau('07:15', '07:00')).toBe(true);
      expect(PushService.dansLeCreneau('07:45', '07:30')).toBe(true);
      expect(PushService.dansLeCreneau('07:45', '07:00')).toBe(false);
    });

    it('retombe sur le défaut quand la valeur est abîmée', () => {
      // Une valeur illisible ne doit ni priver quelqu'un de son brief, ni le lui
      // envoyer à une heure inventée.
      for (const abime of ['25:00', 'sept heures', '7h', '']) {
        expect(PushService.dansLeCreneau(abime, '10:00')).toBe(true);
      }
    });

    it('ne sert que le créneau demandé', async () => {
      prisma.user.findMany.mockResolvedValue([
        { ...compteActif('tot'), ai_profile: { reveil: '07:00' } },
        { ...compteActif('tard'), ai_profile: { reveil: null } },
      ]);
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);

      const resume = await service.sendMorningBriefs('test', '07:00');

      expect(resume.comptesExamines).toBe(1);
    });
  });

  /*
    La tournée des rappels.

    C'est la seule tâche dont l'heure est choisie par la personne : elle a dit
    « 22 h 30 », elle attend 22 h 30. Et c'est la seule dont l'échec est
    strictement invisible — pas d'erreur, pas de trace à l'écran, juste un
    téléphone qui ne sonne pas chez quelqu'un qui comptait dessus. D'où le seul
    point vérifié ici, qui est aussi le seul qui coûte : **on ne marque jamais
    envoyé ce qui n'est pas parti.**
  */
  describe('les rappels', () => {
    let rappels: any;

    beforeEach(() => {
      rappels = (service as any).rappels;
      rappels.dus.mockResolvedValue([{ id: 'r1', user_id: 'u1', texte: 'Commence le livre', quand: new Date() }]);
    });

    it('remet le rappel et ne le marque qu’ensuite', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);

      const bilan: any = await service.envoyerRappels();

      const charge = JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);
      expect(charge.body).toBe('Commence le livre');
      expect(rappels.marquerEnvoye).toHaveBeenCalledWith('r1');
      expect(bilan.envoyes).toBe(1);
    });

    it('laisse la ligne ouverte quand personne n’est joignable', async () => {
      /*
        Un téléphone éteint cinq minutes ne doit pas coûter le rappel : la
        tournée suivante réessaiera, jusqu'à la borne de retard. Marquer envoyé
        ici condamnerait la personne au silence en donnant à croire que c'est
        parti — la panne exacte qu'on répare.
      */
      prisma.pushSubscription.findMany.mockResolvedValue([]);

      const bilan: any = await service.envoyerRappels();

      expect(rappels.marquerEnvoye).not.toHaveBeenCalled();
      expect(bilan.envoyes).toBe(0);
    });

    it('ferme les rappels trop en retard avant d’envoyer', async () => {
      // Sinon ils restent éligibles pour toujours et sonnent un mardi matin sans
      // que rien n'explique pourquoi.
      await service.envoyerRappels();
      expect(rappels.abandonnerLesPerimes).toHaveBeenCalled();
    });
  });

  /*
    Ce que le coach dit à quelqu'un qui a **réussi** sa journée.

    Toutes les branches du soir partaient d'un échec — score à zéro, jours
    manqués. Une journée bouclée ne déclenchait donc rien du tout, et celle de
    18 h allait jusqu'à dire « il te reste la soirée pour finir » à quelqu'un dont
    le titre affichait 100 %. Un produit qui ne parle qu'aux échecs apprend qu'on
    ne le regarde pas.
  */
  describe('quand la journée est finie', () => {
    const jour = (n: number) =>
      new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

    const avecRoutines = (id: string, routines: any, scores: Record<string, number> = {}) => ({
      id,
      push_subscriptions: [{ id: 's1' }],
      sync_data: { daily_scores: scores, routines },
    });

    const charge = () => JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);

    beforeEach(() => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);
    });

    it('ne dit plus « il te reste la soirée » à 18 h à celui qui a tout coché', async () => {
      prisma.user.findMany.mockResolvedValue([
        avecRoutines('u1', [{ items: [{ title: 'Sport', done: true }] }], { [jour(0)]: 100 }),
      ]);

      await service.sendBulkReminders('Check-in de 18h 🎯', 'Il te reste la soirée pour finir.', true);

      expect(charge().body).not.toContain('reste la soirée');
      expect(charge().body).toContain('Tout est coché');
    });

    it('garde le rappel de 18 h pour celui à qui il reste quelque chose', async () => {
      prisma.user.findMany.mockResolvedValue([
        avecRoutines('u1', [{ items: [{ title: 'Sport', done: true }, { title: 'Lire' }] }]),
      ]);

      await service.sendBulkReminders('Check-in de 18h 🎯', 'Il te reste la soirée pour finir.', true);

      expect(charge().body).toContain('reste la soirée');
    });

    it('félicite à 20 h, et compte la journée en cours dans la série', async () => {
      // `computeStreak` repart d'hier : la journée qu'on félicite n'y est pas
      // encore. Annoncer 4 au lieu de 5 ferait dire au coach un chiffre que la
      // personne peut compter elle-même — et donc contredire.
      morningBrief.computeStreak.mockReturnValue(4);
      prisma.user.findMany.mockResolvedValue([
        avecRoutines('u1', [{ items: [{ title: 'Sport', done: true }] }], { [jour(0)]: 100, [jour(1)]: 80 }),
      ]);

      await service.checkStreaksAndWarn(20);

      expect(charge().body).toContain('5 jours');
    });

    it('ne félicite pas une journée vide', async () => {
      // Rien à cocher n'est pas une réussite. Féliciter ici apprendrait que le
      // message part tout seul, ce qui dévalue tous les autres.
      // Un score aujourd'hui, pour ne pas retomber dans la branche des quatre
      // jours manqués : ce qu'on teste ici est l'absence de tâches, pas l'absence
      // d'activité.
      prisma.user.findMany.mockResolvedValue([avecRoutines('u1', [], { [jour(0)]: 50 })]);

      await service.checkStreaksAndWarn(20);

      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });
  });

  /*
    L'urgence était annoncée le soir où elle n'existe plus, et tue le soir où elle
    existe. `missedDays === 2` veut dire « rien aujourd'hui et rien hier » : la
    série est morte la veille au soir, et « elle va disparaître à minuit » y était
    faux.
  */
  describe('la série à 22 h', () => {
    const jour = (n: number) =>
      new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

    const charge = () => JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);

    beforeEach(() => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      ]);
    });

    it('nomme la série le soir où elle meurt vraiment', async () => {
      morningBrief.computeStreak.mockReturnValue(7);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          push_subscriptions: [{ id: 's1' }],
          // Rien aujourd'hui, quelque chose hier : c'est cette nuit qu'elle tombe.
          sync_data: { daily_scores: { [jour(1)]: 90 }, routines: [] },
        },
      ]);

      await service.checkStreaksAndWarn(22);

      expect(charge().body).toContain('7 jours');
      expect(charge().body).toContain('minuit');
    });

    it('ne prétend plus sauver une série déjà perdue', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          push_subscriptions: [{ id: 's1' }],
          // Rien aujourd'hui ni hier : elle est tombée la veille.
          sync_data: { daily_scores: { [jour(2)]: 90 }, routines: [] },
        },
      ]);

      await service.checkStreaksAndWarn(22);

      expect(charge().body).not.toContain('minuit');
      expect(charge().title).not.toContain('URGENCE');
      expect(charge().body).toContain('Deux jours');
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

/**
 * Le coup de pouce affiché dans l'application.
 *
 * Le moteur ne voyageait que par notification : quelqu'un qui ne les active pas
 * ne l'avait jamais vu. Ce qui se vérifie ici n'est pas qu'il répond, mais qu'il
 * garde la seule règle qui compte — se taire sans fait à citer — tout en laissant
 * tomber la cadence de trois jours, qui protégeait d'une intrusion que la page
 * ne commet pas.
 */
describe('PushService — coup de pouce affiché', () => {
  const JOUR = 86400000;
  const cle = (recul: number) => new Date(Date.now() - recul * JOUR).toISOString().slice(0, 10);

  it("ne dit rien quand il n'y a aucun fait à citer", async () => {
    const coupDePouce = new CoupDePouceService();
    const situation = coupDePouce.situation({
      dailyScores: { [cle(0)]: 40 },
      routines: [],
      objectifs: [],
      dernierCoupDePouce: null,
      derniereSynchro: new Date(),
    });

    // Journée déjà active, plus rien devant : se taire est le comportement normal.
    expect(situation).toBeNull();
  });

  it('ignore le délai de trois jours, qui ne protège que les notifications', () => {
    const coupDePouce = new CoupDePouceService();
    const etat = {
      dailyScores: { [cle(3)]: 50, [cle(4)]: 50, [cle(5)]: 50 },
      routines: [],
      objectifs: [],
      derniereSynchro: new Date(),
    };

    // Envoyé il y a une heure : la notification se tairait.
    const pourNotification = coupDePouce.situation({
      ...etat,
      dernierCoupDePouce: new Date(Date.now() - 3600000),
    });
    expect(pourNotification).toBeNull();

    // La carte, elle, doit parler : elle n'interrompt personne.
    const pourAffichage = coupDePouce.situation({ ...etat, dernierCoupDePouce: null });
    expect(pourAffichage?.raison).toBe('reprise');
  });
});
