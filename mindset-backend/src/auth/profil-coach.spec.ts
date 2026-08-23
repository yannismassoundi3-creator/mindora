import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES_AUTOMATIQUES_INSCRIPTION } from '../common/message-inscription';

jest.mock('argon2', () => ({ verify: jest.fn(), hash: jest.fn() }));

/**
 * « Cette personne a-t-elle déjà écrit à son coach ? »
 *
 * Le front en a besoin à chaque ouverture, sans réseau, pour décider s'il pose la
 * bannière « on ne s'est jamais parlé ». Il ne peut pas le savoir seul : un drapeau
 * posé par le navigateur au premier message ne dirait rien des comptes créés avant
 * lui, et ceux-là s'entendraient tous dire qu'on ne s'est jamais parlé après trois
 * semaines de conversation.
 *
 * Ce qui se vérifie ici est donc que **le serveur répond**, et qu'il répond sur les
 * bons messages : le plan que le questionnaire réclamait au nom des gens n'est pas
 * une conversation, et l'avoir compté ferait taire la bannière chez exactement ceux
 * qu'elle vise.
 */
describe('AuthService — a-t-on déjà parlé au coach', () => {
  let service: AuthService;
  let prisma: any;

  const utilisateur = {
    id: 'u1',
    email: 'a@b.c',
    password_hash: 'secret',
    created_at: new Date(),
    subscription: null,
    ai_profile: { user_id: 'u1' },
  };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn(), verifyAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  it('dit oui quand un message a été écrit', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...utilisateur, _count: { chat_messages: 3 } });

    const profil: any = await service.getUserProfile('u1');

    expect(profil.a_deja_parle_au_coach).toBe(true);
    // Le mot de passe ne sort jamais, et `_count` non plus : c'est un détail de
    // requête, pas une information de profil.
    expect(profil.password_hash).toBeUndefined();
    expect(profil._count).toBeUndefined();
  });

  it('dit non quand le compte n’a jamais écrit', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...utilisateur, _count: { chat_messages: 0 } });

    const profil: any = await service.getUserProfile('u1');

    expect(profil.a_deja_parle_au_coach).toBe(false);
  });

  it('compte sur les messages écrits, jamais sur le plan réclamé à l’inscription', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...utilisateur, _count: { chat_messages: 0 } });

    await service.getUserProfile('u1');

    /*
      Le filtre est vérifié sur la requête elle-même et non sur son résultat.

      C'est le seul endroit où l'erreur peut se cacher : un décompte non filtré rend
      un nombre parfaitement plausible — tout compte ayant fini le questionnaire
      aurait « déjà parlé » — et la bannière se tairait précisément chez les 43
      personnes qu'elle est faite pour aller chercher. Rien à l'écran ne le dirait.
    */
    const requete = prisma.user.findUnique.mock.calls[0][0];
    const filtre = requete.include._count.select.chat_messages.where;
    expect(filtre.sender).toBe('user');
    expect(filtre.text.notIn).toEqual(
      expect.arrayContaining([...MESSAGES_AUTOMATIQUES_INSCRIPTION]),
    );
  });
});
