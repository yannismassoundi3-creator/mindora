import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * La session ne doit plus dépendre d'un cookie tiers.
 *
 * Le front est servi par Vercel, l'API par Render : le cookie de rafraîchissement
 * est donc un cookie tiers, et Safari les bloque tous par défaut. Sur iPhone — où
 * tous les navigateurs reposent sur WebKit — il n'arrivait jamais : le jeton d'accès
 * expirait au bout de quinze minutes et il fallait se reconnecter à chaque ouverture
 * de l'application. Signalé depuis un vrai téléphone, invisible sur un poste de
 * développement où le cookie est de première partie.
 *
 * Ces tests sont le seul filet possible ici : on ne peut pas simuler le blocage des
 * cookies de Safari depuis une suite Jest, mais on peut vérifier qu'une requête sans
 * cookie aboutit quand même, et qu'une requête avec cookie ne change pas de
 * comportement.
 */
describe('AuthController — rafraîchissement de session', () => {
  let controller: AuthController;
  let authService: any;
  let reponse: any;

  const SESSION = {
    accessToken: 'acces-neuf',
    refreshToken: 'refresh-neuf',
    user: { id: 'u1', first_name: 'Yannis' },
  };

  beforeEach(async () => {
    authService = {
      refreshSession: jest.fn().mockResolvedValue(SESSION),
      verify2FA: jest.fn().mockResolvedValue({ ...SESSION, has_ai_profile: true }),
    };
    reponse = { cookie: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(require('./guards/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
  });

  it('accepte le jeton présenté dans le corps quand aucun cookie n\'arrive', async () => {
    const req: any = { cookies: {} };

    await controller.refresh(req, reponse, { refresh_token: 'refresh-du-navigateur' });

    expect(authService.refreshSession).toHaveBeenCalledWith('refresh-du-navigateur');
  });

  // Là où le cookie fonctionne, il reste le chemin normal : il n'est pas lisible par
  // un script, donc on ne s'en prive pas.
  it('préfère le cookie quand il est là', async () => {
    const req: any = { cookies: { refresh_token: 'refresh-du-cookie' } };

    await controller.refresh(req, reponse, { refresh_token: 'refresh-du-navigateur' });

    expect(authService.refreshSession).toHaveBeenCalledWith('refresh-du-cookie');
  });

  it('ne casse pas quand la requête n\'a ni cookie ni corps', async () => {
    const req: any = {};

    await controller.refresh(req, reponse, undefined as any);

    expect(authService.refreshSession).toHaveBeenCalledWith(undefined);
  });

  /**
   * Le serveur remplace le jeton à chaque usage. Sans le renvoyer, un client qui n'a
   * pas de cookie garderait éternellement le premier — c'est-à-dire un jeton déjà
   * consommé, que le serveur traite comme un vol et qui révoque toutes les sessions.
   */
  it('renvoie le nouveau jeton, pas seulement le cookie', async () => {
    const res = await controller.refresh({ cookies: {} } as any, reponse, {
      refresh_token: 'ancien',
    });

    expect(res).toMatchObject({ access_token: 'acces-neuf', refresh_token: 'refresh-neuf' });
    expect(reponse.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-neuf', expect.anything());
  });

  it('la validation du code 2FA rend elle aussi le jeton de rafraîchissement', async () => {
    const res = await controller.verify2FA({ email: 'a@b.c', code: '123456' }, reponse);

    expect(res).toMatchObject({ access_token: 'acces-neuf', refresh_token: 'refresh-neuf' });
  });
});
