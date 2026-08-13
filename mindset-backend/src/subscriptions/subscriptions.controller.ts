import { Controller, Post, Body, Req, Headers, UseGuards, Get, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { OfferPromptService, type Palier } from './offer-prompt.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Request } from 'express';

const PALIERS: Palier[] = ['j3', 'j7', 'j21', 'recurrent'];
const ACTIONS = ['vue', 'reporte', 'ouvert'] as const;

@ApiTags('Subscriptions & Payments')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly offerPrompt: OfferPromptService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  @ApiOperation({ summary: 'Créer une session de paiement Stripe' })
  async createCheckoutSession(
    @Req() req: Request,
    @Body('planType') planType: string,
    @Body('origine') origine?: string,
  ) {
    const userId = (req.user as any).userId;
    // L'origine est proposée par le navigateur et vérifiée contre une liste blanche
    // côté service : c'est le seul moyen de ne pas dépendre d'une variable
    // d'environnement pour ramener l'acheteur chez lui après son paiement.
    return this.subscriptionsService.createCheckoutSession(userId, planType, origine);
  }

  /**
   * Filet de sécurité de l'encaissement : demander à Stripe plutôt qu'attendre son appel.
   *
   * Le webhook peut échouer sans bruit, et alors quelqu'un a payé sans rien recevoir.
   * Cette route referme ce trou depuis l'autre bout. La cadence est serrée parce que
   * chaque appel interroge l'API de Stripe : trois par minute suffisent largement au
   * retour d'un paiement, et empêchent d'en faire une boucle.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('verifier')
  @ApiOperation({ summary: "Demander à Stripe l'état réel de l'abonnement et le reporter en base" })
  async verifierAbonnement(@Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.subscriptionsService.verifierAbonnement(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('portal')
  @ApiOperation({ summary: 'Créer une session portail client Stripe' })
  async createPortalSession(@Req() req: Request, @Body('origine') origine?: string) {
    const userId = (req.user as any).userId;
    return this.subscriptionsService.createPortalSession(userId, origine);
  }

  /**
   * La relance ne peut pas être décidée dans le navigateur : il ignore l'âge réel du
   * compte, l'usage réel, et il oublie tout ce qu'on lui a déjà montré dès qu'on
   * change d'appareil. Le serveur dit s'il faut parler et de quoi ; le front écrit
   * la phrase, parce que le nom du coach n'existe que chez lui.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('relance')
  @ApiOperation({ summary: "Faut-il reparler de l'abonnement à ce compte, et sous quel angle" })
  async relance(@Req() req: Request) {
    return this.offerPrompt.decider((req.user as any).userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('relance/reponse')
  @ApiOperation({ summary: "Enregistrer l'affichage d'une relance et la réponse qui a suivi" })
  async repondreRelance(@Req() req: Request, @Body() body: { palier?: string; action?: string }) {
    // Sans ce filtre, n'importe quelle chaîne finirait en base comme palier et
    // rendrait la progression incalculable — un palier inconnu ne se compare à
    // aucun autre, donc la personne ne serait plus jamais relancée.
    if (!PALIERS.includes(body?.palier as Palier)) {
      throw new BadRequestException('Palier inconnu.');
    }
    if (!ACTIONS.includes(body?.action as (typeof ACTIONS)[number])) {
      throw new BadRequestException('Action inconnue.');
    }
    return this.offerPrompt.enregistrer(
      (req.user as any).userId,
      body.palier as Palier,
      body.action as (typeof ACTIONS)[number],
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiResponse({ status: 403, description: 'Réservé aux comptes ADMIN.' })
  @Get('relance/stats')
  @ApiOperation({ summary: "L'entonnoir de la relance : vues, reports, ouvertures de l'offre" })
  async statistiquesRelance() {
    return this.offerPrompt.statistiques();
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe Webhook (Appelé par Stripe)' })
  async handleStripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
    // Dans la vraie vie, il faut récupérer le raw body pour Stripe
    const payload = (req as any).rawBody; 
    return this.subscriptionsService.handleWebhook(signature, payload);
  }

}
