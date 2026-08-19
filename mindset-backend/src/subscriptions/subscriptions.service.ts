import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { origineApp, origineValide } from '../common/origines';

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
   * Elle vient d'abord du navigateur, et seulement ensuite de la configuration.
   * L'ordre n'est pas anodin : le 13 août 2026, `FRONTEND_URL` pointait sur un
   * « …-dashboard.onrender.com » qui n'existe pas, et tous les acheteurs
   * atterrissaient sur une page « Not Found » au retour de leur paiement — au moment
   * précis où il faut les rassurer. Le navigateur, lui, sait toujours d'où il vient ;
   * il suffit de vérifier qu'il ne raconte pas n'importe quoi, d'où la liste blanche
   * de `common/origines.ts`, qui filtre aussi le repli.
   */
  private lienRetour(chemin: string, origine?: string): string {
    return (origineValide(origine) ?? origineApp()) + chemin;
  }

  async createCheckoutSession(userId: string, planType: string, origine?: string) {
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
        /*
          Réutiliser le client Stripe existant plutôt que d'en faire naître un second.
          « customer_email » seul en crée un nouveau à chaque paiement : quelqu'un qui
          passe du mensuel au définitif se retrouverait avec deux clients, et la
          résiliation de son mensuel — qui part du client ayant payé — viserait un
          client tout neuf, donc vide. Le prélèvement mensuel survivrait à l'achat à
          vie, silencieusement. Ça rattache aussi tous ses paiements à une seule fiche.
        */
        ...(user.stripe_customer_id
          ? { customer: user.stripe_customer_id }
          : { customer_email: user.email }),
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
        success_url: this.lienRetour('/?success=true', origine),
        cancel_url: this.lienRetour('/?canceled=true', origine),
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
        return { checkoutUrl: this.lienRetour('/?success=true&mock=true', origine) };
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
          // Un achat à vie (mode « payment ») rend inutile tout prélèvement récurrent
          // du même client : sans cette résiliation, il paierait 99,99 € puis
          // continuerait à être débité de 9,99 € chaque mois.
          if (mode === 'payment' && session.customer) {
            await this.resilierRecurrents(session.customer as string);
          }

          console.log(`[Stripe Webhook] User ${userId} upgraded successfully!`);
        }
        break;
      
      // Un abonnement change d'état tout seul, longtemps après l'achat : l'essai de
      // 7 jours se termine, une carte expire, une relance aboutit. Ces trois événements
      // sont le seul moyen de l'apprendre.
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.synchroniserAbonnement(event.data.object as Stripe.Subscription);
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return { received: true };
  }

  /**
   * Traduit un statut Stripe en statut interne.
   *
   * « unpaid » rejoint PAST_DUE : Stripe a épuisé ses relances mais n'a pas résilié,
   * l'abonnement n'est simplement plus payé. « incomplete_expired » rejoint CANCELED :
   * le tout premier paiement n'a jamais abouti, il n'y a jamais eu d'abonné.
   */
  private static readonly STATUTS: Record<string, 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'INACTIVE'> = {
    trialing: 'TRIALING',
    active: 'ACTIVE',
    past_due: 'PAST_DUE',
    unpaid: 'PAST_DUE',
    canceled: 'CANCELED',
    incomplete: 'INACTIVE',
    incomplete_expired: 'CANCELED',
    paused: 'INACTIVE',
  };

  /** Les deux statuts qui ouvrent le Pro. Doit rester aligné sur `AiQuotaService.PAID_STATUSES`. */
  private static readonly PAYANTS = ['ACTIVE', 'TRIALING'];

  /**
   * Début et fin de la période en cours, quel que soit l'emplacement où Stripe les met.
   *
   * La destination Stripe envoie ses événements dans SA version d'API — ici
   * 2026-06-24.dahlia — quelle que soit celle déclarée par le SDK (14.25.0, figé sur
   * 2023-10-16). Or depuis Basil (2025-03-31), « current_period_start » et
   * « current_period_end » ne sont plus sur l'abonnement : ils vivent sur chacun de
   * ses items. Les lire à la racine ne lèverait aucune erreur, les deux colonnes
   * seraient simplement restées vides pour toujours. On accepte les deux emplacements
   * pour ne dépendre ni de la version du SDK ni de celle de la destination — et ça vaut
   * aussi bien pour l'objet reçu par le webhook que pour celui lu par la réconciliation.
   */
  private static periodes(sub: Stripe.Subscription): { debut: Date | null; fin: Date | null } {
    const enSeconde = (t?: number | null) => (typeof t === 'number' ? new Date(t * 1000) : null);
    const item = (sub as any).items?.data?.[0];
    return {
      debut: enSeconde((sub as any).current_period_start ?? item?.current_period_start),
      fin: enSeconde((sub as any).current_period_end ?? item?.current_period_end),
    };
  }

  /**
   * Reporte l'état réel d'un abonnement Stripe dans notre base.
   *
   * Jusqu'ici seule la résiliation définitive était écoutée, et rien n'écrivait jamais
   * PAST_DUE ni TRIALING alors que les deux existent dans l'enum. Conséquence : à la fin
   * de l'essai de 7 jours, un paiement refusé laissait le compte « ACTIVE » — donc le Pro
   * gratuit à vie, jusqu'à ce que Stripe finisse par résilier de lui-même, ce qu'il ne
   * fait pas toujours selon le réglage des relances.
   *
   * La correspondance se fait sur le seul `stripe_sub_id`, jamais sur le client : un
   * achat « à vie » est un paiement unique, sans abonnement, et se retrouverait annulé
   * par la résiliation d'un ancien mensuel du même acheteur.
   */
  private async synchroniserAbonnement(sub: Stripe.Subscription) {
    const statut = SubscriptionsService.STATUTS[sub.status];
    if (!statut) {
      console.warn(`[Stripe Webhook] Statut d'abonnement inconnu, ignoré : ${sub.status}`);
      return;
    }

    const { debut, fin } = SubscriptionsService.periodes(sub);

    // updateMany plutôt que update : l'abonnement peut appartenir à un compte supprimé,
    // ou l'événement précéder le checkout qui l'a créé. Aucune ligne touchée est un
    // résultat valable, là où `update` lèverait P2025 et ferait répondre 500 à Stripe —
    // qui le prendrait pour une panne et rejouerait l'événement pendant trois jours.
    const { count } = await this.prisma.subscription.updateMany({
      where: { stripe_sub_id: sub.id },
      data: {
        status: statut,
        current_period_start: debut,
        current_period_end: fin,
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
      },
    });

    if (count === 0) {
      console.warn(`[Stripe Webhook] Abonnement ${sub.id} inconnu en base (statut ${sub.status}).`);
      return;
    }
    console.log(`[Stripe Webhook] Abonnement ${sub.id} → ${statut}.`);
  }

  /**
   * Met fin aux abonnements récurrents d'un client qui vient d'acheter à vie.
   *
   * Sans ça, quelqu'un qui passe du mensuel au définitif continue d'être prélevé
   * 9,99 € tous les mois pour une chose qu'il possède déjà — et il ne s'en apercevra
   * qu'en lisant son relevé, un mois plus tard. C'est le seul endroit du code qui
   * touche à l'argent de quelqu'un sans qu'il ait cliqué à cet instant précis, d'où la
   * restriction aux statuts réellement facturables et la trace systématique.
   *
   * N'interrompt jamais l'appelant : l'accès à vie vient d'être accordé, et le refuser
   * parce que la résiliation a échoué serait la pire des deux issues. Une exception
   * lancée depuis le webhook ferait de surcroît rejouer l'événement par Stripe pendant
   * trois jours.
   */
  /**
   * Résilier avant de supprimer un compte — la même opération, l'échec en plus.
   *
   * `resilierRecurrents` avale ses erreurs, et c'est correct là où elle sert :
   * l'accès à vie vient d'être accordé, le refuser parce que Stripe n'a pas
   * répondu serait pire. Ici l'arbitrage s'inverse. Supprimer un compte dont
   * l'abonnement continue de tourner prélève 9,99 € par mois à quelqu'un qui n'a
   * plus aucun moyen de se connecter pour l'arrêter : l'échec doit remonter et
   * interrompre la suppression.
   */
  async resilierPourSuppression(clientStripe: string): Promise<void> {
    const FACTURABLES = ['active', 'trialing', 'past_due', 'unpaid'];
    const abos = await this.stripe.subscriptions.list({ customer: clientStripe, status: 'all', limit: 20 });
    for (const abo of abos.data) {
      if (!FACTURABLES.includes(abo.status)) continue;
      await this.stripe.subscriptions.cancel(abo.id);
      console.log(`[Stripe] Suppression de compte : abonnement ${abo.id} (${abo.status}) résilié.`);
    }
  }

  private async resilierRecurrents(clientStripe: string) {
    const FACTURABLES = ['active', 'trialing', 'past_due', 'unpaid'];
    try {
      const abos = await this.stripe.subscriptions.list({ customer: clientStripe, status: 'all', limit: 20 });
      for (const abo of abos.data) {
        if (!FACTURABLES.includes(abo.status)) continue;
        await this.stripe.subscriptions.cancel(abo.id);
        console.log(`[Stripe] Achat à vie : abonnement ${abo.id} (${abo.status}) résilié pour ${clientStripe}.`);
      }
    } catch (error: any) {
      console.error(`[Stripe] Résiliation après achat à vie impossible pour ${clientStripe} :`, error?.message);
    }
  }

  /**
   * Rang d'un statut Stripe, pour départager plusieurs abonnements du même acheteur.
   *
   * Quelqu'un qui a résilié puis repris en a deux ; c'est le vivant qui compte, pas le
   * plus récemment modifié — une résiliation étant elle-même une modification.
   */
  private static rang(statut: string): number {
    if (statut === 'active' || statut === 'trialing') return 3;
    if (statut === 'past_due' || statut === 'unpaid') return 2;
    return 1;
  }

  /**
   * Va demander à Stripe l'état réel de l'abonnement, sans passer par le webhook.
   *
   * Le webhook est une notification *poussée* : s'il échoue — signature qui ne
   * correspond pas, événement non déclaré sur la destination, service en train de
   * redémarrer — l'argent est encaissé et l'accès n'est jamais ouvert, sans que rien
   * ne le signale nulle part. C'est exactement ce qui s'est produit le 13 août 2026 sur
   * le tout premier achat. Cette route est le chemin inverse : c'est l'application qui
   * interroge Stripe, donc elle ne dépend ni de la signature, ni de la liste
   * d'événements de la destination, ni du fait que le service tournait à cet instant.
   *
   * La correspondance se fait **par e-mail**, et non par `stripe_customer_id` : cette
   * colonne n'est écrite que par le webhook, donc s'y fier ne réparerait justement pas
   * le cas où il n'a pas tourné. L'e-mail est celui passé à Stripe au moment du
   * paiement (`customer_email` du checkout), c'est donc la clé du paiement lui-même.
   */
  async verifierAbonnement(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    let clients: string[];
    try {
      const parEmail = await this.stripe.customers.list({ email: user.email, limit: 10 });
      // L'identifiant déjà connu est gardé en tête : un acheteur peut avoir changé
      // l'e-mail de son compte Stripe après coup, la recherche par e-mail le manquerait.
      clients = [
        ...new Set([
          ...(user.stripe_customer_id ? [user.stripe_customer_id] : []),
          ...parEmail.data.map((c) => c.id),
        ]),
      ];
    } catch (error: any) {
      console.error('[Stripe] Vérification impossible :', error);
      throw new BadRequestException(
        "Impossible de joindre Stripe pour vérifier ton abonnement. Réessaie dans un moment.",
      );
    }

    if (clients.length === 0) {
      return { abonne: false, status: null as string | null, formule: null as string | null };
    }

    let meilleur: Stripe.Subscription | null = null;
    let clientAVie: string | null = null;

    for (const client of clients) {
      const abos = await this.stripe.subscriptions.list({ customer: client, status: 'all', limit: 10 });
      for (const abo of abos.data) {
        if (!meilleur || SubscriptionsService.rang(abo.status) > SubscriptionsService.rang(meilleur.status)) {
          meilleur = abo;
        }
      }

      // L'achat « à vie » est un paiement unique : il ne crée aucun objet Subscription
      // chez Stripe, et resterait donc invisible à la boucle ci-dessus.
      if (!clientAVie) {
        const sessions = await this.stripe.checkout.sessions.list({ customer: client, limit: 20 });
        if (sessions.data.some((s) => s.mode === 'payment' && s.payment_status === 'paid')) {
          clientAVie = client;
        }
      }
    }

    // L'achat à vie prime sur tout le reste : il n'expire pas, et il ne doit pas être
    // écrasé par la résiliation d'un ancien mensuel du même acheteur.
    if (clientAVie) {
      // Le mensuel qu'on vient peut-être de trouver à côté n'a plus lieu d'être. La
      // boucle porte sur *tous* les clients de cette adresse, pas seulement celui qui a
      // payé à vie : un compte peut en avoir deux, précisément parce que le checkout
      // en créait un nouveau à chaque paiement avant le correctif — et c'est sur
      // l'ancien que vit le prélèvement qu'on veut arrêter.
      if (meilleur && SubscriptionsService.rang(meilleur.status) > 1) {
        for (const client of clients) {
          await this.resilierRecurrents(client);
        }
      }
      await this.ecrire(userId, clientAVie, {
        status: 'ACTIVE',
        stripe_sub_id: null,
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
      });
      console.log(`[Stripe] Réconciliation ${userId} : achat à vie retrouvé.`);
      return { abonne: true, status: 'ACTIVE' as string | null, formule: 'lifetime' as string | null };
    }

    if (meilleur) {
      const statut = SubscriptionsService.STATUTS[meilleur.status] ?? 'INACTIVE';
      const { debut, fin } = SubscriptionsService.periodes(meilleur);
      await this.ecrire(userId, meilleur.customer as string, {
        status: statut,
        stripe_sub_id: meilleur.id,
        current_period_start: debut,
        current_period_end: fin,
        cancel_at_period_end: meilleur.cancel_at_period_end ?? false,
      });
      console.log(`[Stripe] Réconciliation ${userId} : abonnement ${meilleur.id} → ${statut}.`);
      return {
        abonne: SubscriptionsService.PAYANTS.includes(statut),
        status: statut as string | null,
        formule: 'monthly' as string | null,
      };
    }

    return { abonne: false, status: null as string | null, formule: null as string | null };
  }

  /**
   * Écrit l'état constaté chez Stripe, et rattache le client au passage.
   *
   * `stripe_customer_id` n'était posé que par le webhook ; sans cette écriture, le
   * portail de gestion de l'abonnement resterait inaccessible à quelqu'un dont le
   * webhook a échoué, alors même qu'on vient de retrouver son paiement.
   */
  private async ecrire(
    userId: string,
    clientStripe: string,
    donnees: {
      status: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'INACTIVE';
      stripe_sub_id: string | null;
      current_period_start: Date | null;
      current_period_end: Date | null;
      cancel_at_period_end: boolean;
    },
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { stripe_customer_id: clientStripe },
    });
    await this.prisma.subscription.upsert({
      where: { user_id: userId },
      update: { ...donnees, plan_type: 'ELITE' },
      create: { user_id: userId, ...donnees, plan_type: 'ELITE' },
    });
  }

  async createPortalSession(userId: string, origine?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.stripe_customer_id) {
      throw new BadRequestException('Aucun compte Stripe associé trouvé.');
    }

    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: this.lienRetour('/?auth=true', origine),
      });

      return { portalUrl: session.url };
    } catch (error: any) {
      console.error('[Stripe] Create portal session error:', error);
      throw new BadRequestException('Failed to create Stripe portal session: ' + error.message);
    }
  }
}
