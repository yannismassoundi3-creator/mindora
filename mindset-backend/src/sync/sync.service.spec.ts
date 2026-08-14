import { Test, TestingModule } from '@nestjs/testing';
import { SyncService } from './sync.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Le squelette généré par le CLI n'injectait pas PrismaService : la compilation du
 * module échouait avant la première assertion, et la seule qu'il portait — « le
 * service existe » — n'aurait de toute façon rien protégé.
 *
 * Ce qui mérite d'être verrouillé ici, c'est le plafond d'éléments : la synchro
 * accepte ce que le client lui envoie, et chaque compte n'a qu'une ligne. Sans
 * borne, un client bavard ou malveillant fait grossir cette ligne indéfiniment.
 */
describe('SyncService', () => {
  let service: SyncService;
  let prisma: {
    syncData: {
      findUnique: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      syncData: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn().mockImplementation((args) => Promise.resolve(args)),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SyncService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<SyncService>(SyncService);
  });

  describe('getSyncData', () => {
    it('rend la ligne existante sans en créer une seconde', async () => {
      prisma.syncData.findUnique.mockResolvedValue({ user_id: 'u1', points: 42 });

      const resultat = await service.getSyncData('u1');

      expect(resultat).toEqual({ user_id: 'u1', points: 42 });
      expect(prisma.syncData.create).not.toHaveBeenCalled();
    });

    it("crée la ligne au premier accès d'un compte", async () => {
      prisma.syncData.findUnique.mockResolvedValue(null);
      prisma.syncData.create.mockResolvedValue({ user_id: 'u2' });

      const resultat = await service.getSyncData('u2');

      expect(prisma.syncData.create).toHaveBeenCalledWith({ data: { user_id: 'u2' } });
      expect(resultat).toEqual({ user_id: 'u2' });
    });
  });

  describe('updateSyncData', () => {
    it('plafonne les listes envoyées par le client à 500 éléments', async () => {
      const milleRoutines = Array.from({ length: 1000 }, (_, i) => ({ title: `r${i}` }));

      const appel: any = await service.updateSyncData('u1', {
        routines: milleRoutines,
        habits: milleRoutines,
      });

      expect(appel.update.routines).toHaveLength(500);
      expect(appel.create.routines).toHaveLength(500);
      expect(appel.update.habits).toHaveLength(500);
      // Le plafond garde le début de la liste, pas une tranche arbitraire.
      expect(appel.update.routines[0]).toEqual({ title: 'r0' });
    });

    it('laisse intactes les listes de taille normale', async () => {
      const appel: any = await service.updateSyncData('u1', {
        routines: [{ title: 'Matin' }, { title: 'Soir' }],
      });

      expect(appel.update.routines).toEqual([{ title: 'Matin' }, { title: 'Soir' }]);
    });

    it("ne dénature pas daily_scores, qui est un objet et non une liste", async () => {
      // borner() ne s'applique qu'aux tableaux. Si quelqu'un le « corrige » un jour
      // pour tronquer aussi les objets, l'historique des scores partirait avec.
      const scores = { '2026-08-10': 80, '2026-08-11': 100 };

      const appel: any = await service.updateSyncData('u1', { daily_scores: scores });

      expect(appel.update.daily_scores).toEqual(scores);
    });

    it("écrit sur la ligne de l'utilisateur passé, jamais une autre", async () => {
      const appel: any = await service.updateSyncData('u42', { points: 10 });

      expect(appel.where).toEqual({ user_id: 'u42' });
      expect(appel.create.user_id).toBe('u42');
    });
  });

  /**
   * L'expérience est le compteur qui décide du niveau et du rang. Elle est
   * séparée des points depuis que la Boutique s'est révélée capable de faire
   * rétrograder : les deux vivaient dans la même valeur, si bien qu'acheter un
   * cosmétique à 3000 faisait retomber un compte du rang Initié à Novice.
   *
   * Ce qui se joue ici n'est pas la valeur — l'économie de jeu reste tenue par le
   * navigateur, et c'est assumé — mais le fait qu'un client silencieux ou d'une
   * version antérieure ne puisse pas effacer une progression déjà acquise.
   */
  describe('expérience', () => {
    it("laisse la colonne intacte quand le client n'envoie pas d'XP", async () => {
      // Le cas d'un navigateur resté sur l'ancien script : sans ce garde, chacune
      // de ses synchros remettrait l'XP du compte à zéro.
      const appel: any = await service.updateSyncData('u1', { points: 900 });

      expect(appel.update.xp).toBeUndefined();
    });

    it('enregistre une XP valide', async () => {
      const appel: any = await service.updateSyncData('u1', { points: 40, xp: 1210 });

      expect(appel.update.xp).toBe(1210);
      expect(appel.create.xp).toBe(1210);
    });

    it('ignore une XP négative, illisible ou infinie', async () => {
      for (const valeur of [-5, 'beaucoup', NaN, Infinity, null]) {
        const appel: any = await service.updateSyncData('u1', { xp: valeur });
        expect(appel.update.xp).toBeUndefined();
      }
    });

    it('arrondit une XP décimale', async () => {
      const appel: any = await service.updateSyncData('u1', { xp: 42.9 });

      expect(appel.update.xp).toBe(42);
    });
  });
});
