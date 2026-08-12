import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PushService } from './push.service';
import { MorningBriefService } from './morning-brief.service';
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
  let morningBrief: { isActive: jest.Mock; generate: jest.Mock };
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
      },
    };
    morningBrief = { isActive: jest.fn().mockReturnValue(true), generate: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: prisma },
        { provide: MorningBriefService, useValue: morningBrief },
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

  describe('lien ouvert au clic', () => {
    it('suit FRONTEND_URL et tolère la barre finale', async () => {
      process.env.FRONTEND_URL = 'https://exemple.test/';
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
      expect(charge.url).toBe('https://exemple.test/?auth=true');
    });
  });
});
