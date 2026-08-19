import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/**
 * Supprimer son compte, depuis l'application.
 *
 * Le produit n'offrait aucun moyen de le faire : la page vie privée renvoyait
 * vers une adresse e-mail, et le bouton « Purger tes données » du Profil efface
 * les routines, les habitudes, la série et les points — **mais le compte, lui,
 * survivait**, avec son adresse, son mot de passe et son abonnement.
 *
 * Deux raisons de le combler, et elles ne se recouvrent pas :
 *
 * - **L'App Store le refuserait.** Depuis 2022, toute application permettant de
 *   créer un compte doit permettre de le supprimer **depuis l'application**, pas
 *   par un e-mail à envoyer. C'est un motif de rejet quasi automatique.
 * - **Le RGPD donne un droit à l'effacement.** Le satisfaire par e-mail est
 *   légal, mais suppose que quelqu'un lise cette boîte et agisse. Un bouton ne
 *   suppose rien.
 *
 * ## Ce qui est supprimé, et dans quel ordre
 *
 * L'ordre n'est pas une commodité, il évite deux dégâts distincts.
 *
 * **L'abonnement d'abord, et son échec interrompt tout.** Un compte effacé dont
 * l'abonnement Stripe continue de tourner prélève 9,99 € par mois à quelqu'un
 * qui n'a plus aucun moyen de se connecter pour l'arrêter — et plus aucune trace
 * de son côté pour comprendre. C'est le pire résultat possible, pire que de ne
 * pas supprimer du tout : on préfère donc refuser la suppression et le dire.
 *
 * **Le mot de passe est exigé.** Apple ne le demande pas, la sécurité si : une
 * session volée, un téléphone laissé ouvert sur une table, et le compte entier
 * disparaît sans retour possible. La suppression est la seule action du produit
 * qu'aucune sauvegarde ne rattrape.
 *
 * **Puis les paiements et le journal d'audit, puis la personne.** Vingt-cinq
 * relations partent en cascade avec elle (routines, habitudes, messages,
 * abonnements aux notifications, rappels…) ; ces deux-là n'ont pas de cascade et
 * bloqueraient l'effacement par contrainte de clé étrangère. Les lignes de
 * paiement sont une copie locale : **Stripe reste la source comptable**, les
 * factures y demeurent, ce que la loi demande de conserver l'est donc toujours.
 */
@Injectable()
export class SuppressionCompteService {
  private readonly logger = new Logger(SuppressionCompteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly abonnements: SubscriptionsService,
  ) {}

  async supprimer(userId: string, motDePasse: string): Promise<{ supprime: true }> {
    if (!motDePasse || typeof motDePasse !== 'string') {
      throw new BadRequestException('Mot de passe requis pour supprimer le compte.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, password_hash: true, stripe_customer_id: true },
    });

    // Un compte déjà supprimé et un mot de passe faux rendent la même chose : rien
    // ici ne doit permettre de deviner qu'une adresse existe.
    if (!user || !(await argon2.verify(user.password_hash, motDePasse))) {
      throw new UnauthorizedException('Mot de passe incorrect.');
    }

    if (user.stripe_customer_id) {
      try {
        await this.abonnements.resilierPourSuppression(user.stripe_customer_id);
      } catch (e: any) {
        /*
          On s'arrête ici, et c'est délibéré. Continuer laisserait un prélèvement
          mensuel actif derrière un compte devenu inaccessible : la personne ne
          pourrait plus ni se connecter pour résilier, ni retrouver la trace de ce
          qu'elle paie. Mieux vaut un message qu'elle peut lire et une seconde
          tentative.
        */
        this.logger.error(`Suppression refusée pour ${userId} : résiliation Stripe impossible (${e?.message})`);
        throw new ServiceUnavailableException(
          "Ton abonnement n'a pas pu être résilié à l'instant, et supprimer le compte le laisserait actif. Réessaie dans quelques minutes.",
        );
      }
    }

    await this.prisma.$transaction([
      // Sans cascade sur ces deux-là : à supprimer explicitement, sinon la
      // contrainte de clé étrangère refuse l'effacement de la personne.
      this.prisma.payment.deleteMany({ where: { user_id: userId } }),
      this.prisma.auditLog.deleteMany({ where: { user_id: userId } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);

    // L'adresse n'est pas journalisée : elle vient d'être effacée, l'écrire dans un
    // journal la ferait survivre à sa propre suppression.
    this.logger.log(`Compte ${userId} supprimé à la demande de son titulaire.`);

    return { supprime: true };
  }
}
