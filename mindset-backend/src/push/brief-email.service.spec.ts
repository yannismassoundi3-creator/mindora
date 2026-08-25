import { BriefEmailService } from './brief-email.service';
import { envoyerEmail } from '../common/email';

jest.mock('../common/email', () => ({
  envoyerEmail: jest.fn(),
  gabarit: jest.fn((o: any) => `<html>${o.titre}${o.corps}</html>`),
}));

/**
 * Le brief porté par e-mail à ceux que la notification n'atteint pas.
 *
 * Six personnes sur cinquante-deux étaient joignables par notification le 20 août
 * 2026. Ce canal-ci atteint tout le monde — c'est précisément ce qui le rend
 * dangereux : un e-mail de trop se signale comme indésirable, et le signalement
 * punit le domaine entier, codes de connexion compris.
 *
 * Ce qui se vérifie ici n'est donc pas que le message part. C'est qu'il ne part
 * pas quand il ne doit pas.
 */
describe('BriefEmailService', () => {
  let service: BriefEmailService;
  let prisma: any;
  const envInitial = { ...process.env };

  const COMPTE = { id: 'u1', email: 'quelqu-un@exemple.fr', first_name: 'Laura' };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BREVO_API_KEY = 'cle';
    process.env.BRIEF_EMAIL_CRENEAUX = 'matin';
    (envoyerEmail as jest.Mock).mockResolvedValue(true);

    prisma = {
      briefEmail: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    service = new BriefEmailService(prisma);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...envInitial };
  });

  describe('les créneaux allumés', () => {
    it('n’allume qu’un seul envoi QUOTIDIEN par défaut', () => {
      /*
        Ce test disait « un seul créneau », et sa raison était « trois envois
        quotidiens depuis un domaine sans historique est le signalement type d'un
        spammeur ». La raison n'a pas changé, le compte si : ce qui abîme une
        réputation d'expéditeur est la répétition quotidienne, pas le nombre de
        motifs.

        Le défaut ouvre donc `matin` — le seul brief quotidien — plus trois
        messages rares par construction : le coup de pouce est plafonné à un tous
        les trois jours par personne, le bilan est hebdomadaire, et l'alerte de
        série ne peut pas partir deux soirs de suite puisqu'elle exige d'avoir
        tenu la veille.

        `midi` et `soir` restent éteints : eux ajouteraient deux e-mails par jour
        à tout le monde, ce qui est exactement le cas que ce test protège.
      */
      delete process.env.BRIEF_EMAIL_CRENEAUX;
      const actifs = BriefEmailService.creneauxActifs();

      expect(actifs).toContain('matin');
      expect(actifs).not.toContain('midi');
      expect(actifs).not.toContain('soir');
      expect(actifs).toEqual(['matin', 'coup-de-pouce', 'bilan', 'serie']);
    });

    it('rend les créneaux dans l’ordre de la journée, quel que soit celui de la variable', () => {
      process.env.BRIEF_EMAIL_CRENEAUX = 'soir, matin';
      expect(BriefEmailService.creneauxActifs()).toEqual(['matin', 'soir']);
    });

    it('ignore un nom inconnu au lieu d’ouvrir un créneau au hasard', () => {
      // Une faute de frappe sur une variable d'environnement ne doit pas décider
      // d'un envoi de masse.
      process.env.BRIEF_EMAIL_CRENEAUX = 'matin,mtain';
      expect(BriefEmailService.creneauxActifs()).toEqual(['matin']);
    });

    it('n’écrit rien quand le créneau est éteint', async () => {
      process.env.BRIEF_EMAIL_CRENEAUX = 'matin';

      await expect(service.envoyer(COMPTE, 'soir', 'Bonne soirée.')).resolves.toBe(false);

      expect(envoyerEmail).not.toHaveBeenCalled();
    });
  });

  it('écrit à quelqu’un que la notification n’atteint pas', async () => {
    await expect(service.envoyer(COMPTE, 'matin', 'Ta série tient depuis 4 jours.')).resolves.toBe(true);

    const envoi = (envoyerEmail as jest.Mock).mock.calls[0][0];
    expect(envoi.destinataire).toBe('quelqu-un@exemple.fr');
    // Le prénom dans le sujet dit, en un coup d'œil, que ce n'est pas une campagne.
    expect(envoi.sujet).toContain('Laura');
    expect(envoi.html).toContain('Ta série tient depuis 4 jours.');
    // Sans en-tête de retrait, Gmail écarte le message avant qu'il soit lu.
    expect(envoi.lienRetrait).toContain('/emails/retrait');
    // La partie texte n'est pas une politesse : un message HTML seul est un
    // signal d'indésirable à lui tout seul.
    expect(envoi.texte).toContain('Ta série tient depuis 4 jours.');
  });

  it('respecte le retrait demandé une fois pour toutes', async () => {
    // Le drapeau vaut pour tout ce qui est périodique, pas seulement pour le
    // message depuis lequel la personne s'est retirée ce jour-là.
    await expect(
      service.envoyer({ ...COMPTE, relances_email: false }, 'matin', 'Bonjour.'),
    ).resolves.toBe(false);

    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  it('n’envoie pas deux fois le même brief dans la journée', async () => {
    /*
      La tournée passe toutes les demi-heures et le panneau d'administration peut
      la rejouer à la main dans le même créneau. Une notification reçue deux fois
      se remarque à peine ; un e-mail reçu deux fois se signale comme indésirable.
    */
    prisma.briefEmail.findUnique.mockResolvedValue({ id: 'deja' });

    await expect(service.envoyer(COMPTE, 'matin', 'Bonjour.')).resolves.toBe(false);

    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  it('ne marque jamais envoyé ce qui n’est pas parti', async () => {
    /*
      Le défaut le plus fréquent de ce projet, et le plus coûteux ici : une trace
      écrite avant l'envoi condamne la personne au silence de la journée en
      donnant à croire qu'elle a reçu quelque chose.
    */
    (envoyerEmail as jest.Mock).mockResolvedValue(false);

    await expect(service.envoyer(COMPTE, 'matin', 'Bonjour.')).resolves.toBe(false);

    expect(prisma.briefEmail.create).not.toHaveBeenCalled();
  });

  it('échappe ce que le modèle a écrit', async () => {
    // Le texte vient d'un modèle : un « < » ouvrirait une balise, et la fin du
    // message disparaîtrait de l'écran sans qu'aucune erreur ne soit levée.
    await service.envoyer(COMPTE, 'matin', 'Objectif < 10 min & repos');

    const envoi = (envoyerEmail as jest.Mock).mock.calls[0][0];
    expect(envoi.html).toContain('&lt; 10 min &amp; repos');
    expect(envoi.html).not.toContain('< 10 min');
  });

  it('reste envoyé même si la trace échoue', async () => {
    // Le message est parti : prétendre le contraire ferait recommencer la
    // tournée suivante, et c'est le doublon qu'on cherche à éviter.
    prisma.briefEmail.create.mockRejectedValue(new Error('base injoignable'));

    await expect(service.envoyer(COMPTE, 'matin', 'Bonjour.')).resolves.toBe(true);
  });

  /*
    Les trois messages qui n avaient aucun canal e-mail.

    Le coup de pouce, le bilan du dimanche et l alerte de serie sautaient
    purement les comptes sans notification, d un `continue`. Avec 6 personnes
    joignables par push sur 52, ils ne parlaient donc qu a 12 % des comptes — et
    l alerte de serie est justement celle qui previent AVANT la perte, la seule
    du produit qui arrive quand il reste quelque chose a sauver.
  */
  describe('les messages qui n avaient pas d e-mail', () => {
    it('porte le coup de pouce, le bilan et l alerte de serie', async () => {
      process.env.BRIEF_EMAIL_CRENEAUX = 'coup-de-pouce,bilan,serie';

      for (const creneau of ['coup-de-pouce', 'bilan', 'serie']) {
        prisma.briefEmail.findUnique.mockResolvedValue(null);
        await expect(service.envoyer(COMPTE, creneau, 'Un texte.')).resolves.toBe(true);
      }
    });

    it('les compte separement dans la journee', async () => {
      /*
        La cle d unicite porte le creneau : un bilan deja parti un dimanche ne
        doit pas empecher l alerte de serie du meme soir. Ce sont deux messages
        qui disent deux choses differentes, et l un n est pas la repetition de
        l autre.
      */
      process.env.BRIEF_EMAIL_CRENEAUX = 'bilan,serie';
      prisma.briefEmail.findUnique.mockResolvedValue(null);

      await service.envoyer(COMPTE, 'bilan', 'Ta semaine.');
      const appels = prisma.briefEmail.create.mock.calls.map((c: any[]) => c[0].data.creneau);

      await service.envoyer(COMPTE, 'serie', 'Ta serie tombe.');
      const apres = prisma.briefEmail.create.mock.calls.map((c: any[]) => c[0].data.creneau);

      expect(appels).toContain('bilan');
      expect(apres).toContain('serie');
    });

    it('ne crie pas dans le sujet de l alerte de serie', async () => {
      /*
        « DERNIERE CHANCE », les majuscules et les points d exclamation sont le
        vocabulaire des campagnes : ils font basculer un message en indesirable
        avant qu il soit lu, et annoncent une urgence fabriquee. Celle-ci est
        reelle — la serie tombe vraiment a minuit — donc la dire platement suffit,
        et c est ce qui la rend croyable.
      */
      process.env.BRIEF_EMAIL_CRENEAUX = 'serie';
      prisma.briefEmail.findUnique.mockResolvedValue(null);

      await service.envoyer(COMPTE, 'serie', 'Ta série de 12 jours tombe à minuit.');

      const sujet: string = (envoyerEmail as jest.Mock).mock.calls.at(-1)[0].sujet;
      expect(sujet).not.toMatch(/[A-Z]{4,}/);
      expect(sujet).not.toContain('!');
      expect(sujet.toLowerCase()).toContain('série');
    });

    it('promet dans le bouton ce que le message contient', async () => {
      // « Ouvrir ma journée » sous un bilan hebdomadaire annonce autre chose que
      // ce qu il fait ; sous une alerte de serie, le bouton doit nommer ce qu il
      // y a a sauver — c est toute la raison d ouvrir ce message-la.
      process.env.BRIEF_EMAIL_CRENEAUX = 'bilan,serie';
      prisma.briefEmail.findUnique.mockResolvedValue(null);

      await service.envoyer(COMPTE, 'serie', 'Ta série tombe.');
      expect((envoyerEmail as jest.Mock).mock.calls.at(-1)[0].texte).toContain('Sauver ma série');

      await service.envoyer(COMPTE, 'bilan', 'Ta semaine.');
      expect((envoyerEmail as jest.Mock).mock.calls.at(-1)[0].texte).toContain('Voir ma semaine');
    });
  });

  /*
    La promesse du premier matin, et ce qui la tient quand le modèle se tait.

    L'e-mail d'accueil annonce depuis le 25 août 2026 un message le lendemain :
    c'est le rendez-vous censé créer le deuxième jour. Or la voie e-mail n'envoie
    rien quand le modèle ne répond pas — Groq saturé, clé refusée — et rien ne le
    signale : le compteur `sansTexte` monte, la boîte de la personne reste vide, et
    la première promesse du produit est démentie le premier matin.
  */
  describe('le repli du tout premier matin', () => {
    const PROFIL = { objectives: ['arrêter de repousser ma thèse'], situation: null };

    it('écrit une phrase à partir de ses mots', async () => {
      const texte = await service.repliPremierMatin(COMPTE, PROFIL);

      expect(texte).toContain('arrêter de repousser ma thèse');
    });

    it('ne sert qu’une fois dans la vie d’un compte', async () => {
      // La seule chose qui empêche ce texte de devenir un e-mail quotidien : dès
      // qu'un brief est parti, quel qu'il soit, le repli se retire.
      prisma.briefEmail.count.mockResolvedValue(1);

      expect(await service.repliPremierMatin(COMPTE, PROFIL)).toBeNull();
    });

    it('se tait plutôt que de tenir la promesse avec une phrase creuse', async () => {
      expect(await service.repliPremierMatin(COMPTE, null)).toBeNull();
      expect(
        await service.repliPremierMatin(COMPTE, { objectives: [], situation: null }),
      ).toBeNull();
    });

    it('ne parle pas d’hier, qui n’est pas forcément vrai', async () => {
      // Le premier brief n'est pas forcément le lendemain de l'inscription : un
      // texte ne doit contenir que des faits qui survivent au délai qui le sépare
      // du moment où il a été décidé.
      const texte = await service.repliPremierMatin(COMPTE, PROFIL);

      expect(texte).not.toContain('Hier');
    });
  });
});
