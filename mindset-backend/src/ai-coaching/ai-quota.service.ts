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

  constructor(private readonly prisma: PrismaService) {}

  private startOfMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  async isSubscribed(userId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
      select: { status: true },
    });
    return sub?.status === 'ACTIVE';
  }

  async getQuota(userId: string) {
    const subscribed = await this.isSubscribed(userId);
    if (subscribed) {
      return { subscribed, unlimited: true, used: 0, limit: null, remaining: null };
    }

    const used = await this.prisma.aiUsage.count({
      where: { user_id: userId, created_at: { gte: this.startOfMonth() } },
    });
    const limit = AiQuotaService.FREE_MONTHLY_MESSAGES;

    return {
      subscribed,
      unlimited: false,
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

    if (!quota.unlimited && quota.remaining! <= 0) {
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

    // Les abonnés ne sont pas limités, inutile de faire grossir la table pour eux.
    if (!quota.unlimited) {
      await this.prisma.aiUsage.create({ data: { user_id: userId, kind } });
    }

    return quota;
  }

  /**
   * Rend le crédit d'un appel qui n'a rien produit.
   *
   * Un compte gratuit n'a que dix messages par mois : les lui faire perdre parce que
   * le fournisseur d'IA était saturé, c'est la meilleure façon de lui donner tort sur
   * la valeur de l'abonnement. Les abonnés n'ont pas de ligne à supprimer.
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
