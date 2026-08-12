import { Controller, Post, Body, UseGuards, Request, Get, HttpCode, Logger } from '@nestjs/common';
import { PushService } from './push.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Push Notifications')
@Controller('push')
export class PushController {
  private readonly logger = new Logger(PushController.name);

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
  @Post('permission')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Enregistrer ce que le navigateur a répondu à la demande de notifications',
    description:
      "Appelée aussi bien sur un refus que sur une acceptation, et sur les appareils " +
      "qui en sont techniquement incapables. C'est la seule source qui distingue « a " +
      "refusé » de « n'a jamais vu la question ».",
  })
  async enregistrerPermission(
    @Request() req,
    @Body() body: { etat: string; deviceId?: string; plateforme?: string },
  ) {
    return this.pushService.enregistrerPermission(
      req.user.userId,
      body?.etat,
      body?.deviceId,
      body?.plateforme,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiResponse({ status: 403, description: 'Réservé aux comptes ADMIN.' })
  @Get('permission/stats')
  @ApiOperation({ summary: "L'entonnoir des notifications : sollicités, réponses, joignables" })
  async statistiquesPermissions() {
    return this.pushService.statistiquesPermissions();
  }

  // Ces deux routes pilotent l'envoi à TOUT LE MONDE : elles ne relèvent pas du compte
  // qui les appelle. Le simple fait d'être connecté suffisait pour déclencher une
  // notification à l'ensemble des utilisateurs et vider le budget IA de la journée,
  // partagé par toute l'application. C'est de l'outillage d'exploitation, pas une
  // fonctionnalité : réservé aux administrateurs.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiResponse({ status: 403, description: 'Réservé aux comptes ADMIN.' })
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiResponse({ status: 403, description: 'Réservé aux comptes ADMIN.' })
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
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
      // Le commentaire promettait ici une clé de secours codée en dur. Il n'y en a
      // jamais eu : on renvoyait une chaîne vide, le client en tirait un tableau vide
      // et `pushManager.subscribe` échouait sans que personne ne sache pourquoi.
      // Plus personne ne pouvait s'abonner, et rien ne le disait.
      this.logger.error(
        'VAPID_PUBLIC_KEY absente : aucun abonnement aux notifications ne peut être créé.',
      );
    }
    return { publicKey: key || '' };
  }
}
