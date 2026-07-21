import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { PushService } from './push.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('Push Notifications')
@Controller('email')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  @ApiOperation({ summary: 'Subscribe to web push notifications' })
  async subscribe(@Request() req, @Body() subscription: any) {
    const userId = req.user.userId;
    await this.pushService.saveSubscription(userId, subscription);
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
      icon: '/pwa-192x192.png'
    });
    return { success: true };
  }
  
  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Get VAPID public key for frontend subscription' })
  getVapidPublicKey() {
    return { publicKey: process.env.VAPID_PUBLIC_KEY };
  }
}
