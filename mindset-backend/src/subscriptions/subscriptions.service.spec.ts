import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

const mockCreerSession = jest.fn();
const mockCreerPortail = jest.fn();

// `import Stripe from 'stripe'` se compile en `stripe_1.default` : le mock doit
// exposer la classe sous `default`, pas à la racine du module.
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockCreerSession } },
    billingPortal: { sessions: { create: mockCreerPortail } },
    webhooks: { constructEvent: jest.fn() },
  })),
}));

/**
 * Le chemin de l'argent. Trois défauts s'y trouvaient, tous invisibles tant qu'on ne
 * regarde pas les adresses produites : une formule non validée partait quand même
 * chez Stripe, la barre finale de FRONTEND_URL renvoyait les acheteurs sur une URL
 * cassée après paiement, et le repli de développement pouvait annoncer un achat
 * réussi en production si la clé Stripe venait à manquer.
 */
describe('SubscriptionsService — création du paiement', () => {
  let service: SubscriptionsService;
  const envInitial = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreerSession.mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    process.env.STRIPE_SECRET_KEY = 'sk_live_vraie';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', email: 'y@example.com' }) } },
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...envInitial };
  });

  it('refuse une formule inconnue sans appeler Stripe', async () => {
    // priceId restait vide et la requête partait quand même : Stripe renvoyait une
    // erreur technique, recopiée telle quelle à l'utilisateur.
    await expect(service.createCheckoutSession('u1', 'gratuit')).rejects.toThrow(BadRequestException);
    expect(mockCreerSession).not.toHaveBeenCalled();
  });

  it('tolère une barre finale dans FRONTEND_URL', async () => {
    process.env.FRONTEND_URL = 'https://exemple.test/';

    await service.createCheckoutSession('u1', 'monthly');

    // Sans le nettoyage, l'acheteur atterrissait sur « //?success=true » au retour.
    const args = mockCreerSession.mock.calls[0][0];
    expect(args.success_url).toBe('https://exemple.test/?success=true');
    expect(args.cancel_url).toBe('https://exemple.test/?canceled=true');
  });

  it('rattache la session au compte, seul lien lu par le webhook', async () => {
    await service.createCheckoutSession('u1', 'lifetime');

    const args = mockCreerSession.mock.calls[0][0];
    // Sans client_reference_id, le webhook ne sait pas qui vient de payer.
    expect(args.client_reference_id).toBe('u1');
    expect(args.mode).toBe('payment');
  });

  it("n'annonce jamais un achat réussi en production quand Stripe échoue", async () => {
    // Le constructeur retombe sur « sk_test_mock » si la variable manque : une clé
    // oubliée en production suffisait à renvoyer tout le monde sur une page de succès
    // sans le moindre paiement.
    process.env.NODE_ENV = 'production';
    delete process.env.STRIPE_SECRET_KEY;
    mockCreerSession.mockRejectedValue(new Error('clé invalide'));

    await expect(service.createCheckoutSession('u1', 'monthly')).rejects.toThrow(BadRequestException);
  });

  it('garde le repli de développement hors production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.STRIPE_SECRET_KEY;
    process.env.FRONTEND_URL = 'http://localhost:3001';
    mockCreerSession.mockRejectedValue(new Error('pas de clé'));

    const resultat = await service.createCheckoutSession('u1', 'monthly');

    expect(resultat.checkoutUrl).toBe('http://localhost:3001/?success=true&mock=true');
  });
});
