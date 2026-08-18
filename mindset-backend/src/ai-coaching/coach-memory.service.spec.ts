import { Logger } from '@nestjs/common';
import { CoachMemoryService } from './coach-memory.service';
import { PrismaService } from '../prisma/prisma.service';
import { MODELES_COURTS } from '../common/modeles';

/**
 * La note de mémoire longue est le seul texte que ce projet écrit une fois puis relit
 * indéfiniment. Elle est enregistrée en base, jointe à chaque message envoyé au
 * modèle, et surtout renvoyée le lendemain sous le titre « Note actuelle » avec la
 * consigne d'en conserver les informations.
 *
 * C'est ce qui rend une réponse coupée par `max_tokens` particulièrement coûteuse
 * ici : le modèle recopie consciencieusement la phrase interrompue au milieu d'un
 * fait, et l'amputation survit à toutes les recompressions suivantes. La note
 * précédente, elle, était entière.
 */
describe('CoachMemoryService — recompression de la mémoire longue', () => {
  let service: CoachMemoryService;
  let prisma: any;
  let fetchMock: jest.Mock;
  const cleInitiale = process.env.GROQ_API_KEY;

  const reponseOk = (contenu: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenu } }] }),
  });
  const reponseCoupee = (contenu: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenu }, finish_reason: 'length' }] }),
  });

  /** Assez d'échanges anciens pour déclencher la recompression. */
  const profil = { memory_summary: 'Note précédente, entière.', memory_updated_at: null };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'cle-de-test';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    prisma = {
      chatMessage: {
        count: jest.fn().mockResolvedValue(60),
        findMany: jest.fn().mockResolvedValue([
          { sender: 'user', text: 'Je n’arrive pas à me lever le matin.' },
          { sender: 'ai', text: 'On avance le coucher d’une demi-heure.' },
        ]),
      },
      aIProfile: { update: jest.fn().mockResolvedValue({}) },
    };

    service = new CoachMemoryService(prisma as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (cleInitiale === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = cleInitiale;
  });

  it('enregistre la note quand le modèle a fini sa phrase', async () => {
    fetchMock.mockResolvedValueOnce(reponseOk('Se lève difficilement. Le coucher avancé a marché.'));

    await service.rafraichirMemoire('u1', profil);

    expect(prisma.aIProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ memory_summary: 'Se lève difficilement. Le coucher avancé a marché.' }),
      }),
    );
  });

  it('n’écrit rien quand la note a été coupée par max_tokens', async () => {
    fetchMock.mockResolvedValue(reponseCoupee('Se lève difficilement. Il a mentionné une blessure au'));

    await service.rafraichirMemoire('u1', profil);

    // Rien en base : la note précédente reste en place, entière.
    expect(prisma.aIProfile.update).not.toHaveBeenCalled();
  });

  it('laisse sa chance au second modèle quand le premier est coupé', async () => {
    fetchMock
      .mockResolvedValueOnce(reponseCoupee('Se lève difficilement. Il a mentionné une blessure au'))
      .mockResolvedValueOnce(reponseOk('Se lève difficilement. Genou droit fragile.'));

    await service.rafraichirMemoire('u1', profil);

    expect(fetchMock.mock.calls.map((a) => JSON.parse(a[1].body).model)).toEqual([
      ...MODELES_COURTS,
    ]);
    expect(prisma.aIProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ memory_summary: 'Se lève difficilement. Genou droit fragile.' }),
      }),
    );
  });
});
