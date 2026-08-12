import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CoinLedgerService } from './coin-ledger.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deux choses se jouent ici.
 *
 * D'abord l'ouverture du solde. Un compte neuf n'a pas de ligne `sync_data` tant
 * qu'il n'a pas synchronisé, et `update` lève P2025 sur une ligne absente : la route
 * de crédit répondait 500. L'impasse était fermée des deux côtés — le nouveau venu
 * démarrait à zéro coin, le refus de l'IA lui disait d'aller terminer une routine
 * pour en gagner, et c'est cette action-là qui échouait.
 *
 * Ensuite le solde de départ, qui ne doit jamais devenir une source infinie : il
 * s'applique à l'ouverture, pas à un compte descendu à zéro en dépensant.
 */
describe('CoinLedgerService — solde et crédits', () => {
  let service: CoinLedgerService;
  let prisma: any;
  /** La ligne sync_data simulée. null = compte qui n'a jamais synchronisé. */
  let ligne: { ai_credits: number | null; points: number } | null;

  const DEPART = CoinLedgerService.SOLDE_DEPART;
  const GAIN = CoinLedgerService.GAIN_PAR_ACTION;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    ligne = null;

    prisma = {
      coinClaim: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockReturnValue({}),
      },
      syncData: {
        findUnique: jest.fn(async () => ligne),
        update: jest.fn(async ({ data }: any) => {
          if (ligne) ligne.ai_credits = data.ai_credits;
          return ligne;
        }),
        upsert: jest.fn((args: any) => {
          if (!ligne) ligne = { ai_credits: args.create.ai_credits, points: 0 };
          else if (args.update?.ai_credits?.increment !== undefined) {
            ligne.ai_credits = (ligne.ai_credits ?? 0) + args.update.ai_credits.increment;
          }
          return { ai_credits: ligne.ai_credits };
        }),
        updateMany: jest.fn(async ({ data }: any) => {
          const montant = data.ai_credits.decrement ?? -data.ai_credits.increment;
          if (!ligne || (ligne.ai_credits ?? 0) < montant) return { count: 0 };
          ligne.ai_credits = (ligne.ai_credits ?? 0) - montant;
          return { count: 1 };
        }),
      },
      // Prisma reçoit les opérations déjà construites : on rend leurs résultats.
      $transaction: jest.fn((ops: any[]) => Promise.resolve(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoinLedgerService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CoinLedgerService>(CoinLedgerService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('ouverture du solde', () => {
    it('offre le solde de départ à un compte qui vient de s’inscrire', async () => {
      expect(await service.getBalance('u-neuf')).toBe(DEPART);
      // La ligne doit exister ensuite, sinon le débit qui suit ne trouverait rien.
      expect(ligne).toEqual({ ai_credits: DEPART, points: 0 });
    });

    it('permet au nouveau venu de parler au coach immédiatement', async () => {
      // Le parcours qui échouait : inscription puis message, sans rien valider avant.
      const resultat = await service.spend('u-neuf');

      expect(resultat).toEqual({ depense: 10, solde: DEPART - 10 });
    });

    it('crédite une action sans 500 quand la ligne n’existe pas encore', async () => {
      const resultat: any = await service.claim('u-neuf', 'routine-2026-08-12');

      expect(resultat.credite).toBe(true);
      expect(resultat.solde).toBe(DEPART + GAIN);
      // `update` seul lèverait P2025 ici : c'est toute la correction.
      expect(prisma.syncData.update).not.toHaveBeenCalled();
    });
  });

  describe('comptes antérieurs au grand livre', () => {
    it('reprend les coins qui vivaient dans points', async () => {
      ligne = { ai_credits: null, points: 120 };

      expect(await service.getBalance('u1')).toBe(120);
    });

    it('relève au solde de départ celui qui en avait moins', async () => {
      // Personne ne doit se retrouver moins bien loti qu'un inscrit du jour.
      ligne = { ai_credits: null, points: 5 };

      expect(await service.getBalance('u1')).toBe(DEPART);
    });

    it('ne réalimente jamais un solde dépensé jusqu’à zéro', async () => {
      // La distinction tient à null : une fois le solde ouvert, `points` n'a plus
      // aucune influence. Sans ça, le solde de départ deviendrait infini — il
      // suffirait de tout dépenser pour être resservi.
      ligne = { ai_credits: 0, points: 999 };

      expect(await service.getBalance('u1')).toBe(0);
      await expect(service.spend('u1')).rejects.toMatchObject({ status: 402 });
    });
  });

  describe('crédits', () => {
    it('incrémente le solde existant sans l’écraser', async () => {
      ligne = { ai_credits: 40, points: 0 };

      const resultat: any = await service.claim('u1', 'routine-2026-08-12');

      expect(resultat.solde).toBe(40 + GAIN);
      expect(prisma.syncData.upsert.mock.calls.at(-1)[0].update).toEqual({
        ai_credits: { increment: GAIN },
      });
    });

    it('ne crédite pas deux fois la même action', async () => {
      ligne = { ai_credits: 30, points: 0 };
      prisma.coinClaim.findUnique.mockResolvedValue({ id: 'deja' });

      const resultat: any = await service.claim('u1', 'routine-2026-08-12');

      expect(resultat).toMatchObject({ credite: false, raison: 'deja_credite', solde: 30 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('applique le plafond quotidien, qui borne la triche par routines infinies', async () => {
      ligne = { ai_credits: 30, points: 0 };
      prisma.coinClaim.count.mockResolvedValue(CoinLedgerService.ACTIONS_MAX_PAR_JOUR);

      const resultat: any = await service.claim('u1', 'routine-2026-08-12');

      expect(resultat).toMatchObject({ credite: false, raison: 'plafond_journalier' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
