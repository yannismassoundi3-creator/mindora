import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FUSEAU_AFFICHAGE,
  cleJourParis,
  derniersJoursParis,
  heureParis,
  minuitParis,
} from '../common/jour-paris';

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
      },
      orderBy: { created_at: 'desc' },
    });

    /*
      Seuls les messages écrits par la personne comptent. Chaque échange laisse
      deux lignes, la sienne et celle du coach ; compter les deux doublerait
      mécaniquement le volume et ferait passer pour bavard un compte qui a posé
      une seule question.
    */
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        sender: 'user',
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
      };
    });

    const nouveauxDuJour = inscritsParJour.get(cleAujourdhui) ?? [];

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
      genere_le: maintenant.toISOString(),
    };
  }
}
