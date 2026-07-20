import { Controller, Get, UseGuards, Req, Post, Body } from '@nestjs/common';
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
  handleGoogleWebhook(@Body() payload: any) {
    return this.calendarService.handleWebhook(payload);
  }
}
