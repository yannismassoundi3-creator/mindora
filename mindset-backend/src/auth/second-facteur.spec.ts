import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AuthService } from './auth.service';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('argon2', () => ({ verify: jest.fn().mockResolvedValue(true), hash: jest.fn() }));

/**
 * Le second facteur, et la façon dont on pouvait s'en passer.
 *
 * `POST /auth/verify-2fa` recevait son corps sans DTO — une annotation TypeScript,
 * effacée à la compilation, donc invisible au `ValidationPipe`. Les deux valeurs
 * arrivaient telles quelles dans un `where` Prisma, où un objet ne se lit pas comme
 * une valeur mais comme un **filtre** : `{"code":{"not":"x"}}` demande « le code en
 * cours, quel qu'il soit », et la route rendait une session complète.
 *
 * Ce que cela coûtait exactement : pendant les dix minutes de validité d'un code —
 * c'est-à-dire chaque fois que quelqu'un se connecte — une adresse e-mail suffisait
 * à prendre son compte. Sans son mot de passe, sans sa boîte mail.
 *
 * Les tests ci-dessous tiennent les deux verrous : celui du DTO, qui refuse la
 * requête avant le contrôleur, et celui du service, qui ne dépend d'aucune
 * décoration.
 */
describe('Second facteur — ce qui doit rester impossible', () => {
  describe('Verify2faDto', () => {
    const erreurs = (corps: unknown) =>
      validateSync(plainToInstance(Verify2faDto, corps as object), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('refuse un code qui est un filtre Prisma déguisé', () => {
      // La charge exacte de l'attaque : « n'importe quel code sauf celui-ci ».
      expect(erreurs({ email: 'a@b.fr', code: { not: 'jamais' } })).not.toHaveLength(0);
    });

    it.each([
      ['un tableau', ['123456']],
      ['un nombre', 123456],
      ['un objet vide', {}],
      ['null', null],
    ])('refuse un code passé comme %s', (_nom, code) => {
      expect(erreurs({ email: 'a@b.fr', code })).not.toHaveLength(0);
    });

    it('refuse ce qui n’est pas six chiffres', () => {
      expect(erreurs({ email: 'a@b.fr', code: '12345' })).not.toHaveLength(0);
      expect(erreurs({ email: 'a@b.fr', code: '1234567' })).not.toHaveLength(0);
      expect(erreurs({ email: 'a@b.fr', code: 'abcdef' })).not.toHaveLength(0);
    });

    it('refuse une adresse qui n’en est pas une', () => {
      expect(erreurs({ email: { contains: '@' }, code: '123456' })).not.toHaveLength(0);
    });

    it('accepte le cas normal', () => {
      expect(erreurs({ email: 'a@b.fr', code: '123456' })).toHaveLength(0);
    });
  });

  describe('AuthService.verify2FA', () => {
    let service: AuthService;
    let prisma: any;

    beforeEach(async () => {
      prisma = {
        user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
        twoFactorCode: {
          findFirst: jest.fn().mockResolvedValue({ id: 'c1' }),
          update: jest.fn().mockResolvedValue({}),
        },
        aIProfile: { count: jest.fn().mockResolvedValue(0) },
        refreshToken: { create: jest.fn().mockResolvedValue({}) },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: JwtService,
            useValue: { signAsync: jest.fn().mockResolvedValue('jeton') },
          },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
        ],
      }).compile();

      service = module.get<AuthService>(AuthService);
    });

    it('refuse un code non textuel sans même interroger la base', async () => {
      await expect(service.verify2FA('a@b.fr', { not: 'jamais' } as any)).rejects.toThrow(
        UnauthorizedException,
      );
      // Le point entier : la valeur ne doit jamais atteindre le `where`. Un test
      // qui se contenterait du 401 passerait même si l'objet y arrivait.
      expect(prisma.twoFactorCode.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('refuse une adresse non textuelle de la même façon', async () => {
      await expect(service.verify2FA({ contains: '@' } as any, '123456')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('laisse passer un vrai code, et le cherche comme une valeur', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'USER',
        first_name: 'Yannis',
        email_verifie_le: null,
      });

      const resultat = await service.verify2FA('a@b.fr', '123456');

      expect(resultat.accessToken).toBe('jeton');
      expect(prisma.twoFactorCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ code: '123456' }) }),
      );
    });
  });
});
