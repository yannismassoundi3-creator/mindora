import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Solde de coins faisant foi pour l'usage de l'IA.
 *
 * Jusqu'ici la règle « un message coûte 10 coins » vivait uniquement dans le
 * navigateur, et la synchro enregistrait tel quel le total envoyé par le client.
 * N'importe qui pouvait donc s'attribuer un solde illimité — sans même créer de
 * routines, une ligne dans la console suffisait.
 *
 * Ce solde-ci n'est jamais alimenté par la synchro. Il n'augmente que par des
 * demandes de crédit idempotentes et plafonnées par jour, ce qui borne le
 * problème des routines créées en boucle : peu importe combien on en fabrique,
 * on ne peut pas encaisser plus que le plafond quotidien.
 */
@Injectable()
export class CoinLedgerService {
  private readonly logger = new Logger(CoinLedgerService.name);

  /** Coût d'un message à l'IA, aligné sur la règle affichée dans l'app. */
  static readonly COUT_MESSAGE = 10;
  /** Gain par action validée. */
  static readonly GAIN_PAR_ACTION = 10;
  /** Nombre maximum d'actions créditées par jour. C'est ce plafond qui borne la triche. */
  static readonly ACTIONS_MAX_PAR_JOUR = 10;

  constructor(private readonly prisma: PrismaService) {}

  private debutDuJour(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Les comptes existants avaient déjà des coins, stockés côté client puis recopiés
   * dans `points`. On initialise le solde avec cette valeur une seule fois, pour ne
   * pas remettre tout le monde à zéro le jour du déploiement. Ensuite, `points` n'a
   * plus aucune influence.
   */
  async getBalance(userId: string): Promise<number> {
    const sync = await this.prisma.syncData.findUnique({
      where: { user_id: userId },
      select: { ai_credits: true, points: true },
    });

    if (!sync) return 0;
    if (sync.ai_credits !== null) return sync.ai_credits;

    const initial = Math.max(0, sync.points ?? 0);
    await this.prisma.syncData.update({
      where: { user_id: userId },
      data: { ai_credits: initial },
    });
    this.logger.log(`Solde initialisé à ${initial} pour ${userId}`);
    return initial;
  }

  async claimsAujourdhui(userId: string): Promise<number> {
    return this.prisma.coinClaim.count({
      where: { user_id: userId, created_at: { gte: this.debutDuJour() } },
    });
  }

  /**
   * Crédite une action validée. `eventKey` doit identifier l'action ET le jour
   * (ex. « routine-matin-2026-08-11 ») : la contrainte d'unicité empêche de
   * réencaisser la même action en rejouant la requête.
   */
  async claim(userId: string, eventKey: string) {
    if (!eventKey || eventKey.length > 200) {
      throw new HttpException('Clé d\'événement invalide.', HttpStatus.BAD_REQUEST);
    }

    const dejaVu = await this.prisma.coinClaim.findUnique({
      where: { user_id_event_key: { user_id: userId, event_key: eventKey } },
    });
    if (dejaVu) {
      return { credite: false, raison: 'deja_credite', solde: await this.getBalance(userId) };
    }

    if ((await this.claimsAujourdhui(userId)) >= CoinLedgerService.ACTIONS_MAX_PAR_JOUR) {
      return {
        credite: false,
        raison: 'plafond_journalier',
        solde: await this.getBalance(userId),
        plafond: CoinLedgerService.ACTIONS_MAX_PAR_JOUR,
      };
    }

    await this.getBalance(userId); // garantit que ai_credits n'est plus null

    try {
      const [, sync] = await this.prisma.$transaction([
        this.prisma.coinClaim.create({
          data: { user_id: userId, event_key: eventKey, amount: CoinLedgerService.GAIN_PAR_ACTION },
        }),
        this.prisma.syncData.update({
          where: { user_id: userId },
          data: { ai_credits: { increment: CoinLedgerService.GAIN_PAR_ACTION } },
          select: { ai_credits: true },
        }),
      ]);
      return { credite: true, gain: CoinLedgerService.GAIN_PAR_ACTION, solde: sync.ai_credits ?? 0 };
    } catch (e: any) {
      // Course entre deux requêtes simultanées sur la même clé : l'unicité a tranché.
      if (e?.code === 'P2002') {
        return { credite: false, raison: 'deja_credite', solde: await this.getBalance(userId) };
      }
      throw e;
    }
  }

  /**
   * Débite le coût d'un message. Le débit est conditionné en base sur le solde
   * courant : deux requêtes simultanées ne peuvent pas passer avec le même solde.
   */
  async spend(userId: string, montant = CoinLedgerService.COUT_MESSAGE) {
    const solde = await this.getBalance(userId);

    if (solde < montant) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'COINS_INSUFFISANTS',
          message: `Il te faut ${montant} coins pour parler à l'IA. Termine une routine pour en gagner.`,
          solde,
          requis: montant,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const maj = await this.prisma.syncData.updateMany({
      where: { user_id: userId, ai_credits: { gte: montant } },
      data: { ai_credits: { decrement: montant } },
    });

    if (maj.count === 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'COINS_INSUFFISANTS',
          message: `Il te faut ${montant} coins pour parler à l'IA. Termine une routine pour en gagner.`,
          solde,
          requis: montant,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return { depense: montant, solde: solde - montant };
  }

  /**
   * Rend les coins d'un message que l'IA n'a pas pu produire.
   *
   * Le débit a lieu avant l'appel au modèle, ce qui est la bonne façon d'empêcher
   * deux requêtes simultanées de passer avec le même solde. Mais sans remboursement,
   * une panne du fournisseur — un 429 lors d'un pic, typiquement — fait payer à
   * l'utilisateur un message qu'il n'a jamais reçu.
   */
  async refund(userId: string, montant = CoinLedgerService.COUT_MESSAGE) {
    await this.prisma.syncData.updateMany({
      where: { user_id: userId },
      data: { ai_credits: { increment: montant } },
    });
    this.logger.log(`${montant} coins rendus à ${userId} (réponse IA non délivrée)`);
  }
}
