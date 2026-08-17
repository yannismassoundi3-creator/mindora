import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { CadenceGlobaleGuard, ipClient } from './cadence-globale.guard';

/**
 * Ce que compte le garde-fou, et pourquoi ce n'était pas ce qu'on croyait.
 *
 * Mesuré en production le 17 août 2026 : dix appels lancés depuis un poste, puis
 * trois passés par la réécriture Vercel, se sont suivis dans **le même compteur**
 * (`x-ratelimit-remaining` descendant de 96 à 93 sans repartir de 99). Deux réseaux
 * sans le moindre rapport partageaient donc le quota — parce que `req.ip` ne
 * désigne pas l'appelant mais l'intermédiaire, toujours le même.
 *
 * Conséquence : cent requêtes par minute suffisaient à fermer l'application à tout
 * le monde, et cinq à fermer la page de connexion. Ce fichier tient la clé de
 * comptage, qui est la seule chose qui empêche cela.
 */
describe('CadenceGlobaleGuard — la clé de comptage', () => {
  const SECRET = 'secret-de-test';
  let jwt: any;

  const garde = () => new CadenceGlobaleGuard([] as any, {} as any, {} as any, jwt);
  const cle = (req: any) => (garde() as any).getTracker(req);

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    jwt = {
      verify: jest.fn((jeton: string) => {
        if (jeton !== 'bon-jeton') throw new Error('signature invalide');
        return { sub: 'u1', role: 'USER' };
      }),
    };
  });

  it('compte par compte quand le jeton est valable', async () => {
    expect(await cle({ headers: { authorization: 'Bearer bon-jeton' }, ip: '1.1.1.1' })).toBe(
      'compte:u1',
    );
  });

  it('vérifie la signature : un jeton inventé ne donne pas un compteur neuf', async () => {
    // Sans ce contrôle, écrire n'importe quoi dans l'en-tête `Authorization`
    // suffirait à repartir de zéro à chaque requête — donc à supprimer le plafond
    // du formulaire de connexion, qui est précisément celui qu'il faut garder.
    const a = await cle({ headers: { authorization: 'Bearer inventé' }, ip: '1.1.1.1' });
    const b = await cle({ headers: { authorization: 'Bearer inventé-aussi' }, ip: '1.1.1.1' });

    expect(a).toBe(b);
    expect(a).toMatch(/^ip:/);
  });

  it('accepte un jeton périmé mais bien signé', async () => {
    // Son porteur est légitime et s'apprête à appeler /auth/refresh : le renvoyer
    // dans le compteur commun à cet instant précis serait le pire moment.
    await cle({ headers: { authorization: 'Bearer bon-jeton' }, ip: '1.1.1.1' });
    expect(jwt.verify).toHaveBeenCalledWith(
      'bon-jeton',
      expect.objectContaining({ ignoreExpiration: true }),
    );
  });

  it('sépare deux appelants anonymes venus d’adresses différentes', async () => {
    const a = await cle({ headers: { 'cf-connecting-ip': '9.9.9.9' } });
    const b = await cle({ headers: { 'cf-connecting-ip': '8.8.8.8' } });
    expect(a).not.toBe(b);
  });

  it('n’écrit pas l’adresse en clair dans la clé', async () => {
    // Cette clé vit dans l'état du compteur ; une adresse IP est une donnée
    // personnelle, et le décompte n'a besoin que de distinguer deux appelants.
    const k = await cle({ headers: { 'cf-connecting-ip': '9.9.9.9' } });
    expect(k).not.toContain('9.9.9.9');
  });
});

/**
 * Le garde se construit-il vraiment ?
 *
 * Il ne se contente pas d'hériter : il déclare un constructeur, et doit donc
 * réclamer lui-même les deux dépendances que `ThrottlerGuard` recevait
 * automatiquement, par des jetons d'injection (`getOptionsToken`,
 * `getStorageToken`) qui appartiennent au paquet et peuvent changer de nom d'une
 * version à l'autre. Une erreur là ne se voit dans aucun test de logique : elle
 * fait échouer le démarrage du serveur, en production, après le déploiement.
 */
describe('CadenceGlobaleGuard — résolution des dépendances', () => {
  it('se construit comme garde global, avec les vrais modules', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
        JwtModule.register({ secret: 'secret-de-test' }),
      ],
      // Fourni par sa classe et non par `APP_GUARD` : ce jeton-là est traité à part
      // par Nest et ne se relit pas depuis le conteneur. Ce qu'on vérifie ici est
      // l'injection du constructeur, qui est identique dans les deux cas.
      providers: [CadenceGlobaleGuard],
    }).compile();

    expect(module.get(CadenceGlobaleGuard)).toBeInstanceOf(CadenceGlobaleGuard);
  });
});

describe('ipClient — quelle adresse croire', () => {
  it('préfère celle que pose Cloudflare', () => {
    // `req.ip` est l'intermédiaire Render, identique pour tout le monde.
    expect(ipClient({ headers: { 'cf-connecting-ip': '9.9.9.9' }, ip: '10.0.0.1' })).toBe('9.9.9.9');
  });

  it('ignore X-Forwarded-For, que le client écrit lui-même', () => {
    // Le premier élément de cette liste est fourni par l'appelant : s'y fier
    // rendrait le décompte contournable en changeant d'en-tête à chaque requête.
    expect(ipClient({ headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('retombe sur le comportement actuel quand Cloudflare n’a rien posé', () => {
    // C'est ce qui rend le changement sûr : au pire il ne fait rien.
    expect(ipClient({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(ipClient({})).toBe('inconnu');
  });
});
