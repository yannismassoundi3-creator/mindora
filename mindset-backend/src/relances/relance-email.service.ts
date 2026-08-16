import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as cron from 'node-cron';
import { PrismaService } from '../prisma/prisma.service';
import { envoyerEmail, gabarit } from '../common/email';
import { lienApi, lienApp } from '../common/origines';

/** Les deux raisons de reprendre contact. Sert aussi de clé d'unicité en base. */
export type MotifRelance = 'jamais_ouvert' | 'decroche';

/**
 * Reprendre contact par e-mail avec ceux qui ne reviennent pas.
 *
 * Constat du 16 août 2026 : l'application n'avait aucun moyen de parler à quelqu'un
 * qui l'a quittée. Le push ne couvre presque personne — 26 comptes sur 28 étaient
 * injoignables —, et les relances vers l'abonnement (`OfferPromptService`) ne
 * s'affichent que **dans** l'app : elles ne parlent donc qu'à ceux qui sont déjà
 * revenus, c'est-à-dire à ceux qu'il faut le moins convaincre. Pendant ce temps
 * l'adresse e-mail, le seul canal qui atteint 100 % des inscrits, ne servait qu'à
 * envoyer des codes de sécurité.
 *
 * Deux messages, un seul par personne et par motif, jamais davantage. Le principe
 * est le même que pour `OfferPromptService` : solliciter peu et ne dire que des
 * choses vraies. Un produit de discipline qui harcèle est une contradiction, et
 * chaque envoi de trop rapproche le domaine entier de la case indésirables — d'où
 * partent aussi les codes de connexion, sans lesquels plus personne n'entre.
 */
@Injectable()
export class RelanceEmailService {
  private readonly logger = new Logger(RelanceEmailService.name);

  /**
   * Âge minimum du compte avant la relance « jamais ouvert ».
   *
   * Deux jours, et non le lendemain : quelqu'un qui s'inscrit le soir et revient le
   * surlendemain n'a rien abandonné, et recevoir « tu n'es jamais revenu » alors
   * qu'on comptait revenir apprend surtout que personne ne regarde vraiment.
   */
  static readonly JOURS_AVANT_JAMAIS_OUVERT = 2;

  /** Jours sans la moindre activité avant de considérer que quelqu'un a décroché. */
  static readonly JOURS_AVANT_DECROCHE = 3;

  /**
   * Au-delà, on se tait.
   *
   * Écrire à quelqu'un qui s'est inscrit il y a trois mois et n'est jamais revenu
   * n'est plus une relance, c'est du démarchage — et c'est ce qui fait signaler un
   * expéditeur. La borne protège aussi le premier passage de la tâche, qui trouve
   * d'un coup tout l'historique des comptes dormants.
   */
  static readonly JOURS_MAX = 30;

  /** Plafond par tournée : une salve massive est ce qui abîme une réputation d'envoi. */
  static readonly MAX_PAR_TOURNEE = 50;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // 11h, après les briefs de 10h : deux tournées simultanées se disputeraient la
    // base et arriveraient chez la même personne dans la même minute.
    cron.schedule(
      '0 11 * * *',
      async () => {
        this.logger.log('[CRON] Relances e-mail — démarrage');
        try {
          const bilan = await this.tournee();
          this.logger.log(`[CRON] Relances e-mail — terminé : ${JSON.stringify(bilan)}`);
        } catch (e) {
          this.logger.error(`[CRON] Relances e-mail — ÉCHEC : ${(e as any)?.message}`, (e as any)?.stack);
        }
      },
      { timezone: 'Europe/Paris' },
    );
    this.logger.log('[CRON] Relances e-mail programmé (0 11 * * *, Europe/Paris)');
  }

  /** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
  private static estCleJour(cle: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(cle);
  }

  /**
   * Le dernier jour où cette personne a agi, ou `null` si elle n'a jamais rien fait.
   *
   * Même lecture que dans `RetentionService` : une entrée présente vaut activité même
   * si le score vaut zéro — la clé n'est écrite que parce qu'il s'est passé quelque
   * chose ce jour-là. Ce qu'on mesure est la venue, pas la performance.
   */
  static dernierJourActif(dailyScores: unknown): string | null {
    if (!dailyScores || typeof dailyScores !== 'object' || Array.isArray(dailyScores)) return null;
    const jours = Object.keys(dailyScores as Record<string, unknown>).filter(RelanceEmailService.estCleJour);
    if (jours.length === 0) return null;
    // Les clés sont en `YYYY-MM-DD` : l'ordre lexicographique est l'ordre chronologique.
    jours.sort();
    return jours[jours.length - 1];
  }

  /**
   * Ce qu'il faut envoyer à cette personne aujourd'hui, ou `null` s'il n'y a rien à dire.
   *
   * Isolée de la base et de l'envoi pour être décidable sur un cas précis : c'est la
   * seule partie où une erreur se voit dans un test plutôt que dans une boîte mail.
   */
  static motifPour(
    compte: { created_at: Date; dailyScores: unknown; dejaEnvoyes: MotifRelance[] },
    maintenant: Date,
  ): MotifRelance | null {
    const jours = (depuis: Date) => Math.floor((maintenant.getTime() - depuis.getTime()) / 86_400_000);
    const age = jours(compte.created_at);
    if (age > RelanceEmailService.JOURS_MAX) return null;

    const dernier = RelanceEmailService.dernierJourActif(compte.dailyScores);

    if (dernier === null) {
      if (age < RelanceEmailService.JOURS_AVANT_JAMAIS_OUVERT) return null;
      return compte.dejaEnvoyes.includes('jamais_ouvert') ? null : 'jamais_ouvert';
    }

    /*
      « Décroché » se mesure sur la dernière venue, pas sur l'âge du compte : c'est
      la différence entre quelqu'un qui n'a jamais commencé et quelqu'un qui a
      commencé puis s'est arrêté. Les deux méritent des mots différents, et c'est
      d'ailleurs la seule raison d'avoir deux motifs.
    */
    const silence = jours(new Date(`${dernier}T00:00:00.000Z`));
    if (silence < RelanceEmailService.JOURS_AVANT_DECROCHE || silence > RelanceEmailService.JOURS_MAX) return null;
    return compte.dejaEnvoyes.includes('decroche') ? null : 'decroche';
  }

  /**
   * Jeton de retrait, lié à un compte et invérifiable sans le secret du serveur.
   *
   * Sans signature, le lien se réduirait à un identifiant en clair dans une URL :
   * n'importe qui pourrait désabonner n'importe qui en changeant un caractère.
   */
  static signature(userId: string): string {
    const secret = process.env.JWT_SECRET || process.env.JWT_REFRESH_SECRET || 'disciplix';
    return crypto.createHmac('sha256', secret).update(`retrait:${userId}`).digest('hex').slice(0, 32);
  }

  static verifierSignature(userId: string, signature: string): boolean {
    const attendue = RelanceEmailService.signature(userId);
    // Comparaison à temps constant : une comparaison ordinaire s'arrête au premier
    // caractère faux et laisse deviner la signature octet par octet.
    const a = Buffer.from(attendue);
    const b = Buffer.from(signature ?? '');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Le lien de retrait pointe vers l'API et non vers l'application.
   *
   * C'est le serveur qui tient la préférence, et l'application ne saurait pas la
   * poser sans une session — or quelqu'un qui veut ne plus rien recevoir est
   * précisément quelqu'un qui ne se reconnectera pas.
   */
  private lienRetrait(userId: string): string {
    return lienApi(
      `/emails/retrait?u=${encodeURIComponent(userId)}&s=${RelanceEmailService.signature(userId)}`,
    );
  }

  private contenu(motif: MotifRelance, prenom: string, userId: string): { sujet: string; html: string } {
    const retrait = this.lienRetrait(userId);
    const app = lienApp('');

    if (motif === 'jamais_ouvert') {
      return {
        sujet: 'Ton compte Disciplix t’attend',
        html: gabarit({
          titre: `${prenom}, tu n’as pas encore commencé.`,
          corps:
            "<p>Tu as créé ton compte, puis plus rien. C'est le moment le plus fragile : " +
            "tant que la première journée n'a pas été cochée, il n'y a rien à quoi revenir.</p>" +
            "<p>Ça prend deux minutes : tu dis à ton coach qui tu veux devenir, il te donne " +
            "quoi faire aujourd'hui, tu le fais. Demain, on recommence.</p>",
          bouton: { texte: 'Reprendre où j’en étais', lien: app },
          lienRetrait: retrait,
        }),
      };
    }

    return {
      sujet: 'Ta série s’est arrêtée',
      html: gabarit({
        titre: `${prenom}, ça fait quelques jours.`,
        corps:
          "<p>Tu avais commencé, puis la série s'est interrompue. Ça arrive à tout le monde, " +
          "et ce n'est pas ce qui décide de la suite — ce qui décide, c'est de rouvrir.</p>" +
          "<p>Ton plan est toujours là, et ton coach sait où tu en étais. Une seule case " +
          "cochée aujourd'hui suffit à repartir.</p>",
        bouton: { texte: 'Reprendre aujourd’hui', lien: app },
        lienRetrait: retrait,
      }),
    };
  }

  /**
   * Une tournée complète. Rendue publique pour être déclenchable à la main : une
   * tâche planifiée qu'on ne peut pas rejouer ne se diagnostique que le lendemain.
   */
  async tournee(): Promise<{ examines: number; envoyes: number; echecs: number; parMotif: Record<string, number> }> {
    const maintenant = new Date();
    const limite = new Date(maintenant.getTime() - RelanceEmailService.JOURS_MAX * 86_400_000);

    const comptes = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        relances_email: true,
        created_at: { gte: limite },
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        created_at: true,
        sync_data: { select: { daily_scores: true } },
        relances: { select: { motif: true } },
      },
    });

    const bilan = { examines: comptes.length, envoyes: 0, echecs: 0, parMotif: {} as Record<string, number> };

    for (const compte of comptes) {
      if (bilan.envoyes >= RelanceEmailService.MAX_PAR_TOURNEE) break;

      const motif = RelanceEmailService.motifPour(
        {
          created_at: compte.created_at,
          dailyScores: compte.sync_data?.daily_scores,
          dejaEnvoyes: compte.relances.map((r) => r.motif as MotifRelance),
        },
        maintenant,
      );
      if (!motif) continue;

      const { sujet, html } = this.contenu(motif, compte.first_name || 'toi', compte.id);
      const parti = await envoyerEmail({ destinataire: compte.email, sujet, html });

      if (!parti) {
        // Rien n'est écrit : la trace dit « envoyé », pas « tenté ». L'inscrire ici
        // condamnerait la personne à ne jamais recevoir la relance, en donnant à
        // croire qu'elle l'a reçue — exactement la panne muette qu'on cherche à ne
        // plus produire.
        bilan.echecs++;
        continue;
      }

      await this.prisma.relanceEmail.create({ data: { user_id: compte.id, motif } });
      bilan.envoyes++;
      bilan.parMotif[motif] = (bilan.parMotif[motif] ?? 0) + 1;
    }

    return bilan;
  }

  /** Retire quelqu'un des relances. Idempotent : un second clic ne doit pas échouer. */
  async retirer(userId: string): Promise<boolean> {
    const compte = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!compte) return false;
    await this.prisma.user.update({ where: { id: userId }, data: { relances_email: false } });
    this.logger.log(`Relances désactivées pour ${userId}`);
    return true;
  }
}
