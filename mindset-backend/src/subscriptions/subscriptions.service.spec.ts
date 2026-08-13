import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

const mockCreerSession = jest.fn();
const mockCreerPortail = jest.fn();
const mockConstruireEvenement = jest.fn();
const mockListerClients = jest.fn();
const mockListerAbos = jest.fn();
const mockListerSessions = jest.fn();

// `import Stripe from 'stripe'` se compile en `stripe_1.default` : le mock doit
// exposer la classe sous `default`, pas à la racine du module.
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockCreerSession, list: mockListerSessions } },
    billingPortal: { sessions: { create: mockCreerPortail } },
    webhooks: { constructEvent: mockConstruireEvenement },
    customers: { list: mockListerClients },
    subscriptions: { list: mockListerAbos },
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

  it('lit les dates de période au format envoyé par la destination', async () => {
    // La destination est configurée en 2026-06-24.dahlia, le SDK est figé sur
    // 2023-10-16. Depuis Basil (2025-03-31), les périodes ne sont plus sur
    // l'abonnement mais sur ses items — les lire à la racine ne lève aucune erreur,
    // les colonnes seraient simplement restées vides pour toujours.
    const versionRecente = {
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] },
    };

    await envoyer('customer.subscription.updated', versionRecente);

    const data = updateMany.mock.calls[0][0].data;
    expect(data.current_period_start).toEqual(new Date(1_700_000_000 * 1000));
    expect(data.current_period_end).toEqual(new Date(1_702_592_000 * 1000));
  });

  it('accepte encore les dates à la racine des anciennes versions', async () => {
    await envoyer('customer.subscription.updated', abonnement({}));

    expect(updateMany.mock.calls[0][0].data.current_period_end).toEqual(
      new Date(1_702_592_000 * 1000),
    );
  });

  it('enregistre le statut même sans aucune date exploitable', async () => {
    // Couper l'accès ne doit jamais dépendre d'un champ décoratif.
    await envoyer('customer.subscription.updated', {
      id: 'sub_123',
      status: 'past_due',
      cancel_at_period_end: false,
    });

    const data = updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('PAST_DUE');
    expect(data.current_period_end).toBeNull();
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

/**
 * La réconciliation : demander à Stripe plutôt qu'attendre son appel.
 *
 * Le 13 août 2026, le tout premier achat réel a été encaissé sans que le compte passe
 * Pro — le webhook n'a rien écrit. Un webhook est une notification poussée : quand elle
 * se perd, l'argent est pris et l'accès jamais ouvert, sans que rien ne le signale.
 * Ces tests couvrent le chemin inverse, celui qui ne dépend d'aucun webhook.
 */
describe('SubscriptionsService — réconciliation avec Stripe', () => {
  let service: SubscriptionsService;
  const majUtilisateur = jest.fn();
  const upsert = jest.fn();

  const construire = async (utilisateur: any = { id: 'u1', email: 'y@example.com', stripe_customer_id: null }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn().mockResolvedValue(utilisateur), update: majUtilisateur },
            subscription: { upsert },
          },
        },
      ],
    }).compile();
    return module.get<SubscriptionsService>(SubscriptionsService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockListerClients.mockResolvedValue({ data: [] });
    mockListerAbos.mockResolvedValue({ data: [] });
    mockListerSessions.mockResolvedValue({ data: [] });
    service = await construire();
  });

  afterEach(() => jest.restoreAllMocks());

  it('ouvre le Pro sur un essai en cours, sans rien avoir reçu de Stripe', async () => {
    // C'est le cas exact du 13 août : formule mensuelle, essai de 7 jours, statut
    // « trialing » chez Stripe, et aucune ligne en base parce que le webhook a échoué.
    mockListerClients.mockResolvedValue({ data: [{ id: 'cus_1' }] });
    mockListerAbos.mockResolvedValue({
      data: [
        {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'trialing',
          cancel_at_period_end: false,
          items: { data: [{ current_period_start: 1000, current_period_end: 2000 }] },
        },
      ],
    });

    const res = await service.verifierAbonnement('u1');

    expect(res).toEqual({ abonne: true, status: 'TRIALING', formule: 'monthly' });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.status).toBe('TRIALING');
  });

  it('rattache le client Stripe au compte, que le webhook n’avait pas écrit', async () => {
    // Sans cette écriture, le portail de gestion resterait inaccessible à quelqu'un
    // dont on vient pourtant de retrouver le paiement.
    mockListerClients.mockResolvedValue({ data: [{ id: 'cus_9' }] });
    mockListerAbos.mockResolvedValue({
      data: [{ id: 'sub_9', customer: 'cus_9', status: 'active', cancel_at_period_end: false, items: { data: [] } }],
    });

    await service.verifierAbonnement('u1');

    expect(majUtilisateur).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { stripe_customer_id: 'cus_9' } });
  });

  it('retrouve un achat à vie, qui ne crée aucun abonnement chez Stripe', async () => {
    // Un paiement unique n'a pas d'objet Subscription : le chercher parmi les
    // abonnements ne le trouverait jamais.
    mockListerClients.mockResolvedValue({ data: [{ id: 'cus_2' }] });
    mockListerSessions.mockResolvedValue({ data: [{ mode: 'payment', payment_status: 'paid' }] });

    const res = await service.verifierAbonnement('u1');

    expect(res).toEqual({ abonne: true, status: 'ACTIVE', formule: 'lifetime' });
    expect(upsert.mock.calls[0][0].create.stripe_sub_id).toBeNull();
  });

  it('fait primer l’achat à vie sur un ancien mensuel résilié', async () => {
    // Sinon la résiliation d'un mensuel effacerait l'accès définitif du même acheteur.
    mockListerClients.mockResolvedValue({ data: [{ id: 'cus_3' }] });
    mockListerAbos.mockResolvedValue({
      data: [{ id: 'sub_3', customer: 'cus_3', status: 'canceled', cancel_at_period_end: false, items: { data: [] } }],
    });
    mockListerSessions.mockResolvedValue({ data: [{ mode: 'payment', payment_status: 'paid' }] });

    const res = await service.verifierAbonnement('u1');

    expect(res.abonne).toBe(true);
    expect(res.formule).toBe('lifetime');
  });

  it('retient l’abonnement vivant quand le compte en porte plusieurs', async () => {
    // Quelqu'un qui a résilié puis repris en a deux. Prendre le plus récemment
    // modifié désignerait le résilié : une résiliation est elle-même une modification.
    mockListerClients.mockResolvedValue({ data: [{ id: 'cus_4' }] });
    mockListerAbos.mockResolvedValue({
      data: [
        { id: 'sub_vieux', customer: 'cus_4', status: 'canceled', cancel_at_period_end: false, items: { data: [] } },
        { id: 'sub_neuf', customer: 'cus_4', status: 'active', cancel_at_period_end: false, items: { data: [] } },
      ],
    });

    const res = await service.verifierAbonnement('u1');

    expect(res.status).toBe('ACTIVE');
    expect(upsert.mock.calls[0][0].create.stripe_sub_id).toBe('sub_neuf');
  });

  it('n’ouvre pas le Pro sur un impayé', async () => {
    // PAST_DUE se retrouve bien en base — c'est l'information utile — mais il ne donne
    // pas accès : Stripe repasse en « active » de lui-même dès qu'une relance aboutit.
    mockListerClients.mockResolvedValue({ data: [{ id: 'cus_5' }] });
    mockListerAbos.mockResolvedValue({
      data: [{ id: 'sub_5', customer: 'cus_5', status: 'past_due', cancel_at_period_end: false, items: { data: [] } }],
    });

    const res = await service.verifierAbonnement('u1');

    expect(res).toEqual({ abonne: false, status: 'PAST_DUE', formule: 'monthly' });
  });

  it('ne touche pas à la base quand Stripe ne connaît pas cet e-mail', async () => {
    const res = await service.verifierAbonnement('u1');

    expect(res).toEqual({ abonne: false, status: null, formule: null });
    expect(upsert).not.toHaveBeenCalled();
    expect(majUtilisateur).not.toHaveBeenCalled();
  });

  it('interroge aussi le client déjà connu, pas seulement l’e-mail', async () => {
    // Un acheteur peut avoir changé l'e-mail de son compte Stripe après coup : la
    // recherche par e-mail le manquerait, alors qu'on a déjà son identifiant.
    service = await construire({ id: 'u1', email: 'y@example.com', stripe_customer_id: 'cus_connu' });
    mockListerClients.mockResolvedValue({ data: [] });

    await service.verifierAbonnement('u1');

    expect(mockListerAbos).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_connu' }));
  });

  it('parle français quand Stripe est injoignable, plutôt que de laisser fuir l’erreur', async () => {
    mockListerClients.mockRejectedValue(new Error('Invalid API Key provided: sk_live_…'));

    await expect(service.verifierAbonnement('u1')).rejects.toThrow(/Impossible de joindre Stripe/);
  });
});
