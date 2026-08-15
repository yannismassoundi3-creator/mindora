import { Test, TestingModule } from '@nestjs/testing';
import { CoachOuvertureService } from './coach-ouverture.service';
import { CoachMemoryService } from './coach-memory.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * La phrase d'ouverture est le premier contact avec le coach, et c'est aussi une
 * dépense : un appel au modèle par ouverture d'écran viderait le quota Groq du jour
 * en quelques rechargements. Les deux choses se testent ensemble, parce qu'elles se
 * contredisent — ce qu'on vérifie ici, c'est que le cache tient sans rendre la
 * phrase fausse, et que rien de tout cela ne peut remonter en erreur à l'écran.
 */
describe('CoachOuvertureService', () => {
  let service: CoachOuvertureService;
  let prisma: any;
  let fetchMock: jest.Mock;
  const cleInitiale = process.env.GROQ_API_KEY;

  const PETIT = 'llama-3.1-8b-instant';
  const GROS = 'llama-3.3-70b-versatile';

  const reponseOk = (contenu: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenu } }] }),
  });
  const reponseKo = (status = 429) => ({ ok: false, status, statusText: 'Error', text: async () => 'ko' });

  const modelesAppeles = () => fetchMock.mock.calls.map((a) => JSON.parse(a[1].body).model as string);
  const consigne = (n = 0) => JSON.parse(fetchMock.mock.calls[n][1].body).messages[0].content as string;
  const donnees = (n = 0) => JSON.parse(fetchMock.mock.calls[n][1].body).messages[1].content as string;

  beforeEach(async () => {
    process.env.GROQ_API_KEY = 'cle-de-test';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    prisma = {
      aIProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      syncData: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoachOuvertureService, CoachMemoryService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CoachOuvertureService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (cleInitiale === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = cleInitiale;
  });

  describe('les trois états de la journée', () => {
    /*
      « Rien de prévu » et « tout est fait » se ressemblent — dans les deux cas il ne
      reste rien à cocher — et appellent pourtant des phrases opposées. Les confondre
      revient à féliciter quelqu'un qui n'a jamais rien planifié.
    */
    it('distingue une journée vide d\'une journée terminée', () => {
      const vide = CoachOuvertureService.lireEtatDuJour({ routines: [] });
      const fini = CoachOuvertureService.lireEtatDuJour({
        routines: [{ items: [{ title: 'Sport', done: true }] }],
      });

      expect(vide.cas).toBe('vide');
      expect(fini.cas).toBe('fini');
    });

    it('nomme les tâches restantes quand il en reste', () => {
      const etat = CoachOuvertureService.lireEtatDuJour({
        routines: [{ items: [{ title: 'Sport 30 min', done: false }, { title: 'Lecture', done: true }] }],
      });

      expect(etat.cas).toBe('reste');
      expect(etat.resume).toContain('Sport 30 min');
      expect(etat.resume).toContain('1 tâche(s) faite(s) sur 2');
      // La tâche déjà faite n'a pas à être proposée de nouveau.
      expect(etat.resume).not.toMatch(/Il lui reste :.*Lecture/);
    });

    it('survit à un contexte absent ou malformé', () => {
      expect(CoachOuvertureService.lireEtatDuJour(undefined).cas).toBe('vide');
      expect(CoachOuvertureService.lireEtatDuJour({ routines: 'pas un tableau' }).cas).toBe('vide');
      expect(CoachOuvertureService.lireEtatDuJour({ routines: [{ items: null }] }).cas).toBe('vide');
    });
  });

  describe('le cache', () => {
    it('rend la phrase retenue sans rappeler le modèle', async () => {
      prisma.aIProfile.findUnique.mockResolvedValue({
        ouverture_texte: 'Déjà dite ce matin.',
        ouverture_genere_le: new Date(Date.now() - 3600 * 1000),
      });

      const texte = await service.ouverture('u1', { routines: [] });

      expect(texte).toBe('Déjà dite ce matin.');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    /*
      Le cœur du compromis : une phrase gardée trop longtemps se met à mentir. Elle
      annoncerait « la journée commence » à quelqu'un qui ouvre l'app le soir, ce qui
      coûte plus cher en crédibilité que l'appel qu'elle économise.
    */
    it('régénère une phrase trop vieille', async () => {
      prisma.aIProfile.findUnique.mockResolvedValue({
        ouverture_texte: 'Datée de ce matin.',
        ouverture_genere_le: new Date(Date.now() - 7 * 3600 * 1000),
      });
      fetchMock.mockResolvedValue(reponseOk('Il te reste ta séance.'));

      const texte = await service.ouverture('u1', { routines: [] });

      expect(texte).toBe('Il te reste ta séance.');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(prisma.aIProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ouverture_texte: 'Il te reste ta séance.' }) }),
      );
    });

    it('rend la phrase même quand elle ne peut pas être retenue', async () => {
      // Un compte sans profil n'a pas de ligne à mettre à jour. Mieux vaut un appel
      // de plus la prochaine fois qu'une exception à l'ouverture d'un écran.
      prisma.aIProfile.findUnique.mockResolvedValue(null);
      fetchMock.mockResolvedValue(reponseOk('Salut.'));

      expect(await service.ouverture('u1', {})).toBe('Salut.');
      expect(prisma.aIProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('le coût', () => {
    it('essaie le petit modèle avant le gros', async () => {
      fetchMock.mockResolvedValueOnce(reponseKo()).mockResolvedValueOnce(reponseOk('Deuxième essai.'));

      await service.ouverture('u1', {});

      expect(modelesAppeles()).toEqual([PETIT, GROS]);
    });

    it('borne la longueur de la réponse demandée', async () => {
      fetchMock.mockResolvedValue(reponseOk('Court.'));
      await service.ouverture('u1', {});
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBeLessThanOrEqual(200);
    });

    it('ne part pas du tout sans clé', async () => {
      delete process.env.GROQ_API_KEY;
      expect(await service.ouverture('u1', {})).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('la robustesse', () => {
    /*
      Le navigateur sait composer sa propre phrase à partir des mêmes données
      locales. Rendre `null` lui laisse la main ; lever afficherait une erreur à
      quelqu'un dont le seul geste a été d'ouvrir une conversation.
    */
    it('rend null quand aucun modèle ne répond', async () => {
      fetchMock.mockResolvedValue(reponseKo(500));
      expect(await service.ouverture('u1', {})).toBeNull();
    });

    it('rend null quand le réseau tombe', async () => {
      fetchMock.mockRejectedValue(new Error('réseau'));
      expect(await service.ouverture('u1', {})).toBeNull();
    });

    /*
      Une phrase arrêtée par `max_tokens` arrive avec un statut 200 : sans lire
      `finish_reason`, elle passait pour finie. Elle est de surcroît mise en cache six
      heures, donc on relirait toute la journée une phrase d'accueil interrompue au
      milieu d'un mot. La phrase composée localement, elle, est entière.
    */
    it('rend null sur une phrase coupée, et ne la met pas en cache', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Il te reste ta séance, et vu ta série de' }, finish_reason: 'length' }],
        }),
      });

      expect(await service.ouverture('u1', {})).toBeNull();
      expect(prisma.aIProfile.update).not.toHaveBeenCalled();
    });

    it('ne parle pas pour un utilisateur de démonstration', async () => {
      expect(await service.ouverture('demo-user', {})).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('retire les guillemets et le préambule que le modèle ajoute parfois', async () => {
      fetchMock.mockResolvedValue(reponseOk('Voici : « Il te reste ta séance de sport. »'));
      expect(await service.ouverture('u1', {})).toBe('Il te reste ta séance de sport.');
    });

    it('ne touche pas aux guillemets internes', async () => {
      fetchMock.mockResolvedValue(reponseOk('Tu m\'as dit « jamais deux jours de suite ». Aujourd\'hui compte.'));
      expect(await service.ouverture('u1', {})).toBe(
        'Tu m\'as dit « jamais deux jours de suite ». Aujourd\'hui compte.',
      );
    });
  });

  describe('la consigne envoyée au modèle', () => {
    beforeEach(() => fetchMock.mockResolvedValue(reponseOk('Une phrase.')));

    /*
      Ce projet a déjà payé deux fois le fait qu'un modèle invente une tâche absente
      des données — « prépare ton sac de sport », « 15 minutes pour t'habiller ».
      Sur une phrase d'accueil, une tâche inventée est la première chose que la
      personne lit, et la preuve immédiate que le coach ne la suit pas.
    */
    it('interdit d\'inventer une tâche ou un chiffre', async () => {
      await service.ouverture('u1', {});
      expect(consigne()).toContain('N\'INVENTE RIEN');
    });

    it('bannit la formule d\'accueil qu\'elle remplace', async () => {
      await service.ouverture('u1', {});
      expect(consigne()).toContain('Comment puis-je t\'aider');
    });

    it('adapte l\'exemple au cas du jour', async () => {
      await service.ouverture('u1', { routines: [] });
      const consigneVide = consigne();

      fetchMock.mockClear();
      await service.ouverture('u2', { routines: [{ items: [{ title: 'Sport', done: true }] }] });
      const consigneFinie = consigne();

      // L'exemple commande, la règle suit : c'est lui qui doit changer d'un cas à
      // l'autre, pas seulement les données.
      expect(consigneVide).not.toBe(consigneFinie);
      expect(consigneFinie).toContain('Tout est coché');
    });

    it('donne le nom que la personne a choisi pour son coach', async () => {
      await service.ouverture('u1', {}, 'Jarvis');
      expect(consigne()).toContain('Jarvis');
    });

    it('transmet le profil et l\'heure', async () => {
      prisma.aIProfile.findUnique.mockResolvedValue({
        objectives: ['Devenir constant'],
        ouverture_texte: null,
      });

      await service.ouverture('u1', {});

      expect(donnees()).toContain('Devenir constant');
      expect(donnees()).toMatch(/il est \d{2}[:h]\d{2}/);
    });
  });
});
