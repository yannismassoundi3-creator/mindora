import { Controller, Post, Get, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';
import { ChatDto } from './dto/chat.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@ApiTags('AI Coaching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-coaching')
export class AiCoachingController {
  constructor(
    private readonly aiCoachingService: AiCoachingService,
    private readonly aiQuota: AiQuotaService,
    private readonly coins: CoinLedgerService,
  ) {}

  @Get('quota')
  @ApiOperation({ summary: 'Messages IA restants pour le mois en cours' })
  async getQuota(@Req() req: Request) {
    const userId = (req.user as any).userId;
    const [quota, solde, claims] = await Promise.all([
      this.aiQuota.getQuota(userId),
      this.coins.getBalance(userId),
      this.coins.claimsAujourdhui(userId),
    ]);
    return {
      ...quota,
      coins: solde,
      coutParMessage: CoinLedgerService.COUT_MESSAGE,
      actionsCrediteesAujourdhui: claims,
      plafondQuotidien: CoinLedgerService.ACTIONS_MAX_PAR_JOUR,
    };
  }

  // Le plafond quotidien borne le gain, pas le nombre d'appels : sans ça, marteler
  // cette route reste un moyen de charger la base pour rien.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('coins/claim')
  @ApiOperation({ summary: 'Créditer les coins d\'une action validée (idempotent)' })
  async claimCoins(@Req() req: Request, @Body() body: { eventKey: string }) {
    return this.coins.claim((req.user as any).userId, body?.eventKey);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('onboarding')
  @ApiOperation({ summary: 'Soumettre le questionnaire intelligent (Onboarding)' })
  async submitOnboarding(@Req() req: Request, @Body() data: any) {
    const userId = (req.user as any).userId;
    return this.aiCoachingService.processOnboarding(userId, data);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('generate-routines')
  @ApiOperation({ summary: 'Générer les routines du lendemain (Cron ou Manuel)' })
  async generateDailyRoutines(@Req() req: Request) {
    const userId = (req.user as any).userId;
    await this.aiQuota.consumeAiCredit(userId, 'routines');
    return this.aiCoachingService.generateRoutinesForUser(userId);
  }

  // Les coins bornent le nombre total de messages, jamais la cadence : avec 500 coins
  // on pouvait en envoyer 50 en dix secondes et saturer l'IA pour les autres.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('chat')
  @ApiOperation({ summary: 'Discuter avec le Coach IA' })
  @ApiResponse({ status: 402, description: 'Coins insuffisants ou quota mensuel épuisé.' })
  async chat(@Req() req: Request, @Body() body: ChatDto) {
    const userId = (req.user as any).userId;
    // Deux barrières distinctes : les coins font respecter la règle du jeu (y compris
    // pour les abonnés), le quota mensuel plafonne la dépense des comptes gratuits.
    await this.coins.spend(userId);
    await this.aiQuota.consumeAiCredit(userId, 'chat');
    return this.aiCoachingService.chatWithAi(userId, body.prompt, body.context);
  }

  @Get('history')
  @ApiOperation({ summary: 'Récupérer l\'historique des conversations avec l\'IA' })
  async getHistory(@Req() req: Request) {
    const userId = (req.user as any)?.userId;
    return this.aiCoachingService.getChatHistory(userId);
  }

  // Chaque appel part chez OpenAI et se facture : c'est la route la plus chère.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('tts')
  @ApiOperation({ summary: 'Générer de la voix avec OpenAI TTS' })
  @ApiResponse({ status: 402, description: 'Réservé aux abonnés.' })
  async generateSpeech(@Req() req: Request, @Body() body: { text: string }) {
    await this.aiQuota.assertSubscribed((req.user as any).userId);
    return this.aiCoachingService.generateSpeech(body.text);
  }
}
