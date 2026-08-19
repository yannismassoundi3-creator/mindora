import { Controller, Post, Body, HttpCode, HttpStatus, Res, UseGuards, Req, Get, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SuppressionCompteService } from './suppression-compte.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { Response, Request } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly suppression: SuppressionCompteService) {}

  /**
   * Options du cookie de rafraîchissement.
   *
   * `sameSite: 'strict'` était intenable ici : le front est servi par Vercel et l'API
   * par Render, donc deux sites différents du point de vue du navigateur. Un cookie
   * strict n'est jamais renvoyé dans ce cas — il était posé à la connexion puis
   * ignoré à chaque requête suivante. Le rafraîchissement de session ne pouvait pas
   * fonctionner, quoi qu'on écrive à côté.
   *
   * `none` impose `secure`, ce qui est acquis en production (NODE_ENV=production sur
   * Render). En développement on reste sur `lax` : localhost est en clair, et un
   * cookie `none` non sécurisé est rejeté par le navigateur.
   */
  private static optionsCookie() {
    const production = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      secure: production,
      sameSite: production ? ('none' as const) : ('lax' as const),
      path: '/',
    };
  }

  /**
   * Le cookie reste posé — mais il ne peut plus être le seul chemin.
   *
   * Le front est servi par Vercel, l'API par Render : pour un navigateur, ce cookie
   * est un **cookie tiers**. Safari les bloque tous par défaut depuis des années, et
   * tous les navigateurs d'iPhone reposent sur WebKit. Sur un iPhone, ce cookie
   * n'était donc ni conservé ni renvoyé, quelles que soient ses options : le
   * rafraîchissement échouait, le jeton d'accès expirait au bout de quinze minutes,
   * et la personne était renvoyée à l'écran de connexion à chaque ouverture de
   * l'application. Signalé depuis un vrai téléphone, invisible sur un poste de
   * développement où le cookie est de première partie.
   *
   * Le jeton est donc aussi renvoyé dans le corps de la réponse, à charge pour le
   * client de le conserver et de le présenter quand le cookie manque. C'est un
   * compromis assumé : un jeton lisible par le script est exposé à une injection de
   * code, là où `httpOnly` l'en protégeait. Deux choses le bornent, et existaient
   * déjà : il est remplacé à chaque usage, et rejouer un jeton déjà consommé révoque
   * toutes les sessions du compte.
   *
   * La solution sans compromis est en place depuis : le front joint l'API sous son
   * propre domaine, par une réécriture Vercel, et le cookie redevient de première
   * partie. Le chemin par le corps subsiste tant que deux choses ne sont pas
   * acquises — qu'une vraie session d'iPhone tienne au-delà de quinze minutes, et
   * que plus personne ne fasse tourner l'ancien script, qui appelle encore Render en
   * direct. Le jour où c'est vérifié, ce retour du jeton dans le corps est à
   * retirer : il n'aura plus de raison d'être.
   */
  private setRefreshTokenCookie(response: Response, refreshToken: string) {
    response.cookie('refresh_token', refreshToken, {
      ...AuthController.optionsCookie(),
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
      return { access_token: accessToken, refresh_token: refreshToken, ...rest };
    }

    return result;
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier le code 2FA par e-mail (Etape 2)' })
  @ApiResponse({ status: 200, description: 'Connexion réussie (retourne AccessToken et set RefreshToken en cookie).' })
  async verify2FA(@Body() body: Verify2faDto, @Res({ passthrough: true }) response: Response) {
    const { accessToken, refreshToken, user, has_ai_profile } = await this.authService.verify2FA(body.email, body.code);

    this.setRefreshTokenCookie(response, refreshToken);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
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

  /**
   * Rend un nouveau jeton d'accès à partir du cookie de session.
   *
   * Cette route manquait purement et simplement. Le jeton d'accès expire au bout de
   * quinze minutes et le front, sur un 401, efface le jeton et renvoie à l'écran de
   * connexion : tout le monde était donc éjecté quatre fois par heure, et devait
   * ressaisir un code à six chiffres reçu par e-mail. Le jeton de rafraîchissement
   * existait pourtant déjà — créé, stocké en base, posé en cookie — mais rien ne
   * permettait de l'échanger.
   *
   * Pas de JwtAuthGuard ici : on arrive précisément parce que le jeton d'accès est
   * périmé. Le cookie fait foi.
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Prolonger la session à partir du cookie de rafraîchissement' })
  @ApiResponse({ status: 401, description: 'Session expirée ou révoquée : il faut se reconnecter.' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { refresh_token?: string },
  ) {
    // Le cookie d'abord quand il arrive, le corps sinon. Voir la note de
    // setRefreshTokenCookie : sur iPhone, le cookie n'arrive jamais.
    const ancien = req.cookies?.['refresh_token'] || body?.refresh_token;
    const { accessToken, refreshToken, user } = await this.authService.refreshSession(ancien);

    this.setRefreshTokenCookie(response, refreshToken);
    return { access_token: accessToken, refresh_token: refreshToken, user };
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
    
    // Les mêmes options qu'à la pose : un cookie posé en SameSite=None ne s'efface
    // pas avec un clearCookie aux options par défaut, il survivrait à la déconnexion.
    response.clearCookie('refresh_token', AuthController.optionsCookie());
    return { message: 'Déconnexion réussie.' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtenir le profil de l\'utilisateur connecté (incluant son rôle/abonnement)' })
  async getProfile(@Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.authService.getUserProfile(userId);
  }

  /**
   * Supprimer son compte.
   *
   * Il n'existait aucun moyen de le faire depuis l'application : la page vie
   * privée renvoyait vers une adresse e-mail. C'est un droit du RGPD, et un motif
   * de rejet quasi automatique sur l'App Store depuis 2022.
   *
   * Le mot de passe est exigé — pas par formalisme : c'est la seule action du
   * produit qu'aucune sauvegarde ne rattrape, et une session laissée ouverte sur
   * un téléphone posé sur une table suffirait sinon.
   *
   * La cadence est serrée pour la même raison que la connexion : le champ accepte
   * un mot de passe, donc il se devine.
   */
  @Delete('compte')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Supprimer définitivement son compte et ses données' })
  async supprimerCompte(@Req() req: Request, @Body('motDePasse') motDePasse: string) {
    const userId = (req.user as any).userId;
    return this.suppression.supprimer(userId, motDePasse);
  }
}
