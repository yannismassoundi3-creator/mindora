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

  /**
   * Adresse de retour après paiement.
   *
   * La barre finale est retirée : selon la façon dont FRONTEND_URL est saisie sur
   * Render, on renvoyait sinon les gens sur « //?success=true » au retour de leur
   * paiement. Le même défaut avait déjà été corrigé côté notifications ; il était
   * resté ici, c'est-à-dire sur la page qui suit un achat.
   */
  private lienRetour(chemin: string): string {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
    return base + chemin;
  }

  async createCheckoutSession(userId: string, planType: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    // Un plan inconnu laissait priceId vide et partait quand même chez Stripe, qui
    // répondait une erreur technique recopiée telle quelle à l'utilisateur.
    if (planType !== 'monthly' && planType !== 'lifetime') {
      throw new BadRequestException("Formule inconnue : attendu « monthly » ou « lifetime ».");
    }

    const priceId =
      planType === 'monthly'
        ? process.env.STRIPE_PRICE_MONTHLY || 'price_mock_monthly'
        : process.env.STRIPE_PRICE_LIFETIME || 'price_mock_lifetime';

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
        success_url: this.lienRetour('/?success=true'),
        cancel_url: this.lienRetour('/?canceled=true'),
        client_reference_id: userId,
      });

      return { checkoutUrl: session.url };
    } catch (error: any) {
      console.error('[Stripe] Create session error:', error);

      // Une variable STRIPE_PRICE_* oubliée sur l'hébergeur laisse partir l'identifiant
      // de repli « price_mock_… », et Stripe répond « No such price ». Le message
      // technique se perdait ensuite dans une alerte générique côté client : personne
      // ne pouvait deviner qu'il manquait une variable d'environnement. On le dit ici,
      // en clair, avec le nom exact à renseigner.
      if (priceId.startsWith('price_mock')) {
        console.error(
          `[Stripe] La formule « ${planType} » n'a pas d'identifiant de prix : renseigne ` +
            `${planType === 'monthly' ? 'STRIPE_PRICE_MONTHLY' : 'STRIPE_PRICE_LIFETIME'} ` +
            `dans les variables d'environnement du service.`,
        );
      }

      // Repli de développement : renvoyer une page de succès sans paiement. Il est
      // désormais interdit en production. La clé Stripe y est censée être présente,
      // mais le constructeur retombe sur « sk_test_mock » quand elle manque — une
      // variable oubliée suffisait donc à annoncer un achat réussi à tout le monde.
      const cle = process.env.STRIPE_SECRET_KEY;
      const enMock = !cle || cle.startsWith('sk_test_mock');
      if (enMock && process.env.NODE_ENV !== 'production') {
        return { checkoutUrl: this.lienRetour('/?success=true&mock=true') };
      }

      // Le message de Stripe reste dans les logs. Le recopier au client exposait la
      // configuration du serveur — « Invalid API Key provided: sk_test_… » s'affichait
      // tel quel — et ne lui apprenait rien d'utile.
      throw new BadRequestException(
        "Le paiement n'a pas pu être ouvert. Ce n'est pas de ton fait : réessaie dans un moment, ou écris-nous à mindoraappli@gmail.com.",
      );
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

    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: this.lienRetour('/?auth=true'),
      });

      return { portalUrl: session.url };
    } catch (error: any) {
      console.error('[Stripe] Create portal session error:', error);
      throw new BadRequestException('Failed to create Stripe portal session: ' + error.message);
    }
  }
}
