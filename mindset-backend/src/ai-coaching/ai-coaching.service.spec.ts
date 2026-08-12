import { Test, TestingModule } from '@nestjs/testing';
import { AiCoachingService } from './ai-coaching.service';
import { CoachMemoryService } from './coach-memory.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Le repli entre modèles, le second appel sur BESOIN_SCHEMA_PLAN et le drapeau qui
 * déclenche le remboursement ont été livrés sans jamais tourner : ils ne se
 * déclenchent que sur une saturation du fournisseur, et provoquer un vrai 429 chez
 * Groq demanderait de brûler le quota quotidien partagé avec la production.
 *
 * On simule donc les réponses. C'est plus sûr que l'appel réel pour ce qu'on cherche
 * à vérifier : ici la saturation est reproductible et gratuite, alors qu'un test en
 * conditions réelles ne prouverait que le chemin nominal — le seul qui marchait déjà.
 */
describe('AiCoachingService — chat', () => {
  let service: AiCoachingService;
  let prisma: any;
  let fetchMock: jest.Mock;
  const cleInitiale = process.env.GROQ_API_KEY;

  const PREMIER = 'llama-3.3-70b-versatile';
  const DEUXIEME = 'openai/gpt-oss-120b';
  const DERNIER = 'llama-3.1-8b-instant';

  /** Extrait du repère textuel du schéma, présent seulement dans la version longue. */
  const EXTRAIT_SCHEMA = 'GÉRER LES HABITUDES';

  const reponseOk = (contenu: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenu } }] }),
  });
  const reponseSaturee = () => ({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'rate limit' });
  const reponseErreur = (status: number, corps: string) => ({
    ok: false,
    status,
    statusText: 'Error',
    text: async () => corps,
  });

  /** Le modèle de chaque appel, dans l'ordre où ils sont partis. */
  const modelesAppeles = () =>
    fetchMock.mock.calls.map((appel) => JSON.parse(appel[1].body).model as string);

  /** La consigne système envoyée au n-ième appel. */
  const consigne = (n: number) =>
    JSON.parse(fetchMock.mock.calls[n][1].body).messages[0].content as string;

  beforeEach(async () => {
    process.env.GROQ_API_KEY = 'cle-de-test';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    prisma = {
      chatMessage: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      syncData: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const memoire = {
      chargerProfil: jest.fn().mockResolvedValue(null),
      formatProfil: jest.fn().mockReturnValue(''),
      formatMemoire: jest.fn().mockReturnValue(''),
      formatTendance: jest.fn().mockReturnValue(''),
      rafraichirMemoire: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiCoachingService,
        { provide: PrismaService, useValue: prisma },
        { provide: CoachMemoryService, useValue: memoire },
      ],
    }).compile();

    service = module.get<AiCoachingService>(AiCoachingService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (cleInitiale === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = cleInitiale;
  });

  describe('repli entre modèles', () => {
    it('sert la réponse du modèle suivant quand le premier est saturé', async () => {
      fetchMock
        .mockResolvedValueOnce(reponseSaturee())
        .mockResolvedValueOnce(reponseOk('Tiens bon, on avance. 💪'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.reply).toBe('Tiens bon, on avance. 💪');
      expect(resultat.erreur).toBeUndefined();
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
    });

    it('passe au suivant quand un modèle a été retiré du catalogue', async () => {
      // Groq met régulièrement des identifiants hors service. Sans ce cas, un modèle
      // devenu invalide en milieu de chaîne emporterait tout le filet placé derrière.
      fetchMock
        .mockResolvedValueOnce(reponseErreur(404, 'model not found'))
        .mockResolvedValueOnce(reponseOk('Toujours là.'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.reply).toBe('Toujours là.');
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
    });

    it("descend les trois modèles avant d'admettre la saturation", async () => {
      fetchMock.mockResolvedValue(reponseSaturee());

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME, DERNIER]);
      // Message d'attente, distinct de la panne : la personne peut réessayer.
      expect(resultat.reply).toContain('Trop de monde');
      // C'est ce drapeau que lit le contrôleur pour rembourser.
      expect(resultat.erreur).toBe(true);
    });

    it("n'insiste pas sur une clé invalide, qui échouerait partout pareil", async () => {
      fetchMock.mockResolvedValue(reponseErreur(401, 'invalid api key'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      // Réessayer triplerait la latence pour afficher la même erreur.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(resultat.erreur).toBe(true);
      expect(resultat.reply).not.toContain('Trop de monde');
    });
  });

  describe('schéma du plan', () => {
    // Aucun mot de MOTS_PLAN là-dedans : la détection passe volontairement à côté.
    const DEMANDE_DETOURNEE = 'Je veux arrêter de procrastiner le matin';

    it('omet le schéma sur un message ordinaire', async () => {
      fetchMock.mockResolvedValueOnce(reponseOk('Bien reçu.'));

      await service.chatWithAi('u1', DEMANDE_DETOURNEE);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(consigne(0)).not.toContain(EXTRAIT_SCHEMA);
      // À la place, la règle qui autorise le modèle à le réclamer lui-même.
      expect(consigne(0)).toContain('BESOIN_SCHEMA_PLAN');
    });

    it('relance avec le schéma quand le modèle le réclame', async () => {
      fetchMock
        .mockResolvedValueOnce(reponseOk('BESOIN_SCHEMA_PLAN'))
        .mockResolvedValueOnce(reponseOk('Voici ton programme. <PLAN>{}</PLAN>'));

      const resultat: any = await service.chatWithAi('u1', DEMANDE_DETOURNEE);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(consigne(1)).toContain(EXTRAIT_SCHEMA);
      // La règle du marqueur disparaît au second appel : la laisser ferait réclamer au
      // modèle des instructions qu'il a déjà sous les yeux, et bouclerait.
      expect(consigne(1)).not.toContain('BESOIN_SCHEMA_PLAN');
      expect(resultat.reply).toBe('Voici ton programme. <PLAN>{}</PLAN>');
      expect(resultat.erreur).toBeUndefined();
    });

    it('joint le schéma dès le premier appel sur une demande reconnue', async () => {
      fetchMock.mockResolvedValueOnce(reponseOk('C\'est noté. <PLAN>{}</PLAN>'));

      await service.chatWithAi('u1', 'Ajoute une séance de sport le mardi');

      // Le second appel ne doit servir que de filet : une demande explicite ne doit
      // jamais coûter deux appels.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(consigne(0)).toContain(EXTRAIT_SCHEMA);
    });

    it("ne laisse jamais le mot de code s'afficher dans la conversation", async () => {
      fetchMock.mockResolvedValue(reponseOk('BESOIN_SCHEMA_PLAN'));

      const resultat: any = await service.chatWithAi('u1', DEMANDE_DETOURNEE);

      expect(resultat.reply).not.toContain('BESOIN_SCHEMA_PLAN');
      // Traité comme une panne, donc remboursé : mieux que d'envoyer un mot de code.
      expect(resultat.erreur).toBe(true);
      expect(prisma.chatMessage.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sender: 'ai' }) }),
      );
    });
  });
});
