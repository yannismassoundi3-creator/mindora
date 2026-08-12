import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Le jeton d'accès dure quinze minutes et le front, sur un 401, renvoyait à l'écran
 * de connexion : tout le monde était éjecté quatre fois par heure et devait ressaisir
 * un code reçu par e-mail. Le jeton de rafraîchissement existait pourtant — créé,
 * stocké, posé en cookie — mais aucune route ne permettait de l'échanger.
 *
 * Ce qui se vérifie ici n'est pas que « ça remarche » : c'est que prolonger une
 * session ne l'affaiblit pas. Le jeton tourne à chaque usage, et un jeton rejoué
 * coupe toutes les sessions du compte au lieu de la seule requête en cours.
 */
describe('AuthService — prolongation de session', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;

  const DEMAIN = new Date(Date.now() + 86400000);
  const HIER = new Date(Date.now() - 86400000);

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn() },
    };
    jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', role: 'USER' }),
      signAsync: jest.fn().mockResolvedValue('jeton-neuf'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  const compteValide = () =>
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'USER',
      first_name: 'Yannis',
      deleted_at: null,
    });

  it('rend une nouvelle paire et révoque celle qui vient de servir', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      user_id: 'u1',
      is_revoked: false,
      expires_at: DEMAIN,
    });
    compteValide();

    const resultat = await service.refreshSession('jeton-valide');

    expect(resultat.accessToken).toBe('jeton-neuf');
    // Rotation : le jeton présenté ne doit plus valoir après usage, sinon un vol
    // reste exploitable pendant sept jours.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ token: 'jeton-valide' }) }),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalled();
  });

  it('coupe toutes les sessions quand un jeton déjà révoqué est rejoué', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      user_id: 'u1',
      is_revoked: true,
      expires_at: DEMAIN,
    });

    await expect(service.refreshSession('jeton-rejoue')).rejects.toThrow(UnauthorizedException);

    // Un jeton révoqué qui revient, c'est deux porteurs pour un même jeton : on ne
    // sait pas lequel est le voleur, donc on déconnecte tout le monde.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { user_id: 'u1', is_revoked: false },
      data: { is_revoked: true },
    });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('refuse un jeton expiré en base même si sa signature tient encore', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      user_id: 'u1',
      is_revoked: false,
      expires_at: HIER,
    });

    await expect(service.refreshSession('jeton-perime')).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('refuse un jeton inconnu de la base', async () => {
    // Signature valable mais aucune ligne : jeton d'une base réinitialisée, ou forgé
    // avec un secret fuité. Vérifier la signature ne suffit pas.
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.refreshSession('jeton-fantome')).rejects.toThrow(UnauthorizedException);
  });

  it('refuse une signature invalide sans même consulter la base', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(service.refreshSession('jeton-bricole')).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('refuse quand aucun cookie n’accompagne la requête', async () => {
    await expect(service.refreshSession(undefined)).rejects.toThrow(UnauthorizedException);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('ferme la porte à un compte supprimé', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      user_id: 'u1',
      is_revoked: false,
      expires_at: DEMAIN,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'USER',
      first_name: 'Yannis',
      deleted_at: new Date(),
    });

    // Sans ce contrôle, une suppression de compte ne mettrait fin à rien avant
    // l'expiration naturelle des jetons, soit sept jours plus tard.
    await expect(service.refreshSession('jeton-valide')).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});
