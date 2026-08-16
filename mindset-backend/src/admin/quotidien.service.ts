import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  /**
   * Le fuseau dans lequel « aujourd'hui » veut dire quelque chose.
   *
   * Le serveur tourne en UTC : entre minuit et 2 h du matin à Paris, un compte
   * créé ici est compté par le serveur comme appartenant à la veille. Le tableau
   * affiche alors un chiffre juste pour une journée qui n'est pas celle qu'on
   * regarde — et personne ne le voit, puisqu'il ressemble à un chiffre normal.
   */
  private static readonly FUSEAU = 'Europe/Paris';

  /** Deux semaines : assez pour voir une tendance, assez court pour tenir à l'écran. */
  private static readonly JOURS_AFFICHES = 14;

  constructor(private readonly prisma: PrismaService) {}

  /** Les champs de date-heure d'un instant, lus dans le fuseau d'affichage. */
  private static parties(date: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: QuotidienService.FUSEAU,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    const champ = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return {
      annee: champ('year'),
      mois: champ('month'),
      jour: champ('day'),
      heure: champ('hour'),
      minute: champ('minute'),
      seconde: champ('second'),
    };
  }

  /** `YYYY-MM-DD` du jour local — la clé qui regroupe une journée. */
  private static cleJour(date: Date): string {
    const p = QuotidienService.parties(date);
    return `${p.annee}-${p.mois}-${p.jour}`;
  }

  /** `HH:MM` local, pour dire à quelle heure quelqu'un est arrivé. */
  private static heureLocale(date: Date): string {
    const p = QuotidienService.parties(date);
    return `${p.heure}:${p.minute}`;
  }

  /** Décalage du fuseau à cet instant précis, en minutes (60 l'hiver, 120 l'été). */
  private static decalageMinutes(date: Date): number {
    const p = QuotidienService.parties(date);
    const commeUTC = Date.UTC(
      Number(p.annee),
      Number(p.mois) - 1,
      Number(p.jour),
      Number(p.heure),
      Number(p.minute),
      Number(p.seconde),
    );
    return (commeUTC - date.getTime()) / 60000;
  }

  /** L'instant UTC où commence la journée locale `cle`. */
  private static minuitLocal(cle: string): Date {
    const [annee, mois, jour] = cle.split('-').map(Number);
    // Le décalage est mesuré à midi : un 2 h 30 du matin peut ne pas exister le
    // jour du passage à l'heure d'été, midi existe toujours.
    const decalage = QuotidienService.decalageMinutes(new Date(Date.UTC(annee, mois - 1, jour, 12)));
    return new Date(Date.UTC(annee, mois - 1, jour, 0, 0, 0) - decalage * 60000);
  }

  /**
   * Les clés des N derniers jours, du plus ancien au plus récent.
   *
   * Construites par arithmétique de calendrier plutôt qu'en retirant 24 h à
   * répétition : les deux nuits de changement d'heure durent 23 et 25 heures, et
   * une soustraction d'horloge y saute ou y répète un jour.
   */
  private static derniersJours(cleAujourdhui: string, combien: number): string[] {
    const [annee, mois, jour] = cleAujourdhui.split('-').map(Number);
    const cles: string[] = [];
    for (let recul = combien - 1; recul >= 0; recul--) {
      cles.push(new Date(Date.UTC(annee, mois - 1, jour - recul)).toISOString().slice(0, 10));
    }
    return cles;
  }

  async getStatsQuotidiennes() {
    const maintenant = new Date();
    const cleAujourdhui = QuotidienService.cleJour(maintenant);
    const cles = QuotidienService.derniersJours(cleAujourdhui, QuotidienService.JOURS_AFFICHES);
    const debutFenetre = QuotidienService.minuitLocal(cles[0]);

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
      const cle = QuotidienService.cleJour(message.created_at);

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
      const cle = QuotidienService.cleJour(inscrit.created_at);
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
      fuseau: QuotidienService.FUSEAU,
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
        heure: QuotidienService.heureLocale(n.created_at),
        emailVerifie: !!n.email_verifie_le,
        entre: n._count.refresh_tokens > 0,
        questionnaireFini: !!n.ai_profile,
        messagesAuCoach: joursParPersonne.get(n.id)?.get(cleAujourdhui) ?? 0,
      })),
      genere_le: maintenant.toISOString(),
    };
  }
}
