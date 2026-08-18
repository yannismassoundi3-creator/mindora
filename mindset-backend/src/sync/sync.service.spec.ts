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

/**
 * Deux appareils, une seule ligne remplacée en bloc à chaque envoi.
 *
 * Le second effaçait tout le travail du premier sans que personne ne l'apprenne :
 * la perte n'était visible que pour celui qui, des jours plus tard, cherchait des
 * routines disparues. `base_version` dit sur quelle version le client a construit
 * son état, et le serveur refuse plutôt que d'écraser.
 */
describe('SyncService — conflit entre appareils', () => {
  let service: SyncService;
  let prisma: any;

  const LUNDI = new Date('2026-08-15T10:00:00.000Z');
  const MARDI = new Date('2026-08-16T10:00:00.000Z');

  beforeEach(() => {
    prisma = {
      syncData: {
        findUnique: jest.fn().mockResolvedValue({ etat_version: LUNDI }),
        create: jest.fn(),
        upsert: jest.fn().mockImplementation((args) => Promise.resolve(args)),
      },
    };
    service = new SyncService(prisma as PrismaService);
  });

  it('accepte une écriture fondée sur la version courante', async () => {
    await expect(
      service.updateSyncData('u1', { base_version: LUNDI.toISOString(), points: 5 }),
    ).resolves.toBeDefined();

    expect(prisma.syncData.upsert).toHaveBeenCalled();
  });

  it('refuse une écriture fondée sur une version dépassée, sans rien écrire', async () => {
    prisma.syncData.findUnique.mockResolvedValue({ etat_version: MARDI });

    await expect(
      service.updateSyncData('u1', { base_version: LUNDI.toISOString(), points: 5 }),
    ).rejects.toMatchObject({ status: 409 });

    // Le point entier : la ligne n'est pas touchée.
    expect(prisma.syncData.upsert).not.toHaveBeenCalled();
  });

  /*
    Un onglet resté ouvert sur la version précédente du code n'envoie pas de
    `base_version`. Refuser son travail serait exactement le dégât qu'on cherche à
    éviter — et il n'a, lui, aucun moyen de se mettre à jour tout seul.
  */
  it('accepte un client qui ne connaît pas encore les versions', async () => {
    prisma.syncData.findUnique.mockResolvedValue({ etat_version: MARDI });

    await expect(service.updateSyncData('u1', { points: 5 })).resolves.toBeDefined();
    expect(prisma.syncData.upsert).toHaveBeenCalled();
  });

  it('accepte le tout premier envoi, quand aucune ligne n’existe', async () => {
    prisma.syncData.findUnique.mockResolvedValue(null);

    await expect(
      service.updateSyncData('u1', { base_version: LUNDI.toISOString(), points: 5 }),
    ).resolves.toBeDefined();
  });

  /*
    Le vrai défaut, et la raison d'être de la colonne `etat_version`.
,
    Signalé par Yannis le 18 août 2026 : « des fois on me demande d'actualiser
    ma page car elle n'est pas sauvegardée, après mes routines tombent à 0 ».

    Cocher une routine déclenche deux requêtes. `POST /ai-coaching/coins/claim`
    crédite les coins — et cette écriture touche la MÊME ligne `SyncData`, donc
    son `updated_at`, qui servait de jeton de version. La remontée temporisée
    partait 500 ms plus tard avec le jeton d'avant, le serveur voyait un écart et
    rendait 409. L'application concluait « un autre appareil a écrit », mettait le
    travail local de côté et adoptait la version du serveur : les cases cochées
    disparaissaient. Un conflit de l'application contre elle-même, sur un seul
    appareil.

    `ai_credits` ne fait pas partie de l'état synchronisé — les deux ensembles de
    champs sont disjoints. Un crédit de coins ne peut donc pas entrer en conflit
    avec une remontée, et ne doit pas périmer le jeton.
  */
  it('accepte une remontée alors que les coins ont écrit entre-temps', async () => {
    // La ligne a été touchée mardi par un crédit de coins, mais l'état, lui,
    // n'a pas bougé depuis lundi.
    prisma.syncData.findUnique.mockResolvedValue({ updated_at: MARDI, etat_version: LUNDI });

    await expect(
      service.updateSyncData('u1', { base_version: LUNDI.toISOString(), points: 5 }),
    ).resolves.toBeDefined();

    expect(prisma.syncData.upsert).toHaveBeenCalled();
  });

  it('accepte une ligne antérieure à la colonne, une fois', async () => {
    // Les comptes existants n'ont pas encore de jeton : comparer contre `null`
    // les mettrait tous en conflit au déploiement.
    prisma.syncData.findUnique.mockResolvedValue({ updated_at: MARDI, etat_version: null });

    await expect(
      service.updateSyncData('u1', { base_version: LUNDI.toISOString(), points: 5 }),
    ).resolves.toBeDefined();
  });

  it('pose un jeton neuf à chaque écriture de l’état', async () => {
    const args: any = await service.updateSyncData('u1', { points: 5 });
    expect(args.update.etat_version).toBeInstanceOf(Date);
    expect(args.create.etat_version).toBeInstanceOf(Date);
  });

  it('rend le jeton sous les deux noms, pour les anciens scripts comme pour les neufs', async () => {
    /*
      Un navigateur qui tourne sur un script d'avant ne lit que `updated_at` et
      n'a aucun moyen de se mettre à jour tout seul. Ne corriger que dans un
      nouveau champ l'aurait laissé en conflit permanent — la panne même qu'on
      répare.
    */
    const jeton = new Date('2026-08-18T10:00:00.000Z');
    prisma.syncData.findUnique.mockResolvedValue({ etat_version: null });
    prisma.syncData.upsert.mockResolvedValue({
      user_id: 'u1',
      updated_at: MARDI,
      etat_version: jeton,
    });

    const rendu: any = await service.updateSyncData('u1', { points: 5 });

    expect(rendu.etat_version).toEqual(jeton);
    expect(rendu.updated_at).toEqual(jeton);
  });

  it('dit au client quelle version le serveur détient', async () => {
    prisma.syncData.findUnique.mockResolvedValue({ etat_version: MARDI });

    await service
      .updateSyncData('u1', { base_version: LUNDI.toISOString() })
      .then(() => {
        throw new Error('aurait dû lever');
      })
      .catch((e: any) => {
        expect(e.getResponse()).toMatchObject({
          code: 'SYNC_CONFLIT',
          version_serveur: MARDI.toISOString(),
        });
      });
  });
});
