import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Applique le quota d'IA côté serveur.
 *
 * Le blocage vivait uniquement dans le front, donc n'importe quel compte gratuit
 * pouvait appeler l'IA directement avec son token — à nos frais. C'est ici que la
 * limite doit être décidée, jamais dans le navigateur.
 */
@Injectable()
export class AiQuotaService {
  /** Messages offerts par mois calendaire à un compte non abonné. */
  static readonly FREE_MONTHLY_MESSAGES = 10;

  /**
   * Plafond quotidien d'un abonné.
   *
   * Un abonné n'avait aucune borne en dehors de la cadence `@Throttle` — dix
   * messages par minute, soit 14 400 par jour s'il la tient. Ce n'est pas la marge
   * qui est en jeu mais le quota Groq, qui est partagé : un seul compte emballé
   * l'épuise pour tout le monde, et comme les échecs du modèle sont volontairement
   * silencieux, cela se manifesterait par « l'IA ne marche plus » sans cause visible.
   *
   * Le compteur est quotidien et non mensuel : il faut que le service revienne de
   * lui-même, sans intervention, et le lendemain est le plus court délai qui borne
   * réellement les dégâts.
   */
  static readonly PAID_DAILY_MESSAGES = 50;

  constructor(private readonly prisma: PrismaService) {}

  private startOfMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /**
   * Minuit passé, dans le fuseau du serveur.
   *
   * Volontairement aligné sur `startOfMonth` : les deux compteurs se remettent à
   * zéro sur la même horloge, faute de quoi un abonné pourrait voir son plafond
   * quotidien retomber à un autre moment que le changement de mois d'un gratuit.
   */
  private startOfDay(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /**
   * Statuts qui ouvrent le Pro.
   *
   * L'essai de 7 jours est un abonnement payant qui n'a pas encore été débité :
   * il donne droit à tout. Tant que le webhook écrivait « ACTIVE » à l'ouverture
   * quoi qu'il arrive, la distinction n'existait pas ; maintenant qu'il écrit le
   * statut réel de Stripe, oublier TRIALING ici couperait l'accès à toute personne
   * en cours d'essai — c'est-à-dire à chaque nouvel abonné pendant sa première
   * semaine.
   *
   * PAST_DUE en est volontairement absent : c'est un abonnement dont le paiement a
   * échoué. Stripe le repasse en « active » de lui-même dès qu'une relance aboutit,
   * donc l'accès revient sans intervention.
   */
  static readonly PAID_STATUSES = ['ACTIVE', 'TRIALING'] as const;

  async isSubscribed(userId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
      select: { status: true },
    });
    return (AiQuotaService.PAID_STATUSES as readonly string[]).includes(sub?.status ?? '');
  }

  /**
   * Ce qu'il reste à quelqu'un, et sur quelle période.
   *
   * Les deux profils ont désormais une limite, mais elles ne disent pas la même
   * chose : celle d'un gratuit est une raison de s'abonner, celle d'un abonné est un
   * garde-fou qu'il ne doit jamais rencontrer en usage normal. D'où `periode`, qui
   * permet à l'appelant de distinguer les deux sans réinterpréter les nombres.
   */
  async getQuota(userId: string) {
    const subscribed = await this.isSubscribed(userId);

    const depuis = subscribed ? this.startOfDay() : this.startOfMonth();
    const limit = subscribed ? AiQuotaService.PAID_DAILY_MESSAGES : AiQuotaService.FREE_MONTHLY_MESSAGES;

    const used = await this.prisma.aiUsage.count({
      where: { user_id: userId, created_at: { gte: depuis } },
    });

    return {
      subscribed,
      // Conservé pour ne pas casser les appelants qui l'interrogeaient : un abonné
      // n'a toujours pas de compteur mensuel. Sa borne quotidienne est ailleurs.
      unlimited: subscribed,
      periode: subscribed ? ('jour' as const) : ('mois' as const),
      used,
      limit,
      remaining: Math.max(0, limit - used),
    };
  }

  /**
   * Vérifie le quota puis débite immédiatement le crédit.
   *
   * Le débit a lieu avant l'appel à l'IA, et non après : sinon plusieurs requêtes
   * lancées en parallèle passeraient toutes la vérification avant qu'aucune n'ait
   * été comptée, ce qui laisserait dépasser le quota autant de fois que voulu.
   */
  async consumeAiCredit(userId: string, kind: 'chat' | 'routines') {
    const quota = await this.getQuota(userId);

    if (quota.remaining <= 0) {
      /*
        Deux murs, deux statuts, et la distinction n'est pas cosmétique.

        Un gratuit reçoit 402 : il n'a rien payé, l'écran d'abonnement s'ouvre, et
        c'est la réponse juste à sa situation. Un abonné a déjà payé — lui renvoyer
        « Payment Required » l'inviterait à acheter ce qu'il possède, et le front
        ouvrirait l'écran de tarifs à quelqu'un qui n'a rien à y faire. Il reçoit
        donc 429 : ce n'est pas une question d'argent, c'est une cadence.
      */
      if (quota.subscribed) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            code: 'AI_DAILY_CAP',
            message: `Tu as envoyé ${quota.limit} messages aujourd'hui — c'est le plafond quotidien, il se remet à zéro demain. Prends la nuit pour appliquer ce qu'on a décidé.`,
            used: quota.used,
            limit: quota.limit,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 402 Payment Required : le front s'en sert pour ouvrir l'écran d'abonnement.
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'AI_QUOTA_EXCEEDED',
          message: `Tu as utilisé tes ${quota.limit} messages offerts ce mois-ci. Passe à Disciplix Pro pour continuer.`,
          used: quota.used,
          limit: quota.limit,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    /*
      La ligne est écrite pour tout le monde, abonnés compris.

      Elle ne l'était que pour les gratuits — « inutile de faire grossir la table ».
      Conséquence : la consommation des abonnés ne laissait aucune trace, donc un
      compte emballé était non seulement sans borne mais indétectable après coup.
      C'est aussi cette ligne qui rend le plafond quotidien calculable.
    */
    await this.prisma.aiUsage.create({ data: { user_id: userId, kind } });

    return quota;
  }

  /**
   * Rend le crédit d'un appel qui n'a rien produit.
   *
   * Un compte gratuit n'a que dix messages par mois : les lui faire perdre parce que
   * le fournisseur d'IA était saturé, c'est la meilleure façon de lui donner tort sur
   * la valeur de l'abonnement. Depuis que les abonnés ont eux aussi une ligne par
   * message, le remboursement les couvre : une panne de Groq ne doit pas entamer un
   * plafond quotidien que la personne n'a pas consommé.
   */
  async refundAiCredit(userId: string, kind: 'chat' | 'routines') {
    const derniere = await this.prisma.aiUsage.findFirst({
      where: { user_id: userId, kind },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    if (derniere) {
      await this.prisma.aiUsage.deleteMany({ where: { id: derniere.id } });
    }
  }

  /** Réservé aux abonnés : la synthèse vocale coûte trop cher pour être offerte. */
  async assertSubscribed(userId: string) {
    if (await this.isSubscribed(userId)) return;
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Cette fonctionnalité est réservée à Disciplix Pro.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
