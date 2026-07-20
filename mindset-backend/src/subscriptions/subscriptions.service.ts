import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionsService {
  private stripe: Stripe;

  constructor(private readonly prisma: PrismaService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
      apiVersion: '2023-10-16',
    });
  }

  async createCheckoutSession(userId: string, planType: string) {
    // Simulation: Normalement on interagit avec this.stripe.checkout.sessions.create
    console.log(`[Stripe] Création d'une session de paiement pour le user ${userId}, Plan: ${planType}`);
    
    return {
      checkoutUrl: 'https://checkout.stripe.com/pay/mock_session_123',
    };
  }

  async handleWebhook(signature: string, payload: any) {
    // Validation de la signature Stripe...
    console.log('[Stripe Webhook] Received event');
    return { received: true };
  }

  async mockSuccess(userId: string) {
    console.log(`[Mock Stripe] Paiement validé pour le user ${userId}`);
    await this.prisma.subscription.upsert({
      where: { user_id: userId },
      update: { status: 'ACTIVE', plan_type: 'ELITE' },
      create: { user_id: userId, status: 'ACTIVE', plan_type: 'ELITE' }
    });
    return { success: true };
  }
}
