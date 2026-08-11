import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MorningBriefService } from './morning-brief.service';
import * as cron from 'node-cron';
import * as webpush from 'web-push';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private prisma: PrismaService,
    private morningBrief: MorningBriefService,
  ) {
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

  async saveSubscription(userId: string, subscription: any, deviceId?: string) {
    // Un appareil ne doit avoir qu'une seule inscription active. Quand le navigateur
    // recrée son abonnement, l'endpoint change : on purge d'abord les anciennes lignes
    // du même appareil, sinon elles restent et l'utilisateur reçoit tout en double.
    if (deviceId) {
      await this.prisma.pushSubscription.deleteMany({
        where: {
          user_id: userId,
          // Les lignes sans device_id datent d'avant ce mécanisme : impossible de savoir
          // à quel appareil elles appartiennent, et ce sont elles qui provoquent les
          // doublons actuels. On les retire aussi. Un autre appareil encore sur
          // l'ancienne version se réinscrira tout seul à sa prochaine ouverture.
          OR: [{ device_id: deviceId }, { device_id: null }],
          endpoint: { not: subscription.endpoint },
        },
      });
    }

    await this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        user_id: userId,
        device_id: deviceId ?? undefined,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      create: {
        user_id: userId,
        endpoint: subscription.endpoint,
        device_id: deviceId ?? null,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });

    this.logger.log(`Saved push subscription for user ${userId}`);
    return { success: true };
  }

  /**
   * Retourne le nombre d'appareils réellement atteints. Sans ça, l'appelant ne peut
   * pas distinguer « envoyé » de « personne n'était abonné », et annonce un succès
   * alors que rien n'est parti.
   */
  async sendNotification(userId: string, payload: any): Promise<{ abonnements: number; envoyees: number }> {
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { user_id: userId } });
    if (!subscriptions || subscriptions.length === 0) {
      this.logger.warn(`No push subscription found for user ${userId}`);
      return { abonnements: 0, envoyees: 0 };
    }

    let envoyees = 0;

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
        envoyees++;
        this.logger.log(`Push notification sent successfully to user ${userId}`);
      } catch (error) {
        const statut = (error as any)?.statusCode;
        // "Received unexpected response code" ne dit pas lequel : sans le statut ni le
        // corps, impossible de distinguer un abonnement périmé d'une clé invalide.
        this.logger.error(
          `Push refusé pour ${userId} — statut ${statut ?? 'inconnu'} : ${(error as any)?.body || (error as any)?.message}`,
        );

        // 404/410 : l'abonnement n'existe plus chez le fournisseur.
        // 401/403 : signature refusée. Mozilla répond 401 « VAPID public key mismatch »
        //           pour un abonnement créé avec une ancienne clé, Chrome 403 ; dans les
        //           deux cas il ne redeviendra jamais valide, et le garder fait échouer
        //           chaque envoi indéfiniment.
        // On le supprime pour que le navigateur en recrée un propre à sa prochaine visite.
        if (statut === 404 || statut === 410 || statut === 403 || statut === 401) {
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
          this.logger.log(`Abonnement obsolète supprimé pour ${userId} (statut ${statut})`);
        }
      }
    }

    return { abonnements: subscriptions.length, envoyees };
  }

  onModuleInit() {
    // 10:00 - Morning Wake Up
    cron.schedule('0 10 * * *', async () => {
      this.logger.log('Running morning push reminder cron job at 10:00');
      await this.sendMorningBriefs();
    }, { timezone: 'Europe/Paris' });

    // 18:00 - Evening Check-in
    cron.schedule('0 18 * * *', async () => {
      this.logger.log('Running evening push reminder cron job at 18:00');
      await this.sendBulkReminders('Check-in de 18h 🎯', 'Où en es-tu dans tes objectifs ? Viens faire le point.');
    }, { timezone: 'Europe/Paris' });

    // 20:00 - Streak Warnings (1st day)
    cron.schedule('0 20 * * *', async () => {
      this.logger.log('Running evening streak warnings at 20:00');
      await this.checkStreaksAndWarn(20);
    }, { timezone: 'Europe/Paris' });

    // 22:00 - Night Review & Urgent Warnings (2nd day)
    cron.schedule('0 22 * * *', async () => {
      this.logger.log('Running night push reminder and last chance at 22:00');
      await this.checkStreaksAndWarn(22);
    }, { timezone: 'Europe/Paris' });
    // 20:00 - Sunday Weekly Report
    cron.schedule('0 20 * * 0', async () => {
      this.logger.log('Running sunday weekly report at 20:00');
      await this.sendWeeklyReports();
    }, { timezone: 'Europe/Paris' });
  }

  async checkStreaksAndWarn(hour: number) {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true, sync_data: true }
    });

    const today = new Date().toISOString().slice(0, 10);
    const dYesterday = new Date();
    dYesterday.setDate(dYesterday.getDate() - 1);
    const yesterday = dYesterday.toISOString().slice(0, 10);

    for (const user of users) {
      if (!user.push_subscriptions || user.push_subscriptions.length === 0) continue;
      
      const scores = (user.sync_data?.daily_scores as Record<string, number>) || {};
      const scoreToday = scores[today] || 0;
      const scoreYesterday = scores[yesterday] || 0;
      
      // Calculate missed consecutive days
      let missedDays = 0;
      for (let i = 0; i < 4; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        if (!scores[dateStr] || scores[dateStr] === 0) {
          missedDays++;
        } else {
          break; // Streak is alive at some point in the last 4 days
        }
      }

      if (hour === 20) {
        if (missedDays >= 4) {
          // AI Dynamic Adjustment Prompt
          await this.sendNotification(user.id, {
            title: '🤖 Coach IA : Stratégie',
            body: 'Je remarque que tu as du mal depuis quelques jours. Ouvre le Chat IA pour réduire la difficulté de tes objectifs.',
            url: 'https://mindset-elite.com?auth=true'
          });
        } else if (scoreToday === 0 && scoreYesterday > 0) {
          // Warning 1st day miss
          await this.sendNotification(user.id, {
            title: 'Attention ! 😡',
            body: 'Tu n\'as pas encore fait tes routines aujourd\'hui. Ne brise pas ton rythme !',
            url: 'https://mindset-elite.com'
          });
        }
      } else if (hour === 22) {
        // Warning 2nd day miss (Urgency)
        if (missedDays === 2) {
          await this.sendNotification(user.id, {
            title: '🚨 URGENCE STREAK 🚨',
            body: 'Dernier avertissement ! Ta série va disparaître à minuit si tu n\'agis pas tout de suite !',
            url: 'https://mindset-elite.com'
          });
        } else if (scoreToday === 0 && scoreYesterday > 0) {
          // Normal night review for those who just haven't finished today yet
          await this.sendNotification(user.id, {
            title: 'C\'est l\'heure du bilan 🌙',
            body: 'Valide tes dernières routines avant de dormir.',
            url: 'https://mindset-elite.com'
          });
        }
      }
    }
  }

  async sendWeeklyReports() {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true, sync_data: true }
    });
    for (const user of users) {
      if (!user.push_subscriptions || user.push_subscriptions.length === 0) continue;
      
      const score = user.sync_data?.mental_score || 0;
      await this.sendNotification(user.id, {
        title: '📊 Bilan de ta semaine',
        body: `Ton Score Mental est de ${score}%. Voici ton plan d'attaque pour lundi. Ouvre l'app pour le découvrir !`,
        url: 'https://mindset-elite.com'
      });
    }
  }

  /**
   * Rappel du matin, écrit par l'IA à partir des données de chaque personne.
   *
   * Les comptes dormants sont ignorés : générer un message coûte un appel IA, et
   * relancer quelqu'un parti depuis des semaines avec un texte personnalisé ne le
   * fera pas revenir. Si l'IA est indisponible, on retombe sur le message générique
   * plutôt que de ne rien envoyer.
   */
  async sendMorningBriefs() {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true, sync_data: true },
    });

    let personnalises = 0;
    let generiques = 0;
    let ignores = 0;

    for (const user of users) {
      if (!user.push_subscriptions?.length) continue;

      if (!this.morningBrief.isActive(user.sync_data?.updated_at)) {
        ignores++;
        continue;
      }

      const resultat = await this.sendMorningBriefTo(user.id);
      if (resultat.personnalise) personnalises++;
      else generiques++;
    }

    this.logger.log(
      `Briefs du matin : ${personnalises} personnalisé(s), ${generiques} générique(s), ${ignores} compte(s) dormant(s) ignoré(s)`,
    );
  }

  /**
   * Un seul brief. Partagé par le cron et l'endpoint de test, pour que ce qui est
   * testé soit exactement ce qui part le matin.
   */
  async sendMorningBriefTo(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sync_data: true },
    });
    if (!user) return { envoye: false, personnalise: false, message: 'Utilisateur introuvable.' };

    const texte = await this.morningBrief.generate(user.first_name, user.sync_data);
    const body = texte ?? "Tes objectifs t'attendent, c'est l'heure de commencer ta journée.";

    const envoi = await this.sendNotification(user.id, {
      title: texte ? '🎯 Ton brief du jour' : 'Réveil ! ☀️',
      body,
      url: 'https://disciplix-ai.vercel.app/?auth=true',
    });

    return {
      envoye: envoi.envoyees > 0,
      personnalise: !!texte,
      message: body,
      abonnements: envoi.abonnements,
      appareilsAtteints: envoi.envoyees,
      ...(envoi.abonnements === 0 && {
        diagnostic:
          "Aucun appareil abonné aux notifications. Ouvre l'app et autorise les notifications, puis relance ce test.",
      }),
    };
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
