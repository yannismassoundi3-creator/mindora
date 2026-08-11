import { Controller, Post, Body, HttpCode, HttpStatus, Res, UseGuards, Req, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Response, Request } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Sécurité: Refresh Token en HttpOnly Cookie, jamais dans le corps de la réponse.
  private setRefreshTokenCookie(response: Response, refreshToken: string) {
    response.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    });
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @ApiOperation({ summary: 'Inscription d\'un nouvel utilisateur' })
  @ApiResponse({ status: 201, description: 'Utilisateur créé avec succès.' })
  @ApiResponse({ status: 409, description: 'Email ou Téléphone déjà utilisé.' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @Post('claim-admin')
  @ApiOperation({ summary: 'Devenir Admin avec la clé secrète' })
  async claimAdmin(@Req() req: Request, @Body('secretKey') secretKey: string) {
    return this.authService.claimAdmin((req.user as any).userId, secretKey);
  }


  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion de l\'utilisateur (Etape 1: 2FA)' })
  @ApiResponse({ status: 200, description: 'Retourne requires2FA: true si les identifiants sont valides.' })
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    // Étape 1 : Vérifie le mot de passe et envoie le code 2FA par e-mail
    const result = await this.authService.login(loginDto);

    // Quand le 2FA est bypassé (dev sans Brevo), la connexion est déjà terminée :
    // on renvoie exactement la même forme que verify-2fa, sinon le front ne reconnaît
    // pas la réponse et reste bloqué sans message d'erreur.
    if ('accessToken' in result) {
      const { accessToken, refreshToken, ...rest } = result;
      this.setRefreshTokenCookie(response, refreshToken);
      return { access_token: accessToken, ...rest };
    }

    return result;
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier le code 2FA par e-mail (Etape 2)' })
  @ApiResponse({ status: 200, description: 'Connexion réussie (retourne AccessToken et set RefreshToken en cookie).' })
  async verify2FA(@Body() body: { email: string; code: string }, @Res({ passthrough: true }) response: Response) {
    const { accessToken, refreshToken, user, has_ai_profile } = await this.authService.verify2FA(body.email, body.code);

    this.setRefreshTokenCookie(response, refreshToken);

    return {
      access_token: accessToken,
      user,
      has_ai_profile
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demander un lien de réinitialisation de mot de passe' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réinitialiser le mot de passe avec un token reçu par e-mail' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Déconnexion' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) response: Response) {
    const userId = (req.user as any).userId;
    const refreshToken = req.cookies['refresh_token'];
    
    if (refreshToken) {
      await this.authService.revokeRefreshToken(userId, refreshToken);
    }
    
    response.clearCookie('refresh_token');
    return { message: 'Déconnexion réussie.' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtenir le profil de l\'utilisateur connecté (incluant son rôle/abonnement)' })
  async getProfile(@Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.authService.getUserProfile(userId);
  }
}
