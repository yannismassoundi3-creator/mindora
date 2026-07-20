import { Controller, Post, Body, Req, Headers, UseGuards, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@ApiTags('Subscriptions & Payments')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  @ApiOperation({ summary: 'Créer une session de paiement Stripe' })
  async createCheckoutSession(@Req() req: Request, @Body('planType') planType: string) {
    const userId = (req.user as any).userId;
    return this.subscriptionsService.createCheckoutSession(userId, planType);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe Webhook (Appelé par Stripe)' })
  async handleStripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
    // Dans la vraie vie, il faut récupérer le raw body pour Stripe
    const payload = (req as any).rawBody; 
    return this.subscriptionsService.handleWebhook(signature, payload);
  }

  @Post('mock-success')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Bouchon temporaire pour simuler un achat réussi' })
  async mockSuccess(@Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.subscriptionsService.mockSuccess(userId);
  }
}
