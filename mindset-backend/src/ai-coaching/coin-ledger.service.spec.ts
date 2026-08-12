import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CoinLedgerService } from './coin-ledger.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Un compte neuf n'a pas de ligne `sync_data` tant qu'il n'a pas synchronisé, et
 * `update` lève P2025 sur une ligne absente : la route de crédit répondait 500.
 *
 * L'impasse était complète : le nouveau venu démarre à zéro coin, le refus de l'IA
 * lui dit d'aller terminer une routine pour en gagner, et c'est exactement cette
 * action-là qui échouait. Il ne pouvait donc jamais atteindre le coach — la
 * fonctionnalité pour laquelle il s'est inscrit.
 */
describe('CoinLedgerService — créditer une action', () => {
  let service: CoinLedgerService;
  let prisma: any;

  const GAIN = CoinLedgerService.GAIN_PAR_ACTION;

  /** L'opération de solde construite par claim(), quelle que soit sa forme. */
  const operationSolde = () =>
    prisma.syncData.upsert.mock.calls.length ? prisma.syncData.upsert.mock.calls.at(-1)[0] : null;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    prisma = {
      coinClaim: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockReturnValue({}),
      },
      syncData: {
        findUnique: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn().mockReturnValue({ ai_credits: GAIN }),
      },
      // Les opérations sont construites puis remises à $transaction : on rend ce que
      // les mocks ont produit, dans l'ordre.
      $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.resolve(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoinLedgerService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CoinLedgerService>(CoinLedgerService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('crédite un compte qui n’a jamais synchronisé, au lieu de rendre une 500', async () => {
    // Pas de ligne sync_data : c'est l'état d'un compte à la sortie de l'inscription.
    prisma.syncData.findUnique.mockResolvedValue(null);

    const resultat: any = await service.claim('u-neuf', 'routine-2026-08-12');

    expect(resultat.credite).toBe(true);
    expect(resultat.solde).toBe(GAIN);
    // `update` seul échouerait ici : la ligne doit pouvoir être créée.
    expect(prisma.syncData.update).not.toHaveBeenCalled();
    expect(operationSolde()).toMatchObject({
      where: { user_id: 'u-neuf' },
      create: { user_id: 'u-neuf', ai_credits: GAIN },
    });
  });

  it('incrémente le solde existant sans l’écraser', async () => {
    prisma.syncData.findUnique.mockResolvedValue({ ai_credits: 40, points: 0 });
    prisma.syncData.upsert.mockReturnValue({ ai_credits: 40 + GAIN });

    const resultat: any = await service.claim('u1', 'routine-2026-08-12');

    expect(resultat.solde).toBe(40 + GAIN);
    // Un `set` remettrait tout le monde à GAIN : c'est bien un incrément.
    expect(operationSolde()?.update).toEqual({ ai_credits: { increment: GAIN } });
  });

  it('ne crédite pas deux fois la même action', async () => {
    prisma.syncData.findUnique.mockResolvedValue({ ai_credits: 30, points: 0 });
    prisma.coinClaim.findUnique.mockResolvedValue({ id: 'deja' });

    const resultat: any = await service.claim('u1', 'routine-2026-08-12');

    expect(resultat).toMatchObject({ credite: false, raison: 'deja_credite', solde: 30 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('applique le plafond quotidien, qui borne la triche par routines infinies', async () => {
    prisma.syncData.findUnique.mockResolvedValue({ ai_credits: 30, points: 0 });
    prisma.coinClaim.count.mockResolvedValue(CoinLedgerService.ACTIONS_MAX_PAR_JOUR);

    const resultat: any = await service.claim('u1', 'routine-2026-08-12');

    expect(resultat).toMatchObject({ credite: false, raison: 'plafond_journalier' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
