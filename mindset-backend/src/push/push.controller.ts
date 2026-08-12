import { Controller, Post, Body, UseGuards, Request, Get, HttpCode } from '@nestjs/common';
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
      title: 'Disciplix',
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

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('morning-brief/run-all')
  @HttpCode(202)
  @ApiOperation({
    summary: "Lancer la tâche de 10h maintenant, filtre des comptes dormants inclus",
    description:
      "Répond immédiatement : la tournée dure 2,2 s par compte actif et dépasserait le " +
      "délai de la requête au-delà d'une quarantaine de personnes. Le décompte se lit " +
      'sur GET /push/morning-brief/status.',
  })
  async runMorningBriefs(@Request() req) {
    // La route de test ci-dessus contourne le filtre d'activité : elle peut donc
    // réussir alors que la tâche planifiée n'enverrait rien. Celle-ci rejoue le
    // parcours complet et compte les envois, seule façon de distinguer les deux.
    return this.pushService.declencherTourneeBriefs(`manuel:${req.user.userId}`);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('morning-brief/status')
  @ApiOperation({
    summary: 'Où en est la tournée des briefs, et ce qu’a donné la dernière',
  })
  async morningBriefStatus() {
    // Vaut aussi pour le cron de 10h : jusqu'ici son décompte n'existait que dans les
    // logs de Render, à retrouver à la main le lendemain.
    return this.pushService.etatTournee();
  }


  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Get VAPID public key for frontend subscription' })
  getVapidPublicKey() {
    // Fallback key hardcodée pour éviter les erreurs si la variable d'environnement manque
    const key = process.env.VAPID_PUBLIC_KEY || '';
    return { publicKey: key };
  }
}
