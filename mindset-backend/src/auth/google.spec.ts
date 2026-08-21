import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as google from './google';

jest.mock('../relances/bienvenue', () => ({
  envoyerBienvenue: jest.fn().mockResolvedValue(true),
  MOTIF_BIENVENUE: 'bienvenue',
}));

/**
 * Le formulaire demandait quatre champs et un mot de passe à inventer puis à
 * retenir, entre le clic payé et la première vue du produit. C'est le même mur que
 * celui qui a fait retirer le code à six chiffres de la première connexion.
 *
 * **Ce qui se vérifie ici n'est pas que « ça connecte ».** C'est que personne ne
 * perd son compte au passage : la liaison d'un compte existant est le seul endroit
 * de ce fichier où une erreur ne se rattrape pas.
 */
describe('AuthService — connexion Google', () => {
  let service: AuthService;
  let prisma: any;

  const IDENTITE = {
    sub: 'google-123',
    email: 'yannis@example.com',
    prenom: 'Yannis',
    nom: 'M',
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({
          id: 'neuf',
          role: 'USER',
          first_name: 'Yannis',
          email: IDENTITE.email,
          relances_email: true,
          created_at: new Date(),
        }),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      aIProfile: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('jeton') } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.spyOn(google, 'verifierJetonGoogle').mockResolvedValue(IDENTITE);
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuse un jeton que Google ne valide pas', async () => {
    // `null` couvre tout : signature fausse, jeton périmé, audience d'une autre
    // application, adresse non vérifiée chez Google.
    jest.spyOn(google, 'verifierJetonGoogle').mockResolvedValue(null);

    await expect(service.connexionGoogle('n-importe-quoi')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('crée le compte quand ni l’identifiant ni l’adresse ne sont connus', async () => {
    const resultat = await service.connexionGoogle('jeton-valide');

    expect(prisma.user.create).toHaveBeenCalled();
    const cree = prisma.user.create.mock.calls[0][0].data;
    expect(cree.google_sub).toBe('google-123');
    // Google a déjà prouvé que la boîte existe et appartient à la personne : c'est
    // exactement la question à laquelle le code à six chiffres répond. Ces comptes
    // n'en verront jamais.
    expect(cree.email_verifie_le).toBeInstanceOf(Date);
    // Aucun mot de passe : en inventer un que personne ne connaît reviendrait à
    // créer une porte dont on aurait perdu la clé.
    expect(cree.password_hash).toBeUndefined();
    expect(resultat.nouveau).toBe(true);
  });

  /*
    Le test qui compte.

    Quelqu'un inscrit par e-mail il y a trois semaines appuie sur « Continuer avec
    Google » pour la première fois. S'il obtient un compte neuf, il voit un écran
    vide : série perdue, habitudes disparues, historique effacé. De son point de
    vue, l'application vient de supprimer ses données — et il ne reviendra pas.

    Ce cas n'existe pas en développement, où l'on n'a jamais d'ancien compte.
  */
  it('rattache un compte existant au lieu d’en créer un second', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'ancien',
      role: 'USER',
      first_name: 'Yannis',
      email: IDENTITE.email,
      google_sub: null,
      email_verifie_le: null,
      ai_profile: { id: 'p1' },
    });

    const resultat = await service.connexionGoogle('jeton-valide');

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ancien' },
        data: expect.objectContaining({ google_sub: 'google-123' }),
      }),
    );
    expect(resultat.nouveau).toBe(false);
    expect(resultat.has_ai_profile).toBe(true);
  });

  it('n’écrit rien de plus quand le compte est déjà rattaché', async () => {
    // Le rattachement est un geste unique. Le rejouer à chaque connexion écrirait
    // en base sur le chemin le plus chaud du produit, pour rien.
    prisma.user.findFirst.mockResolvedValue({
      id: 'ancien',
      role: 'USER',
      first_name: 'Yannis',
      email: IDENTITE.email,
      google_sub: 'google-123',
      email_verifie_le: new Date(),
      ai_profile: null,
    });

    await service.connexionGoogle('jeton-valide');

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('cherche par identifiant Google ET par adresse', async () => {
    /*
      Les deux, et pas seulement l'adresse : quelqu'un peut changer l'e-mail de son
      compte Google. Le `sub`, lui, ne bouge jamais — sans lui, ce changement
      d'adresse fabriquerait un second compte à la connexion suivante.
    */
    await service.connexionGoogle('jeton-valide');

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ google_sub: 'google-123' }, { email: 'yannis@example.com' }] },
      }),
    );
  });
});
