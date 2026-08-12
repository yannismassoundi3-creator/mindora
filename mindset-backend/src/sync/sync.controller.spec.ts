import { Test, TestingModule } from '@nestjs/testing';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/**
 * Le squelette généré par le CLI n'injectait pas SyncService, d'où l'échec au
 * montage du module.
 *
 * Ce qu'on vérifie ici tient en une phrase : l'identifiant écrit vient du jeton
 * d'authentification, jamais du corps de la requête. C'est ce qui empêche un client
 * d'écraser les données de quelqu'un d'autre en glissant un `user_id` dans son
 * message, et rien dans la signature des méthodes ne l'impose.
 */
describe('SyncController', () => {
  let controller: SyncController;
  let syncService: { getSyncData: jest.Mock; updateSyncData: jest.Mock };

  beforeEach(async () => {
    syncService = {
      getSyncData: jest.fn().mockResolvedValue({ user_id: 'depuis-le-jeton' }),
      updateSyncData: jest.fn().mockResolvedValue({ ok: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [{ provide: SyncService, useValue: syncService }],
    }).compile();

    controller = module.get<SyncController>(SyncController);
  });

  it("lit l'état du compte porté par le jeton", async () => {
    await controller.getState({ user: { userId: 'u1' } } as any);

    expect(syncService.getSyncData).toHaveBeenCalledWith('u1');
  });

  it("écrit sous l'identifiant du jeton et ignore celui envoyé dans le corps", async () => {
    const requete = { user: { userId: 'moi' } } as any;
    const corps = { user_id: 'quelquun-dautre', userId: 'quelquun-dautre', points: 999 };

    await controller.updateState(requete, corps);

    expect(syncService.updateSyncData).toHaveBeenCalledWith('moi', corps);
  });
});
