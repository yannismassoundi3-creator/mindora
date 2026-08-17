import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ipClient } from './cadence-globale.guard';

/**
 * Ce que le garde-fou nous passe au moment du refus.
 *
 * Décrit ici plutôt qu'importé : `ThrottlerLimitDetail` vit dans un sous-chemin
 * que l'index du paquet ne réexporte pas, et dépendre d'un chemin interne se
 * casse à la première mise à jour.
 *
 * **`timeToExpire` est en secondes**, pas en millisecondes : le service de
 * stockage le calcule en divisant par mille. Se tromper d'unité ici ne planterait
 * rien — cela annoncerait simplement une attente fausse, du genre qu'on ne
 * remarque jamais.
 */
interface DetailCadence {
  timeToExpire: number;
}

/**
 * La cadence du coach : par compte, et dite en français.
 *
 * Deux défauts du garde-fou standard, sur une route authentifiée.
 *
 * **Il compte par adresse IP.** C'est le bon choix pour une page de connexion, où
 * l'on ne sait pas encore qui parle. Ici on le sait. Compter par IP produit les
 * deux erreurs à la fois : deux personnes derrière la même box, le même réseau
 * d'école ou le même opérateur mobile se partagent le quota et se bloquent
 * mutuellement, pendant que quelqu'un qui veut vraiment saturer le service change
 * simplement de réseau. Compter par compte supprime les deux.
 *
 * **Il rend un message technique.** « ThrottlerException: Too Many Requests »
 * arrive au navigateur sans code reconnaissable, et l'écran de conversation
 * l'affiche sous sa phrase d'erreur générique — « je n'arrive pas à me connecter
 * à mon cerveau externe ». La personne croit alors à une panne du produit au
 * moment précis où le produit fonctionne exactement comme prévu. Le code
 * `AI_CADENCE` permet au client de dire la vérité : ce n'est pas cassé, c'est
 * trop rapide.
 *
 * **Limite connue :** le décompte vit dans la mémoire du processus. Un
 * redéploiement le remet à zéro, et il ne serait pas partagé entre plusieurs
 * instances. C'est sans conséquence sur une instance unique — la configuration
 * actuelle — et c'est un garde-fou anti-emballement, pas un quota facturé : les
 * vrais plafonds, eux, sont comptés en base par `AiQuotaService`.
 */
@Injectable()
export class CadenceGuard extends ThrottlerGuard {
  /**
   * La clé de comptage : l'identifiant du compte, à défaut l'adresse IP.
   *
   * Le repli sur l'IP couvre les routes non authentifiées si ce garde venait à en
   * protéger un jour — et surtout il ne laisse jamais passer sans compter, ce qui
   * serait le pire des deux mondes. Il passe par `ipClient` et non par `req.ip`,
   * qui derrière Render et Vercel désigne un intermédiaire commun à tous.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.userId;
    return userId ? `compte:${userId}` : `ip:${ipClient(req)}`;
  }

  /**
   * Le refus, écrit pour être lu par la personne.
   *
   * L'attente est annoncée en minutes plutôt qu'en secondes : personne ne compte
   * en secondes au-delà d'une minute, et « réessaie dans 1140 secondes » se lit
   * comme un message d'erreur système.
   */
  protected async throwThrottlingException(
    _context: unknown,
    detail: DetailCadence,
  ): Promise<void> {
    const minutes = Math.max(1, Math.ceil((detail?.timeToExpire ?? 60) / 60));

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'AI_CADENCE',
        message:
          `Tu as envoyé beaucoup de messages coup sur coup. Le coach reprend dans ` +
          `${minutes} minute${minutes > 1 ? 's' : ''} — le temps de mettre en pratique ` +
          `ce qu'on vient de se dire.`,
        // Rendus pour que le client puisse afficher un décompte s'il le souhaite,
        // sans avoir à relire la phrase.
        minutes,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
