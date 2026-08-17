import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';

/**
 * L'adresse de celui qui appelle, telle qu'on peut la croire.
 *
 * `req.ip` ne vaut rien ici. Express le lit sur la connexion TCP, or l'application
 * ne reçoit jamais de connexion directe : tout passe par le routeur de Render, et
 * l'essentiel passe d'abord par la réécriture `/api/*` de Vercel. L'adresse vue
 * est donc celle d'un intermédiaire, la même pour tout le monde — mesuré le
 * 17 août 2026 : dix appels depuis cette machine puis trois par Vercel se sont
 * suivis dans **le même compteur**, alors que ce sont deux réseaux sans rapport.
 *
 * `X-Forwarded-For` réglerait le problème mais en ouvrirait un pire : le premier
 * élément de cette liste est écrit par le client, donc quiconque veut échapper au
 * décompte n'a qu'à en changer à chaque requête. Un compteur contournable est
 * moins utile qu'un compteur trop large — il ne protège plus le formulaire de
 * connexion.
 *
 * `CF-Connecting-IP` n'a pas ce défaut : Cloudflare — présent devant Render, ses
 * en-têtes `CF-RAY` et `Server: cloudflare` le prouvent sur chaque réponse — la
 * **réécrit** au lieu de l'ajouter. Une valeur envoyée par le client est donc
 * écrasée avant d'arriver ici.
 *
 * Et si elle manque, on retombe sur `req.ip`, c'est-à-dire exactement le
 * comportement actuel. C'est ce qui rend ce changement sûr : au pire il ne fait
 * rien, il ne peut pas ouvrir de porte.
 */
export function ipClient(req: Record<string, any>): string {
  const cf = req?.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req?.ip ?? 'inconnu';
}

/**
 * Le décompte des requêtes, compté par compte plutôt que pour tout le monde à la fois.
 *
 * Le garde-fou standard compte par adresse IP. Derrière deux intermédiaires, cette
 * adresse est constante (voir `ipClient` ci-dessus) : **l'application entière
 * partageait donc un seul quota de 100 requêtes par minute.** Deux conséquences,
 * dont la seconde est la vraie.
 *
 * 1. Un tableau de bord qui s'ouvre lance plusieurs appels ; quelques personnes
 *    connectées en même temps se prenaient mutuellement leur budget.
 * 2. **N'importe qui pouvait éteindre le service depuis un téléphone.** Cent
 *    requêtes par minute sur `/health` — une boucle de trois lignes — et plus
 *    personne ne passe. Le plafond de cinq par minute sur `POST /auth/login`
 *    valait pareil : cinq essais suffisaient à fermer la connexion à tous les
 *    inscrits, sans interruption tant que la boucle tourne.
 *
 * D'où la clé ci-dessous : le compte quand la requête en désigne un, l'adresse
 * sinon. Une personne ne peut plus dépenser que son propre budget, et le
 * saturateur ne se nuit qu'à lui-même.
 *
 * **Le jeton est vérifié avant d'être cru.** C'est tout l'enjeu de ce garde : s'en
 * remettre à la chaîne présentée sans contrôler sa signature reviendrait à donner
 * un compteur neuf à qui écrit n'importe quoi dans l'en-tête `Authorization` —
 * autrement dit à supprimer le plafond de la page de connexion, exactement ce
 * qu'il faut garder. Un jeton faux ou périmé ne vaut donc rien ici et retombe sur
 * l'adresse.
 *
 * Ne remplace pas `CadenceGuard` (route du coach), qui garde sa propre clé : ce
 * garde-ci est le plafond général, celui-là borne la dépense d'IA.
 */
@Injectable()
export class CadenceGlobaleGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Le compte qui présente ce jeton, ou `null` si le jeton ne prouve rien.
   *
   * L'expiration n'est pas exigée : un jeton périmé mais correctement signé
   * désigne quand même son porteur légitime, et son détenteur est sur le point
   * d'appeler `POST /auth/refresh`. Le refuser le renverrait dans le compteur
   * commun au moment précis où sa session se prolonge.
   */
  private compteDuJeton(req: Record<string, any>): string | null {
    const entete = req?.headers?.authorization;
    if (typeof entete !== 'string' || !entete.startsWith('Bearer ')) return null;

    const secret = process.env.JWT_SECRET;
    if (!secret) return null;

    try {
      const charge: any = this.jwt.verify(entete.slice(7).trim(), {
        secret,
        ignoreExpiration: true,
      });
      return typeof charge?.sub === 'string' ? charge.sub : null;
    } catch {
      return null;
    }
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const compte = this.compteDuJeton(req);
    if (compte) return `compte:${compte}`;

    // Haché plutôt qu'en clair : cette clé se retrouve dans l'état du compteur, et
    // une adresse IP est une donnée personnelle. Le décompte n'a besoin que de
    // distinguer deux appelants, jamais de savoir lequel est lequel.
    return `ip:${crypto.createHash('sha256').update(ipClient(req)).digest('hex').slice(0, 16)}`;
  }
}
