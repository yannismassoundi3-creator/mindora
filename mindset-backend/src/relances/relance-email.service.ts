import { Injectable, Logger } from '@nestjs/common';
import {
  signatureRetrait,
  verifierSignatureRetrait,
  lienRetrait as construireLienRetrait,
} from '../common/retrait';
import * as crypto from 'crypto';
import * as cron from 'node-cron';
import { PrismaService } from '../prisma/prisma.service';
import { envoyerEmail, gabarit } from '../common/email';
import { lienApi, lienApp } from '../common/origines';
import { MOTIF_BIENVENUE, envoyerBienvenue } from './bienvenue';

/**
 * Les raisons d'écrire à quelqu'un. Sert aussi de clé d'unicité en base.
 *
 * Les deux premières reprennent contact avec quelqu'un qui s'éloigne. Les deux
 * autres font l'inverse : elles répondent à un geste qu'on vient de recevoir —
 * une inscription, un abonnement. Elles partagent le même mécanisme parce
 * qu'elles partagent la même exigence — une fois, jamais deux, et retirable d'un
 * clic.
 *
 * `bienvenue` n'est pas envoyé par la tournée : il part à l'inscription même
 * (`AuthService.register`). Il figure ici parce qu'il occupe la même table, donc
 * la même contrainte d'unicité, et parce que la tournée le rattrape quand le
 * premier envoi a échoué.
 */
export type MotifRelance = 'jamais_ouvert' | 'decroche' | 'merci_abonnement' | 'bienvenue';

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

  /**
   * Le lot d'accueils rattrapés que déclenche un clic, quand on n'en demande pas.
   *
   * Dix, et non « tous » : le défaut est ce qui part quand personne n'a réfléchi,
   * et sur un domaine sans historique la prudence doit être gratuite. Celui qui
   * veut aller plus vite le dit — `?max=50` — et c'est alors une décision, pas un
   * effet de bord.
   */
  static readonly LOT_BIENVENUE_PAR_DEFAUT = 10;

  /** Au-delà, aucun geste unique ne peut aller : la borne n'est pas négociable. */
  static readonly LOT_BIENVENUE_MAX = 50;

  /**
   * Les statuts qui valent « a pris l'abonnement ».
   *
   * Recopiés de `AiQuotaService.PAID_STATUSES` plutôt qu'importés, comme le fait
   * déjà le module push : le remerciement n'a pas à créer un lien entre l'envoi
   * d'e-mails et le quota d'IA. `TRIALING` en fait partie — quelqu'un en essai a
   * donné sa carte, c'est le geste qu'on remercie, et attendre le prélèvement pour
   * le dire ferait arriver le merci une semaine trop tard.
   */
  static readonly STATUTS_ABONNES = ['ACTIVE', 'TRIALING'] as const;

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

  /*
    Le jeton et sa vérification vivent désormais dans `common/retrait.ts`.

    Le brief du matin par e-mail a besoin du même lien de retrait. Deux façons de
    signer la même chose, c'est la garantie qu'un jour l'une change : les liens
    déjà partis dans des boîtes cessent alors de fonctionner, et on ne l'apprend
    qu'au premier signalement pour spam. Ces deux méthodes restent exposées ici
    parce que le contrôleur les appelle, mais elles ne décident plus de rien.
  */
  static signature(userId: string): string {
    return signatureRetrait(userId);
  }

  static verifierSignature(userId: string, signature: string): boolean {
    return verifierSignatureRetrait(userId, signature);
  }

  /**
   * Le lien de retrait pointe vers l'API et non vers l'application.
   *
   * C'est le serveur qui tient la préférence, et l'application ne saurait pas la
   * poser sans une session — or quelqu'un qui veut ne plus rien recevoir est
   * précisément quelqu'un qui ne se reconnectera pas.
   */
  private lienRetrait(userId: string): string {
    return construireLienRetrait(userId);
  }

  /*
    Ce qui est écrit compte autant que le fait d'écrire.

    Les mots qui font basculer un message en indésirable sont ceux des campagnes :
    promotion, offre, gratuit, urgence, majuscules, points d'exclamation en rafale,
    images de fond. Ces deux messages n'en contiennent aucun — ils ne vendent rien,
    ils constatent quelque chose de vrai sur le compte de la personne. C'est aussi
    la raison pour laquelle ils tiennent en quatre phrases et un seul lien : plus un
    e-mail contient de liens et de balises, plus il ressemble à ce que les filtres
    cherchent.
  */
  private contenu(
    motif: MotifRelance,
    prenom: string,
    userId: string,
  ): { sujet: string; html: string; texte: string; lienRetrait: string } {
    const retrait = this.lienRetrait(userId);
    const app = lienApp('');

    if (motif === 'merci_abonnement') {
      /*
        Le seul message du produit qui ne demande rien.

        Les deux autres constatent un éloignement et invitent à revenir. Celui-ci
        répond à quelqu'un qui vient de payer : lui glisser un appel à l'action
        transformerait un merci en relance, et c'est exactement ce qui fait qu'on
        ne croit plus les remerciements. D'où l'absence de bouton, seule de tout
        le fichier.

        Il est écrit à la première personne parce qu'il y a vraiment quelqu'un
        derrière : un merci signé « l'équipe », pour un produit tenu par une seule
        personne, se lit comme un automatisme — ce qu'il est précisément en train
        d'essayer de ne pas être.
      */
      return {
        sujet: 'Merci',
        html: gabarit({
          titre: `${prenom}, merci.`,
          corps:
            "<p>Tu viens de prendre l'abonnement. Disciplix est un produit jeune et tu es " +
            "parmi les tout premiers à le soutenir — ça se voit d'ici, et ça compte.</p>" +
            "<p>Ton coach n'a plus de compteur mensuel. Je continue à travailler dessus " +
            "toutes les semaines, et je te tiendrai au courant des prochaines mises à jour " +
            "— sans t'écrire pour rien.</p>" +
            "<p>Si quelque chose ne va pas, ou si tu vois ce qui manque : réponds à cet " +
            "e-mail. Je le lis.</p>",
          lienRetrait: retrait,
        }),
        texte:
          `${prenom}, merci.\n\n` +
          "Tu viens de prendre l'abonnement. Disciplix est un produit jeune et tu es " +
          "parmi les tout premiers à le soutenir — ça se voit d'ici, et ça compte.\n\n" +
          "Ton coach n'a plus de compteur mensuel. Je continue à travailler dessus " +
          "toutes les semaines, et je te tiendrai au courant des prochaines mises à jour " +
          "— sans t'écrire pour rien.\n\n" +
          "Si quelque chose ne va pas, ou si tu vois ce qui manque : réponds à cet e-mail. " +
          `Je le lis.\n\n${app}\n\nNe plus recevoir ces messages : ${retrait}\n`,
        lienRetrait: retrait,
      };
    }

    if (motif === 'jamais_ouvert') {
      return {
        // Sujet sans majuscules criées ni promesse : il décrit l'état du compte.
        sujet: 'Tu n’as pas encore commencé',
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
        texte:
          `${prenom}, tu n'as pas encore commencé.\n\n` +
          "Tu as créé ton compte, puis plus rien. C'est le moment le plus fragile : tant que " +
          "la première journée n'a pas été cochée, il n'y a rien à quoi revenir.\n\n" +
          "Ça prend deux minutes : tu dis à ton coach qui tu veux devenir, il te donne quoi " +
          "faire aujourd'hui, tu le fais. Demain, on recommence.\n\n" +
          `${app}\n\nNe plus recevoir ces messages : ${retrait}\n`,
        lienRetrait: retrait,
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
      texte:
        `${prenom}, ça fait quelques jours.\n\n` +
        "Tu avais commencé, puis la série s'est interrompue. Ça arrive à tout le monde, et ce " +
        "n'est pas ce qui décide de la suite — ce qui décide, c'est de rouvrir.\n\n" +
        "Ton plan est toujours là, et ton coach sait où tu en étais. Une seule case cochée " +
        "aujourd'hui suffit à repartir.\n\n" +
        `${app}\n\nNe plus recevoir ces messages : ${retrait}\n`,
      lienRetrait: retrait,
    };
  }

  /**
   * Une tournée complète. Rendue publique pour être déclenchable à la main : une
   * tâche planifiée qu'on ne peut pas rejouer ne se diagnostique que le lendemain.
   *
   * En `simulation`, rien ne part et rien n'est écrit : on rend seulement qui
   * recevrait quoi. Un envoi est irréversible et sort du produit — on doit pouvoir
   * regarder la liste avant, sans avoir à la deviner d'après le code. C'est
   * d'autant plus vrai ici que le premier passage trouve d'un coup tout
   * l'historique des comptes dormants.
   */
  async tournee(
    simulation = false,
  ): Promise<{
    simulation: boolean;
    examines: number;
    envoyes: number;
    echecs: number;
    parMotif: Record<string, number>;
    destinataires?: Array<{ email: string; motif: MotifRelance; inscritIlYA: number }>;
  }> {
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

    const bilan = {
      simulation,
      // Renseigné après la requête des remerciements, plus bas : les deux passes
      // regardent deux populations différentes, et n'en compter qu'une donnerait
      // à croire que la tournée n'a pas vu les abonnés.
      examines: comptes.length,
      envoyes: 0,
      echecs: 0,
      parMotif: {} as Record<string, number>,
      destinataires: [] as Array<{ email: string; motif: MotifRelance; inscritIlYA: number }>,
    };

    /*
      Les bienvenues manquées, avant tout le reste.

      Le message d'accueil part normalement à la seconde de l'inscription. Quand
      Brevo refuse ou ne répond pas, rien n'est écrit en base — c'est la règle du
      module — et personne ne le saurait : il n'existe aucun écran où l'absence
      d'un e-mail se voit. Cette passe est le filet.

      Bornée aux comptes plus jeunes que le premier motif de relance : au-delà,
      « ton compte est prêt » ne décrit plus rien, et c'est `jamais_ouvert` qui a
      les bons mots. Le rattrapage n'a donc jamais plus de deux jours d'arriéré à
      combler, quel que soit le nombre de comptes en base.
    */
    const bienvenuesManquees = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        relances_email: true,
        created_at: {
          gte: new Date(maintenant.getTime() - RelanceEmailService.JOURS_AVANT_JAMAIS_OUVERT * 86_400_000),
        },
        relances: { none: { motif: MOTIF_BIENVENUE } },
      },
      select: { id: true, email: true, first_name: true, created_at: true, relances_email: true },
    });

    // Ces comptes figurent aussi dans `comptes` : ils ne sont pas rajoutés au
    // total examiné, ils y sont déjà.
    const accueillis = new Set<string>();

    for (const compte of bienvenuesManquees) {
      if (bilan.envoyes >= RelanceEmailService.MAX_PAR_TOURNEE) break;
      const motif: MotifRelance = 'bienvenue';
      const inscritIlYA = Math.floor((maintenant.getTime() - compte.created_at.getTime()) / 86_400_000);

      if (simulation) {
        bilan.envoyes++;
        bilan.parMotif[motif] = (bilan.parMotif[motif] ?? 0) + 1;
        bilan.destinataires.push({ email: compte.email, motif, inscritIlYA });
        accueillis.add(compte.id);
        continue;
      }

      // L'envoi et la trace sont ceux de l'inscription, à l'identique : deux
      // chemins qui composent le même message finiraient par en composer deux.
      const parti = await envoyerBienvenue(this.prisma, compte);
      if (!parti) {
        bilan.echecs++;
        continue;
      }
      bilan.envoyes++;
      bilan.parMotif[motif] = (bilan.parMotif[motif] ?? 0) + 1;
      accueillis.add(compte.id);
    }

    /*
      Les remerciements, sur leur propre requête.

      Ils ne peuvent pas passer par `motifPour` ni par la requête ci-dessus, et
      c'est structurel : celle-là cherche des gens qui s'éloignent, bornés à 30
      jours d'ancienneté. Or un abonné est actif par définition, et quelqu'un peut
      très bien s'abonner six mois après son inscription — la borne des 30 jours
      protège d'un démarchage tardif, elle n'a aucun sens pour répondre à un geste
      qu'on vient de recevoir.

      `relances_email` reste respecté : quelqu'un qui a demandé à ne plus rien
      recevoir n'a pas fait d'exception pour les bonnes nouvelles.
    */
    const aRemercier = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        relances_email: true,
        subscription: { status: { in: [...RelanceEmailService.STATUTS_ABONNES] } },
        relances: { none: { motif: 'merci_abonnement' } },
      },
      select: { id: true, email: true, first_name: true, created_at: true },
    });

    // Les abonnés ne figurent pas forcément dans `comptes` : celui-là s'arrête à
    // 30 jours d'ancienneté. Sans cette ligne, la tournée dirait avoir examiné
    // moins de monde qu'elle n'en a écrit.
    bilan.examines += aRemercier.length;

    for (const compte of aRemercier) {
      if (bilan.envoyes >= RelanceEmailService.MAX_PAR_TOURNEE) break;
      const motif: MotifRelance = 'merci_abonnement';
      const inscritIlYA = Math.floor((maintenant.getTime() - compte.created_at.getTime()) / 86_400_000);

      if (simulation) {
        bilan.envoyes++;
        bilan.parMotif[motif] = (bilan.parMotif[motif] ?? 0) + 1;
        bilan.destinataires.push({ email: compte.email, motif, inscritIlYA });
        continue;
      }

      const { sujet, html, texte, lienRetrait } = this.contenu(motif, compte.first_name || 'toi', compte.id);
      const parti = await envoyerEmail({ destinataire: compte.email, sujet, html, texte, lienRetrait });

      if (!parti) {
        // Rien n'est écrit sur un échec : la trace dit « envoyé », pas « tenté ».
        // L'inscrire ici priverait définitivement quelqu'un de son remerciement en
        // donnant à croire qu'il l'a reçu.
        bilan.echecs++;
        continue;
      }

      await this.prisma.relanceEmail.create({ data: { user_id: compte.id, motif } });
      bilan.envoyes++;
      bilan.parMotif[motif] = (bilan.parMotif[motif] ?? 0) + 1;
      this.logger.log(`Merci envoyé à ${compte.id}`);
    }

    // Personne ne reçoit deux e-mails dans la même tournée : un merci suivi d'un
    // « tu n'es jamais revenu » le même jour se contredirait tout seul.
    const dejaEcrit = new Set([...accueillis, ...aRemercier.map((c) => c.id)]);

    for (const compte of comptes) {
      if (bilan.envoyes >= RelanceEmailService.MAX_PAR_TOURNEE) break;
      if (dejaEcrit.has(compte.id)) continue;

      const motif = RelanceEmailService.motifPour(
        {
          created_at: compte.created_at,
          dailyScores: compte.sync_data?.daily_scores,
          dejaEnvoyes: compte.relances.map((r) => r.motif as MotifRelance),
        },
        maintenant,
      );
      if (!motif) continue;

      if (simulation) {
        // Le plafond compte quand même : la simulation doit décrire la tournée
        // réelle, pas une tournée idéale qui n'aura jamais lieu.
        bilan.envoyes++;
        bilan.parMotif[motif] = (bilan.parMotif[motif] ?? 0) + 1;
        bilan.destinataires.push({
          email: compte.email,
          motif,
          inscritIlYA: Math.floor((maintenant.getTime() - compte.created_at.getTime()) / 86_400_000),
        });
        continue;
      }

      const { sujet, html, texte, lienRetrait } = this.contenu(motif, compte.first_name || 'toi', compte.id);
      const parti = await envoyerEmail({ destinataire: compte.email, sujet, html, texte, lienRetrait });

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

    // Hors simulation, la liste nominative n'a pas à sortir : le décompte suffit à
    // savoir ce qui s'est passé, et une réponse d'API n'est pas un endroit où
    // laisser traîner les adresses de tout le monde.
    if (!simulation) return { ...bilan, destinataires: undefined };
    return bilan;
  }

  /**
   * L'accueil des comptes créés avant que l'accueil existe.
   *
   * Cinquante-deux personnes se sont inscrites sans jamais recevoir un mot. Ce
   * n'est pas la tournée de 11 h qui peut le réparer : elle se borne à deux jours
   * d'ancienneté, exprès, pour que le rattrapage quotidien reste minuscule. D'où
   * une passe séparée, déclenchée à la main, et qui ne part jamais toute seule.
   *
   * **Elle est paginée, et c'est le cœur du sujet.** Le domaine `disciplix.app` a
   * été créé le 20 août 2026 : il n'a aucun historique d'envoi. Cinquante messages
   * d'un seul geste depuis un domaine neuf est le profil exact d'un expéditeur
   * compromis, et la sanction ne frapperait pas que ces cinquante messages — elle
   * emporterait les codes de connexion, sans lesquels plus personne n'entre.
   *
   * Les plus récents d'abord : si l'on s'arrête après un lot, ceux qui sont servis
   * sont ceux dont l'inscription est la plus fraîche, donc ceux qui se souviennent
   * encore d'avoir créé un compte.
   */
  async rattrapageBienvenue(options: { simulation?: boolean; max?: number } = {}): Promise<{
    simulation: boolean;
    aAccueillir: number;
    envoyes: number;
    echecs: number;
    restants: number;
    destinataires?: Array<{ email: string; inscritIlYA: number }>;
  }> {
    const simulation = options.simulation === true;
    const max = RelanceEmailService.lotValide(options.max);
    const maintenant = new Date();

    const critere = {
      deleted_at: null,
      relances_email: true,
      relances: { none: { motif: MOTIF_BIENVENUE } },
    };

    // Le total sert au décompte de ce qui restera : sans lui, on ne saurait pas
    // combien de fois il faut encore cliquer, et un rattrapage à moitié fait
    // ressemble à un rattrapage fini.
    const aAccueillir = await this.prisma.user.count({ where: critere });

    const lot = await this.prisma.user.findMany({
      where: critere,
      orderBy: { created_at: 'desc' },
      take: max,
      select: { id: true, email: true, first_name: true, created_at: true, relances_email: true },
    });

    let envoyes = 0;
    let echecs = 0;
    const destinataires: Array<{ email: string; inscritIlYA: number }> = [];

    for (const compte of lot) {
      const inscritIlYA = Math.floor((maintenant.getTime() - compte.created_at.getTime()) / 86_400_000);

      if (simulation) {
        envoyes++;
        destinataires.push({ email: compte.email, inscritIlYA });
        continue;
      }

      // Exactement l'envoi de l'inscription : c'est lui qui décide de l'ouverture
      // d'après l'âge du compte, et lui qui refuse d'écrire deux fois.
      if (await envoyerBienvenue(this.prisma, compte)) envoyes++;
      else echecs++;
    }

    if (!simulation) {
      this.logger.log(`Rattrapage bienvenue : ${envoyes} envoyé(s), ${echecs} échec(s), ${aAccueillir - envoyes} restant(s)`);
    }

    return {
      simulation,
      aAccueillir,
      envoyes,
      echecs,
      // En simulation, rien n'est parti : ce qui « resterait » se compte comme si
      // le lot affiché avait été envoyé, sans quoi le chiffre ne décrirait pas la
      // tournée réelle que le bouton d'à côté déclenche.
      restants: aAccueillir - envoyes,
      ...(simulation ? { destinataires } : {}),
    };
  }

  /**
   * La taille d'un lot, bornée des deux côtés.
   *
   * Elle vient d'une adresse d'API : `?max=5000` est une frappe, pas une intention,
   * et elle ne doit pas pouvoir devenir un envoi de masse. Une valeur illisible
   * retombe sur le défaut plutôt que de lever — refuser la requête n'aiderait
   * personne, et on veut que le geste aboutisse sur un lot prudent.
   */
  static lotValide(brut: unknown): number {
    const n = Math.floor(Number(brut));
    if (!Number.isFinite(n) || n < 1) return RelanceEmailService.LOT_BIENVENUE_PAR_DEFAUT;
    return Math.min(n, RelanceEmailService.LOT_BIENVENUE_MAX);
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
