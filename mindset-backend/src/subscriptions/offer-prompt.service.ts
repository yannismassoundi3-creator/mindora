import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiQuotaService } from '../ai-coaching/ai-quota.service';
import { CoinLedgerService } from '../ai-coaching/coin-ledger.service';

/** Paliers de relance, dans l'ordre où on les franchit. */
export type Palier = 'j3' | 'j7' | 'j21' | 'recurrent';

/** Ce qu'on met en avant. Le palier dit quand parler, l'angle dit de quoi. */
export type Angle = 'coins' | 'quota' | 'temps';

export interface DecisionRelance {
  afficher: boolean;
  /** Pourquoi on ne montre rien : utile pour comprendre sans deviner. */
  raison?: 'abonne' | 'trop_jeune' | 'trop_recent' | 'palier_atteint';
  palier?: Palier;
  angle?: Angle;
  jours?: number;
  messagesUtilises?: number;
  messagesRestants?: number;
  coins?: number;
}

/**
 * Décide quand reparler de l'abonnement à un compte gratuit.
 *
 * Jusqu'ici l'offre ne s'ouvrait toute seule qu'à l'épuisement du quota mensuel de
 * dix messages — un seuil que presque personne n'atteint, puisque le mur des coins
 * arrive bien avant (cinquante coins à l'ouverture, dix par message : cinq messages,
 * puis il faut valider des actions pour en regagner). Autrement dit, la seule
 * relance automatique du produit se déclenchait à un moment qui n'arrive jamais.
 *
 * Trois choses interdisent de faire ça dans le navigateur, et c'est pour elles que ce
 * service existe : l'âge réel du compte n'y est pas connu, l'usage réel non plus, et
 * la mémoire de ce qu'on a déjà montré y disparaît au premier changement d'appareil.
 *
 * Le parti pris est de solliciter peu et de ne dire que des choses vraies. Rien avant
 * trois jours — une relance adressée à quelqu'un qui n'a pas encore vu ce qu'il
 * achèterait ne fait que le lasser —, jamais deux fois dans la même semaine, et la
 * cadence passe au mois après trois refus : quelqu'un qui a dit « plus tard » trois
 * fois a répondu.
 */
@Injectable()
export class OfferPromptService {
  /** Aucune relance avant que le compte ait vécu. */
  static readonly AGE_MINIMUM_JOURS = 3;

  /** Jour d'ancienneté à partir duquel chaque palier devient franchissable. */
  static readonly SEUILS: Record<Exclude<Palier, 'recurrent'>, number> = {
    j3: 3,
    j7: 7,
    j21: 21,
  };

  /** Une fois les trois paliers passés, on ne revient qu'une fois par mois. */
  static readonly PERIODE_RECURRENTE_JOURS = 30;

  /** Délai minimum entre deux relances, quel que soit le palier. */
  static readonly DELAI_MIN_JOURS = 7;

  /** Au-delà, « plus tard » cesse d'être une hésitation : on espace pour de bon. */
  static readonly REPORTS_AVANT_FATIGUE = 3;

  private static readonly ORDRE: Palier[] = ['j3', 'j7', 'j21', 'recurrent'];

  constructor(private readonly prisma: PrismaService) {}

  private static jours(depuis: Date, jusqua: Date): number {
    return Math.floor((jusqua.getTime() - depuis.getTime()) / 86_400_000);
  }

  async decider(userId: string, maintenant = new Date()): Promise<DecisionRelance> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        created_at: true,
        subscription: { select: { status: true } },
        sync_data: { select: { ai_credits: true } },
        offer_prompt: true,
      },
    });

    if (!user) return { afficher: false, raison: 'abonne' };

    // Un abonné — essai compris — n'a rien à acheter. Oublier TRIALING ici
    // relancerait chaque nouvel abonné pendant sa première semaine, c'est-à-dire
    // exactement la semaine où il évalue s'il garde.
    const statut = user.subscription?.status ?? '';
    if ((AiQuotaService.PAID_STATUSES as readonly string[]).includes(statut)) {
      return { afficher: false, raison: 'abonne' };
    }

    const jours = OfferPromptService.jours(user.created_at, maintenant);
    if (jours < OfferPromptService.AGE_MINIMUM_JOURS) {
      return { afficher: false, raison: 'trop_jeune', jours };
    }

    const memoire = user.offer_prompt;
    if (memoire) {
      const fatigue = memoire.reports >= OfferPromptService.REPORTS_AVANT_FATIGUE;
      const delai = fatigue
        ? OfferPromptService.PERIODE_RECURRENTE_JOURS
        : OfferPromptService.DELAI_MIN_JOURS;
      if (OfferPromptService.jours(memoire.derniere_vue, maintenant) < delai) {
        return { afficher: false, raison: 'trop_recent', jours };
      }
    }

    const palier = OfferPromptService.prochainPalier(
      memoire?.dernier_palier as Palier | undefined,
      jours,
      memoire ? OfferPromptService.jours(memoire.derniere_vue, maintenant) : Infinity,
    );
    if (!palier) return { afficher: false, raison: 'palier_atteint', jours };

    const utilises = await this.prisma.aiUsage.count({
      where: { user_id: userId, created_at: { gte: OfferPromptService.debutDuMois(maintenant) } },
    });
    // Un compte qui n'a jamais synchronisé n'a pas encore de ligne : son solde est
    // celui de l'ouverture, pas zéro. Annoncer « plus de coins » à quelqu'un qui en
    // a cinquante serait le mensonge le plus coûteux de cet écran.
    const coins = user.sync_data?.ai_credits ?? CoinLedgerService.SOLDE_DEPART;
    const restants = Math.max(0, AiQuotaService.FREE_MONTHLY_MESSAGES - utilises);

    return {
      afficher: true,
      palier,
      angle: OfferPromptService.angle(coins, restants),
      jours,
      messagesUtilises: utilises,
      messagesRestants: restants,
      coins,
    };
  }

  private static debutDuMois(maintenant: Date): Date {
    return new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
  }

  /**
   * Le palier dit *quand* revenir, l'angle dit *de quoi parler*.
   *
   * L'ordre n'est pas indifférent : quelqu'un qui n'a plus de coins est arrêté
   * maintenant, et c'est la seule chose qui l'intéresse. Lui parler d'ancienneté
   * pendant qu'il est bloqué, c'est répondre à côté.
   */
  private static angle(coins: number, restants: number): Angle {
    if (coins < CoinLedgerService.COUT_MESSAGE) return 'coins';
    if (restants <= 2) return 'quota';
    return 'temps';
  }

  /**
   * Les paliers ne se parcourent que vers l'avant : le dernier atteint résume tout
   * l'historique, et une relance déjà passée ne se rejoue pas parce qu'un appareil
   * a oublié.
   */
  private static prochainPalier(
    dernier: Palier | undefined,
    jours: number,
    joursDepuisDerniereVue: number,
  ): Palier | null {
    const rang = dernier ? OfferPromptService.ORDRE.indexOf(dernier) : -1;

    for (const candidat of OfferPromptService.ORDRE) {
      if (OfferPromptService.ORDRE.indexOf(candidat) <= rang) continue;
      if (candidat === 'recurrent') break;
      if (jours >= OfferPromptService.SEUILS[candidat]) return candidat;
      return null; // les seuils sont croissants : inutile de regarder plus loin.
    }

    // Tous les paliers datés sont passés. On ne revient qu'au rythme mensuel, et
    // seulement si le dernier passage remonte à un mois — le délai minimum de sept
    // jours, lui, ne suffirait pas à protéger de douze relances par an.
    if (dernier === 'recurrent' || rang === OfferPromptService.ORDRE.length - 2) {
      return joursDepuisDerniereVue >= OfferPromptService.PERIODE_RECURRENTE_JOURS
        ? 'recurrent'
        : null;
    }
    return null;
  }

  /**
   * Enregistre ce que la personne a fait de la relance.
   *
   * `vue` n'est écrit que par le front au moment où la carte apparaît réellement :
   * une relance décidée mais jamais affichée — écran quitté, composant démonté — ne
   * doit pas consommer un palier. Le compteur `vues` peut être incrémenté deux fois
   * par un double rendu ; c'est sans effet, seuls le palier et la date pilotent la
   * cadence, et ils ne bougent que vers l'avant.
   */
  async enregistrer(userId: string, palier: Palier, action: 'vue' | 'reporte' | 'ouvert') {
    const colonne = { vue: 'vues', reporte: 'reports', ouvert: 'ouvertures' }[action];

    await this.prisma.offerPrompt.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        dernier_palier: palier,
        derniere_vue: new Date(),
        [colonne]: 1,
      },
      // Un « plus tard » ou une ouverture n'avancent pas la date : c'est l'affichage
      // qui fait courir le délai, et lui seul. Sinon un clic sur « Découvrir Pro »
      // repousserait la relance suivante d'une semaine de plus que prévu — on
      // punirait l'intérêt.
      update: {
        dernier_palier: palier,
        ...(action === 'vue' ? { derniere_vue: new Date() } : {}),
        [colonne]: { increment: 1 },
      },
    });

    return { ok: true };
  }

  /**
   * Entonnoir de la relance, pour un administrateur.
   *
   * Combien voient, combien repoussent, combien ouvrent l'offre : sans ces trois
   * nombres, régler la cadence se fait à l'intuition, et l'intuition sur ce sujet
   * penche toujours vers « plus souvent ».
   */
  async statistiques() {
    const [lignes, agregat] = await Promise.all([
      this.prisma.offerPrompt.groupBy({
        by: ['dernier_palier'],
        _count: { _all: true },
      }),
      this.prisma.offerPrompt.aggregate({
        _sum: { vues: true, reports: true, ouvertures: true },
        _count: { _all: true },
      }),
    ]);

    return {
      comptes: agregat._count._all,
      vues: agregat._sum.vues ?? 0,
      reports: agregat._sum.reports ?? 0,
      ouvertures: agregat._sum.ouvertures ?? 0,
      parPalier: Object.fromEntries(lignes.map((l) => [l.dernier_palier, l._count._all])),
    };
  }
}
