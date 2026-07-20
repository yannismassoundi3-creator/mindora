import { Controller, Post, Body, HttpCode, HttpStatus, Res, UseGuards, Req, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Response, Request } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Inscription d\'un nouvel utilisateur' })
  @ApiResponse({ status: 201, description: 'Utilisateur créé avec succès.' })
  @ApiResponse({ status: 409, description: 'Email ou Téléphone déjà utilisé.' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier le numéro de téléphone après inscription' })
  @ApiResponse({ status: 200, description: 'Téléphone vérifié avec succès.' })
  @ApiResponse({ status: 401, description: 'Code invalide ou expiré.' })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('login/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demander un code de connexion par SMS (Passwordless)' })
  async requestLoginOtp(@Body('phone_number') phoneNumber: string) {
    return this.authService.requestLoginOtp(phoneNumber);
  }

  @Post('login/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion via code SMS' })
  async verifyLoginOtp(@Body() verifyOtpDto: VerifyOtpDto, @Res({ passthrough: true }) response: Response) {
    const { accessToken, refreshToken, user } = await this.authService.verifyLoginOtp(verifyOtpDto);
    
    response.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { access_token: accessToken, user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion de l\'utilisateur' })
  @ApiResponse({ status: 200, description: 'Connexion réussie (retourne AccessToken et set RefreshToken en cookie).' })
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const { accessToken, refreshToken, user } = await this.authService.login(loginDto);
    
    // Sécurité: Refresh Token en HttpOnly Cookie
    response.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    });

    return {
      access_token: accessToken,
      user
    };
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
