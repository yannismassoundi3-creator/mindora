import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { envoyerEmail, gabarit } from '../common/email';
import { lienRetrait } from '../common/retrait';
import { lienApp } from '../common/origines';
import { repereDuProfil, ProfilCitable } from '../common/repere';

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

  /**
   * Tout ce que ce service sait porter, du plus quotidien au plus rare.
   *
   * Les trois premiers sont des briefs, un par créneau de la journée. Les trois
   * suivants sont les messages qui **n'avaient aucun canal e-mail** : leur tournée
   * sautait purement les comptes sans notification, d'un `continue`. Avec 6
   * personnes joignables par push sur 52, cela voulait dire que le coup de pouce,
   * le bilan du dimanche et l'alerte de série ne parlaient à personne.
   *
   * Leur volume est très différent de celui d'un brief, et c'est ce qui rend leur
   * ajout tenable : le coup de pouce est plafonné à un tous les trois jours par
   * personne, le bilan est hebdomadaire, et l'alerte de série ne peut partir que
   * le soir où une série vivante n'a rien de coché — donc jamais deux soirs de
   * suite, par construction.
   */
  static readonly CRENEAUX_CONNUS = ['matin', 'midi', 'soir', 'coup-de-pouce', 'bilan', 'serie'];

  /**
   * Les créneaux réellement autorisés à partir.
   *
   * Le défaut n'ouvre pas tout : `midi` et `soir` ajouteraient deux e-mails
   * quotidiens à tout le monde, ce qui est le signalement type qu'un filtre attend
   * d'un domaine sans historique. Les trois nouveaux, eux, sont rares par
   * construction — voir `CRENEAUX_CONNUS`.
   */
  static creneauxActifs(): string[] {
    const brut = process.env.BRIEF_EMAIL_CRENEAUX ?? 'matin,coup-de-pouce,bilan,serie';
    const demandes = brut
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);

    // Un nom inconnu est ignoré plutôt que d'ouvrir un créneau au hasard : une
    // faute de frappe sur la variable ne doit pas décider d'un envoi de masse.
    return BriefEmailService.CRENEAUX_CONNUS.filter((c) => demandes.includes(c));
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
   * Le seul texte que ce service accepte d'écrire sans le modèle, et une seule fois.
   *
   * **Ce qu'il répare.** L'e-mail d'accueil promet depuis le 25 août 2026 un
   * message le lendemain matin : c'est le rendez-vous qui doit créer le deuxième
   * jour, et une promesse tenue est le seul mécanisme de retour que ce produit
   * puisse offrir à quelqu'un qui n'a pas installé l'application. Or la voie
   * e-mail n'envoie rien quand le modèle ne répond pas — Groq saturé, clé
   * refusée — et personne ne l'apprend : le compteur `sansTexte` monte, la boîte
   * de la personne reste vide, et la première promesse du produit est démentie
   * le premier matin. Exactement la panne muette que ce projet produit en série.
   *
   * **Pourquoi ce texte-ci n'est pas un e-mail générique**, ce que le service
   * s'interdit par ailleurs : il cite les mots que la personne a écrits elle-même,
   * il n'est donc identique pour personne d'autre. Et il ne peut pas devenir
   * quotidien — `count() > 0` le retire dès qu'un premier brief est parti, quel
   * qu'il soit. Un seul message dans la vie d'un compte, celui qui était promis.
   *
   * `null` quand rien n'a été dit à l'inscription : mieux vaut manquer une
   * promesse que la tenir avec une phrase creuse.
   */
  async repliPremierMatin(
    user: { id: string },
    profil?: ProfilCitable,
  ): Promise<string | null> {
    const repere = repereDuProfil(profil);
    if (!repere) return null;

    const deja = await this.prisma.briefEmail.count({ where: { user_id: user.id } });
    if (deja > 0) return null;

    // « En arrivant » et non « hier » : le premier brief n'est pas forcément le
    // lendemain de l'inscription, et une phrase mise en cache ne doit contenir que
    // des faits qui survivent au délai — la règle vaut aussi pour un repli.
    return `Tu m'as dit en arrivant : « ${repere} ». On commence par quoi aujourd'hui ?`;
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
        bouton: BriefEmailService.bouton(creneau),
        lienRetrait: retrait,
      }),
      texte: `${texte}\n\n${BriefEmailService.bouton(creneau).texte} : ${BriefEmailService.bouton(creneau).lien}`,
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
    /*
      Le sujet de l'alerte de série ne crie pas, et c'est délibéré.

      « DERNIÈRE CHANCE », les majuscules et les points d'exclamation sont le
      vocabulaire des campagnes : ils font basculer un message en indésirable
      avant qu'il soit lu, et ils annoncent une urgence fabriquée. Celle-ci est
      réelle — la série tombe vraiment à minuit — donc la dire platement suffit,
      et c'est ce qui la rend croyable.
    */
    if (creneau === 'serie') return `${qui}ta série s'arrête ce soir`;
    if (creneau === 'bilan') return `${qui}ta semaine en chiffres`;
    if (creneau === 'coup-de-pouce') return `${qui}un mot de ton coach`;
    return `${qui}ton brief du jour`;
  }

  private static titre(creneau: string, prenom: string | null): string {
    const qui = prenom ? ` ${prenom}` : '';
    if (creneau === 'soir') return `Ta journée${qui}`;
    if (creneau === 'midi') return `Le point de midi${qui}`;
    if (creneau === 'serie') return `Il te reste ce soir${qui}`;
    if (creneau === 'bilan') return `Ta semaine${qui}`;
    if (creneau === 'coup-de-pouce') return `Ton coach${qui}`;
    return `Bonjour${qui}`;
  }

  /**
   * Ce que promet le bouton, et où il mène.
   *
   * Un bouton qui dit « ouvrir ma journée » sous un bilan hebdomadaire annonce
   * autre chose que ce qu'il fait. Et sous une alerte de série, il doit dire ce
   * qu'il y a à sauver — c'est toute la raison d'ouvrir ce message-là.
   */
  private static bouton(creneau: string): { texte: string; lien: string } {
    if (creneau === 'serie') return { texte: 'Sauver ma série', lien: lienApp('/?auth=true') };
    if (creneau === 'bilan') return { texte: 'Voir ma semaine', lien: lienApp('/?auth=true') };
    if (creneau === 'coup-de-pouce') {
      return { texte: 'Reprendre maintenant', lien: lienApp('/?auth=true&vue=chat') };
    }
    return { texte: 'Ouvrir ma journée', lien: lienApp('/?auth=true') };
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
