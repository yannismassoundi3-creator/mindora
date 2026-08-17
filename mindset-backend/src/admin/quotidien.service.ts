import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FUSEAU_AFFICHAGE,
  cleJourParis,
  derniersJoursParis,
  heureParis,
  minuitParis,
} from '../common/jour-paris';
import {
  FILTRE_MESSAGES_AUTOMATIQUES,
  FILTRE_MESSAGES_ECRITS,
} from '../common/message-inscription';

/**
 * Ce qui s'est passé aujourd'hui, et les treize jours d'avant.
 *
 * La rétention répond sur des semaines ; elle ne dit pas si l'affiche publiée ce
 * matin a fait venir quelqu'un. C'est pourtant la question qu'on se pose le jour
 * où l'on pousse l'application : combien sont arrivés, et sont-ils allés jusqu'au
 * coach — le seul geste que l'abonnement fait payer, donc le seul dont on sache
 * qu'il vaut quelque chose.
 *
 * Les deux nombres ne se lisent pas séparément. Trente inscrits dont aucun n'a
 * parlé au coach est un mauvais jour déguisé en bon jour.
 */
@Injectable()
export class QuotidienService {
  /** Deux semaines : assez pour voir une tendance, assez court pour tenir à l'écran. */
  private static readonly JOURS_AFFICHES = 14;

  constructor(private readonly prisma: PrismaService) {}

  async getStatsQuotidiennes() {
    const maintenant = new Date();
    const cleAujourdhui = cleJourParis(maintenant);
    const cles = derniersJoursParis(cleAujourdhui, QuotidienService.JOURS_AFFICHES);
    const debutFenetre = minuitParis(cles[0]);

    const inscrits = await this.prisma.user.findMany({
      where: { deleted_at: null, created_at: { gte: debutFenetre } },
      select: {
        id: true,
        first_name: true,
        email: true,
        created_at: true,
        email_verifie_le: true,
        // Les deux marches qui suivent l'inscription : un jeton de session prouve
        // qu'on est entré, une ligne de profil que le questionnaire est allé au
        // bout. Sans elles, un inscrit muet est illisible — on ne sait pas s'il
        // n'a pas voulu parler au coach ou s'il n'a jamais atteint l'application.
        _count: { select: { refresh_tokens: true } },
        ai_profile: { select: { id: true } },
        // `null` sur tout compte antérieur au 17 août 2026, et sur quiconque
        // arrive par un lien sans marque.
        source: true,
      },
      orderBy: { created_at: 'desc' },
    });

    /*
      Seuls les messages écrits par la personne comptent, et seulement ceux
      qu'elle a réellement tapés.

      Chaque échange laisse deux lignes, la sienne et celle du coach : compter les
      deux doublerait le volume. Mais il y a plus grave — la fin du questionnaire
      envoie un message au coach à la place de la personne, pour qu'elle reçoive
      son plan sans avoir à le demander. Ce message est légitime, et il n'est pas
      une conversation.

      Compté comme tel, il faisait afficher « 9 inscrits, 9 ont parlé au coach » :
      une conversion parfaite, entièrement mécanique. C'est le pire chiffre
      possible — celui qui dit que tout va bien au moment précis où il faudrait
      regarder. Il est donc exclu, et montré à part.
    */
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        ...FILTRE_MESSAGES_ECRITS,
        created_at: { gte: debutFenetre },
        user: { deleted_at: null },
      },
      select: { user_id: true, created_at: true },
    });

    // Les messages automatiques, comptés séparément : ils disent combien de
    // questionnaires sont allés au bout, ce qui est une autre information utile.
    const automatiques = await this.prisma.chatMessage.findMany({
      where: {
        ...FILTRE_MESSAGES_AUTOMATIQUES,
        created_at: { gte: debutFenetre },
        user: { deleted_at: null },
      },
      select: { user_id: true, created_at: true },
    });

    // Qui a parlé, et quel jour. Deux index : l'un par jour pour le graphique,
    // l'autre par personne pour croiser avec sa date d'inscription.
    const parleursDuJour = new Map<string, Set<string>>();
    const messagesDuJour = new Map<string, number>();
    const joursParPersonne = new Map<string, Map<string, number>>();
    const planAutoParJour = new Map<string, number>();

    for (const message of messages) {
      const cle = cleJourParis(message.created_at);

      const parleurs = parleursDuJour.get(cle) ?? new Set<string>();
      parleurs.add(message.user_id);
      parleursDuJour.set(cle, parleurs);

      messagesDuJour.set(cle, (messagesDuJour.get(cle) ?? 0) + 1);

      const parPersonne = joursParPersonne.get(message.user_id) ?? new Map<string, number>();
      parPersonne.set(cle, (parPersonne.get(cle) ?? 0) + 1);
      joursParPersonne.set(message.user_id, parPersonne);
    }

    for (const message of automatiques) {
      const cle = cleJourParis(message.created_at);
      planAutoParJour.set(cle, (planAutoParJour.get(cle) ?? 0) + 1);
    }

    const inscritsParJour = new Map<string, typeof inscrits>();
    for (const inscrit of inscrits) {
      const cle = cleJourParis(inscrit.created_at);
      const liste = inscritsParJour.get(cle) ?? [];
      liste.push(inscrit);
      inscritsParJour.set(cle, liste);
    }

    const jours = cles.map((cle) => {
      const nouveaux = inscritsParJour.get(cle) ?? [];
      /*
        « Ont parlé au coach le jour même de leur inscription ». C'est le nombre
        qui dit si la journée a produit autre chose que des lignes en base : un
        compte créé qui n'a rien demandé n'a encore rien coûté à personne, mais
        n'a rien rapporté non plus.
      */
      const nouveauxAyantParle = nouveaux.filter(
        (n) => (joursParPersonne.get(n.id)?.get(cle) ?? 0) > 0,
      ).length;

      return {
        date: cle,
        inscrits: nouveaux.length,
        inscritsAyantParleAuCoach: nouveauxAyantParle,
        // Tous comptes confondus, anciens compris : l'usage réel du coach ce jour-là.
        ontParleAuCoach: parleursDuJour.get(cle)?.size ?? 0,
        messages: messagesDuJour.get(cle) ?? 0,
        // Les plans demandés automatiquement à la fin du questionnaire. Montrés
        // séparément pour qu'on ne les reprenne jamais pour des conversations.
        plansAutomatiques: planAutoParJour.get(cle) ?? 0,
      };
    });

    const nouveauxDuJour = inscritsParJour.get(cleAujourdhui) ?? [];

    /*
      D'où viennent les inscrits de la fenêtre.

      Sans cette ventilation, une bonne soirée ne dit pas laquelle des publications
      l'a produite — donc laquelle refaire. Les comptes sans provenance sont
      montrés sous « lien nu » plutôt que masqués : leur nombre est l'information
      la plus utile au début, puisqu'il dit combien de liens circulent encore sans
      marque, c'est-à-dire quelle part de la mesure est aveugle.
    */
    const parProvenance = new Map<string, { inscrits: number; ontParle: number }>();
    for (const inscrit of inscrits) {
      const cle = inscrit.source ?? '(lien nu)';
      const groupe = parProvenance.get(cle) ?? { inscrits: 0, ontParle: 0 };
      groupe.inscrits++;
      if ((joursParPersonne.get(inscrit.id)?.size ?? 0) > 0) groupe.ontParle++;
      parProvenance.set(cle, groupe);
    }

    return {
      fuseau: FUSEAU_AFFICHAGE,
      aujourdhui: {
        ...jours[jours.length - 1],
        ontOuvertUneSession: nouveauxDuJour.filter((n) => n._count.refresh_tokens > 0).length,
        ontFiniLeQuestionnaire: nouveauxDuJour.filter((n) => n.ai_profile).length,
      },
      // La veille, pour que le chiffre du jour ait un point de comparaison. Un
      // nombre seul ne se lit pas : sept inscrits est une bonne ou une mauvaise
      // journée selon ce qu'étaient les précédentes.
      hier: jours.length > 1 ? jours[jours.length - 2] : null,
      jours,
      /*
        Le détail nominatif des arrivées du jour. Sur un produit de cette taille,
        c'est ce qui permet de recontacter quelqu'un resté bloqué — un taux ne le
        permet pas.
      */
      inscritsDuJour: nouveauxDuJour.map((n) => ({
        id: n.id,
        prenom: n.first_name,
        email: n.email,
        heure: heureParis(n.created_at),
        emailVerifie: !!n.email_verifie_le,
        entre: n._count.refresh_tokens > 0,
        questionnaireFini: !!n.ai_profile,
        messagesAuCoach: joursParPersonne.get(n.id)?.get(cleAujourdhui) ?? 0,
      })),
      /*
        Trié par volume : c'est dans cet ordre qu'on décide quoi refaire. La part
        qui a parlé au coach est jointe parce qu'un canal qui amène du monde sans
        que personne n'essaie le produit n'est pas un bon canal — c'est le même
        raisonnement que pour la journée, appliqué à chaque origine.
      */
      provenances: [...parProvenance.entries()]
        .map(([source, g]) => ({ source, inscrits: g.inscrits, ontParleAuCoach: g.ontParle }))
        .sort((a, b) => b.inscrits - a.inscrits),
      genere_le: maintenant.toISOString(),
    };
  }
}
