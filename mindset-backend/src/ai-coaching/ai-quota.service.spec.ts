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

/**
 * Les deux murs.
 *
 * Un abonné n'avait aucune borne hors de la cadence `@Throttle` : dix messages par
 * minute, soit 14 400 par jour s'il la tenait. Ce qui est en jeu n'est pas la marge
 * mais le quota Groq, partagé — un seul compte emballé l'épuise pour tout le monde.
 */
describe('AiQuotaService — les deux plafonds', () => {
  let service: AiQuotaService;
  const findUnique = jest.fn();
  const count = jest.fn();
  const create = jest.fn();

  const abonne = (oui: boolean) => findUnique.mockResolvedValue(oui ? { status: 'ACTIVE' } : null);

  beforeEach(async () => {
    jest.clearAllMocks();
    create.mockResolvedValue({});
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiQuotaService,
        {
          provide: PrismaService,
          useValue: { subscription: { findUnique }, aiUsage: { count, create } },
        },
      ],
    }).compile();
    service = module.get<AiQuotaService>(AiQuotaService);
  });

  it('compte un gratuit au mois, un abonné au jour', async () => {
    abonne(false);
    count.mockResolvedValue(3);
    expect(await service.getQuota('u1')).toMatchObject({ periode: 'mois', limit: 10, remaining: 7 });

    abonne(true);
    count.mockResolvedValue(3);
    expect(await service.getQuota('u1')).toMatchObject({ periode: 'jour', limit: 50, remaining: 47 });
  });

  it('laisse passer un abonné sous son plafond', async () => {
    abonne(true);
    count.mockResolvedValue(49);
    await expect(service.consumeAiCredit('u1', 'chat')).resolves.toMatchObject({ remaining: 1 });
  });

  /*
    429 et non 402 : la personne a déjà payé. Un « Payment Required » l'inviterait à
    acheter ce qu'elle possède, et le front ouvrirait l'écran de tarifs par-dessus.
  */
  it('arrête un abonné à cinquante messages, sans lui proposer de payer', async () => {
    abonne(true);
    count.mockResolvedValue(50);
    await expect(service.consumeAiCredit('u1', 'chat')).rejects.toMatchObject({
      status: 429,
      response: { code: 'AI_DAILY_CAP' },
    });
  });

  it('arrête un gratuit à dix messages en ouvrant l\'abonnement', async () => {
    abonne(false);
    count.mockResolvedValue(10);
    await expect(service.consumeAiCredit('u1', 'chat')).rejects.toMatchObject({
      status: 402,
      response: { code: 'AI_QUOTA_EXCEEDED' },
    });
  });

  /*
    Sans cette ligne, la consommation des abonnés ne laissait aucune trace : un compte
    emballé était non seulement sans borne, mais indétectable après coup. C'est elle
    aussi qui rend le plafond quotidien calculable.
  */
  it("écrit une ligne d'usage pour un abonné aussi", async () => {
    abonne(true);
    count.mockResolvedValue(0);
    await service.consumeAiCredit('u1', 'chat');
    expect(create).toHaveBeenCalledWith({ data: { user_id: 'u1', kind: 'chat' } });
  });
});
