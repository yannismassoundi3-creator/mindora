import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

const mockCreerSession = jest.fn();
const mockCreerPortail = jest.fn();
const mockConstruireEvenement = jest.fn();

// `import Stripe from 'stripe'` se compile en `stripe_1.default` : le mock doit
// exposer la classe sous `default`, pas à la racine du module.
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockCreerSession } },
    billingPortal: { sessions: { create: mockCreerPortail } },
    webhooks: { constructEvent: mockConstruireEvenement },
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

  it("ne recopie jamais le message de Stripe à l'acheteur", async () => {
    process.env.NODE_ENV = 'production';
    mockCreerSession.mockRejectedValue(new Error('Invalid API Key provided: sk_test_51ABC'));

    // Ce message partait tel quel dans la réponse HTTP : il exposait la configuration
    // du serveur, et n'apprenait rien à la personne qui essayait de payer.
    await expect(service.createCheckoutSession('u1', 'monthly')).rejects.toThrow(
      /réessaie dans un moment/,
    );
    await expect(service.createCheckoutSession('u1', 'monthly')).rejects.not.toThrow(/sk_test/);
  });

  it("nomme la variable manquante quand la formule n'a pas d'identifiant de prix", async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STRIPE_PRICE_MONTHLY;
    mockCreerSession.mockRejectedValue(new Error('No such price: price_mock_monthly'));

    await expect(service.createCheckoutSession('u1', 'monthly')).rejects.toThrow(BadRequestException);

    // Sans cette trace, une variable oubliée sur l'hébergeur ressemble à une panne de
    // Stripe : on cherche des heures du côté du paiement.
    const traces = (console.error as jest.Mock).mock.calls.flat().join(' ');
    expect(traces).toContain('STRIPE_PRICE_MONTHLY');
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

/**
 * Ce qui arrive à un abonnement APRÈS l'achat — et que personne n'écoutait.
 *
 * Le webhook ne traitait que l'encaissement initial et la résiliation définitive.
 * Rien n'écrivait jamais PAST_DUE ni TRIALING, pourtant présents dans l'enum. À la
 * fin de l'essai de 7 jours, une carte refusée laissait donc le compte « ACTIVE »,
 * c'est-à-dire le Pro gratuit pour une durée indéterminée.
 */
describe('SubscriptionsService — cycle de vie de l’abonnement', () => {
  let service: SubscriptionsService;
  const updateMany = jest.fn();

  const abonnement = (extra: Record<string, any>) => ({
    id: 'sub_123',
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    ...extra,
  });

  const envoyer = (type: string, objet: any) => {
    mockConstruireEvenement.mockReturnValue({ type, data: { object: objet } });
    return service.handleWebhook('sig', Buffer.from('{}'));
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn(), update: jest.fn() },
            subscription: { updateMany, upsert: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('coupe le Pro quand le paiement échoue à la fin de l’essai', async () => {
    // Le cas qui coûtait de l'argent : l'essai se termine, la carte est refusée,
    // et le compte restait ACTIVE puisque seul « deleted » était écouté.
    await envoyer('customer.subscription.updated', abonnement({ status: 'past_due' }));

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripe_sub_id: 'sub_123' },
        data: expect.objectContaining({ status: 'PAST_DUE' }),
      }),
    );
  });

  it('rend le Pro dès qu’une relance aboutit', async () => {
    await envoyer('customer.subscription.updated', abonnement({ status: 'active' }));

    expect(updateMany.mock.calls[0][0].data.status).toBe('ACTIVE');
  });

  it('marque l’essai comme tel plutôt que comme un abonnement payé', async () => {
    await envoyer('customer.subscription.created', abonnement({ status: 'trialing' }));

    expect(updateMany.mock.calls[0][0].data.status).toBe('TRIALING');
  });

  it('enregistre la résiliation programmée et les dates de période', async () => {
    // Trois colonnes existaient dans le schéma sans que rien ne les remplisse.
    await envoyer('customer.subscription.updated', abonnement({ cancel_at_period_end: true }));

    const data = updateMany.mock.calls[0][0].data;
    expect(data.cancel_at_period_end).toBe(true);
    expect(data.current_period_end).toEqual(new Date(1_702_592_000 * 1000));
  });

  it('traduit une résiliation définitive en CANCELED', async () => {
    await envoyer('customer.subscription.deleted', abonnement({ status: 'canceled' }));

    expect(updateMany.mock.calls[0][0].data.status).toBe('CANCELED');
  });

  it('n’écrit rien sur un statut Stripe inconnu', async () => {
    // Stripe ajoute des statuts au fil du temps ; en écraser un par défaut
    // reviendrait à couper l'accès de quelqu'un sur un mot qu'on ne comprend pas.
    await envoyer('customer.subscription.updated', abonnement({ status: 'quelque_chose_de_neuf' }));

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('répond sans erreur quand l’abonnement est inconnu en base', async () => {
    // Stripe ne garantit pas l'ordre des événements : celui-ci peut précéder le
    // checkout qui crée la ligne. Une exception ferait répondre 500, et Stripe
    // rejouerait l'événement pendant trois jours en croyant à une panne.
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      envoyer('customer.subscription.updated', abonnement({ status: 'past_due' })),
    ).resolves.toEqual({ received: true });
  });

  it('ne touche jamais à un achat à vie lors de la résiliation d’un mensuel', async () => {
    // Un achat « à vie » est un paiement unique : il n'a pas de stripe_sub_id. Si la
    // correspondance se faisait sur le client plutôt que sur l'abonnement, résilier un
    // ancien mensuel annulerait l'accès définitif du même acheteur.
    await envoyer('customer.subscription.deleted', abonnement({ status: 'canceled' }));

    expect(updateMany.mock.calls[0][0].where).toEqual({ stripe_sub_id: 'sub_123' });
  });
});
