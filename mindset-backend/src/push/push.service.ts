import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as cron from 'node-cron';
import * as nodemailer from 'nodemailer';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private transporter: nodemailer.Transporter;

  constructor(private prisma: PrismaService) {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user,
          pass,
        },
      });
      this.logger.log('Email Transporter configured for Gmail.');
    } else {
      this.logger.warn('EMAIL_USER or EMAIL_PASS not configured in .env. Emails will not be sent.');
    }
  }

  // Maintient la compatibilité avec l'ancien code frontend
  async saveSubscription(userId: string, subscription: any) {
    return { success: true };
  }

  async sendEmailNotification(userId: string, payload: { title: string, body: string }) {
    if (!this.transporter) {
      this.logger.warn('Cannot send email: transporter not initialized.');
      return;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.email) return;

    const htmlContent = `
      <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; background-color: #0a0a0a; color: #fff; padding: 40px; border-radius: 16px; border: 1px solid #222;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ec4899; margin: 0; font-size: 28px; letter-spacing: 2px;">MINDORA</h1>
        </div>
        <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 20px; text-align: center;">${payload.title}</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #e5e5e5;">Bonjour ${user.first_name},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #e5e5e5; margin-bottom: 40px;">${payload.body}</p>
        <div style="text-align: center; margin-top: 30px; margin-bottom: 30px;">
          <a href="https://mindset-elite.com" style="background: linear-gradient(90deg, #ec4899, #8b5cf6); color: white; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 15px rgba(236, 72, 153, 0.4);">Accéder à mon Dashboard</a>
        </div>
        <hr style="border: none; border-top: 1px solid #333; margin: 30px 0;" />
        <p style="text-align: center; font-size: 12px; color: #666; margin: 0;">Ce message est un rappel automatique du système Mindora OS.</p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: '"Mindora OS" <' + process.env.EMAIL_USER + '>',
        to: user.email,
        subject: payload.title,
        html: htmlContent,
      });
      this.logger.log(`Email sent successfully to ${user.email}`);
    } catch (error) {
      this.logger.error(`Error sending email to ${user.email}:`, error);
    }
  }

  // Conserve la signature de l'ancienne fonction pour ne pas tout casser
  async sendNotification(userId: string, payload: any) {
    return this.sendEmailNotification(userId, payload);
  }

  onModuleInit() {
    cron.schedule('0 20 * * *', async () => {
      this.logger.log('Running daily email reminder cron job at 20:00');
      await this.sendDailyReminders();
    });
  }

  async sendDailyReminders() {
    const users = await this.prisma.user.findMany();
    for (const user of users) {
      await this.sendEmailNotification(user.id, {
        title: 'Validation Requise 🔥',
        body: "N'oublie pas de compléter tes routines du jour ! Ne brise pas ta série de focus.",
      });
    }
    this.logger.log(`Sent daily email reminders to ${users.length} users.`);
  }
}
