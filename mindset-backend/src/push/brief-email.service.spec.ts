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
    it('n’en allume qu’un par défaut', () => {
      // Trois envois quotidiens depuis un domaine sans historique est le
      // signalement type d'un spammeur. On monte le volume à la main.
      delete process.env.BRIEF_EMAIL_CRENEAUX;
      expect(BriefEmailService.creneauxActifs()).toEqual(['matin']);
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
});
