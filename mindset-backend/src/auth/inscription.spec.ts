import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('argon2', () => ({ verify: jest.fn().mockResolvedValue(true), hash: jest.fn().mockResolvedValue('h') }));

/**
 * L'inscription, et le message qui part avec elle.
 *
 * Depuis le 16 août 2026 la toute première connexion se passe du code à six
 * chiffres : c'était le mur qui perdait un quart des inscrits. La contrepartie est
 * qu'aucun e-mail ne partait plus au moment de l'inscription — donc plus rien ne
 * disait que l'adresse fonctionne, et personne ne recevait rien avant la première
 * relance, deux jours plus tard.
 *
 * Ce qui se vérifie ici est surtout une hiérarchie : le compte prime sur l'e-mail.
 * Une inscription qui échoue parce que Brevo a hoqueté coûterait exactement ce que
 * le message cherche à gagner — et la personne réessaierait sur une adresse déjà
 * prise, donc sur un 409.
 */
describe('Inscription', () => {
  let service: AuthService;
  let prisma: any;

  const dto = {
    first_name: 'Laura',
    last_name: 'M',
    email: 'laura@example.com',
    password: 'motdepasse123',
  } as any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'u1', email: data.email, first_name: data.first_name, relances_email: true }),
        ),
      },
      relanceEmail: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    process.env.BREVO_API_KEY = 'cle-de-test';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' }) as any;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    delete process.env.BREVO_API_KEY;
    jest.restoreAllMocks();
  });

  it('accueille la personne dès la création du compte', async () => {
    const resultat = await service.register(dto);

    expect(resultat.user_id).toBe('u1');
    const corps = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(corps.to).toEqual([{ email: 'laura@example.com' }]);
    expect(corps.subject).toBe('Ton compte est prêt');
    expect(prisma.relanceEmail.create).toHaveBeenCalledWith({
      data: { user_id: 'u1', motif: 'bienvenue' },
    });
  });

  it('rend quand même le compte quand l’e-mail ne part pas', async () => {
    // Le compte est déjà en base à cet instant. Rendre une 500 laisserait la
    // personne devant un formulaire qui ne repassera jamais : son adresse est
    // désormais prise, et la seconde tentative rendra un 409.
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, text: async () => 'quota dépassé' });

    await expect(service.register(dto)).resolves.toMatchObject({ user_id: 'u1' });
    expect(prisma.relanceEmail.create).not.toHaveBeenCalled();
  });

  it('rend quand même le compte quand l’envoi lève', async () => {
    // Un serveur injoignable ne rend pas une réponse : il jette. C'est le cas que
    // le `try` de la création du compte transformerait en 500 s'il l'englobait.
    (global.fetch as jest.Mock).mockRejectedValue(new Error('réseau coupé'));

    await expect(service.register(dto)).resolves.toMatchObject({ user_id: 'u1' });
  });

  it('n’écrit à personne quand la création du compte échoue', async () => {
    prisma.user.create.mockRejectedValue(new Error('contrainte violée'));

    await expect(service.register(dto)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
