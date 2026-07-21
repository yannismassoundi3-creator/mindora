import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as cron from 'node-cron';
import * as webpush from 'web-push';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(private prisma: PrismaService) {
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:mindoraappli@gmail.com';
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BHrG1AYlmFHaFP1dsraB9T2mMpucNJ_t3Y2-69nIiLUfrpvaoesfe1wQE2y0fngztoBq6-NL-sxiVliec9fe4HE';
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'c7NdrePKUzEMbvzHEXoXyFaD8aRmjJEXqvEnjC_41OA';

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.logger.log('VAPID keys configured successfully for Web Push.');
    } else {
      this.logger.warn('VAPID keys missing in environment! Push notifications will fail.');
    }
  }

  async saveSubscription(userId: string, subscription: any) {
    const exists = await this.prisma.pushSubscription.findUnique({
      where: { endpoint: subscription.endpoint }
    });
    
    if (exists) {
      await this.prisma.pushSubscription.update({
        where: { endpoint: subscription.endpoint },
        data: {
          user_id: userId,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        }
      });
    } else {
      await this.prisma.pushSubscription.create({
        data: {
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        }
      });
    }
    this.logger.log(`Saved push subscription for user ${userId}`);
    return { success: true };
  }

  async sendNotification(userId: string, payload: any) {
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { user_id: userId } });
    if (!subscriptions || subscriptions.length === 0) {
      this.logger.warn(`No push subscription found for user ${userId}`);
      return;
    }

    for (const sub of subscriptions) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      try {
        await webpush.sendNotification(pushSub, JSON.stringify(payload));
        this.logger.log(`Push notification sent successfully to user ${userId}`);
      } catch (error) {
        this.logger.error(`Error sending push notification to user ${userId}:`, error);
        if ((error as any).statusCode === 404 || (error as any).statusCode === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
          this.logger.log(`Removed invalid push subscription for user ${userId}`);
        }
      }
    }
  }

  onModuleInit() {
    // 10:00 - Morning Wake Up
    cron.schedule('0 10 * * *', async () => {
      this.logger.log('Running morning push reminder cron job at 10:00');
      await this.sendBulkReminders('Réveil ! ☀️', 'Tes objectifs t\'attendent, c\'est l\'heure de commencer ta journée.');
    }, { timezone: 'Europe/Paris' });

    // 18:00 - Evening Check-in
    cron.schedule('0 18 * * *', async () => {
      this.logger.log('Running evening push reminder cron job at 18:00');
      await this.sendBulkReminders('Check-in de 18h 🎯', 'Où en es-tu dans tes objectifs ? Viens faire le point.');
    }, { timezone: 'Europe/Paris' });

    // 22:00 - Night Review
    cron.schedule('0 22 * * *', async () => {
      this.logger.log('Running night push reminder cron job at 22:00');
      await this.sendBulkReminders('C\'est l\'heure du bilan 🌙', 'Valide tes dernières routines avant de dormir.');
    }, { timezone: 'Europe/Paris' });
  }

  async sendBulkReminders(title: string, body: string) {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true }
    });
    for (const user of users) {
      if (user.push_subscriptions && user.push_subscriptions.length > 0) {
        await this.sendNotification(user.id, {
          title,
          body,
          url: 'https://mindset-elite.com'
        });
      }
    }
    this.logger.log(`Sent bulk push reminders: ${title}`);
  }
}
