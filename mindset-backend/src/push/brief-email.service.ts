import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { envoyerEmail, gabarit } from '../common/email';
import { lienRetrait } from '../common/retrait';
import { lienApp } from '../common/origines';

/**
 * Le brief, porté par e-mail à ceux que la notification n'atteint pas.
 *
 * Mesuré le 20 août 2026 : **6 personnes sur 52 sont joignables par
 * notification**. Le brief du matin — le seul mécanisme du produit conçu pour
 * créer un deuxième jour — ne parlait donc qu'à 12 % des comptes, alors que deux
 * tiers de ceux qui agissent n'agissent qu'un seul jour. Le plus gros groupe des
 * injoignables est celui des iPhone sans application installée : iOS ne délivre
 * le push qu'aux applications posées sur l'écran d'accueil, et aucun texte
 * d'incitation ne fera installer tout le monde.
 *
 * L'e-mail, lui, atteint 100 % des comptes par construction. C'est le seul canal
 * qui puisse porter la promesse du produit à ceux qui l'ont acceptée.
 *
 * ## Ce que ce service refuse de faire, et pourquoi
 *
 * **Il n'écrit jamais à quelqu'un qui reçoit déjà la notification.** Le même
 * message deux fois par deux canaux n'est pas une insistance, c'est du
 * harcèlement — et c'est le plus court chemin vers un signalement pour
 * indésirable, qui punit le domaine entier, codes de connexion compris.
 *
 * **Il n'écrit qu'aux comptes encore vivants.** Quelqu'un qui a décroché reçoit
 * déjà la relance prévue pour ça ; lui ajouter un message quotidien abîmerait la
 * réputation d'un domaine créé le 20 août 2026, et une réputation d'expéditeur se
 * refait en semaines, pas en heures.
 *
 * **Il n'écrit rien tant que le créneau n'est pas allumé.** `BRIEF_EMAIL_CRENEAUX`
 * décide, et vaut « matin » par défaut. Trois envois quotidiens depuis un domaine
 * sans historique est le signalement type que les filtres attendent d'un
 * spammeur : on monte le volume quand le domaine a fait ses preuves, pas avant.
 * La variable existe pour que cette montée ne demande aucun déploiement.
 */
@Injectable()
export class BriefEmailService {
  private readonly logger = new Logger(BriefEmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Les créneaux réellement autorisés à partir, dans l'ordre de la journée. */
  static creneauxActifs(): string[] {
    const brut = process.env.BRIEF_EMAIL_CRENEAUX ?? 'matin';
    const demandes = brut
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);

    // Un nom inconnu est ignoré plutôt que d'ouvrir un créneau au hasard : une
    // faute de frappe sur la variable ne doit pas décider d'un envoi de masse.
    return ['matin', 'midi', 'soir'].filter((c) => demandes.includes(c));
  }

  static creneauActif(creneau: string): boolean {
    return BriefEmailService.creneauxActifs().includes(creneau);
  }

  /**
   * Le jour local, tel qu'il sert de clé d'unicité.
   *
   * En heure de Paris, et pas en UTC : un brief envoyé à 1 h du matin en été
   * appartient à la journée que la personne est en train de vivre, pas à celle de
   * la veille. Sans ça, le premier envoi de la nuit rendrait impossible celui de
   * la matinée qui suit.
   */
  private static jourLocal(): string {
    return new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  }

  /**
   * Envoie le brief par e-mail. Rend `true` seulement si Brevo l'a accepté.
   *
   * L'ordre compte : **la trace n'est écrite qu'après un envoi accepté.** L'écrire
   * avant condamnerait la personne au silence de la journée en donnant à croire
   * qu'elle a reçu quelque chose — le défaut le plus fréquent de ce projet, et
   * celui qu'on ne rejoue pas ici.
   */
  async envoyer(
    user: { id: string; email: string; first_name: string | null; relances_email?: boolean },
    creneau: string,
    texte: string,
  ): Promise<boolean> {
    if (!BriefEmailService.creneauActif(creneau)) return false;

    // Le même drapeau que les relances : quelqu'un qui a demandé à ne plus rien
    // recevoir l'a demandé pour tout ce qui est périodique, pas seulement pour le
    // message dont il se retirait ce jour-là.
    if (user.relances_email === false) return false;

    const jour = BriefEmailService.jourLocal();

    /*
      Le doublon, empêché avant l'envoi et non après.

      La tournée passe toutes les demi-heures, et le panneau d'administration peut
      la rejouer à la main dans le même créneau. Une notification reçue deux fois
      se remarque à peine ; un e-mail reçu deux fois se signale comme indésirable.
    */
    const deja = await this.prisma.briefEmail.findUnique({
      where: { user_id_creneau_jour: { user_id: user.id, creneau, jour } },
    });
    if (deja) return false;

    const prenom = user.first_name?.trim() || null;
    const retrait = lienRetrait(user.id);

    const envoye = await envoyerEmail({
      destinataire: user.email,
      sujet: BriefEmailService.sujet(creneau, prenom),
      html: gabarit({
        titre: BriefEmailService.titre(creneau, prenom),
        // Le texte du modèle est déjà écrit pour être lu tel quel : on ne le
        // reformule pas, on l'encadre.
        corps: `<p style="margin: 0 0 16px;">${BriefEmailService.echapper(texte)}</p>`,
        bouton: { texte: 'Ouvrir ma journée', lien: lienApp('/?auth=true') },
        lienRetrait: retrait,
      }),
      texte: `${texte}\n\nOuvrir ma journée : ${lienApp('/?auth=true')}`,
      lienRetrait: retrait,
    });

    if (!envoye) {
      this.logger.warn(`Brief « ${creneau} » non remis à ${user.id} : Brevo a refusé.`);
      return false;
    }

    try {
      await this.prisma.briefEmail.create({ data: { user_id: user.id, creneau, jour } });
    } catch (e: any) {
      // La trace a échoué mais le message est parti : le pire qui puisse arriver
      // est un second envoi dans le même créneau. Le dire, et ne pas prétendre que
      // l'envoi n'a pas eu lieu.
      this.logger.error(`Brief « ${creneau} » envoyé à ${user.id} mais non tracé : ${e?.message}`);
    }

    return true;
  }

  /*
    Ce qui est écrit compte autant que le fait d'écrire.

    Le sujet est la seule chose lue avant de décider d'ouvrir. Les majuscules, les
    points d'exclamation et le vocabulaire des campagnes font basculer un message
    en indésirable avant qu'il ne soit lu — et un prénom dans le sujet dit, en un
    coup d'œil, que ce message-là n'est pas une campagne.
  */
  private static sujet(creneau: string, prenom: string | null): string {
    const qui = prenom ? `${prenom}, ` : '';
    if (creneau === 'soir') return `${qui}ta journée en une ligne`;
    if (creneau === 'midi') return `${qui}il te reste l'après-midi`;
    return `${qui}ton brief du jour`;
  }

  private static titre(creneau: string, prenom: string | null): string {
    const qui = prenom ? ` ${prenom}` : '';
    if (creneau === 'soir') return `Ta journée${qui}`;
    if (creneau === 'midi') return `Le point de midi${qui}`;
    return `Bonjour${qui}`;
  }

  /**
   * Le texte vient d'un modèle : il peut contenir n'importe quel caractère.
   *
   * Sans échappement, une apostrophe typographique ne pose aucun problème mais un
   * `<` ouvrirait une balise, et la fin du message disparaîtrait de l'écran sans
   * qu'aucune erreur ne soit levée nulle part.
   */
  private static echapper(texte: string): string {
    return texte
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');
  }
}
