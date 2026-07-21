import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as cron from 'node-cron';
import * as webpush from 'web-push';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(private prisma: PrismaService) {
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:mindoraappli@gmail.com';
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.logger.log('VAPID keys configured successfully for Web Push.');
    } else {
      this.logger.warn('VAPID keys missing in environment! Push notifications will fail.');
    }
  }

  async saveSubscription(userId: string, subscription: any) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { push_subscription: JSON.parse(JSON.stringify(subscription)) },
    });
    this.logger.log(`Saved push subscription for user ${userId}`);
    return { success: true };
  }

  async sendNotification(userId: string, payload: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.push_subscription) {
      this.logger.warn(`No push subscription found for user ${userId}`);
      return;
    }

    try {
      await webpush.sendNotification(user.push_subscription as any, JSON.stringify(payload));
      this.logger.log(`Push notification sent successfully to user ${userId}`);
    } catch (error) {
      this.logger.error(`Error sending push notification to user ${userId}:`, error);
      // Remove invalid subscriptions
      if ((error as any).statusCode === 404 || (error as any).statusCode === 410) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { push_subscription: null },
        });
        this.logger.log(`Removed invalid push subscription for user ${userId}`);
      }
    }
  }

  onModuleInit() {
    cron.schedule('0 20 * * *', async () => {
      this.logger.log('Running daily push reminder cron job at 20:00');
      await this.sendDailyReminders();
    });
  }

  async sendDailyReminders() {
    const users = await this.prisma.user.findMany({
      where: { push_subscription: { not: null } }
    });
    for (const user of users) {
      await this.sendNotification(user.id, {
        title: 'Validation Requise 🔥',
        body: "N'oublie pas de compléter tes routines du jour ! Ne brise pas ta série de focus.",
        url: 'https://mindset-elite.com'
      });
    }
    this.logger.log(`Sent daily push reminders to ${users.length} users.`);
  }
}
