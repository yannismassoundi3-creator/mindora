import { Test, TestingModule } from '@nestjs/testing';
import { AiQuotaService } from './ai-quota.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * La porte du Pro, côté serveur.
 *
 * `isSubscribed` est le seul endroit qui décide si le coach est illimité. Tant que
 * le webhook écrivait « ACTIVE » quoi qu'il arrive, il n'y avait qu'un statut à
 * connaître ; maintenant qu'il reporte l'état réel de Stripe, cette liste est ce qui
 * sépare un abonné en essai d'un compte gratuit — et un impayé d'un client à jour.
 */
describe('AiQuotaService — qui a droit au Pro', () => {
  let service: AiQuotaService;
  const findUnique = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiQuotaService,
        {
          provide: PrismaService,
          useValue: { subscription: { findUnique }, aiUsage: { count: jest.fn() } },
        },
      ],
    }).compile();

    service = module.get<AiQuotaService>(AiQuotaService);
  });

  it('ouvre le Pro à un abonnement actif', async () => {
    findUnique.mockResolvedValue({ status: 'ACTIVE' });
    await expect(service.isSubscribed('u1')).resolves.toBe(true);
  });

  it("ouvre le Pro pendant l'essai de 7 jours", async () => {
    // Le webhook écrit désormais TRIALING à la souscription. L'oublier ici couperait
    // le coach à chaque nouvel abonné pendant sa première semaine — celle qui décide
    // s'il garde l'abonnement.
    findUnique.mockResolvedValue({ status: 'TRIALING' });
    await expect(service.isSubscribed('u1')).resolves.toBe(true);
  });

  it('referme le Pro quand le paiement a échoué', async () => {
    // Le trou que tout ceci corrige : sans statut PAST_DUE écrit nulle part, un essai
    // terminé sur une carte refusée gardait le Pro indéfiniment.
    findUnique.mockResolvedValue({ status: 'PAST_DUE' });
    await expect(service.isSubscribed('u1')).resolves.toBe(false);
  });

  it('referme le Pro sur une résiliation', async () => {
    findUnique.mockResolvedValue({ status: 'CANCELED' });
    await expect(service.isSubscribed('u1')).resolves.toBe(false);
  });

  it("ne s'effondre pas sur un compte qui n'a jamais payé", async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.isSubscribed('u1')).resolves.toBe(false);
  });
});
