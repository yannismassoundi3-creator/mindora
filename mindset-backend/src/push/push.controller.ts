import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { PushService } from './push.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('Push Notifications')
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  @ApiOperation({ summary: 'Subscribe to web push notifications' })
  async subscribe(@Request() req, @Body() body: any) {
    const userId = req.user.userId;
    // Le client envoie { subscription, deviceId }. On accepte aussi l'ancien format
    // (l'abonnement à plat) le temps que tous les navigateurs aient rechargé l'app.
    const subscription = body?.subscription ?? body;
    await this.pushService.saveSubscription(userId, subscription, body?.deviceId);
    return { success: true, message: 'Subscription saved.' };
  }

  // A test endpoint to trigger a push notification for the logged in user
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('test')
  @ApiOperation({ summary: 'Test push notification' })
  async testPush(@Request() req) {
    const userId = req.user.userId;
    await this.pushService.sendNotification(userId, {
      title: 'Mindset Elite',
      body: "Prêt à exploser tes objectifs aujourd'hui ? Ouvre l'application et valide tes habitudes pour maintenir ta série ! 🔥",
      icon: '/icon-192.png'
    });
    return { success: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('morning-brief/test')
  @ApiOperation({
    summary: "Générer et envoyer son propre brief du matin, sans attendre 10h",
  })
  async testMorningBrief(@Request() req) {
    return this.pushService.sendMorningBriefTo(req.user.userId);
  }

  
  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Get VAPID public key for frontend subscription' })
  getVapidPublicKey() {
    // Fallback key hardcodée pour éviter les erreurs si la variable d'environnement manque
    const key = process.env.VAPID_PUBLIC_KEY || '';
    return { publicKey: key };
  }
}
