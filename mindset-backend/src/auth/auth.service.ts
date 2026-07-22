import { Injectable, ConflictException, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as nodemailer from 'nodemailer';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Injectable()
export class AuthService {
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const smtpHost = this.configService.get<string>('SMTP_HOST') || 'smtp.ethereal.email';
    const smtpUser = this.configService.get<string>('SMTP_USER') || 'ethereal_user';
    const smtpPass = this.configService.get<string>('SMTP_PASS') || 'ethereal_pass';

    if (smtpHost.includes('gmail')) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    } else {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10),
        secure: false, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    }
  }

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email },
          { phone_number: dto.phone_number }
        ]
      }
    });

    if (existingUser) {
      throw new ConflictException('Cet email ou ce numéro de téléphone est déjà utilisé.');
    }

    try {
      const passwordHash = await argon2.hash(dto.password);

      const user = await this.prisma.user.create({
        data: {
          first_name: dto.first_name,
          last_name: dto.last_name,
          email: dto.email,
          phone_number: dto.phone_number,
          password_hash: passwordHash,
          is_phone_verified: false, 
        },
      });

      // Simulation de l'envoi du SMS OTP
      await this.sendOtp(dto.phone_number);

      return {
        message: 'Compte créé avec succès. Un code OTP a été envoyé par SMS.',
        user_id: user.id,
      };
    } catch (error) {
      throw new InternalServerErrorException('Erreur lors de la création du compte.');
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { ai_profile: true }
    });

    if (!user || !await argon2.verify(user.password_hash, dto.password)) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Vérifier si le SMTP est configuré. Sinon, bypass 2FA pour ne pas bloquer l'utilisateur.
    const smtpUser = this.configService.get<string>('SMTP_USER');
    if (!smtpUser || smtpUser === 'ethereal_user') {
      console.log(`[AUTH] 2FA bypassé pour ${user.email} car SMTP n'est pas configuré.`);
      const tokens = await this.generateTokens(user.id, user.role);
      return {
        ...tokens,
        has_ai_profile: !!user.ai_profile
      };
    }

    // 2FA par E-mail
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 min

    await this.prisma.twoFactorCode.create({
      data: {
        user_id: user.id,
        code,
        expires_at: expiresAt,
      }
    });

    // Send in background to avoid hanging the login request if SMTP is slow
    this.send2FAEmail(user.email, code).catch(console.error);

    return {
      requires2FA: true,
      email: user.email,
      message: 'Un code de vérification vous a été envoyé par e-mail.'
    };
  }

  async send2FAEmail(email: string, code: string) {
    try {
      const senderEmail = this.configService.get<string>('SMTP_USER') || 'security@mindset-elite.com';
      await this.transporter.sendMail({
        from: `"Mindset Elite Security" <${senderEmail}>`,
        to: email,
        subject: 'Votre code de connexion Mindset',
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 40px; text-align: center;">
            <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <h2 style="color: #1a1a1a;">Connexion Mindset Elite</h2>
              <p style="color: #4a4a4a; font-size: 16px;">Voici votre code de sécurité à 6 chiffres. Il est valide pendant 10 minutes.</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #3b82f6; margin: 30px 0; padding: 15px; background: #eff6ff; border-radius: 8px;">
                ${code}
              </div>
              <p style="color: #9ca3af; font-size: 14px;">Si vous n'avez pas demandé ce code, ignorez cet e-mail.</p>
            </div>
          </div>
        `
      });
      console.log(`[MOCK EMAIL 2FA] Code ${code} envoyé à ${email}`);
    } catch (e) {
      console.error('Failed to send 2FA email', e);
      // Fallback log for development
      console.log(`[MOCK EMAIL 2FA FALLBACK] Code ${code} envoyé à ${email}`);
    }
  }

  async verify2FA(email: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }

    const verification = await this.prisma.twoFactorCode.findFirst({
      where: {
        user_id: user.id,
        code: code,
        is_used: false,
        expires_at: { gt: new Date() }
      },
      orderBy: { created_at: 'desc' }
    });

    if (!verification) {
      throw new UnauthorizedException('Code 2FA invalide ou expiré.');
    }

    await this.prisma.twoFactorCode.update({
      where: { id: verification.id },
      data: { is_used: true }
    });

    const tokens = await this.generateTokens(user.id, user.role);
    
    // Check if ai_profile exists for response
    const has_ai_profile = (await this.prisma.aIProfile.count({ where: { user_id: user.id } })) > 0;

    return {
      ...tokens,
      has_ai_profile
    };
  }

  async generateTokens(userId: string, role: string) {
    const payload = { sub: userId, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'default-refresh-secret-mindora',
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d',
      }),
    ]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        user_id: userId,
        expires_at: expiresAt,
      },
    });

    return { accessToken, refreshToken, user: { id: userId, role } };
  }

  async revokeRefreshToken(userId: string, token: string) {
    await this.prisma.refreshToken.updateMany({
      where: { user_id: userId, token: token, is_revoked: false },
      data: { is_revoked: true },
    });
  }

  async sendOtp(phoneNumber: string) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60000);
    await this.prisma.phoneVerification.create({
      data: { phone: phoneNumber, code, expires_at: expiresAt }
    });
    console.log(`[MOCK SMS] Envoi du code ${code} au numéro ${phoneNumber}`);
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const verification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone: dto.phone_number,
        code: dto.code,
        is_used: false,
        expires_at: { gt: new Date() }
      },
      orderBy: { created_at: 'desc' }
    });

    if (!verification) throw new UnauthorizedException('Code OTP invalide ou expiré.');
    await this.prisma.phoneVerification.update({
      where: { id: verification.id },
      data: { is_used: true }
    });
    await this.prisma.user.update({
      where: { phone_number: dto.phone_number },
      data: { is_phone_verified: true }
    });
    return { message: 'Numéro de téléphone vérifié avec succès.' };
  }

  async requestLoginOtp(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({ where: { phone_number: phoneNumber } });
    if (!user) throw new UnauthorizedException('Aucun compte associé à ce numéro.');
    await this.sendOtp(phoneNumber);
    return { message: 'Code de connexion envoyé par SMS.' };
  }

  async verifyLoginOtp(dto: VerifyOtpDto) {
    const verification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone: dto.phone_number,
        code: dto.code,
        is_used: false,
        expires_at: { gt: new Date() }
      },
      orderBy: { created_at: 'desc' }
    });

    if (!verification) throw new UnauthorizedException('Code OTP invalide ou expiré.');
    const user = await this.prisma.user.findUnique({ where: { phone_number: dto.phone_number } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable.');

    await this.prisma.phoneVerification.update({
      where: { id: verification.id },
      data: { is_used: true }
    });

    if (!user.is_phone_verified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { is_phone_verified: true }
      });
    }
    return this.generateTokens(user.id, user.role);
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true }
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable.');
    const { password_hash, ...result } = user;
    return result;
  }
}
