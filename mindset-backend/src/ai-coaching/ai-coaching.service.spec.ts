import { Test, TestingModule } from '@nestjs/testing';
import { AiCoachingService } from './ai-coaching.service';
import { CoachMemoryService } from './coach-memory.service';
import { PrismaService } from '../prisma/prisma.service';
import { RappelService } from './rappel.service';
import { ObservationService } from './observation.service';
import { AnalyseHabitudesService } from '../push/analyse-habitudes.service';
import { MODELES_CHAT } from '../common/modeles';

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
  /* Hissée hors du `beforeEach` : le profil décide du budget temps, et un test
     doit pouvoir déclarer « cette personne a vingt minutes ». */
  let memoire: any;
  const cleInitiale = process.env.GROQ_API_KEY;

  const PREMIER = MODELES_CHAT[0];
  const DEUXIEME = MODELES_CHAT[1];
  const DERNIER = MODELES_CHAT[2];

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
      coachEchec: { create: jest.fn().mockResolvedValue({}) },
      // Les deux canaux interrogés au moment de confirmer un rappel. Par défaut la
      // notification est ouverte : c'est le cas nominal, et celui où la phrase de
      // confirmation ne doit surtout rien ajouter.
      pushSubscription: { count: jest.fn().mockResolvedValue(1) },
      user: { findUnique: jest.fn().mockResolvedValue({ relances_email: true }) },
    };

    memoire = {
      chargerProfil: jest.fn().mockResolvedValue(null),
      formatProfil: jest.fn().mockReturnValue(''),
      formatMemoire: jest.fn().mockReturnValue(''),
      formatTendance: jest.fn().mockReturnValue(''),
      rafraichirMemoire: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObservationService,
        AnalyseHabitudesService,
        {
          provide: RappelService,
          // Les rappels ont leur propre suite : ici on veut seulement que le
          // module se construise, et qu aucun rappel ne soit pose.
          useValue: {
            poser: jest.fn().mockResolvedValue([]),
            dus: jest.fn().mockResolvedValue([]),
            marquerEnvoye: jest.fn(),
            abandonnerLesPerimes: jest.fn().mockResolvedValue(0),
          },
        },
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

  /**
   * Le dernier maillon, payant.
   *
   * Le plan Developer de Groq est fermé depuis des mois : on ne peut pas acheter
   * de capacité, même en le voulant. Le coach — ce que l'abonnement fait payer —
   * dépend donc d'un quota gratuit partagé. Ce maillon-ci ne travaille que sur ce
   * que le gratuit a refusé, et il doit rester strictement inerte tant qu'aucune
   * clé n'est configurée : ce code se déploie avant qu'un compte existe.
   */
  describe('fournisseur de secours', () => {
    const SECOURS_URL = 'https://exemple-secours.test/v1/chat/completions';

    const activerSecours = (modele: string | null = 'un/modele-payant') => {
      process.env.SECOURS_API_KEY = 'cle-secours';
      process.env.SECOURS_API_URL = SECOURS_URL;
      if (modele === null) delete process.env.SECOURS_MODELE;
      else process.env.SECOURS_MODELE = modele;
    };

    afterEach(() => {
      delete process.env.SECOURS_API_KEY;
      delete process.env.SECOURS_API_URL;
      delete process.env.SECOURS_MODELE;
    });

    it('ne change rien tant qu’aucune clé n’est configurée', async () => {
      // C'est la garantie qui permet de livrer ce code avant d'avoir un compte
      // chez qui que ce soit : sans clé, la chaîne est celle d'avant, au modèle près.
      fetchMock.mockResolvedValue(reponseSaturee());

      const resultat: any = await service.chatWithAi('u1', 'Salut');

      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME, DERNIER]);
      expect(resultat.erreur).toBe(true);
    });

    it('prend le relais quand toute la chaîne gratuite est saturée', async () => {
      activerSecours();
      fetchMock
        .mockResolvedValueOnce(reponseSaturee())
        .mockResolvedValueOnce(reponseSaturee())
        .mockResolvedValueOnce(reponseSaturee())
        .mockResolvedValueOnce(reponseOk('Je suis là. 💪'));

      const resultat: any = await service.chatWithAi('u1', 'Salut');

      expect(resultat.reply).toBe('Je suis là. 💪');
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME, DERNIER, 'un/modele-payant']);

      // Sa propre adresse et sa propre clé : le secours n'est pas un modèle Groq
      // de plus, c'est un autre service.
      const [url, options] = fetchMock.mock.calls[3];
      expect(url).toBe(SECOURS_URL);
      expect(options.headers.Authorization).toBe('Bearer cle-secours');
    });

    it('ne coûte rien tant que le gratuit répond', async () => {
      // Le point qui décide de la facture : placé ailleurs que en dernier, il
      // paierait des requêtes que Groq aurait servies gratuitement.
      activerSecours();
      fetchMock.mockResolvedValueOnce(reponseOk('Réponse gratuite.'));

      await service.chatWithAi('u1', 'Salut');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('api.groq.com');
    });

    it('reste inerte si le modèle du secours n’est pas nommé', async () => {
      // Une clé sans identifiant de modèle ne peut pas marcher — il n'est pas
      // devinable et change d'un fournisseur à l'autre. Mieux vaut ne pas tenter
      // l'appel qu'échouer sur un 400 que personne ne reliera à cette variable.
      activerSecours(null);
      fetchMock.mockResolvedValue(reponseSaturee());

      await service.chatWithAi('u1', 'Salut');

      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME, DERNIER]);
    });

    it('reste joignable quand Groq refuse la clé', async () => {
      /*
        Une clé Groq révoquée ou un compte suspendu condamne les trois modèles
        gratuits — ils la partagent — mais **pas** le secours, qui a la sienne.
        C'est précisément le jour où Groq nous ferme la porte qu'un filet payant
        sert à quelque chose ; l'ancienne boucle le sautait avec le reste.
      */
      activerSecours();
      fetchMock
        .mockResolvedValueOnce(reponseErreur(401, 'invalid api key'))
        .mockResolvedValueOnce(reponseOk('Toujours là, malgré tout.'));

      const resultat: any = await service.chatWithAi('u1', 'Salut');

      expect(resultat.reply).toBe('Toujours là, malgré tout.');
      // Les deux modèles Groq restants sont sautés : même clé, même refus.
      expect(modelesAppeles()).toEqual([PREMIER, 'un/modele-payant']);
    });
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

    it('passe au suivant quand un modèle est interdit sur le projet Groq', async () => {
      // Constaté sur une clé neuve le 12 août 2026 : les projets récents n'autorisent
      // qu'une liste réduite de modèles, et Groq répond 403 « blocked at the project
      // level ». Sans ce cas, le premier modèle interdit emportait toute la chaîne.
      fetchMock
        .mockResolvedValueOnce(
          reponseErreur(403, 'The model `' + MODELES_CHAT[0] + '` is blocked at the project level.'),
        )
        .mockResolvedValueOnce(reponseOk('Présent.'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.reply).toBe('Présent.');
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
    });

    it('passe au suivant quand un modèle ne répond pas à temps', async () => {
      /*
        Le trou le plus coûteux de l'ancienne boucle : elle énumérait les pannes
        autorisées à continuer, si bien qu'un délai dépassé — panne non listée —
        emportait les deux modèles suivants **et** le secours payant. Or un modèle
        lent ne dit rien de la disponibilité des autres : c'est au contraire le cas
        où le maillon suivant a toutes ses chances.
      */
      fetchMock
        .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        .mockResolvedValueOnce(reponseOk('Me revoilà.'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.reply).toBe('Me revoilà.');
      expect(resultat.erreur).toBeUndefined();
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
    });

    it('passe au suivant quand la connexion tombe', async () => {
      // Même raisonnement : un réseau qui lâche sur un appel ne condamne pas le
      // suivant. Aucun code d'erreur n'est posé ici, et c'est justement le cas que
      // l'ancienne liste blanche rejetait par défaut.
      fetchMock
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(reponseOk('Reconnecté.'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.reply).toBe('Reconnecté.');
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
    });

    it("garde la cause du silence, et le maillon qui a cédé", async () => {
      /*
        La cause n'existait que dans un `console.error` sur l'hébergeur — c'est-à-dire
        nulle part, puisque personne ne relit ces journaux le lendemain, et que c'est
        le lendemain qu'on se demande pourquoi quelqu'un est parti. Le tableau
        comptait les silences sans jamais pouvoir dire lequel des quatre gestes
        possibles il fallait faire.
      */
      fetchMock.mockResolvedValue(reponseSaturee());

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.erreur).toBe(true);
      expect(prisma.coachEchec.create).toHaveBeenCalledWith({
        data: { user_id: 'u1', code: 'GROQ_RATE_LIMIT', modele: DERNIER },
      });
    });

    it('redescend la chaîne quand un modèle rend 200 sans texte', async () => {
      /*
        Le même défaut que dans la boucle, d'un cran plus haut : le modèle avait
        « réussi », donc le repli était terminé et les maillons suivants — dont le
        filet payant — n'étaient jamais sollicités. Or ce n'est pas parce qu'un
        modèle rend du vide que le suivant en rendrait aussi.
      */
      fetchMock
        .mockResolvedValueOnce(reponseOk('   '))
        .mockResolvedValueOnce(reponseOk('Je suis là.'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.reply).toBe('Je suis là.');
      expect(resultat.erreur).toBeUndefined();
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
      expect(prisma.coachEchec.create).not.toHaveBeenCalled();
    });

    it('n’insiste pas au-delà du second maillon muet', async () => {
      /*
        Si deux modèles se taisent d'affilée, la cause n'est plus le modèle mais ce
        qu'on lui envoie : un troisième appel paierait le même vide. Le code du
        silence dit « VIDE » et non « inconnu » — le ranger dans « inconnu »
        enverrait chercher chez le fournisseur une panne qui est de notre côté.
      */
      fetchMock.mockResolvedValue(reponseOk('   '));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.erreur).toBe(true);
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
      expect(prisma.coachEchec.create).toHaveBeenCalledWith({
        data: { user_id: 'u1', code: 'VIDE', modele: DEUXIEME },
      });
    });

    it('ne transforme pas une trace impossible en panne supplémentaire', async () => {
      // On est dans le `catch` de la réponse au coach : une exception lancée là ne
      // serait rattrapée par personne et changerait un message d'excuse en 500.
      prisma.coachEchec.create.mockImplementation(() => {
        throw new Error('base injoignable');
      });
      fetchMock.mockResolvedValue(reponseSaturee());

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.erreur).toBe(true);
      expect(resultat.reply).toContain('Trop de monde');
    });

    it("s'arrête sur un 403 qui ne parle pas de modèle", async () => {
      // Un compte suspendu, par exemple : réessayer sur les autres modèles ne ferait
      // que retarder la même erreur. La distinction se joue sur le corps de la réponse.
      fetchMock.mockResolvedValue(reponseErreur(403, 'forbidden'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(resultat.erreur).toBe(true);
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

    it('annonce la saturation même si les modèles de repli sont interdits', async () => {
      // Situation réelle avec deux modèles bloqués sur le projet : la dernière erreur
      // de la chaîne est un 403 de configuration, mais ce que la personne doit lire
      // c'est « réessaie dans une minute » — la seule information qui lui serve.
      fetchMock
        .mockResolvedValueOnce(reponseSaturee())
        .mockResolvedValue(reponseErreur(403, 'The model is blocked at the project level.'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME, DERNIER]);
      expect(resultat.reply).toContain('Trop de monde');
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

    it('envoie une retouche au schéma d’édition, pas au schéma complet', async () => {
      /*
        « Ajoute une séance de sport le mardi » touche UNE ligne. Le schéma complet
        pèse 1 951 jetons et ne sait que tout remplacer ; celui d'édition en pèse
        504 et nomme sa cible. Sur une limite de 8 000 jetons par minute partagée
        par toute l'application, ce choix décide du nombre de gens qu'on sert.

        Et il reste un seul appel : le filet du second appel ne doit servir que
        quand on s'est trompé.
      */
      fetchMock.mockResolvedValueOnce(
        reponseOk('Ajouté. <PLAN>{"edits":[{"op":"task.add","routine":"MORNING","value":"Course (5 km)"}]}</PLAN>'),
      );

      await service.chatWithAi('u1', 'Ajoute une séance de sport le mardi');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(consigne(0)).not.toContain(EXTRAIT_SCHEMA);
      expect(consigne(0)).toContain('MODIFIER UN SEUL ÉLÉMENT');
    });

    it('garde le schéma complet pour un ordre visant le plan entier', async () => {
      fetchMock.mockResolvedValueOnce(reponseOk("C'est parti. <PLAN>{}</PLAN>"));

      await service.chatWithAi('u1', 'Refais-moi mon programme complet');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(consigne(0)).toContain(EXTRAIT_SCHEMA);
    });

    it('joint le schéma complet quand la demande porte sur un apprentissage', async () => {
      /*
        « Donne moi toute les notion à apprendre » — capture d'un vrai échange du
        21 août 2026. Un parcours d'apprentissage crée des objectifs ET des
        routines : c'est un plan entier sous un autre nom, et l'envoyer au schéma
        d'édition le ferait remonter par `BESOIN_SCHEMA_PLAN`, au prix d'un
        aller-retour sur une demande qu'on savait reconnaître.
      */
      fetchMock.mockResolvedValueOnce(reponseOk('Voici le parcours. <PLAN>{}</PLAN>'));

      await service.chatWithAi('u1', 'Donne moi toute les notion à apprendre');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(consigne(0)).toContain(EXTRAIT_SCHEMA);
    });

    it('laisse le modèle réclamer le schéma complet depuis une retouche', async () => {
      /*
        C'est ce qui rend le partage sûr : se tromper d'outil ne coûte qu'un
        aller-retour, et le mécanisme existait déjà pour les messages sans schéma.
      */
      fetchMock
        .mockResolvedValueOnce(reponseOk('BESOIN_SCHEMA_PLAN'))
        .mockResolvedValueOnce(reponseOk('Voilà. <PLAN>{"replaceRoutines":true}</PLAN>'));

      await service.chatWithAi('u1', 'change mon repas du soir et tout le reste');

      expect(consigne(0)).toContain('MODIFIER UN SEUL ÉLÉMENT');
      expect(consigne(1)).toContain(EXTRAIT_SCHEMA);
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

  /*
    Le plan ordonné et jamais rendu.

    Mesuré contre le vrai Groq le 24 août 2026 : `openai/gpt-oss-20b` — dernier
    maillon, donc celui qui répond quand les deux premiers saturent — refuse
    « Je ne peux pas créer un plan complet pour toute la semaine en une seule
    réponse », puis écrit la routine en Markdown. La réponse se lit bien et
    l'application reste vide.

    C'était la seule panne du fichier sans rattrapage ni trace : ni le marqueur
    réclamé, ni le 200 muet, ni la troncature ne la couvrent, parce qu'ici le
    modèle a parfaitement réussi son appel — il a juste répondu autre chose.
  */
  describe('plan ordonné et non rendu', () => {
    const ORDRE = 'fais-moi un plan complet pour la semaine';

    it('redescend la chaîne en écartant le maillon qui a refusé', async () => {
      fetchMock
        .mockResolvedValueOnce(reponseOk("Je ne peux pas tout faire d'un coup. Voici lundi : 20 pompes."))
        .mockResolvedValueOnce(reponseOk('Voilà. <PLAN>{"replaceRoutines":true}</PLAN>'));

      const resultat: any = await service.chatWithAi('u1', ORDRE);

      // Pas une seconde chance donnée au même modèle : c'est lui le problème.
      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
      expect(resultat.reply).toContain('<PLAN>');
      expect(resultat.erreur).toBeUndefined();
    });

    it('garde la première réponse et prévient quand les deux refusent', async () => {
      const prose = 'On va y aller étape par étape. Lundi : 20 pompes.';
      fetchMock.mockResolvedValue(reponseOk(prose));

      const resultat: any = await service.chatWithAi('u1', ORDRE);

      // La réponse est écrite, lisible et déjà payée : la jeter coûterait deux
      // appels pour rendre moins que ce qu'on avait.
      expect(resultat.reply).toContain(prose);
      expect(resultat.erreur).toBeUndefined();
      // Mais elle ne passe pas pour un succès : sans cette phrase, la personne ne
      // voit rien apparaître dans son application et n'a aucun moyen de le savoir.
      expect(resultat.reply).toContain("Je n'ai rien installé dans ton plan");
    });

    it('ne demande jamais plus de 1500 jetons, schéma joint ou non', async () => {
      /*
        **Ce plafond est imposé de l'extérieur, pas choisi.** Groq compte 8 000
        jetons par minute pour l'organisation entière et inclut `max_tokens` dans
        le total demandé ; l'invite d'une demande de plan en pèse déjà ~6 000.

        Constaté en production le 26 août 2026 à 16 h 24, sur un vrai utilisateur,
        après un passage à 2600 « pour éviter les troncatures » :
        `413 — Request too large … TPM: Limit 8000, Requested 8965`, sur les trois
        modèles. Une requête plus grosse que la limite par minute ne passe JAMAIS,
        et elle consomme la minute de tout le monde en échouant.

        Ce test existe pour que personne ne relève ce nombre en croyant régler une
        troncature : il supprimerait la fonctionnalité au lieu de la réparer.
      */
      fetchMock.mockResolvedValueOnce(reponseOk('C\'est parti. <PLAN>{}</PLAN>'));
      await service.chatWithAi('u1', ORDRE);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(1500);

      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(reponseOk('Bien reçu.'));
      await service.chatWithAi('u1', 'Comment tu vas ?');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(1500);
    });

    it('ne relance rien quand le bloc est là', async () => {
      fetchMock.mockResolvedValueOnce(reponseOk('C\'est parti. <PLAN>{}</PLAN>'));

      await service.chatWithAi('u1', ORDRE);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    /*
      Le cas qui décide de tout le coût de ce filet.

      « J'ai fini ma routine » contient le mot « routine » : le schéma est donc
      joint, et la réponse ne contient aucun bloc — c'est même ce que les
      instructions exigent sur un compte rendu de progrès. Relancer là-dessus
      ferait payer un aller-retour supplémentaire sur l'un des messages les plus
      fréquents de l'application, pour rien.
    */
    it('ne relance pas sur un compte rendu de progrès', async () => {
      fetchMock.mockResolvedValueOnce(reponseOk('Acté. Enchaîne sur le gainage ce soir.'));

      await service.chatWithAi('u1', "J'ai fini ma routine ce matin");

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    /*
      Le déclencheur qui ne dépend d'aucun vocabulaire d'utilisateur.

      Reproduction exacte du 26 août 2026, 16 h 24 : « Construis-moi mon plan
      complet, je te fais confiance ». Le verbe manquait à la liste, donc rien ne
      s'est déclenché — et le coach a répondu « Ce plan crée une structure complète
      adaptée à ton emploi du temps d'étudiant » sans qu'aucun plan n'existe.

      Aucune liste de verbes ne couvrira le français. Celle-ci n'a pas à le faire :
      un coach qui écrit « ce plan » doit en avoir produit un.
    */
    it('se déclenche sur un coach qui annonce un plan inexistant', async () => {
      fetchMock
        .mockResolvedValueOnce(
          reponseOk('Ce plan crée une structure complète adaptée à ton emploi du temps.'),
        )
        .mockResolvedValueOnce(reponseOk('En place. <PLAN>{"replaceRoutines":true}</PLAN>'));

      const resultat: any = await service.chatWithAi(
        'u1',
        'Construis-moi mon plan complet, je te fais confiance',
      );

      expect(modelesAppeles()).toEqual([PREMIER, DEUXIEME]);
      expect(resultat.reply).toContain('<PLAN>');
    });

    it('ne se déclenche pas quand le coach ne parle d’aucun plan', () => {
      // L'asymétrie joue dans le bon sens : pas d'annonce, pas de relance.
      expect(AiCoachingService.annonceUnPlan('Tu as tenu 4 jours. Fais tes squats.')).toBe(false);
      expect(AiCoachingService.annonceUnPlan('Ce plan tient dans tes 20 minutes.')).toBe(true);
    });

    it("n'accuse pas d'échec un modèle qui demande une précision", async () => {
      const question = 'Tu veux un plan sur combien de jours ?';
      fetchMock.mockResolvedValue(reponseOk(question));

      const resultat: any = await service.chatWithAi('u1', ORDRE);

      // Demander avant d'écrire est un comportement correct : lui coller un
      // avertissement d'échec contredirait la question qu'il vient de poser.
      expect(resultat.reply).toBe(question);
    });
  });

  /*
    La phrase que la personne lit après avoir demandé un rappel.

    Elle est écrite par le serveur et non par le modèle, parce que lui seul sait
    ce qui a vraiment été écrit en base. Depuis que le rappel part aussi par
    e-mail, elle doit dire **par quel canal** : « je te le rappelle à 22 h 30 »
    chez quelqu'un sans notification veut dire un e-mail, et ne pas le préciser le
    laisse guetter une sonnerie pendant qu'un message l'attend ailleurs.
  */
  describe('la confirmation d’un rappel', () => {
    /** Demain à 9 h, en heure de Paris : ni dans le passé, ni recalé au jour même. */
    const DEMAIN = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Paris',
    });
    const DEMANDE = 'rappelle-moi demain à 09:00 mes pompes';
    const REPONSE = `Noté.\n<RAPPEL ${DEMAIN}T09:00>Tes 25 pompes.</RAPPEL>`;

    beforeEach(() => {
      // Le service ne confirme que ce que `poser` a réellement écrit : on lui fait
      // rendre ce qu'il reçoit, ce qui est le cas d'une écriture réussie.
      (service as any).rappels.poser = jest.fn(async (_u: string, demandes: any[]) => demandes);
      fetchMock.mockResolvedValueOnce(reponseOk(REPONSE));
    });

    it('ne nomme aucun canal quand la notification est ouverte', async () => {
      const resultat: any = await service.chatWithAi('u1', DEMANDE);

      expect(resultat.reply).toContain('je te le rappelle');
      expect(resultat.reply).not.toContain('e-mail');
    });

    it('dit que ça passera par e-mail quand aucun appareil n’est abonné', async () => {
      prisma.pushSubscription.count.mockResolvedValue(0);

      const resultat: any = await service.chatWithAi('u1', DEMANDE);

      expect(resultat.reply).toContain('par e-mail');
      expect(resultat.reply).toContain('je te le rappelle');
    });

    it('prévient quand aucun des deux canaux n’est ouvert', async () => {
      // La ligne existe, et personne ne la lira jamais. On aurait remplacé une
      // promesse fausse par une promesse muette, ce qui ne vaut pas mieux — et la
      // personne l'apprend maintenant, pas à 9 h.
      prisma.pushSubscription.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue({ relances_email: false });

      const resultat: any = await service.chatWithAi('u1', DEMANDE);

      expect(resultat.reply).toContain('rien ne partira');
    });
  });

  /*
    Le plan qui déborde du temps déclaré.

    Le serveur ne lisait jamais le contenu du bloc : il le passe au navigateur, qui
    l'applique. Un plan trois fois trop long s'installait donc exactement comme un
    bon — JSON valide, tâches visibles, aucune erreur nulle part. La seule trace
    était quelqu'un qui n'ouvrait plus l'application.
  */
  describe('AiCoachingService.minutesDuJourLePlusCharge', () => {
    const bloc = (plan: any) => `Voilà ton plan.\n<PLAN>${JSON.stringify(plan)}</PLAN>`;

    it('additionne les trois moments de la même journée', () => {
      /*
        Le plan réellement rendu par `openai/gpt-oss-20b` le 26 août 2026, à
        quelqu'un ayant déclaré 20 minutes : 3×5 le matin, 3×15 le midi, 10 le
        soir, tous les jours. Soixante-dix minutes. Le modèle avait écrit « Tu as
        20 min par jour, pas plus » dans la phrase juste au-dessus.
      */
      const plan = {
        newRoutines: [
          {
            type: 'MORNING',
            tasks: [
              { title: 'Squats (4x12)', duration: 5 },
              { title: 'Planche (3x45s)', duration: 5 },
              { title: 'Lecture 10 pages', duration: 5 },
            ],
          },
          {
            type: 'MIDDAY',
            tasks: [
              { title: 'Séance 1', duration: 15 },
              { title: 'Séance 2', duration: 15 },
              { title: 'Séance 3', duration: 15 },
            ],
          },
          { type: 'EVENING', tasks: [{ title: 'Bilan écrit', duration: 10 }] },
        ],
      };

      expect(AiCoachingService.minutesDuJourLePlusCharge(bloc(plan))).toBe(70);
    });

    it('compte une tâche sans « jours » tous les jours de la semaine', () => {
      // C'est la règle du schéma, et l'ignorer ferait passer pour léger un plan qui
      // tombe sept fois.
      const plan = {
        newRoutines: [{ type: 'MORNING', tasks: [{ title: 'Méditation', duration: 12 }] }],
      };

      expect(AiCoachingService.minutesDuJourLePlusCharge(bloc(plan))).toBe(12);
    });

    it('rend le jour le plus chargé, pas la moyenne', () => {
      // Un plan qui met tout le lundi et rien le reste de la semaine déborde le
      // lundi. La moyenne le dirait raisonnable, et c'est le lundi qu'on abandonne.
      const plan = {
        newRoutines: [
          {
            type: 'MORNING',
            tasks: [
              { title: 'Squats (4x12)', duration: 30, jours: ['lundi'] },
              { title: 'Étirements', duration: 5, jours: ['lundi', 'mercredi'] },
            ],
          },
        ],
      };

      expect(AiCoachingService.minutesDuJourLePlusCharge(bloc(plan))).toBe(35);
    });

    it('ignore une durée absente ou aberrante', () => {
      const plan = {
        newRoutines: [
          {
            type: 'MORNING',
            tasks: [
              { title: 'Sans durée' },
              { title: 'Durée négative', duration: -10 },
              { title: 'Squats (4x12)', duration: 8 },
            ],
          },
        ],
      };

      expect(AiCoachingService.minutesDuJourLePlusCharge(bloc(plan))).toBe(8);
    });

    it('rend null sur un bloc absent, vide ou cassé', () => {
      // Un JSON cassé se voit déjà côté navigateur, qui affiche « Je n'ai pas
      // réussi à appliquer ce plan ». Rien à ajouter ici.
      expect(AiCoachingService.minutesDuJourLePlusCharge('Rien à signaler.')).toBeNull();
      expect(AiCoachingService.minutesDuJourLePlusCharge('<PLAN>{"newRou</PLAN>')).toBeNull();
      expect(AiCoachingService.minutesDuJourLePlusCharge(bloc({ newHabits: [] }))).toBeNull();
    });

    /** Un plan dont le jour le plus chargé pèse `minutes`. */
    const planDe = (minutes: number) =>
      bloc({ newRoutines: [{ type: 'MIDDAY', tasks: [{ title: 'Squats (4x12)', duration: minutes }] }] });

    it('journalise un léger dépassement sans repayer un appel', async () => {
      /*
        24 minutes pour 20 se rattrape en sautant une tâche un jour chargé. Payer
        un appel de plus pour ça doublerait le coût de presque chaque demande de
        plan : mesuré le 26 août, les trois modèles dépassent, mais deux de peu.
      */
      const trace = jest.spyOn(console, 'error');
      memoire.chargerProfil.mockResolvedValue({ minutes_par_jour: 20 });
      fetchMock.mockResolvedValueOnce(reponseOk(planDe(24)));

      const resultat: any = await service.chatWithAi('u1', 'fais-moi un plan complet');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(resultat.reply).toContain('<PLAN>');
      const message = trace.mock.calls.map((a) => String(a[0])).join('\n');
      expect(message).toContain('Plan hors budget');
      expect(message).toContain('24 min');
    });

    it('renvoie le calcul au modèle quand le plan déborde vraiment', async () => {
      /*
        70 minutes pour 20 — le cas réellement mesuré sur `gpt-oss-20b` — est un
        plan qu'on n'ouvre plus au bout de trois jours.

        On lui dit le total qu'il a raté plutôt que de rogner nous-mêmes : rogner
        donnerait un plan que le coach n'a pas composé, et il ne saurait ni
        laquelle des tâches il vient de perdre, ni pourquoi. Il ne sait pas
        additionner en écrivant ; il sait très bien retirer quand on lui montre
        le total.
      */
      memoire.chargerProfil.mockResolvedValue({ minutes_par_jour: 20 });
      fetchMock
        .mockResolvedValueOnce(reponseOk(planDe(70)))
        .mockResolvedValueOnce(reponseOk(planDe(18)));

      const resultat: any = await service.chatWithAi('u1', 'fais-moi un plan complet');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // La correction porte les deux nombres : celui qu'il a écrit, et celui qu'il
      // avait déclaré. Sans eux, « fais plus court » ne dit pas de combien.
      expect(consigne(1)).toContain('70 minutes');
      expect(consigne(1)).toContain('20');
      expect(AiCoachingService.minutesDuJourLePlusCharge(resultat.reply)).toBe(18);
    });

    it('garde la première réponse si la correction ne fait pas mieux', async () => {
      /*
        Un modèle à qui l'on signale une erreur peut très bien rendre pire. Sans
        cette comparaison, la correction serait un pari — et on paierait un appel
        pour dégrader le plan.
      */
      const trace = jest.spyOn(console, 'error');
      memoire.chargerProfil.mockResolvedValue({ minutes_par_jour: 20 });
      fetchMock
        .mockResolvedValueOnce(reponseOk(planDe(70)))
        .mockResolvedValueOnce(reponseOk(planDe(90)));

      const resultat: any = await service.chatWithAi('u1', 'fais-moi un plan complet');

      expect(AiCoachingService.minutesDuJourLePlusCharge(resultat.reply)).toBe(70);
      expect(trace.mock.calls.map((a) => String(a[0])).join('\n')).toContain(
        'toujours hors budget après correction',
      );
    });

    it('ne corrige rien quand aucun temps n’a été déclaré', async () => {
      // Sans budget déclaré, il n'y a pas de dépassement possible : on ne va pas
      // inventer une limite au nom de quelqu'un qui n'en a pas donné.
      memoire.chargerProfil.mockResolvedValue({ minutes_par_jour: null });
      fetchMock.mockResolvedValueOnce(reponseOk(planDe(120)));

      await service.chatWithAi('u1', 'fais-moi un plan complet');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * La détection décide de relancer un appel : son biais est donc l'inverse de
   * `MOTS_PLAN`, qui ne décide que de joindre un millier de jetons.
   */
  describe('AiCoachingService.ordreDePlan', () => {
    it.each([
      // Message d'un vrai utilisateur, 26 août 2026 à 16 h 24. « construis »
      // manquait à la liste : le filet ne s'est pas déclenché, et il a redemandé
      // quatre minutes plus tard.
      'Construis-moi mon plan complet, je te fais confiance',
      'bâtis-moi un programme de sport',
      'fais-moi un plan complet pour la semaine',
      'Ajoute une habitude de lecture le soir',
      'refais mon programme de muscu',
      'stp crée mon planning de la semaine',
      'change tout',
      'que dois-je faire ensuite',
      'Supprime le repas du soir',
    ])('y voit un ordre : %s', (message) => {
      expect(AiCoachingService.ordreDePlan(message)).toBe(true);
    });

    it.each([
      'je fais ma routine tous les matins',
      "J'ai fini ma routine ce matin",
      'ma séance était dure aujourd hui',
      'je change tout dans ma vie en ce moment',
      'Comment tu vas ?',
      'Je veux arrêter de procrastiner le matin',
    ])('n’y voit pas un ordre : %s', (message) => {
      expect(AiCoachingService.ordreDePlan(message)).toBe(false);
    });
  });

  /*
    Une réponse arrêtée par `max_tokens` arrive en 200, avec la même forme qu'une
    réponse terminée. Ici le budget est de 1500 jetons et un plan complet en occupe
    près de 1100 : c'est le seul endroit du projet où la coupure est vraisemblable.

    Le parti pris est de ne jamais jeter la réponse. Mille cinq cents jetons de texte
    utile valent mieux qu'un message d'erreur, et les refacturer serait pire encore.
  */
  describe('une réponse coupée par max_tokens', () => {
    const reponseCoupee = (contenu: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: contenu }, finish_reason: 'length' }] }),
    });

    it('marque la prose interrompue au lieu de la faire passer pour finie', async () => {
      fetchMock.mockResolvedValueOnce(reponseCoupee('Tu as tenu quatre jours, et ce qui compte maintenant'));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.reply).toBe('Tu as tenu quatre jours, et ce qui compte maintenant…');
      // Surtout pas une erreur : le texte reçu est utile et il a déjà été payé.
      expect(resultat.erreur).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('ne double pas la ponctuation quand la coupure tombe sur un point', async () => {
      fetchMock.mockResolvedValueOnce(reponseCoupee('Tu as tenu quatre jours. '));

      const resultat: any = await service.chatWithAi('u1', 'Comment tu vas ?');

      expect(resultat.reply).toBe('Tu as tenu quatre jours…');
    });

    /*
      Bloc <PLAN> ouvert : son JSON est forcément incomplet, `JSON.parse` échouera
      dans le navigateur et la personne lira déjà « Je n'ai pas réussi à appliquer ce
      plan ». Ajouter des points de suspension à un message qui annonce fièrement un
      plan ne dirait rien d'utile — ce qui manquait, c'était la trace côté serveur.
    */
    it('laisse le message intact quand un bloc de plan est ouvert', async () => {
      const coupee = 'Voilà ton programme.\n<PLAN>{"newRoutines":[{"title":"Matin","items":[{"title":"Cour';
      fetchMock.mockResolvedValueOnce(reponseCoupee(coupee));

      const resultat: any = await service.chatWithAi('u1', 'refais-moi un plan');

      expect(resultat.reply).toBe(coupee);
      expect(resultat.erreur).toBeUndefined();
    });

    it('laisse une trace exploitable dans les journaux', async () => {
      const trace = jest.spyOn(console, 'warn');
      fetchMock.mockResolvedValueOnce(reponseCoupee('Voilà ton programme.\n<PLAN>{"newRou'));

      await service.chatWithAi('u1', 'refais-moi un plan');

      // Sans cette ligne, on chercherait la cause dans la mise en forme du modèle
      // alors qu'elle est dans le plafond de jetons.
      const message = trace.mock.calls.map((a) => String(a[0])).join('\n');
      expect(message).toContain('max_tokens');
      expect(message).toContain(PREMIER);
      expect(message).toContain('<PLAN> ouvert');
    });

    /*
      Le journal dit si le schéma était joint, parce que c'est lui qui explique la
      coupure : il pèse à lui seul un bon millier de jetons. Le déduire du message de
      départ le ferait mentir dans le seul cas où l'information compte — celui où la
      détection par mots-clés est passée à côté et où le modèle a réclamé le schéma
      lui-même. On chercherait alors la cause dans la mauvaise moitié du prompt.
    */
    it('dit le schéma réellement joint, et non celui qu’on avait prévu', async () => {
      const trace = jest.spyOn(console, 'warn');
      fetchMock
        .mockResolvedValueOnce(reponseOk('BESOIN_SCHEMA_PLAN'))
        .mockResolvedValueOnce(reponseCoupee('Voilà ton programme.'));

      // Message qui ne déclenche pas la détection : le schéma était donc « omis » au
      // premier appel, et bien joint au second, celui qui a été coupé.
      await service.chatWithAi('u1', 'Je veux arrêter de procrastiner le matin');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(trace.mock.calls.map((a) => String(a[0])).join('\n')).toContain('schéma joint');
    });
  });
});

/**
 * Le coach recevait le niveau d'une habitude mais jamais sa régularité — or un
 * niveau 4 peut n'avoir pas été tenu depuis trois semaines. Il ne pouvait donc pas
 * faire la seule observation qui compte vraiment : « tu as sauté ça quatre fois
 * cette semaine ». L'historique était pourtant déjà envoyé par le client.
 */
describe('AiCoachingService.joursTenus — régularité des habitudes', () => {
  const cle = (ilYaNJours: number) =>
    new Date(Date.now() - ilYaNJours * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

  it('compte les jours tenus dans la fenêtre de sept jours', () => {
    expect(AiCoachingService.joursTenus([cle(0), cle(1), cle(3)])).toBe(3);
  });

  it('ignore ce qui est plus vieux que sept jours', () => {
    expect(AiCoachingService.joursTenus([cle(0), cle(30), cle(200)])).toBe(1);
  });

  // Une habitude cochée deux fois le même jour affichait 8/7, ce qui décrédibilise
  // instantanément le coach qui s'appuie dessus.
  it('compte les jours et non les lignes, si une date revient deux fois', () => {
    expect(AiCoachingService.joursTenus([cle(2), cle(2), cle(2)])).toBe(1);
  });

  it("accepte une date horodatée, en n'en gardant que le jour", () => {
    expect(AiCoachingService.joursTenus([`${cle(1)}T08:30:00.000Z`])).toBe(1);
  });

  it('rend 0 sur une habitude sans historique, quelle qu\'en soit la forme', () => {
    expect(AiCoachingService.joursTenus(undefined)).toBe(0);
    expect(AiCoachingService.joursTenus(null)).toBe(0);
    expect(AiCoachingService.joursTenus('pas un tableau')).toBe(0);
    expect(AiCoachingService.joursTenus([])).toBe(0);
  });

  it('ne se laisse pas déborder par des entrées qui ne sont pas des dates', () => {
    expect(AiCoachingService.joursTenus([null, 42, {}, cle(0)])).toBe(1);
  });
});

/**
 * Un bloc technique s'est affiché en clair dans la conversation, sous une phrase
 * annonçant fièrement le plan : quarante lignes de JSON, et rien d'appliqué. La
 * fermeture était arrivée mutilée (« ; ↘'PLAN> »), et l'expression employée exigeait
 * les deux balises intactes.
 *
 * Côté serveur, la conséquence était pire qu'un affichage : le bloc restait dans
 * l'historique et repartait au modèle à chaque message suivant, qui y lisait un
 * exemple de sa propre production ratée.
 */
describe('AiCoachingService.retirerPlan — nettoyage de l\'historique', () => {
  it('retire un bloc correctement fermé', () => {
    expect(AiCoachingService.retirerPlan('Voici ton plan.<PLAN>{"newHabits":[]}</PLAN>')).toBe('Voici ton plan.');
  });

  it('retire un bloc dont la fermeture est mutilée', () => {
    const abime = `Voici ton plan.<PLAN> , , { "newMicroObjectives": [] } ] ; ↘'PLAN>`;

    const propre = AiCoachingService.retirerPlan(abime);

    expect(propre).toBe('Voici ton plan.');
    expect(propre).not.toContain('{');
  });

  it('retire un bloc sans aucune fermeture', () => {
    expect(AiCoachingService.retirerPlan('Allez !<PLAN>\n{ "newRoutines": [] }')).toBe('Allez !');
  });

  // Le modèle écrit parfois une phrase après son bloc : elle appartient à la
  // conversation et doit survivre.
  it('conserve ce qui suit le bloc', () => {
    expect(AiCoachingService.retirerPlan('Avant.<PLAN>{}</PLAN>Après.')).toBe('Avant.\nAprès.');
  });

  it('ne touche pas à un message ordinaire', () => {
    const message = 'Bravo pour ta séance ! On continue comme ça 💪';

    expect(AiCoachingService.retirerPlan(message)).toBe(message);
  });

  // Le mot « plan » est courant dans la bouche d'un coach : seule la balise compte.
  it('ne confond pas le mot « plan » avec la balise', () => {
    const message = "Ton plan d'action est prêt, on l'attaque demain.";

    expect(AiCoachingService.retirerPlan(message)).toBe(message);
  });
});

/**
 * L'objectif déclaré était en écriture seule : rempli à l'inscription, lu par le
 * seul prompt du serveur, jamais réaffiché. L'app le remet maintenant sous les yeux
 * de la personne — ce qui n'est défendable que s'il reste modifiable, sinon un choix
 * fait en trente secondes le jour de l'inscription devient un reproche quotidien.
 */
describe('AiCoachingService — l\'objectif déclaré', () => {
  let service: AiCoachingService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      aIProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ update, create }: any) => ({
          objectives: (update?.objectives ?? create?.objectives) as string[],
        })),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObservationService,
        AnalyseHabitudesService,
        {
          provide: RappelService,
          // Les rappels ont leur propre suite : ici on veut seulement que le
          // module se construise, et qu aucun rappel ne soit pose.
          useValue: {
            poser: jest.fn().mockResolvedValue([]),
            dus: jest.fn().mockResolvedValue([]),
            marquerEnvoye: jest.fn(),
            abandonnerLesPerimes: jest.fn().mockResolvedValue(0),
          },
        },AiCoachingService, CoachMemoryService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AiCoachingService);
  });

  it('rend le premier objectif du profil', async () => {
    prisma.aIProfile.findUnique.mockResolvedValue({
      objectives: ['Devenir constant', 'Autre chose'],
      occupation: 'Étudiant',
      personality: null,
      coaching_style: null,
      situation: 'Genou fragile',
      minutes_par_jour: 30,
      niveau_depart: 'reprise',
    });

    expect(await service.lireProfil('u1')).toEqual({
      objectif: 'Devenir constant',
      occupation: 'Étudiant',
      personality: null,
      coaching_style: null,
      situation: 'Genou fragile',
      minutesParJour: 30,
      niveau: 'reprise',
      // Nul veut dire « rien de regle » : le brief part alors a 10 h, comme avant.
      reveil: null,
      cadrageManquant: false,
    });
  });

  /**
   * Le questionnaire ne se rejoue que pour un compte sans profil du tout. Les comptes
   * ouverts avant que le temps et le niveau ne soient demandés ont donc un profil
   * complet à l'ancienne et ne repasseront jamais par l'inscription : sans ce
   * drapeau, leur coach doserait leurs plans au hasard indéfiniment.
   */
  it('signale le cadrage manquant sur un compte ouvert avant ces questions', async () => {
    prisma.aIProfile.findUnique.mockResolvedValue({
      objectives: ['Devenir constant'],
      occupation: 'Salarié',
      personality: null,
      coaching_style: null,
      situation: null,
      minutes_par_jour: null,
      niveau_depart: null,
    });

    const profil = await service.lireProfil('u1');
    expect(profil.cadrageManquant).toBe(true);
  });

  // La situation est facultative : n'avoir aucune blessure à déclarer ne rend pas un
  // profil incomplet, et redemanderait indéfiniment à ceux qui n'ont rien à dire.
  it('ne réclame rien à qui a répondu temps et niveau sans situation', async () => {
    prisma.aIProfile.findUnique.mockResolvedValue({
      objectives: [],
      occupation: null,
      personality: null,
      coaching_style: null,
      situation: null,
      minutes_par_jour: 15,
      niveau_depart: 'sedentaire',
    });

    expect((await service.lireProfil('u1')).cadrageManquant).toBe(false);
  });

  // Un compte peut n'avoir aucun profil : le questionnaire a longtemps échoué en
  // silence, et ces comptes-là existent toujours en production.
  it('ne casse pas sur un compte sans profil', async () => {
    expect(await service.lireProfil('u1')).toEqual({
      objectif: null,
      occupation: null,
      personality: null,
      coaching_style: null,
      situation: null,
      minutesParJour: null,
      niveau: null,
      reveil: null,
      cadrageManquant: true,
    });
  });

  it('borne un temps disponible venu d\'un client modifié', async () => {
    await service.majCadrage('u1', { minutesParJour: 9999 });
    expect(prisma.aIProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { minutes_par_jour: 240 } }),
    );
  });

  it('refuse un niveau de départ inventé', async () => {
    await expect(service.majCadrage('u1', { niveau: 'champion' })).rejects.toThrow('Niveau de départ inconnu.');
  });

  /**
   * Une blessure guérit, des examens passent. Sans ce cas, une contrainte périmée
   * resterait dans le prompt du coach pour toujours, et il continuerait à composer
   * des plans autour d'un genou qui ne fait plus mal.
   */
  it('accepte la chaîne vide pour retirer une contrainte périmée', async () => {
    await service.majCadrage('u1', { situation: '   ' });
    expect(prisma.aIProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { situation: null } }),
    );
  });

  it('ne touche que ce qu\'on lui envoie', async () => {
    await service.majCadrage('u1', { niveau: 'confirme' });
    expect(prisma.aIProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { niveau_depart: 'confirme' } }),
    );
  });

  it('refuse un appel qui ne changerait rien', async () => {
    await expect(service.majCadrage('u1', {})).rejects.toThrow('Rien à mettre à jour.');
  });

  it('enregistre un objectif en le nettoyant', async () => {
    expect(await service.majObjectif('u1', '   Devenir quelqu\'un de fiable   ')).toEqual({
      objectif: 'Devenir quelqu\'un de fiable',
    });
  });

  // Cette phrase est affichée en haut de l'écran et repart dans le prompt à chaque
  // message : sans plafond, elle déborderait de l'un et serait facturée dans l'autre.
  it('borne la longueur', async () => {
    const { objectif } = await service.majObjectif('u1', 'a'.repeat(300));

    expect(objectif).toHaveLength(AiCoachingService.MAX_OBJECTIF);
  });

  it('refuse un objectif vide ou fait d\'espaces', async () => {
    await expect(service.majObjectif('u1', '   ')).rejects.toThrow();
    expect(prisma.aIProfile.upsert).not.toHaveBeenCalled();
  });

  /*
    L'ouverture en cache a été écrite en connaissant l'ancien objectif. La garder
    ferait accueillir par une phrase qui parle du cap qu'on vient d'abandonner.
  */
  it('jette la phrase d\'ouverture en cache', async () => {
    await service.majObjectif('u1', 'Nouveau cap');

    expect(prisma.aIProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ouverture_texte: null, ouverture_genere_le: null } }),
    );
  });

  // Un compte sans profil doit pouvoir s'en donner un : c'est justement celui à qui
  // l'app n'a jamais réussi à poser la question.
  it('crée le profil s\'il n\'existe pas', async () => {
    await service.majObjectif('u1', 'Premier cap');

    expect(prisma.aIProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ user_id: 'u1', objectives: ['Premier cap'] }) }),
    );
  });
});
