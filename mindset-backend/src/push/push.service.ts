import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';
import * as cron from 'node-cron';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(private prisma: PrismaService) {
    const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
    const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

    if (publicVapidKey && privateVapidKey) {
      webpush.setVapidDetails(
        'mailto:support@mindset-elite.com',
        publicVapidKey,
        privateVapidKey,
      );
      this.logger.log('Web Push VAPID keys configured.');
    } else {
      this.logger.warn('VAPID keys not configured in .env');
    }
  }

  async saveSubscription(userId: string, subscription: any) {
    // Upsert based on endpoint
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        user_id: userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      create: {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  }

  async sendNotification(userId: string, payload: any) {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { user_id: userId },
    });

    const sendPromises = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
      } catch (error: any) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          // Subscription has expired or is no longer valid
          this.logger.warn(`Deleting invalid subscription for user ${userId}`);
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
        } else {
          this.logger.error(`Error sending push notification to user ${userId}:`, error);
        }
      }
    });

    await Promise.all(sendPromises);
  }

  onModuleInit() {
    // Schedule a job to run every day at 20:00 server time
    cron.schedule('0 20 * * *', async () => {
      this.logger.log('Running daily push notification cron job at 20:00');
      await this.sendDailyReminders();
    });
  }

  async sendDailyReminders() {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      distinct: ['user_id'], // Get unique users to avoid spamming if multiple devices, or just notify all endpoints
    });
    
    // Instead of filtering by sync state for v1, we just broadcast a reminder
    // to all users at 20:00. Those who finished will see a small reminder, 
    // those who didn't will be prompted.
    const uniqueUserIds = [...new Set(subscriptions.map(s => s.user_id))];
    
    for (const userId of uniqueUserIds) {
      await this.sendNotification(userId, {
        title: 'Mindset Elite',
        body: "N'oublie pas de compléter tes routines du jour ! Ne brise pas ta série 🔥",
        icon: '/pwa-192x192.png',
        url: 'https://mindset-elite.com/'
      });
    }
    
    this.logger.log(`Sent daily reminders to ${uniqueUserIds.length} users.`);
  }
}
