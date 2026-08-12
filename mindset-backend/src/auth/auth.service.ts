import { Injectable, ConflictException, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email }
    });

    if (existingUser) {
      throw new ConflictException('Cet email est déjà utilisé.');
    }

    try {
      const passwordHash = await argon2.hash(dto.password);

      const user = await this.prisma.user.create({
        data: {
          first_name: dto.first_name,
          last_name: dto.last_name,
          email: dto.email,
          password_hash: passwordHash
        },
      });

      return {
        message: 'Compte créé avec succès.',
        user_id: user.id,
      };
    } catch (error) {
      throw new InternalServerErrorException('Erreur lors de la création du compte.');
    }
  }

  async claimAdmin(userId: string, secretKey: string) {
    const validKey = process.env.ADMIN_SECRET_KEY;
    if (!validKey) {
      throw new InternalServerErrorException('Configuration serveur manquante.');
    }
    if (secretKey !== validKey) {
      throw new UnauthorizedException('Clé secrète invalide.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'ADMIN' }
    });

    return { message: 'Félicitations, vous êtes maintenant Administrateur.' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { ai_profile: true }
    });

    if (!user || !await argon2.verify(user.password_hash, dto.password)) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Vérifier si Brevo est configuré. En dev, on bypass le 2FA pour ne pas bloquer le développement.
    // En production, une config manquante ne doit JAMAIS désactiver silencieusement le 2FA.
    const brevoApiKey = this.configService.get<string>('BREVO_API_KEY');
    if (!brevoApiKey) {
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        console.error('[AUTH] BREVO_API_KEY manquant en production : le 2FA ne peut pas être envoyé.');
        throw new InternalServerErrorException('Configuration serveur manquante (2FA).');
      }
      console.log(`[AUTH] 2FA bypassé pour ${user.email} car BREVO_API_KEY n'est pas configuré (dev uniquement).`);
      const tokens = await this.generateTokens(user.id, user.role, user.first_name);
      return {
        ...tokens,
        has_ai_profile: !!user.ai_profile
      };
    }

    // 2FA par E-mail
    //
    // crypto.randomInt et non Math.random : ce dernier s'appuie sur xorshift128+, un
    // générateur rapide mais prédictible. Quelques valeurs issues du même processus
    // suffisent à en reconstituer l'état interne, et donc à calculer les suivantes.
    // Or n'importe qui peut s'en procurer : chaque connexion sur son propre compte
    // rend un code du même flux. Ce code est le second facteur de tous les comptes ;
    // il doit venir d'une source cryptographique.
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 min

    // Les codes précédents encore valables sont retirés. `verify2FA` accepte n'importe
    // quel code non utilisé et non expiré : cinq tentatives de connexion laissaient
    // donc cinq codes bons en même temps, et multipliaient d'autant les chances d'un
    // tirage au hasard. Un seul code vaut à la fois — le dernier demandé.
    await this.prisma.twoFactorCode.updateMany({
      where: { user_id: user.id, is_used: false },
      data: { is_used: true },
    });

    await this.prisma.twoFactorCode.create({
      data: {
        user_id: user.id,
        code,
        expires_at: expiresAt,
      }
    });

    // Send in background to avoid hanging the login request
    this.send2FAEmail(user.email, code).catch(console.error);

    return {
      requires2FA: true,
      email: user.email,
      message: 'Un code de vérification vous a été envoyé par e-mail.'
    };
  }

  async send2FAEmail(email: string, code: string) {
    try {
      const apiKey = this.configService.get<string>('BREVO_API_KEY');
      const senderEmail = this.configService.get<string>('BREVO_SENDER_EMAIL') || 'mindoraappli@gmail.com';
      
      if (!apiKey) return;

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 40px; text-align: center;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #1a1a1a;">Connexion Disciplix</h2>
            <p style="color: #4a4a4a; font-size: 16px;">Voici votre code de sécurité à 6 chiffres. Il est valide pendant 10 minutes.</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #3b82f6; margin: 30px 0; padding: 15px; background: #eff6ff; border-radius: 8px;">
              ${code}
            </div>
            <p style="color: #9ca3af; font-size: 14px;">Si vous n'avez pas demandé ce code, ignorez cet e-mail.</p>
          </div>
        </div>
      `;

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Disciplix', email: senderEmail },
          to: [{ email: email }],
          subject: 'Votre code de sécurité Disciplix',
          htmlContent: htmlContent
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Brevo API Error:', errorText);
      } else {
        console.log(`[BREVO 2FA] Code envoyé à ${email}`);
      }
    } catch (e) {
      console.error('Failed to send 2FA email via Brevo', e);
    }
  }

  async verify2FA(email: string, code: string) {
    // Message identique dans tous les cas, comme pour l'oubli de mot de passe :
    // répondre « Utilisateur introuvable » à une adresse inconnue et « Code invalide »
    // à une adresse connue transforme cette route en annuaire de comptes.
    const refus = new UnauthorizedException('Code de vérification invalide ou expiré.');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw refus;
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
      throw refus;
    }

    await this.prisma.twoFactorCode.update({
      where: { id: verification.id },
      data: { is_used: true }
    });

    const tokens = await this.generateTokens(user.id, user.role, user.first_name);
    
    // Check if ai_profile exists for response
    const has_ai_profile = (await this.prisma.aIProfile.count({ where: { user_id: user.id } })) > 0;

    return {
      ...tokens,
      has_ai_profile
    };
  }

  async generateTokens(userId: string, role: string, firstName: string) {
    const payload = { sub: userId, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
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

    // first_name est attendu par le front pour l'accueil ("Bonjour, X").
    return { accessToken, refreshToken, user: { id: userId, role, first_name: firstName } };
  }

  /**
   * Échange un jeton de rafraîchissement contre une nouvelle paire.
   *
   * Le jeton est tourné à chaque usage plutôt que réutilisé pendant sept jours : un
   * jeton volé ne vaut alors que jusqu'au prochain rafraîchissement légitime.
   *
   * Présenter un jeton déjà révoqué n'est pas une erreur ordinaire — c'est soit un
   * rejeu, soit deux porteurs pour le même jeton, donc un vol probable. On coupe
   * alors toutes les sessions du compte plutôt que la seule requête en cours.
   */
  async refreshSession(token?: string) {
    if (!token) {
      throw new UnauthorizedException('Session absente.');
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      });
    } catch {
      throw new UnauthorizedException('Session expirée.');
    }

    const enBase = await this.prisma.refreshToken.findUnique({ where: { token } });

    if (!enBase) {
      throw new UnauthorizedException('Session inconnue.');
    }

    if (enBase.is_revoked) {
      await this.revokeAllRefreshTokens(enBase.user_id);
      throw new UnauthorizedException('Session révoquée : reconnecte-toi.');
    }

    if (enBase.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expirée.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, first_name: true, deleted_at: true },
    });

    // Un compte supprimé garde des jetons valides pendant sept jours : sans ce
    // contrôle, la suppression ne mettrait fin à rien avant leur expiration.
    if (!user || user.deleted_at) {
      await this.revokeAllRefreshTokens(enBase.user_id);
      throw new UnauthorizedException('Compte indisponible.');
    }

    // Révoqué avant d'en émettre un nouveau : si la création échoue, l'ancien ne
    // reste pas valide en circulation.
    await this.revokeRefreshToken(enBase.user_id, token);

    return this.generateTokens(user.id, user.role, user.first_name);
  }

  async revokeRefreshToken(userId: string, token: string) {
    await this.prisma.refreshToken.updateMany({
      where: { user_id: userId, token: token, is_revoked: false },
      data: { is_revoked: true },
    });
  }

  async revokeAllRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { user_id: userId, is_revoked: false },
      data: { is_revoked: true },
    });
  }

  async forgotPassword(email: string) {
    // Message générique dans tous les cas pour ne pas révéler si l'email existe (anti-énumération).
    const genericResponse = {
      message: 'Si un compte existe avec cet e-mail, un lien de réinitialisation vient de lui être envoyé.',
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return genericResponse;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60000); // 1 heure

    await this.prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });

    this.sendPasswordResetEmail(user.email, rawToken).catch(console.error);

    return genericResponse;
  }

  async sendPasswordResetEmail(email: string, rawToken: string) {
    try {
      const apiKey = this.configService.get<string>('BREVO_API_KEY');
      const senderEmail = this.configService.get<string>('BREVO_SENDER_EMAIL') || 'mindoraappli@gmail.com';
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
      const resetLink = `${frontendUrl}/?reset_token=${rawToken}`;

      if (!apiKey) {
        if (this.configService.get<string>('NODE_ENV') !== 'production') {
          console.log(`[AUTH][DEV] BREVO_API_KEY absent, lien de réinitialisation pour ${email} : ${resetLink}`);
        } else {
          console.log(`[AUTH] BREVO_API_KEY absent : impossible d'envoyer l'e-mail de réinitialisation à ${email}.`);
        }
        return;
      }

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 40px; text-align: center;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #1a1a1a;">Réinitialisation de mot de passe</h2>
            <p style="color: #4a4a4a; font-size: 16px;">Clique sur le bouton ci-dessous pour définir un nouveau mot de passe. Ce lien est valide pendant 1 heure.</p>
            <a href="${resetLink}" style="display: inline-block; margin: 20px 0; padding: 14px 28px; background: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">Réinitialiser mon mot de passe</a>
            <p style="color: #9ca3af; font-size: 14px;">Si tu n'as pas demandé cette réinitialisation, ignore cet e-mail.</p>
          </div>
        </div>
      `;

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Disciplix', email: senderEmail },
          to: [{ email: email }],
          subject: 'Réinitialisation de ton mot de passe Disciplix',
          htmlContent: htmlContent
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Brevo API Error:', errorText);
      } else {
        console.log(`[BREVO RESET] E-mail de réinitialisation envoyé à ${email}`);
      }
    } catch (e) {
      console.error('Failed to send password reset email via Brevo', e);
    }
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!resetToken || resetToken.is_used || resetToken.expires_at < new Date()) {
      throw new UnauthorizedException('Lien de réinitialisation invalide ou expiré.');
    }

    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.user_id },
        data: { password_hash: passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { is_used: true },
      }),
    ]);

    // Déconnecte toutes les sessions existantes par sécurité après un changement de mot de passe.
    await this.revokeAllRefreshTokens(resetToken.user_id);

    return { message: 'Mot de passe réinitialisé avec succès.' };
  }

  /**
   * `has_ai_profile` accompagne le profil pour que le front sache, à chaque
   * ouverture, si le questionnaire d'inscription a bien été rempli.
   *
   * Jusqu'ici cette information n'existait qu'à la connexion, et le front la
   * remplaçait de toute façon par un drapeau local posé à « true » sans rien
   * vérifier. Résultat : le questionnaire n'était jamais posé en production, et
   * le coach lisait un profil que personne n'avait rempli. Le serveur sait, lui,
   * si la table contient quelque chose — c'est à lui de le dire.
   */
  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true, ai_profile: { select: { user_id: true } } },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable.');
    const { password_hash, ai_profile, ...result } = user;
    return { ...result, has_ai_profile: !!ai_profile };
  }
}
