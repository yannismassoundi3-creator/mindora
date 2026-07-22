import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AiCoachingService } from './ai-coaching.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@ApiTags('AI Coaching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-coaching')
export class AiCoachingController {
  constructor(private readonly aiCoachingService: AiCoachingService) {}

  @Post('onboarding')
  @ApiOperation({ summary: 'Soumettre le questionnaire intelligent (Onboarding)' })
  async submitOnboarding(@Req() req: Request, @Body() data: any) {
    const userId = (req.user as any).userId;
    return this.aiCoachingService.processOnboarding(userId, data);
  }

  @Post('generate-routines')
  @ApiOperation({ summary: 'Générer les routines du lendemain (Cron ou Manuel)' })
  async generateDailyRoutines(@Req() req: Request) {
    const userId = (req.user as any)?.userId || 'demo-user';
    return this.aiCoachingService.generateRoutinesForUser(userId);
  }

  @Post('chat')
  @ApiOperation({ summary: 'Discuter avec le Coach IA' })
  async chat(@Body() body: { prompt: string, history?: any[], context?: any }) {
    return this.aiCoachingService.chatWithAi(body.prompt, body.history || [], body.context);
  }

  @Post('tts')
  @ApiOperation({ summary: 'Générer de la voix avec OpenAI TTS' })
  async generateSpeech(@Body() body: { text: string }) {
    return this.aiCoachingService.generateSpeech(body.text);
  }
}
