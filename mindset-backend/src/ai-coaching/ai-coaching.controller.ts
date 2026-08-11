import { Controller, Post, Get, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
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
  ) {}

  @Get('quota')
  @ApiOperation({ summary: 'Messages IA restants pour le mois en cours' })
  async getQuota(@Req() req: Request) {
    return this.aiQuota.getQuota((req.user as any).userId);
  }

  @Post('onboarding')
  @ApiOperation({ summary: 'Soumettre le questionnaire intelligent (Onboarding)' })
  async submitOnboarding(@Req() req: Request, @Body() data: any) {
    const userId = (req.user as any).userId;
    return this.aiCoachingService.processOnboarding(userId, data);
  }

  @Post('generate-routines')
  @ApiOperation({ summary: 'Générer les routines du lendemain (Cron ou Manuel)' })
  async generateDailyRoutines(@Req() req: Request) {
    const userId = (req.user as any).userId;
    await this.aiQuota.consumeAiCredit(userId, 'routines');
    return this.aiCoachingService.generateRoutinesForUser(userId);
  }

  @Post('chat')
  @ApiOperation({ summary: 'Discuter avec le Coach IA' })
  @ApiResponse({ status: 402, description: 'Quota de messages gratuits épuisé.' })
  async chat(@Req() req: Request, @Body() body: { prompt: string, context?: any }) {
    const userId = (req.user as any).userId;
    await this.aiQuota.consumeAiCredit(userId, 'chat');
    return this.aiCoachingService.chatWithAi(userId, body.prompt, body.context);
  }

  @Get('history')
  @ApiOperation({ summary: 'Récupérer l\'historique des conversations avec l\'IA' })
  async getHistory(@Req() req: Request) {
    const userId = (req.user as any)?.userId;
    return this.aiCoachingService.getChatHistory(userId);
  }

  @Post('tts')
  @ApiOperation({ summary: 'Générer de la voix avec OpenAI TTS' })
  @ApiResponse({ status: 402, description: 'Réservé aux abonnés.' })
  async generateSpeech(@Req() req: Request, @Body() body: { text: string }) {
    await this.aiQuota.assertSubscribed((req.user as any).userId);
    return this.aiCoachingService.generateSpeech(body.text);
  }
}
