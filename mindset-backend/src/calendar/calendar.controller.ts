import { Controller, Get, UseGuards, Req, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@ApiTags('Google Calendar')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('auth-url')
  @ApiOperation({ summary: 'Obtenir l\'URL d\'autorisation Google Calendar' })
  getAuthUrl() {
    return this.calendarService.getGoogleAuthUrl();
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Webhook Google Calendar (Synchronisation bidirectionnelle)' })
  handleGoogleWebhook(
    @Body() payload: any,
    @Headers('x-goog-channel-token') channelToken: string | undefined,
  ) {
    const expectedToken = process.env.CALENDAR_WEBHOOK_SECRET;
    // Tant que le token n'est pas configuré, le webhook est désactivé par défaut
    // (le flow OAuth Google Calendar n'est de toute façon pas encore implémenté).
    if (!expectedToken || channelToken !== expectedToken) {
      throw new UnauthorizedException('Webhook non autorisé.');
    }
    return this.calendarService.handleWebhook(payload);
  }
}
