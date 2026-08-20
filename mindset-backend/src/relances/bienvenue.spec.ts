import { contenuBienvenue, envoyerBienvenue, MOTIF_BIENVENUE } from './bienvenue';
import { PrismaService } from '../prisma/prisma.service';

/*
  Ce qui se vérifie ici tient en deux phrases.

  D'abord : le message part une fois, jamais deux, et la trace n'est écrite que
  si Brevo l'a accepté. Une trace posée sur un échec priverait la personne de son
  accueil en donnant à croire qu'elle l'a reçu — la panne muette habituelle du
  projet, celle qui produit un résultat plausible.

  Ensuite : rien de tout cela ne peut faire tomber une inscription. Le compte est
  déjà en base quand cette fonction est appelée ; la moindre exception qui
  remonterait rendrait une 500 à quelqu'un dont le compte existe, et il
  réessaierait sur un e-mail déjà pris.
*/
describe('bienvenue', () => {
  let prisma: any;

  const compte = (extra: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'nouveau@example.com',
    first_name: 'Laura',
    relances_email: true,
    created_at: new Date(),
    ...extra,
  });

  /** Un compte inscrit bien avant que l'accueil existe : le cas du rattrapage. */
  const ancien = (jours = 20) =>
    compte({ created_at: new Date(Date.now() - jours * 86_400_000) });

  beforeEach(() => {
    prisma = {
      relanceEmail: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    process.env.BREVO_API_KEY = 'cle-de-test';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' }) as any;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.BREVO_API_KEY;
    jest.restoreAllMocks();
  });

  /** Le corps JSON réellement envoyé à Brevo. */
  const envoi = () => JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);

  describe("l'envoi", () => {
    it('part à l’inscription et laisse une trace', async () => {
      const parti = await envoyerBienvenue(prisma as PrismaService, compte());

      expect(parti).toBe(true);
      expect(envoi().to).toEqual([{ email: 'nouveau@example.com' }]);
      expect(prisma.relanceEmail.create).toHaveBeenCalledWith({
        data: { user_id: 'u1', motif: MOTIF_BIENVENUE },
      });
    });

    it('n’écrit rien quand Brevo refuse', async () => {
      // La trace dit « envoyé », pas « tenté » : c'est elle qui autorise la tournée
      // de 11h à rattraper l'envoi manqué. L'écrire ici condamnerait la personne au
      // silence sans que rien ne le signale.
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, text: async () => 'quota dépassé' });

      const parti = await envoyerBienvenue(prisma as PrismaService, compte());

      expect(parti).toBe(false);
      expect(prisma.relanceEmail.create).not.toHaveBeenCalled();
    });

    it('ne souhaite pas deux fois la bienvenue', async () => {
      prisma.relanceEmail.findFirst.mockResolvedValue({ id: 'r1' });

      const parti = await envoyerBienvenue(prisma as PrismaService, compte());

      expect(parti).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('respecte quelqu’un qui s’est retiré', async () => {
      // Le cas ne se présente pas à l'inscription — le drapeau vaut vrai par
      // défaut — mais le rattrapage, lui, passe des jours plus tard.
      const parti = await envoyerBienvenue(prisma as PrismaService, compte({ relances_email: false }));

      expect(parti).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('ne lève jamais, même quand la base tombe', async () => {
      prisma.relanceEmail.findFirst.mockRejectedValue(new Error('connexion perdue'));

      await expect(envoyerBienvenue(prisma as PrismaService, compte())).resolves.toBe(false);
    });

    it('dit « toi » plutôt que rien quand le prénom manque', async () => {
      await envoyerBienvenue(prisma as PrismaService, compte({ first_name: null }));

      expect(envoi().subject).toBeTruthy();
      expect(envoi().htmlContent).toContain('toi, bienvenue');
      expect(envoi().htmlContent).not.toContain('null');
    });
  });

  describe("l'accueil rattrapé", () => {
    it('n’annonce pas la création d’un compte vieux de trois semaines', async () => {
      // C'est le point de tout le rattrapage : un message qui décrit un état faux
      // se lit comme un envoi automatique déréglé, et c'est ce qui fait cliquer
      // sur « indésirable ».
      await envoyerBienvenue(prisma as PrismaService, ancien());

      const corps = envoi();
      expect(corps.subject).toBe('Je ne t’avais jamais écrit');
      expect(corps.htmlContent).not.toContain('Ton compte est créé');
      expect(corps.htmlContent).toContain('en retard');
    });

    it('demande la même chose que l’accueil du jour même', async () => {
      // L'ouverture change, la demande non : parler au coach reste la seule action
      // qui prédise un retour, qu'on écrive le jour de l'inscription ou trois
      // semaines après.
      await envoyerBienvenue(prisma as PrismaService, ancien());

      expect(envoi().htmlContent).toContain('vue=chat');
      expect(envoi().htmlContent).toContain('parler une fois');
    });

    it('bascule sur l’âge du compte, pas sur un drapeau de l’appelant', async () => {
      // Deux chemins mènent à cet envoi. Un drapeau qu'on se transmet finit
      // oublié sur l'un des deux ; l'âge, lui, répond pareil à tout le monde.
      await envoyerBienvenue(prisma as PrismaService, compte({ created_at: new Date(Date.now() - 86_400_000) }));

      expect(envoi().subject).toBe('Ton compte est prêt');
    });
  });

  describe('ce qui est écrit', () => {
    const { sujet, html, texte, lienRetrait } = contenuBienvenue('Laura', 'u1');

    it('s’adresse à la personne par son prénom', () => {
      expect(html).toContain('Laura, bienvenue.');
      expect(texte).toContain('Laura, bienvenue.');
    });

    it('porte une partie texte et une sortie', () => {
      // Un message qui n'a qu'une partie HTML est un signal d'indésirable à lui
      // seul ; et depuis février 2024 Gmail exige la sortie en un clic de tout
      // expéditeur de masse. Sans elle, le message part en indésirable avant
      // d'être lu — les codes de connexion du même domaine avec lui.
      expect(texte.length).toBeGreaterThan(200);
      expect(lienRetrait).toContain('/emails/retrait');
      expect(html).toContain(lienRetrait);
      expect(texte).toContain(lienRetrait);
    });

    it('pousse vers le coach, pas vers le tableau de bord', () => {
      // Le seul trait commun de tous ceux qui ont tenu plus d'une journée est
      // d'avoir parlé au coach. Un accueil qui fait le tour des fonctions
      // disperse la seule action qui prédise un retour.
      expect(html).toContain('vue=chat');
      expect(html).toContain('Parler à mon coach');
    });

    it('n’emploie aucun vocabulaire de campagne', () => {
      // Ce ne sont pas des mots interdits par superstition : ce sont ceux sur
      // lesquels les filtres sont entraînés, et ceux qu'un produit qui ne vend
      // rien à cet instant n'a aucune raison d'employer.
      const interdits = [/gratuit/i, /offre/i, /promotion/i, /!!/, /100 %/, /urgent/i];
      for (const mot of interdits) {
        expect(sujet).not.toMatch(mot);
        expect(texte).not.toMatch(mot);
      }
      expect(sujet).not.toMatch(/[A-ZÀ-Ÿ]{4,}/);
    });
  });
});
