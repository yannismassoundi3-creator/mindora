import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  getGoogleAuthUrl() {
    // Renvoie l'URL OAuth2 de Google
    return {
      url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=mock&redirect_uri=mock&response_type=code&scope=https://www.googleapis.com/auth/calendar'
    };
  }

  async handleWebhook(payload: any) {
    console.log('[Google Calendar Webhook] Reçu un changement depuis le calendrier.');
    // Mettre à jour l'heure de la tâche dans la BD si l'utilisateur l'a déplacée dans Google Calendar
    return { status: 'synchronized' };
  }
}
