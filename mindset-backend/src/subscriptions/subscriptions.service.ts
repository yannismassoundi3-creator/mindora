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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    
    // Configurer le prix en fonction du plan (à remplacer par tes vrais Price IDs Stripe)
    let priceId = '';
    if (planType === 'monthly') {
      priceId = process.env.STRIPE_PRICE_MONTHLY || 'price_mock_monthly';
    } else if (planType === 'lifetime') {
      priceId = process.env.STRIPE_PRICE_LIFETIME || 'price_mock_lifetime';
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: planType === 'lifetime' ? 'payment' : 'subscription',
        customer_email: user.email,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        ...(planType !== 'lifetime' && {
          subscription_data: {
            trial_period_days: 7,
          },
        }),
        success_url: `${frontendUrl}/?success=true`,
        cancel_url: `${frontendUrl}/?canceled=true`,
        client_reference_id: userId,
      });

      return { checkoutUrl: session.url };
    } catch (error: any) {
      console.error('[Stripe] Create session error:', error);
      // Fallback au mock en développement si pas de vraie clé
      if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_mock') || !process.env.STRIPE_SECRET_KEY) {
         return { checkoutUrl: `${frontendUrl}/?success=true&mock=true` };
      }
      throw new BadRequestException('Failed to create Stripe session: ' + error.message);
    }
  }

  async handleWebhook(signature: string, payload: any) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event: Stripe.Event;

    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not set, rejecting webhook.');
      throw new BadRequestException('Webhook configuration missing.');
    }

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed:`, err.message);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        if (userId) {
          const mode = session.mode;
          
          await this.prisma.user.update({
            where: { id: userId },
            data: { stripe_customer_id: session.customer as string }
          });

          await this.prisma.subscription.upsert({
            where: { user_id: userId },
            update: { 
              status: 'ACTIVE', 
              plan_type: 'ELITE',
              stripe_sub_id: session.subscription as string
            },
            create: { 
              user_id: userId, 
              status: 'ACTIVE', 
              plan_type: 'ELITE',
              stripe_sub_id: session.subscription as string
            }
          });
          console.log(`[Stripe Webhook] User ${userId} upgraded successfully!`);
        }
        break;
      
      case 'customer.subscription.deleted':
        const deletedSub = event.data.object as Stripe.Subscription;
        await this.prisma.subscription.updateMany({
          where: { stripe_sub_id: deletedSub.id },
          data: { status: 'CANCELED' }
        });
        break;
        
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return { received: true };
  }

  async createPortalSession(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.stripe_customer_id) {
      throw new BadRequestException('Aucun compte Stripe associé trouvé.');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';

    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${frontendUrl}/?auth=true`,
      });

      return { portalUrl: session.url };
    } catch (error: any) {
      console.error('[Stripe] Create portal session error:', error);
      throw new BadRequestException('Failed to create Stripe portal session: ' + error.message);
    }
  }
}
