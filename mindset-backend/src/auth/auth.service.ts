import { Injectable, ConflictException, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    // Vérification de l'unicité
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
          // La vérification OTP se ferait ensuite via un autre endpoint
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
    });

    if (!user || !await argon2.verify(user.password_hash, dto.password)) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Le compte doit être vérifié (désactivé pour la démo)
    // if (!user.is_phone_verified) {
    //   throw new UnauthorizedException('Veuillez vérifier votre numéro de téléphone avec le code OTP.');
    // }

    return this.generateTokens(user.id, user.role);
  }

  async generateTokens(userId: string, role: string) {
    const payload = { sub: userId, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION'),
      }),
    ]);

    // Enregistrer le refresh token en DB
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // +7 jours

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        user_id: userId,
        expires_at: expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: userId, role }
    };
  }

  async revokeRefreshToken(userId: string, token: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        user_id: userId,
        token: token,
        is_revoked: false,
      },
      data: {
        is_revoked: true,
      },
    });
  }

  // --- LOGIQUE OTP ---

  async sendOtp(phoneNumber: string) {
    // Générer un code à 6 chiffres
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60000); // Valide 15 minutes

    await this.prisma.phoneVerification.create({
      data: {
        phone: phoneNumber,
        code: code,
        expires_at: expiresAt,
      }
    });

    // En production, on utiliserait le SDK Twilio ici:
    // await this.twilioClient.messages.create({ body: `Votre code Mindset: ${code}`, from: '...', to: phoneNumber });
    console.log(`[MOCK SMS] Envoi du code ${code} au numéro ${phoneNumber}`);
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const verification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone: dto.phone_number,
        code: dto.code,
        is_used: false,
        expires_at: { gt: new Date() } // Non expiré
      },
      orderBy: { created_at: 'desc' }
    });

    if (!verification) {
      throw new UnauthorizedException('Code OTP invalide ou expiré.');
    }

    // Marquer comme utilisé
    await this.prisma.phoneVerification.update({
      where: { id: verification.id },
      data: { is_used: true }
    });

    // Valider le compte utilisateur
    const user = await this.prisma.user.update({
      where: { phone_number: dto.phone_number },
      data: { is_phone_verified: true }
    });

    return { message: 'Numéro de téléphone vérifié avec succès.' };
  }

  async requestLoginOtp(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({
      where: { phone_number: phoneNumber }
    });

    if (!user) {
      throw new UnauthorizedException('Aucun compte associé à ce numéro.');
    }

    await this.sendOtp(phoneNumber);
    return { message: 'Code de connexion envoyé par SMS.' };
  }

  async verifyLoginOtp(dto: VerifyOtpDto) {
    // Vérification du code
    const verification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone: dto.phone_number,
        code: dto.code,
        is_used: false,
        expires_at: { gt: new Date() }
      },
      orderBy: { created_at: 'desc' }
    });

    if (!verification) {
      throw new UnauthorizedException('Code OTP invalide ou expiré.');
    }

    // Utilisateur associé
    const user = await this.prisma.user.findUnique({
      where: { phone_number: dto.phone_number }
    });

    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }

    // Marquer comme utilisé
    await this.prisma.phoneVerification.update({
      where: { id: verification.id },
      data: { is_used: true }
    });

    // Si c'est sa première connexion et qu'il n'était pas vérifié, on le valide
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
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }
    const { password_hash, ...result } = user;
    return result;
  }
}
