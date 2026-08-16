import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cleJourParis } from '../common/jour-paris';

/**
 * L'ouverture de l'application, enregistrée pour elle-même.
 *
 * Tout ce que l'administration savait de l'activité venait de traces laissées par
 * autre chose : une clé dans `daily_scores` parce qu'une tâche a été cochée, un
 * `updated_at` parce qu'un état est remonté. Quelqu'un qui ouvre l'app, regarde sa
 * journée et referme ne laissait donc rien — il était strictement indistinguable
 * de quelqu'un qui n'est jamais venu.
 *
 * C'est l'écart entre les deux qui compte : une application ouverte dix jours et
 * utilisée deux n'est pas la même chose qu'une application ouverte deux jours et
 * utilisée deux. La première a une habitude et un problème de produit ; la
 * seconde n'a pas encore d'habitude.
 */
@Injectable()
export class ActiviteService {
  private readonly logger = new Logger(ActiviteService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compte une ouverture pour aujourd'hui.
   *
   * **Ce qui compte comme une ouverture est décidé par le client**, et il ne le
   * fait qu'au démarrage ou après une absence prolongée — sans quoi chaque
   * changement d'onglet gonflerait le chiffre. Le serveur ne peut pas trancher
   * cette question : il ne voit pas la fenêtre. Voir `utils/ouverture.ts`.
   *
   * Ne lève jamais. Un compteur d'usage qui fait échouer le démarrage de
   * l'application coûterait infiniment plus cher que le chiffre ne rapporte.
   */
  async enregistrerOuverture(userId: string): Promise<void> {
    const jour = cleJourParis();

    try {
      await this.prisma.appOuverture.upsert({
        where: { user_id_jour: { user_id: userId, jour } },
        update: { nombre: { increment: 1 } },
        create: { user_id: userId, jour, nombre: 1 },
      });
    } catch (erreur) {
      // Journalisé, pas propagé : c'est une mesure, pas une fonction du produit.
      this.logger.warn(
        `Ouverture non enregistrée pour ${userId} : ${erreur instanceof Error ? erreur.message : erreur}`,
      );
    }
  }
}
