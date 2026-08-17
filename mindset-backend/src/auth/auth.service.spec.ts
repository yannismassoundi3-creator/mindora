import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('argon2', () => ({ verify: jest.fn().mockResolvedValue(true), hash: jest.fn() }));

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
        // Par défaut, un compte qui a déjà ouvert une session : c'est le cas où le
        // second facteur s'applique. Les tests de la première connexion le
        // ramènent à zéro explicitement.
        count: jest.fn().mockResolvedValue(1),
      },
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      twoFactorCode: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      aIProfile: { count: jest.fn().mockResolvedValue(0) },
    };
    // send2FAEmail part chez Brevo : on ne veut pas d'appel réseau depuis un test.
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' }) as any;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
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

  describe('code de vérification', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'yannis@example.com',
        password_hash: 'peu-importe',
        role: 'USER',
        first_name: 'Yannis',
        // Un compte qui vient d'être créé : c'est l'état où la dispense de code
        // peut s'appliquer. Les tests qui la refusent vieillissent ce compte.
        created_at: new Date(),
        ai_profile: null,
      });
    });

    it('ne tire jamais le code avec le générateur non cryptographique', async () => {
      // Math.random s'appuie sur xorshift128+ : quelques valeurs du même processus
      // suffisent à reconstituer son état et à prédire les suivantes. Chacun peut s'en
      // procurer en se connectant sur son propre compte. Ce test est là pour que
      // personne ne le réintroduise par commodité.
      const dé = jest.spyOn(Math, 'random');

      await service.login({ email: 'yannis@example.com', password: 'x' } as any);

      expect(dé).not.toHaveBeenCalled();
      const code = prisma.twoFactorCode.create.mock.calls[0][0].data.code;
      expect(code).toMatch(/^\d{6}$/);
    });

    it('périme les codes précédents avant d’en émettre un nouveau', async () => {
      await service.login({ email: 'yannis@example.com', password: 'x' } as any);

      // Sans ça, cinq tentatives de connexion laissaient cinq codes valables en même
      // temps : verify2FA accepte n'importe quel code non utilisé et non expiré.
      expect(prisma.twoFactorCode.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', is_used: false },
        data: { is_used: true },
      });
      expect(prisma.twoFactorCode.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.twoFactorCode.create.mock.invocationCallOrder[0],
      );
    });

    it('ne demande pas de code à la toute première connexion', async () => {
      // Le mur se dressait entre le clic sur la publicité et la première vue du
      // produit : neuf comptes sur trente-quatre n'ont jamais atteint le tableau de
      // bord. À cet instant, la personne vient de choisir son mot de passe et son
      // compte est vide — le second facteur n'y protège rien.
      prisma.refreshToken.count.mockResolvedValue(0);

      const resultat: any = await service.login({ email: 'yannis@example.com', password: 'x' } as any);

      expect(resultat.requires2FA).toBeUndefined();
      expect(resultat.accessToken).toBe('jeton-neuf');
      expect(prisma.twoFactorCode.create).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('redemande le code dès qu’une session a déjà existé', async () => {
      // La contrepartie du test précédent, et la raison pour laquelle il est sans
      // danger : sur un compte réellement utilisé, deviner le mot de passe ne suffit
      // toujours pas.
      prisma.refreshToken.count.mockResolvedValue(1);

      const resultat: any = await service.login({ email: 'yannis@example.com', password: 'x' } as any);

      expect(resultat.requires2FA).toBe(true);
      expect(prisma.twoFactorCode.create).toHaveBeenCalled();
    });

    it('redemande le code à un compte inscrit puis jamais ouvert', async () => {
      /*
        Le trou de la première version, signalé par Yannis : « jamais ouvert de
        session » sans borne de temps, c'est une dispense qui ne périme jamais. Une
        liste de mots de passe fuités ailleurs, réessayée ici des mois plus tard,
        entrait sans code sur tous les comptes restés inertes.
      */
      prisma.refreshToken.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'yannis@example.com',
        role: 'USER',
        first_name: 'Yannis',
        created_at: new Date(Date.now() - 3 * 86400000),
        ai_profile: null,
      });

      const resultat: any = await service.login({ email: 'yannis@example.com', password: 'x' } as any);

      expect(resultat.requires2FA).toBe(true);
      expect(prisma.twoFactorCode.create).toHaveBeenCalled();
    });

    it('n’accorde jamais la dispense à un administrateur', async () => {
      // Un compte qui lit les chiffres de tout le monde et déclenche des envois de
      // masse n'a pas à profiter d'un raccourci pensé pour un inscrit de la veille.
      prisma.refreshToken.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'yannis@example.com',
        role: 'ADMIN',
        first_name: 'Yannis',
        created_at: new Date(),
        ai_profile: null,
      });

      const resultat: any = await service.login({ email: 'yannis@example.com', password: 'x' } as any);

      expect(resultat.requires2FA).toBe(true);
    });

    it('retient que l’adresse est vérifiée quand un code est validé', async () => {
      // C'est la seule preuve que la boîte existe. Sans cette trace, l'entonnoir ne
      // distingue plus « bloqué par le code » de « a quitté le questionnaire », et
      // les relances partent vers des adresses jamais confirmées.
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'yannis@example.com',
        role: 'USER',
        first_name: 'Yannis',
        email_verifie_le: null,
      });
      prisma.twoFactorCode.findFirst.mockResolvedValue({ id: 'c1' });

      await service.verify2FA('yannis@example.com', '123456');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { email_verifie_le: expect.any(Date) },
      });
    });

    it('répond la même chose pour une adresse inconnue et un mauvais code', async () => {
      // Deux messages distincts feraient de cette route un annuaire de comptes.
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const surAdresseInconnue = await service.verify2FA('inconnu@example.com', '123456').catch((e) => e.message);

      prisma.twoFactorCode.findFirst.mockResolvedValue(null);
      const surMauvaisCode = await service.verify2FA('yannis@example.com', '000000').catch((e) => e.message);

      expect(surAdresseInconnue).toBe(surMauvaisCode);
    });
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

  /**
   * Le lien de réinitialisation est le seul de l'application qu'on ne peut pas
   * contourner : quelqu'un qui a perdu son mot de passe n'a aucun autre chemin de
   * retour. Il était construit sur `FRONTEND_URL`, variable qui a pointé en
   * production sur un domaine inexistant — l'e-mail partait, le bouton menait sur
   * « Not Found », et le compte devenait irrécupérable sans que rien ne le signale.
   */
  describe('lien de réinitialisation', () => {
    const envInitial = { ...process.env };
    afterEach(() => {
      process.env = { ...envInitial };
    });

    const lienEnvoye = () => {
      const corps = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      return corps.htmlContent.match(/href="([^"]+)"/)[1];
    };

    it("ouvre l'application même quand FRONTEND_URL est fausse", async () => {
      process.env.NODE_ENV = 'production';
      process.env.FRONTEND_URL = 'https://mindset-dashboard.onrender.com';

      await service.sendPasswordResetEmail('y@example.com', 'jeton-brut');

      expect(lienEnvoye()).toBe('https://disciplix-ai.vercel.app/?reset_token=jeton-brut');
    });

    it('ne double pas la barre quand la variable en porte une', async () => {
      process.env.FRONTEND_URL = 'https://disciplix-ai.vercel.app/';

      await service.sendPasswordResetEmail('y@example.com', 'jeton-brut');

      expect(lienEnvoye()).toBe('https://disciplix-ai.vercel.app/?reset_token=jeton-brut');
    });
  });
});

/**
 * La provenance d'une inscription.
 *
 * Elle vient du navigateur, donc d'une chaîne libre écrite par n'importe qui, et
 * elle finit affichée dans le panneau d'administration. Deux exigences : qu'elle
 * se compte (une seule étiquette pour une seule origine) et qu'elle ne puisse
 * jamais faire échouer la création du compte.
 */
describe('AuthService.provenanceNettoyee', () => {
  it('ramène les variantes d’écriture à une seule étiquette', () => {
    // Sans cela, la même story se compte sous trois lignes différentes et aucune
    // n'a l'air d'avoir marché.
    expect(AuthService.provenanceNettoyee('Story 16/08 !!')).toBe('story-16-08');
    expect(AuthService.provenanceNettoyee('  DM  ')).toBe('dm');
    expect(AuthService.provenanceNettoyee('dm')).toBe('dm');
  });

  it('borne la longueur sans laisser de tiret en fin', () => {
    const propre = AuthService.provenanceNettoyee('a'.repeat(50));
    expect(propre).toHaveLength(32);

    // La coupe peut tomber sur un séparateur : « commentaire-… » tronqué à 32 ne
    // doit pas produire une étiquette qui finit par un tiret.
    expect(AuthService.provenanceNettoyee('c'.repeat(32) + ' suite')).toBe('c'.repeat(32));
  });

  it('rend null plutôt que de faire échouer une inscription', () => {
    // Le but est de compter les gens, pas de les refuser : tout ce qui n'est pas
    // exploitable devient une absence de provenance, en silence.
    expect(AuthService.provenanceNettoyee(undefined)).toBeNull();
    expect(AuthService.provenanceNettoyee(null)).toBeNull();
    expect(AuthService.provenanceNettoyee('')).toBeNull();
    expect(AuthService.provenanceNettoyee('!!!')).toBeNull();
    expect(AuthService.provenanceNettoyee(42 as any)).toBeNull();
  });
});
