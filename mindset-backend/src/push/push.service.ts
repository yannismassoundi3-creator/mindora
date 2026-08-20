import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BriefEmailService } from './brief-email.service';
import { MorningBriefService } from './morning-brief.service';
import { WeeklyReviewService } from './weekly-review.service';
import { CoupDePouceService } from './coup-de-pouce.service';
import { BilanHebdoService } from './bilan-hebdo.service';
import { AnalyseHabitudesService } from './analyse-habitudes.service';
import { RappelService } from '../ai-coaching/rappel.service';
import * as cron from 'node-cron';
import * as webpush from 'web-push';
import { lienApp } from '../common/origines';
import { titreProgression } from './jauge';
import { aDesRoutines, tachesDuJour } from './taches';

/** Décompte d'une tournée de briefs, identique dans le log et dans la réponse HTTP. */
export interface ResumeTournee {
  personnalises: number;
  generiques: number;
  dormantsIgnores: number;
  echecs: number;
  comptesExamines: number;
  /** Briefs partis par e-mail, faute d'appareil joignable par notification. */
  parEmail: number;
}

/**
 * Décompte d'une tournée de coups de pouce.
 *
 * `riensADire` est le chiffre important, et il n'a pas d'équivalent dans les
 * briefs : c'est lui qui dit que le dispositif se retient. S'il tombe à zéro un
 * jour, c'est que la règle de cadence ne s'applique plus.
 */
export interface ResumeCoupsDePouce {
  envoyes: number;
  personnalises: number;
  riensADire: number;
  echecs: number;
  comptesExamines: number;
}

/** Trace de la dernière tournée, consultable après coup puisque l'envoi ne bloque plus. */
export interface TourneeTerminee {
  debut: string;
  fin: string;
  dureeMs: number;
  declencheur: string;
  resume: ResumeTournee | null;
  erreur: string | null;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  /**
   * Tournée en vol, partagée par le cron de 10h et le déclencheur manuel.
   *
   * Sans ce garde, deux tournées simultanées envoyaient deux notifications à chaque
   * personne et consommaient deux fois le quota du fournisseur. Le cas n'a rien de
   * théorique : la route manuelle existe justement pour rejouer la tâche, et un
   * double clic suffisait.
   */
  private tourneeEnCours: { promesse: Promise<ResumeTournee>; debut: number; declencheur: string } | null = null;
  private derniereTournee: TourneeTerminee | null = null;

  /**
   * Délai entre deux briefs, calibré pour rester sous les 30 requêtes par minute du
   * plan gratuit Groq (2,2 s ≈ 27 appels/min, appel du modèle compris). À 100
   * utilisateurs la tournée dure environ quatre minutes, ce qui reste sans effet
   * visible pour une notification de 10h.
   */
  private static readonly INTERVALLE_ENTRE_BRIEFS_MS = 2200;

  /**
   * Adresse ouverte au clic sur une notification.
   *
   * Six des sept notifications pointaient en dur vers mindset-elite.com, un domaine
   * qui ne résout plus : le check-in de 18h, les deux alertes de 20h, les deux de 22h
   * et le bilan hebdomadaire menaient toutes dans le vide. Seul le brief du matin
   * visait le vrai site. Une notification de relance qui n'ouvre rien est pire que
   * pas de notification : elle consomme l'attention et détruit la confiance.
   *
   * On passe par l'aide partagée, déjà utilisée par l'authentification et les
   * abonnements, pour qu'un changement de domaine n'ait plus à être répercuté à
   * six endroits — et pour qu'une `FRONTEND_URL` fausse ne puisse plus les
   * envoyer toutes dans le vide, ce qui est arrivé (voir `common/origines.ts`).
   */
  private lienApp(chemin = ''): string {
    return lienApp(chemin);
  }

  /**
   * Adresse qui ouvre l'app sur l'écran dont parle la notification.
   *
   * Toutes visaient la même page d'accueil, y compris celle qui demande
   * explicitement d'ouvrir le Chat IA. Le paramètre `vue` est lu au démarrage de
   * l'application ; `auth=true` reste indispensable pour que quelqu'un dont la
   * session a expiré tombe sur l'écran de connexion et non sur la page vitrine.
   */
  private lienVers(vue: 'dashboard' | 'chat' | 'objectives' | 'habits' = 'dashboard'): string {
    return this.lienApp(`/?auth=true&vue=${vue}`);
  }

  /**
   * Statuts qui donnent droit à la version enrichie du bilan.
   *
   * Recopiés de `AiQuotaService.PAID_STATUSES` plutôt qu'importés : le module push
   * ne dépend pas du module de coaching, et l'y accrocher pour deux chaînes créerait
   * un lien entre l'envoi des notifications et le quota d'IA. `TRIALING` en fait
   * partie — un abonné de sa première semaine paie déjà, à terme.
   */
  static readonly STATUTS_PAYANTS = ['ACTIVE', 'TRIALING'] as const;

  constructor(
    private prisma: PrismaService,
    private morningBrief: MorningBriefService,
    private weeklyReview: WeeklyReviewService,
    private coupDePouce: CoupDePouceService,
    private bilanHebdo: BilanHebdoService,
    private analyseHabitudes: AnalyseHabitudesService,
    // Les rappels que le coach a promis. Le seul envoi de ce fichier dont
    // l heure est choisie par la personne et non par nous.
    private rappels: RappelService,
    private readonly briefEmail: BriefEmailService,
  ) {
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:coach@disciplix.app';
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.logger.log('VAPID keys configured successfully for Web Push.');
    } else {
      this.logger.warn('VAPID keys missing in environment! Push notifications will fail.');
    }
  }

  async saveSubscription(userId: string, subscription: any, deviceId?: string) {
    // Un appareil ne doit avoir qu'une seule inscription active. Quand le navigateur
    // recrée son abonnement, l'endpoint change : on purge d'abord les anciennes lignes
    // du même appareil, sinon elles restent et l'utilisateur reçoit tout en double.
    if (deviceId) {
      await this.prisma.pushSubscription.deleteMany({
        where: {
          user_id: userId,
          // Les lignes sans device_id datent d'avant ce mécanisme : impossible de savoir
          // à quel appareil elles appartiennent, et ce sont elles qui provoquent les
          // doublons actuels. On les retire aussi. Un autre appareil encore sur
          // l'ancienne version se réinscrira tout seul à sa prochaine ouverture.
          OR: [{ device_id: deviceId }, { device_id: null }],
          endpoint: { not: subscription.endpoint },
        },
      });
    }

    await this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        user_id: userId,
        device_id: deviceId ?? undefined,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      create: {
        user_id: userId,
        endpoint: subscription.endpoint,
        device_id: deviceId ?? null,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });

    this.logger.log(`Saved push subscription for user ${userId}`);
    return { success: true };
  }

  /**
   * Réponses possibles du navigateur à la demande de notifications.
   *
   * `reporte` n'est pas un refus : c'est un « plus tard » dans notre propre carte,
   * avant que le navigateur n'ait été sollicité. La distinction est le cœur du sujet —
   * un « plus tard » se redemande, un refus navigateur ne se rattrape jamais.
   */
  static readonly ETATS_PERMISSION = ['accorde', 'refuse', 'non_supporte', 'ios_a_installer', 'reporte'];

  /**
   * Enregistre ce que l'appareil a répondu.
   *
   * Un refus ne laissait aucune trace : le code sortait sur un `console.warn` que
   * personne ne lit. On a appris que 26 comptes sur 28 étaient injoignables par le
   * décompte d'une tournée d'envoi, par accident.
   */
  async enregistrerPermission(userId: string, etat: string, deviceId?: string, plateforme?: string) {
    if (!PushService.ETATS_PERMISSION.includes(etat)) {
      throw new BadRequestException(
        `État inconnu « ${etat} ». Attendu : ${PushService.ETATS_PERMISSION.join(', ')}.`,
      );
    }

    // Une ligne par appareil : la même personne peut refuser sur son ordinateur et
    // accepter sur son téléphone, et c'est une information, pas un conflit.
    const appareil = (deviceId || 'inconnu').slice(0, 200);

    await this.prisma.pushPermission.upsert({
      where: { user_id_device_id: { user_id: userId, device_id: appareil } },
      create: { user_id: userId, device_id: appareil, etat, plateforme: plateforme?.slice(0, 200) || null },
      update: { etat, plateforme: plateforme?.slice(0, 200) || null },
    });

    return { enregistre: true, etat };
  }

  /** L'entonnoir complet : qui a été sollicité, qui a répondu quoi, qui reçoit. */
  async statistiquesPermissions() {
    const [parEtat, comptes, appareilsAbonnes, porteurs, repondants] = await Promise.all([
      this.prisma.pushPermission.groupBy({ by: ['etat'], _count: { _all: true } }),
      this.prisma.user.count(),
      this.prisma.pushSubscription.count(),
      this.prisma.pushSubscription.findMany({ distinct: ['user_id'], select: { user_id: true } }),
      this.prisma.pushPermission.findMany({ distinct: ['user_id'], select: { user_id: true } }),
    ]);

    const etats: Record<string, number> = {};
    for (const e of parEtat) etats[e.etat] = e._count._all;

    return {
      comptes,
      comptesJoignables: porteurs.length,
      appareilsAbonnes,
      etats,
      // Ni refus ni acceptation : ces comptes n'ont jamais vu la question, ce qui est
      // un problème d'interface, pas un choix des utilisateurs.
      comptesSansReponse: comptes - repondants.length,
    };
  }

  /**
   * Retourne le nombre d'appareils réellement atteints. Sans ça, l'appelant ne peut
   * pas distinguer « envoyé » de « personne n'était abonné », et annonce un succès
   * alors que rien n'est parti.
   */
  async sendNotification(userId: string, payload: any): Promise<{ abonnements: number; envoyees: number }> {
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { user_id: userId } });
    if (!subscriptions || subscriptions.length === 0) {
      this.logger.warn(`No push subscription found for user ${userId}`);
      return { abonnements: 0, envoyees: 0 };
    }

    let envoyees = 0;

    for (const sub of subscriptions) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      try {
        // Sans options, l'urgence vaut « normal » : Android peut alors ajourner la
        // remise jusqu'au prochain réveil du téléphone (mode Doze). Un rappel de
        // coaching daté n'a plus d'intérêt s'il arrive trois heures plus tard, d'où
        // « high ». Le TTL borne l'attente : mieux vaut perdre le brief de 10h que
        // le délivrer le lendemain, hors contexte.
        await webpush.sendNotification(pushSub, JSON.stringify(payload), {
          urgency: 'high',
          TTL: 6 * 3600,
        });
        envoyees++;
        this.logger.log(`Push notification sent successfully to user ${userId}`);
      } catch (error) {
        const statut = (error as any)?.statusCode;
        // "Received unexpected response code" ne dit pas lequel : sans le statut ni le
        // corps, impossible de distinguer un abonnement périmé d'une clé invalide.
        this.logger.error(
          `Push refusé pour ${userId} — statut ${statut ?? 'inconnu'} : ${(error as any)?.body || (error as any)?.message}`,
        );

        // 404/410 : l'abonnement n'existe plus chez le fournisseur.
        // 401/403 : signature refusée. Mozilla répond 401 « VAPID public key mismatch »
        //           pour un abonnement créé avec une ancienne clé, Chrome 403 ; dans les
        //           deux cas il ne redeviendra jamais valide, et le garder fait échouer
        //           chaque envoi indéfiniment.
        // On le supprime pour que le navigateur en recrée un propre à sa prochaine visite.
        if (statut === 404 || statut === 410 || statut === 403 || statut === 401) {
          // deleteMany plutôt que delete : sur une ligne déjà supprimée, delete lève
          // P2025. L'exception remontait alors jusqu'au cron et interrompait la
          // tournée entière — un abonnement périmé suffisait à priver tout le monde
          // de sa notification. Le nettoyage ne doit jamais faire échouer l'envoi.
          await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
          this.logger.log(`Abonnement obsolète supprimé pour ${userId} (statut ${statut})`);
        }
      }
    }

    return { abonnements: subscriptions.length, envoyees };
  }

  /**
   * Envoie les rappels arrives a echeance.
   *
   * `envoye_le` n est ecrit **qu apres** un envoi accepte. L ecrire avant, ou en
   * cas d echec, condamnerait le rappel au silence en donnant a croire qu il est
   * parti — exactement la panne qu on repare ici. Un rappel trop en retard n est
   * pas envoye du tout : il reveillerait une intention morte et apprendrait
   * surtout que l application n est pas a l heure.
   */
  async envoyerRappels() {
    await this.rappels.abandonnerLesPerimes();
    const dus = await this.rappels.dus();
    if (dus.length === 0) return { dus: 0, envoyes: 0 };

    let envoyes = 0;
    for (const r of dus) {
      try {
        const { envoyees } = await this.sendNotification(r.user_id, {
          title: '⏰ Rappel',
          body: r.texte,
          url: this.lienVers(),
          /*
            Un tag par rappel, jamais un tag « rappel » commun : chacun porte un
            texte que personne d'autre ne porte, et les fondre ferait disparaître
            celui de 22 h 30 sous celui de 23 h. La persistance, en revanche, est
            ici et nulle part ailleurs : c'est la personne qui a fixé cette heure,
            et une notification qu'elle a demandée ne doit pas s'évaporer avant
            qu'elle regarde son téléphone.
          */
          tag: `rappel-${r.id}`,
          persistante: true,
        });

        if (envoyees > 0) {
          await this.rappels.marquerEnvoye(r.id);
          envoyes++;
        } else {
          // Aucun abonnement joignable : la ligne reste ouverte et la tournee
          // suivante reessaiera, jusqu a la borne de retard. Un telephone eteint
          // cinq minutes ne doit pas couter le rappel.
          this.logger.warn('Rappel ' + r.id + ' non remis a ' + r.user_id + ' : aucun abonnement joignable.');
        }
      } catch (e) {
        // Un echec sur une personne ne doit pas interrompre les suivantes.
        this.logger.error('Rappel ' + r.id + ' echoue pour ' + r.user_id + ' : ' + (e as any)?.message);
      }
    }

    this.logger.log('Rappels : ' + envoyes + '/' + dus.length + ' remis.');
    return { dus: dus.length, envoyes };
  }

  onModuleInit() {
    // Une exception dans une tâche planifiée est avalée en silence : ni notification,
    // ni trace. C'est exactement ce qui rend un envoi manqué indiagnosticable le
    // lendemain. Chaque tâche journalise son début, sa fin, et toute erreur.
    const planifier = (expression: string, nom: string, action: () => Promise<any>) => {
      cron.schedule(expression, async () => {
        this.logger.log(`[CRON] ${nom} — démarrage`);
        try {
          await action();
          this.logger.log(`[CRON] ${nom} — terminé`);
        } catch (e) {
          this.logger.error(`[CRON] ${nom} — ÉCHEC : ${(e as any)?.message}`, (e as any)?.stack);
        }
      }, { timezone: 'Europe/Paris' });
      // Tracé au démarrage : si cette ligne manque, la tâche n'a jamais été programmée.
      this.logger.log(`[CRON] ${nom} programmé (${expression}, Europe/Paris)`);
    };

    /*
      Le brief part a l heure de reveil de chacun, pas a 10 h pour tout le monde.

      La tache passe toutes les demi-heures et ne sert que les comptes dont l heure
      declaree tombe dans le creneau. Qui n a rien regle garde 10 h — exactement ce
      qu il recevait avant, sans avoir a repondre a quoi que ce soit.

      **Le garde anti-chevauchement joue ici aussi** : une tournee qui deborde de
      trente minutes ferait raccrocher la suivante a celle en cours, et le creneau
      d apres serait saute. C est peu probable — chaque creneau ne sert qu une
      fraction des comptes — mais ca se lirait dans les journaux, pas a l ecran.
    */
    planifier('*/30 * * * *', 'Briefs du matin', () =>
      this.sendMorningBriefs('cron', PushService.creneauCourant()),
    );
    planifier('0 18 * * *', 'Check-in 18h', () =>
      this.sendBulkReminders(
        'Check-in de 18h 🎯',
        'Voilà où tu en es. Il te reste la soirée pour finir.',
        true,
      ));
    /*
      Le coup de pouce tourne à 15 h, entre le brief du matin et le check-in du
      soir : c'est le moment où une journée peut encore être rattrapée, et le seul
      créneau de la journée qui ne soit pas déjà occupé. La plupart des comptes
      examinés ne recevront rien — voir `CoupDePouceService`, où le silence est la
      réponse par défaut.
    */
    planifier('0 15 * * *', 'Coups de pouce 15h', () => this.envoyerCoupsDePouce());
    planifier('0 20 * * *', 'Alerte série 20h', () => this.checkStreaksAndWarn(20));
    planifier('0 22 * * *', 'Dernière chance 22h', () => this.checkStreaksAndWarn(22));
    planifier('0 20 * * 0', 'Bilan hebdomadaire', () => this.sendWeeklyReports());

    /*
      Les rappels, toutes les cinq minutes.

      C'est la seule tache dont l'heure est choisie par la personne et non par
      nous : elle a dit « 22 h 30 », elle attend 22 h 30. Un passage horaire
      decalerait la moitie des rappels d'une demi-heure, ce qui, pour une
      promesse datee, revient a ne pas la tenir.

      Cinq minutes coutent une requete indexee qui ne rend presque jamais rien :
      la table est petite et la fenetre etroite. Voir RappelService.dus.
    */
    planifier('*/5 * * * *', 'Rappels', () => this.envoyerRappels());
  }

  /**
   * Le coup de pouce, pour affichage dans l'application.
   *
   * Le moteur existait déjà, mais il ne voyageait que par notification : quelqu'un
   * qui refuse les notifications ne l'a **jamais** vu. C'est le cas de la majorité
   * des comptes — et c'est un utilisateur qui l'a signalé sans le savoir, en
   * réclamant « un petit truc qui donne une chose à faire » sur la page des
   * objectifs, une fonction qu'il possédait déjà sans pouvoir la recevoir.
   *
   * **Deux différences avec l'envoi, et la règle essentielle conservée.**
   *
   * Le délai de trois jours ne s'applique pas ici. Il existe parce qu'une
   * notification s'impose : elle interrompt, et trop d'interruptions font couper
   * le canal pour de bon — le seul dommage irréversible de toute l'affaire. Une
   * carte sur une page qu'on a choisi d'ouvrir n'interrompt personne ; l'y
   * appliquer cacherait une information utile pendant trois jours sans aucune
   * contrepartie. D'où `dernierCoupDePouce: null`.
   *
   * Le texte n'est pas écrit par l'IA. Cette carte se calcule à chaque ouverture
   * de page : un appel au modèle coûterait un quota déjà tendu, ajouterait une
   * seconde d'attente et échouerait quand le fournisseur sature — pour une phrase
   * que `texteFactuel` compose depuis les mêmes données, sans jamais rien inventer.
   *
   * Ce qui reste, et qui est tout : **on ne dit rien s'il n'y a pas de fait**.
   * `situation()` rend `null` la plupart du temps, volontairement. Une carte qui
   * trouve toujours quelque chose à conseiller devient un bandeau qu'on ne lit
   * plus au bout de trois jours.
   */
  async coupDePouceAAfficher(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { first_name: true, sync_data: true },
    });

    if (!user) return { afficher: false as const };

    const situation = this.coupDePouce.situation({
      dailyScores: user.sync_data?.daily_scores as Record<string, number> | null,
      routines: user.sync_data?.routines,
      jourDesRoutines: user.sync_data?.last_routine_date,
      objectifs: user.sync_data?.micro_objectives,
      dernierCoupDePouce: null,
      derniereSynchro: user.sync_data?.updated_at ?? null,
    });

    if (!situation) return { afficher: false as const };

    return {
      afficher: true as const,
      raison: situation.raison,
      texte: this.coupDePouce.texteFactuel(user.first_name, situation),
      /*
        La tâche elle-même, telle que la personne l'a écrite. C'est ce qui sépare
        une carte utile d'un encouragement : elle nomme une chose précise, qui
        existe déjà dans ses listes. Jamais une action inventée — « fais 20
        pompes » chez quelqu'un dont le plan n'en prévoit pas se lit comme un
        reproche, et contredit le plan que le coach a lui-même écrit.
      */
      action: situation.restantes[0] ?? null,
      serie: situation.serie,
    };
  }

  /**
   * La tournée des coups de pouce.
   *
   * Elle ressemble à celle du matin, à une différence près qui est tout l'intérêt
   * du dispositif : ici, ne rien envoyer est le cas normal. Le décompte distingue
   * donc « personne à qui écrire » de « échec », sans quoi une tournée muette et
   * une tournée cassée se ressembleraient dans les logs — et c'est précisément le
   * genre de panne qu'on ne voit jamais.
   */
  async envoyerCoupsDePouce(): Promise<ResumeCoupsDePouce> {
    const users = await this.prisma.user.findMany({
      where: { deleted_at: null },
      include: {
        push_subscriptions: true,
        sync_data: true,
        coup_de_pouce: true,
      },
    });

    let envoyes = 0;
    let personnalises = 0;
    let riensADire = 0;
    let echecs = 0;

    for (const user of users) {
      // Injoignable : inutile de calculer quoi que ce soit, et surtout inutile de
      // payer un appel IA pour un message que personne ne recevra.
      if (!user.push_subscriptions?.length) continue;

      const situation = this.coupDePouce.situation({
        dailyScores: user.sync_data?.daily_scores as Record<string, number> | null,
        routines: user.sync_data?.routines,
        jourDesRoutines: user.sync_data?.last_routine_date,
        objectifs: user.sync_data?.micro_objectives,
        dernierCoupDePouce: user.coup_de_pouce?.dernier_envoi ?? null,
        derniereSynchro: user.sync_data?.updated_at ?? null,
      });

      if (!situation) {
        riensADire++;
        continue;
      }

      // Même cadence que les briefs : le fournisseur limite à une trentaine
      // d'appels par minute, et se faire couper à mi-tournée priverait la seconde
      // moitié de la personnalisation sans que rien ne le signale.
      if (envoyes > 0) {
        await new Promise((r) => setTimeout(r, PushService.INTERVALLE_ENTRE_BRIEFS_MS));
      }

      try {
        const texte = await this.coupDePouce.generer(user.first_name, situation);
        const body = texte ?? this.coupDePouce.texteFactuel(user.first_name, situation);

        const envoi = await this.sendNotification(user.id, {
          title: this.coupDePouce.titre(situation),
          tag: 'coup-de-pouce',
          body,
          // Une reprise se joue dans la conversation, pas sur un tableau de bord :
          // quelqu'un qui a décroché a besoin de redécider quoi faire, ce qui est
          // exactement ce que le chat sait faire.
          url: this.lienVers(situation.raison === 'reprise' ? 'chat' : 'dashboard'),
        });

        // La trace n'est écrite que si l'envoi a atteint un appareil. Un échec
        // réseau qui consommerait quand même le quota de trois jours ferait taire
        // le coach sans que personne n'ait rien reçu.
        if (envoi.envoyees > 0) {
          await this.prisma.coupDePouce.upsert({
            where: { user_id: user.id },
            create: {
              user_id: user.id,
              dernier_envoi: new Date(),
              derniere_raison: situation.raison,
              envoyes: 1,
            },
            update: {
              dernier_envoi: new Date(),
              derniere_raison: situation.raison,
              envoyes: { increment: 1 },
            },
          });
          envoyes++;
          if (texte) personnalises++;
        }
      } catch (e) {
        echecs++;
        this.logger.error(
          `Coup de pouce échoué pour ${user.id} : ${(e as any)?.message}`,
          (e as any)?.stack,
        );
      }
    }

    this.logger.log(
      `Coups de pouce : ${envoyes} envoyé(s) dont ${personnalises} écrit(s) par l'IA, ` +
        `${riensADire} compte(s) sans rien à dire, ${echecs} échec(s)`,
    );

    return { envoyes, personnalises, riensADire, echecs, comptesExamines: users.length };
  }

  /**
   * Le coup de pouce d'une seule personne, en ignorant la cadence.
   *
   * Sert à voir ce que le dispositif produit sans attendre trois jours. La cadence
   * est court-circuitée mais rien d'autre : si la situation ne justifie aucun
   * message, la réponse le dit au lieu d'en inventer un — c'est justement ce qu'on
   * veut pouvoir vérifier.
   */
  async testerCoupDePouce(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sync_data: true },
    });
    if (!user) return { envoye: false, message: 'Utilisateur introuvable.' };

    const situation = this.coupDePouce.situation({
      dailyScores: user.sync_data?.daily_scores as Record<string, number> | null,
      routines: user.sync_data?.routines,
      jourDesRoutines: user.sync_data?.last_routine_date,
      objectifs: user.sync_data?.micro_objectives,
      dernierCoupDePouce: null,
      derniereSynchro: user.sync_data?.updated_at ?? null,
    });

    if (!situation) {
      return {
        envoye: false,
        raison: null,
        message:
          "Rien à dire à ce compte aujourd'hui : pas d'absence récente, pas de tâche en attente, " +
          "pas de série à défendre. C'est le comportement attendu — le coup de pouce se tait par défaut.",
      };
    }

    const texte = await this.coupDePouce.generer(user.first_name, situation);
    const body = texte ?? this.coupDePouce.texteFactuel(user.first_name, situation);
    const envoi = await this.sendNotification(user.id, {
      title: this.coupDePouce.titre(situation),
      tag: 'coup-de-pouce',
      body,
      url: this.lienVers(situation.raison === 'reprise' ? 'chat' : 'dashboard'),
    });

    return {
      envoye: envoi.envoyees > 0,
      raison: situation.raison,
      personnalise: !!texte,
      message: body,
      abonnements: envoi.abonnements,
      appareilsAtteints: envoi.envoyees,
      ...(envoi.abonnements === 0 && {
        diagnostic:
          "Aucun appareil abonné aux notifications. Ouvre l'app et autorise les notifications, puis relance ce test.",
      }),
    };
  }

  async checkStreaksAndWarn(hour: number) {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true, sync_data: true }
    });

    const today = new Date().toISOString().slice(0, 10);
    const dYesterday = new Date();
    dYesterday.setDate(dYesterday.getDate() - 1);
    const yesterday = dYesterday.toISOString().slice(0, 10);

    for (const user of users) {
      if (!user.push_subscriptions || user.push_subscriptions.length === 0) continue;
      
      const scores = (user.sync_data?.daily_scores as Record<string, number>) || {};
      const scoreToday = scores[today] || 0;
      const scoreYesterday = scores[yesterday] || 0;
      
      // Calculate missed consecutive days
      let missedDays = 0;
      for (let i = 0; i < 4; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        if (!scores[dateStr] || scores[dateStr] === 0) {
          missedDays++;
        } else {
          break; // Streak is alive at some point in the last 4 days
        }
      }

      // Le titre porte l'état du jour plutôt qu'une interjection.
      //
      // « Attention ! 😡 » ne dit rien qu'on ne sache déjà en voyant l'expéditeur, et
      // ne se distingue pas de la notification de la veille. La jauge, elle, se lit
      // sans déverrouiller et n'est jamais deux fois la même — c'est ce que fait la
      // barre de Duolingo. Une notification web ne peut pas être animée, mais elle
      // peut au moins dire où en est la personne. Voir `jauge.ts`.
      // Calculée à la demande : la plupart des comptes examinés ne reçoivent rien ce
      // soir-là, et parcourir leur historique pour un titre qu'on n'enverra pas se
      // paie sur toute la base à chaque tournée.
      const progression = () => titreProgression(scoreToday, this.morningBrief.computeStreak(scores));

      /*
        Ce qui reste à cocher ce soir.

        Jusqu'ici ces deux tournées ne savaient qu'avertir : toutes leurs branches
        partent de `scoreToday === 0` ou d'un nombre de jours manqués. Quelqu'un
        qui bouclait sa journée ne recevait donc **rien** — le produit ne parlait
        qu'à ceux qui échouaient, ce qui est l'inverse de ce qu'on demande à un
        coach.
      */
      const taches = tachesDuJour(user.sync_data);
      const avaitQuelqueChose = taches.restantes.length + taches.faites.length > 0;
      const journeePleine = avaitQuelqueChose && taches.restantes.length === 0;

      // Comme pour le brief du matin : un échec sur une personne ne doit pas
      // interrompre la tournée des suivantes.
      try {
        if (hour === 20) {
          if (missedDays >= 4) {
            // AI Dynamic Adjustment Prompt
            await this.sendNotification(user.id, {
              title: '🤖 Coach IA : Stratégie',
              tag: 'progression',
              body: 'Je remarque que tu as du mal depuis quelques jours. Ouvre le Chat IA pour réduire la difficulté de tes objectifs.',
              url: this.lienVers('chat')
            });
          } else if (journeePleine) {
            /*
              La félicitation, et le seul moment de la journée où elle a un sens.

              À 18 h la journée peut encore bouger ; à 22 h il est trop tard pour
              que ça serve à autre chose qu'à réveiller quelqu'un. 20 h est l'heure
              où c'est fini et où le téléphone est encore en main.

              Le nombre de jours est dit quand il existe, jamais inventé : « bravo »
              tout seul est ce qu'on écrit quand on n'a rien regardé, et ça se sent.
              `computeStreak` repart d'hier, d'où le +1 : la journée qu'on est en
              train de féliciter n'y est pas encore comptée.
            */
            const serie = this.morningBrief.computeStreak(scores);
            await this.sendNotification(user.id, {
              title: progression(),
              tag: 'progression',
              body:
                serie >= 2
                  ? `Journée pleine. Ça fait ${serie + 1} jours d'affilée.`
                  : 'Journée pleine. Tout ce que tu avais prévu est coché.',
              url: this.lienVers()
            });
          } else if (scoreToday === 0 && scoreYesterday > 0) {
            // Warning 1st day miss
            await this.sendNotification(user.id, {
              title: progression(),
              tag: 'progression',
              body: "Rien de coché aujourd'hui, et tu avais tenu hier. Il te reste la soirée.",
              url: this.lienVers()
            });
          }
        } else if (hour === 22) {
          /*
            Les deux branches étaient inversées par rapport à la réalité de la série.

            `missedDays === 2` veut dire : rien aujourd'hui **et** rien hier. Or
            `computeStreak` repart d'hier — la série est donc déjà à zéro depuis
            la veille au soir. « Ta série va disparaître à minuit » y était
            simplement faux, doublé d'un « dernier avertissement » que rien ne
            justifiait. C'est le registre que le produit a retiré partout ailleurs
            (fausse rareté, majuscules criées) et qui avait survécu ici.

            Le seul soir où une série meurt vraiment à minuit, c'est l'autre
            branche : rien aujourd'hui, mais quelque chose hier. Elle ne le disait
            pas. L'urgence était donc criée le soir où elle n'existe plus, et tue le
            soir où elle existe.
          */
          if (missedDays === 2) {
            await this.sendNotification(user.id, {
              title: progression(),
              tag: 'progression',
              body: "Deux jours sans rien cocher. Une seule case ce soir, et tu repars.",
              url: this.lienVers()
            });
          } else if (scoreToday === 0 && scoreYesterday > 0) {
            const serie = this.morningBrief.computeStreak(scores);
            await this.sendNotification(user.id, {
              title: progression(),
              tag: 'progression',
              body:
                serie >= 2
                  ? `Ta série de ${serie} jours s'arrête à minuit. Une case suffit à la garder.`
                  : 'Deux heures avant minuit. Valide ce que tu as fait avant de dormir.',
              url: this.lienVers()
            });
          }
        }
      } catch (e) {
        this.logger.error(
          `Alerte série ${hour}h échouée pour ${user.id} : ${(e as any)?.message}`,
          (e as any)?.stack,
        );
      }
    }
  }

  /**
   * Le bilan du dimanche soir.
   *
   * Il annonçait à tout le monde la même phrase — « Voici ton plan d'attaque pour
   * lundi. Ouvre l'app pour le découvrir ! » — alors que rien ne préparait ce plan.
   * Une notification qui promet ce qui n'existe pas apprend surtout à ne plus les
   * ouvrir. Elle citait par ailleurs le score mental du jour, c'est-à-dire celui
   * d'un dimanche soir, présenté comme un bilan de semaine.
   *
   * Chacun reçoit désormais ses vrais chiffres, et les abonnés reçoivent en plus
   * la lecture qu'en fait leur coach. C'est le seul avantage de l'abonnement qui se
   * voie sans ouvrir l'application — et il n'enlève rien à personne.
   */
  async sendWeeklyReports() {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true, sync_data: true, subscription: true },
    });

    let envoyes = 0;
    let ignores = 0;
    let lecturesPreparees = 0;
    let appelsIA = 0;

    for (const user of users) {
      if (!user.push_subscriptions || user.push_subscriptions.length === 0) continue;

      // Une exception par personne ne doit pas arrêter la tournée : c'est ce qui
      // avait déjà fait taire l'envoi du matin pour tout le monde.
      try {
        const semaine = this.weeklyReview.resumerSemaine(
          user.sync_data?.daily_scores as any,
          user.sync_data?.habits as any,
        );

        // Rien à raconter : envoyer « 0 jour actif, score moyen 0 % » à quelqu'un qui
        // n'a rien fait de la semaine est un reproche, pas un service.
        if (!semaine) {
          ignores++;
          continue;
        }

        const prenom = user.first_name || '';
        const abonne = (PushService.STATUTS_PAYANTS as readonly string[]).includes(
          user.subscription?.status ?? '',
        );

        /*
          Deux appels au modèle pour un abonné, espacés comme dans la tournée du
          matin : le fournisseur limite à une trentaine de requêtes par minute, et
          se faire couper à mi-parcours priverait la seconde moitié des abonnés de
          leur lecture sans que rien ne le signale.
        */
        if (abonne && appelsIA > 0) {
          await new Promise((r) => setTimeout(r, PushService.INTERVALLE_ENTRE_BRIEFS_MS));
        }

        const texte =
          (abonne ? await this.weeklyReview.generate(prenom, semaine) : null) ??
          this.weeklyReview.texteFactuel(prenom, semaine);
        if (abonne) appelsIA++;

        await this.sendNotification(user.id, {
          title: '📊 Bilan de ta semaine',
          tag: 'bilan',
          body: texte,
          url: this.lienVers(abonne ? 'chat' : 'dashboard'),
        });
        envoyes++;

        /*
          La lecture longue est préparée maintenant, pas à l'ouverture de l'écran.

          La notification qu'on vient d'envoyer est précisément ce qui ramène les
          gens dans l'application : la calculer à leur arrivée leur ferait attendre
          un aller-retour vers le modèle au moment le plus mal choisi. Elle est
          mise en cache par `BilanHebdoService`, le même que celui de l'écran —
          l'abonné qui ouvre son tableau de bord la trouve déjà écrite.

          Après l'envoi, et non avant : un échec de génération ne doit jamais
          empêcher la notification de partir. C'est elle qui compte le plus.
        */
        if (abonne) {
          await new Promise((r) => setTimeout(r, PushService.INTERVALLE_ENTRE_BRIEFS_MS));
          appelsIA++;
          const lecture = await this.bilanHebdo
            .lecture(
              user.id,
              prenom,
              semaine,
              // Le meme levier que l'ecran : les deux appelants partagent le cache de
              // BilanHebdoService, et deux entrees differentes rendraient deux textes
              // pour la meme semaine selon la porte par laquelle on arrive.
              this.analyseHabitudes.analyser(
                user.sync_data?.daily_scores as any,
                user.sync_data?.habits as any,
              ).levier,
            )
            .catch((e) => {
              this.logger.warn(`Lecture hebdo non préparée pour ${user.id} : ${e?.message}`);
              return null;
            });
          if (lecture) lecturesPreparees++;
        }
      } catch (e) {
        this.logger.error(`Bilan hebdomadaire échoué pour ${user.id} : ${(e as any)?.message}`);
      }
    }

    this.logger.log(
      `[Bilan hebdo] ${envoyes} envoyé(s), ${ignores} sans activité cette semaine, ` +
        `${lecturesPreparees} lecture(s) d'abonné préparée(s) d'avance`,
    );
    return { envoyes, ignores, lecturesPreparees };
  }

  /**
   * Rappel du matin, écrit par l'IA à partir des données de chaque personne.
   *
   * Les comptes dormants sont ignorés : générer un message coûte un appel IA, et
   * relancer quelqu'un parti depuis des semaines avec un texte personnalisé ne le
   * fera pas revenir. Si l'IA est indisponible, on retombe sur le message générique
   * plutôt que de ne rien envoyer.
   */
  async sendMorningBriefs(declencheur = 'cron', creneau?: string): Promise<ResumeTournee> {
    // Une tournée déjà en vol est réutilisée plutôt que doublée : l'appelant obtient
    // le résultat de celle qui tourne, et personne ne reçoit deux notifications.
    if (this.tourneeEnCours) {
      this.logger.warn(
        `Tournée des briefs déjà en cours (déclenchée par « ${this.tourneeEnCours.declencheur} ») : ` +
          `l'appel « ${declencheur} » se raccroche à celle-là au lieu d'en lancer une seconde.`,
      );
      return this.tourneeEnCours.promesse;
    }

    const debut = Date.now();
    const promesse = this.executerTourneeBriefs(creneau);
    this.tourneeEnCours = { promesse, debut, declencheur };

    try {
      const resume = await promesse;
      this.enregistrerTournee(debut, declencheur, resume, null);
      return resume;
    } catch (e) {
      this.enregistrerTournee(debut, declencheur, null, (e as any)?.message ?? String(e));
      throw e;
    } finally {
      this.tourneeEnCours = null;
    }
  }

  private enregistrerTournee(
    debut: number,
    declencheur: string,
    resume: ResumeTournee | null,
    erreur: string | null,
  ) {
    const fin = Date.now();
    this.derniereTournee = {
      debut: new Date(debut).toISOString(),
      fin: new Date(fin).toISOString(),
      dureeMs: fin - debut,
      declencheur,
      resume,
      erreur,
    };
  }

  /**
   * Lance la tournée sans l'attendre, et rend la main tout de suite.
   *
   * À 2,2 s par personne, la tournée dure quatre minutes pour cent comptes actifs :
   * bien au-delà de ce qu'un client HTTP — et le routeur de Render devant lui —
   * accepte de garder ouvert. La réponse partait donc en délai dépassé alors que
   * l'envoi se poursuivait, ce qui donnait à croire à un échec. Le décompte se lit
   * ensuite sur `GET /push/morning-brief/status`.
   */
  declencherTourneeBriefs(declencheur = 'manuel') {
    const dejaEnCours = !!this.tourneeEnCours;

    // Les erreurs par personne sont déjà rattrapées dans la boucle ; ce catch ne vise
    // que l'échec global (lecture de la base). Sans lui, l'exception d'une promesse
    // que plus personne n'attend ferait tomber le process Node.
    void this.sendMorningBriefs(declencheur).catch((e) =>
      this.logger.error(`Tournée des briefs interrompue : ${(e as any)?.message}`, (e as any)?.stack),
    );

    return {
      demarre: !dejaEnCours,
      dejaEnCours,
      message: dejaEnCours
        ? "Une tournée était déjà en cours : rien de neuf n'a été lancé, personne ne recevra de doublon."
        : "Tournée lancée en arrière-plan. Le décompte arrive sur GET /push/morning-brief/status.",
      suivi: 'GET /push/morning-brief/status',
    };
  }

  /** État courant et résultat de la dernière tournée, cron compris. */
  etatTournee() {
    return {
      enCours: !!this.tourneeEnCours,
      ...(this.tourneeEnCours && {
        depuisMs: Date.now() - this.tourneeEnCours.debut,
        declencheur: this.tourneeEnCours.declencheur,
      }),
      derniereTournee: this.derniereTournee,
    };
  }

  /** L heure par defaut du brief, pour qui n a rien regle. C est celle d avant. */
  static readonly REVEIL_PAR_DEFAUT = '10:00';

  /** Largeur d un creneau, en minutes. Doit diviser 60 : le cron est une demi-heure. */
  static readonly CRENEAU_MINUTES = 30;

  /**
   * Le creneau courant, en heure de Paris, sous la forme « HH:MM ».
   *
   * Le serveur tourne en UTC : compare a une heure locale, il enverrait les briefs
   * avec deux heures de decalage en ete, tous les jours, sans rien signaler. Meme
   * piege que les rappels dates, et il se paie ici sur tout le monde a la fois.
   */
  static creneauCourant(maintenant = new Date()): string {
    const hhmm = maintenant.toLocaleTimeString('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
    });
    const [h, m] = hhmm.split(':').map(Number);
    const debut = Math.floor(m / PushService.CRENEAU_MINUTES) * PushService.CRENEAU_MINUTES;
    return String(h).padStart(2, '0') + ':' + String(debut).padStart(2, '0');
  }

  /**
   * Vrai quand l heure de reveil declaree tombe dans ce creneau.
   *
   * On arrondit vers le bas plutot que d exiger une correspondance exacte : quelqu un
   * qui reglerait 7 h 15 ne recevrait jamais rien avec une egalite stricte, et il n y
   * a aucun moyen pour lui de le deviner. Un quart d heure d avance vaut mieux qu un
   * silence.
   */
  static dansLeCreneau(reveil: string | null | undefined, creneau: string): boolean {
    const brut = (reveil ?? PushService.REVEIL_PAR_DEFAUT).trim();
    const valide = /^([01]\d|2[0-3]):([0-5]\d)$/.test(brut);
    // Une valeur abimee retombe sur le defaut : elle ne doit pas priver quelqu un
    // de son brief, ni le lui envoyer a une heure inventee.
    const heure = valide ? brut : PushService.REVEIL_PAR_DEFAUT;

    const [h, m] = heure.split(':').map(Number);
    const debut = Math.floor(m / PushService.CRENEAU_MINUTES) * PushService.CRENEAU_MINUTES;
    return String(h).padStart(2, '0') + ':' + String(debut).padStart(2, '0') === creneau;
  }

  private async executerTourneeBriefs(creneau?: string): Promise<ResumeTournee> {
    const tous = await this.prisma.user.findMany({
      include: { push_subscriptions: true, sync_data: true, ai_profile: { select: { reveil: true } } },
    });

    /*
      Le creneau filtre la tournee.

      Sans creneau — le declencheur manuel d administration — tout le monde est
      servi, ce qui reste le comportement attendu quand on rejoue une tournee a la
      main : on veut la voir partir, pas attendre la bonne demi-heure.
    */
    const users = creneau
      ? tous.filter((u) => PushService.dansLeCreneau((u as any).ai_profile?.reveil, creneau))
      : tous;

    let personnalises = 0;
    let generiques = 0;
    let ignores = 0;
    let echecs = 0;
    let parEmail = 0;

    for (const user of users) {
      /*
        Le compte dormant est écarté avant le choix du canal, et non après.

        Cette vérification venait après le filtre des abonnements : quelqu'un de
        dormant et sans appareil joignable sortait donc par la première porte,
        sans être compté nulle part. Maintenant que l'absence d'appareil ouvre une
        seconde voie, l'ordre décide de qui reçoit un e-mail — et personne ne doit
        en recevoir un pour avoir cessé de venir. La relance existe pour ça.
      */
      if (!this.morningBrief.isActive(user.sync_data?.updated_at)) {
        ignores++;
        continue;
      }

      /*
        Sans appareil joignable, le brief part par e-mail.

        C'est la moitié du produit qui se rejoue ici : 6 personnes sur 52 étaient
        joignables par notification le 20 août 2026, et le brief du matin est le
        seul mécanisme conçu pour créer un deuxième jour.

        **Rien ne part si le modèle n'a rien écrit.** Une notification générique
        vaut mieux que pas de notification — elle passe, on la lit, on l'oublie.
        Un e-mail générique quotidien, en revanche, c'est le même texte tous les
        matins dans la même boîte : le signalement pour indésirable est mérité, et
        il coûterait le domaine entier.
      */
      if (!user.push_subscriptions?.length) {
        /*
          L'e-mail ne part que sur une tournée planifiée.

          Sans créneau, la tournée sert **tout le monde** : c'est le déclencheur
          manuel du panneau d'administration, et c'est le comportement attendu
          quand on veut voir une tournée partir. Une notification envoyée à
          contretemps se remarque à peine ; quarante-six e-mails d'un seul geste,
          hors de l'heure choisie par chacun et depuis un domaine sans historique,
          c'est le signalement pour indésirable garanti.

          Pour vérifier ce chemin, `sendMorningBriefTo` l'emprunte sur une seule
          personne — voir plus bas.
        */
        if (!creneau) continue;
        if (!BriefEmailService.creneauActif('matin')) continue;

        if (personnalises + generiques + parEmail > 0) {
          await new Promise((r) => setTimeout(r, PushService.INTERVALLE_ENTRE_BRIEFS_MS));
        }

        try {
          const texte = await this.morningBrief.generate(user.first_name, user.sync_data);
          if (texte && (await this.briefEmail.envoyer(user, 'matin', texte))) parEmail++;
        } catch (e) {
          echecs++;
          this.logger.error(
            `Brief du matin par e-mail échoué pour ${user.id} : ${(e as any)?.message}`,
            (e as any)?.stack,
          );
        }
        continue;
      }

      // La boucle envoyait aussi vite que le modèle répondait, soit une quarantaine
      // d'appels par minute — au-dessus de ce que le fournisseur autorise. Elle se
      // faisait donc limiter à mi-parcours et le reste des utilisateurs recevait le
      // message générique. Espacer les appels rend la tournée plus lente et complète,
      // ce qui est le bon compromis pour une notification à heure fixe.
      if (personnalises + generiques > 0) {
        await new Promise((r) => setTimeout(r, PushService.INTERVALLE_ENTRE_BRIEFS_MS));
      }

      // Chaque personne est isolée : une requête en échec sur l'une d'elles ne doit
      // pas priver toutes les suivantes de leur brief. La boucle n'avait aucun garde,
      // si bien qu'une seule exception vidait la tournée en silence.
      try {
        const resultat = await this.sendMorningBriefTo(user.id);
        if (resultat.personnalise) personnalises++;
        else generiques++;
      } catch (e) {
        echecs++;
        this.logger.error(
          `Brief du matin échoué pour ${user.id} : ${(e as any)?.message}`,
          (e as any)?.stack,
        );
      }
    }

    this.logger.log(
      `Briefs du matin : ${personnalises} personnalisé(s), ${generiques} générique(s), ` +
        `${parEmail} par e-mail, ${ignores} compte(s) dormant(s) ignoré(s), ${echecs} échec(s)`,
    );

    // Renvoyé pour que le suivi de tournée expose le même décompte que le log.
    return {
      personnalises,
      generiques,
      parEmail,
      dormantsIgnores: ignores,
      echecs,
      comptesExamines: users.length,
    };
  }

  /**
   * Un seul brief. Partagé par le cron et l'endpoint de test, pour que ce qui est
   * testé soit exactement ce qui part le matin.
   */
  async sendMorningBriefTo(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sync_data: true },
    });
    if (!user) return { envoye: false, personnalise: false, message: 'Utilisateur introuvable.' };

    const texte = await this.morningBrief.generate(user.first_name, user.sync_data);
    const body = texte ?? "Tes objectifs t'attendent, c'est l'heure de commencer ta journée.";

    /*
      Le test d'une seule personne emprunte le vrai chemin.

      Quelqu'un sans appareil joignable recevait ici un diagnostic — « aucun
      abonnement, autorise les notifications » — alors que le produit sait
      désormais lui écrire. Tester le brief sur soi doit exercer le chemin qu'on
      recevra réellement, sinon le test ne prouve rien de ce qui part le matin.
    */
    const abonnements = await this.prisma.pushSubscription.count({ where: { user_id: user.id } });
    if (abonnements === 0 && texte) {
      const parEmail = await this.briefEmail.envoyer(user, 'matin', texte);
      return {
        envoye: parEmail,
        personnalise: true,
        message: body,
        abonnements: 0,
        appareilsAtteints: 0,
        canal: 'email',
        ...(!parEmail && {
          diagnostic:
            "Aucun appareil joignable, et l'e-mail n'est pas parti : créneau éteint, brief déjà envoyé aujourd'hui, ou retrait demandé.",
        }),
      };
    }

    const envoi = await this.sendNotification(user.id, {
      title: texte ? '🎯 Ton brief du jour' : 'Réveil ! ☀️',
      body,
      // Un brief par jour : si un second partait, il remplacerait le premier au
      // lieu de s'empiler dessus.
      tag: 'brief',
      // Seule notification restée en dur après le passage des six autres à lienApp() :
      // elle visait le bon domaine, donc rien ne clochait à l'œil. Un changement de
      // FRONTEND_URL l'aurait pourtant laissée seule derrière, sur l'ancienne adresse.
      url: this.lienVers(),
    });

    return {
      envoye: envoi.envoyees > 0,
      personnalise: !!texte,
      message: body,
      abonnements: envoi.abonnements,
      appareilsAtteints: envoi.envoyees,
      ...(envoi.abonnements === 0 && {
        diagnostic:
          "Aucun appareil abonné aux notifications. Ouvre l'app et autorise les notifications, puis relance ce test.",
      }),
    };
  }

  /**
   * Le point de 18 h : où en est la journée, pendant qu'elle est encore rattrapable.
   *
   * C'était le seul envoi strictement identique pour tout le monde — même titre,
   * même phrase, tous les soirs. Il porte maintenant la jauge du jour, qui n'est
   * jamais deux fois la même et se lit sans déverrouiller. `titreParDefaut` sert
   * aux rappels envoyés à la main, qui n'ont pas d'état du jour à montrer.
   */
  async sendBulkReminders(titreParDefaut: string, body: string, avecProgression = false) {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true, ...(avecProgression ? { sync_data: true } : {}) },
    });
    const aujourdhui = new Date().toISOString().slice(0, 10);
    let echecs = 0;
    for (const user of users) {
      if (user.push_subscriptions && user.push_subscriptions.length > 0) {
        try {
          const donnees = (user as any).sync_data;
          const scores = (donnees?.daily_scores as Record<string, number>) || {};

          // Les coches datées : voir `tachesDuJour`. Sans elle, celui qui n'a pas ouvert
          // l'app de la journée arrivait ici avec les cases de la veille encore cochées.
          const taches = tachesDuJour(donnees);

          // Une jauge vide n'a de sens que face à quelque chose qu'on n'a pas fait.
          // Quelqu'un dont la journée est vide n'a pas échoué : il n'a rien à cocher,
          // et lui montrer « 0 % » le lui reproche. Même distinction que dans le brief
          // du matin, qui l'avait déjà payée une fois.
          const aDesTaches = taches.restantes.length + taches.faites.length > 0;

          /*
            Le jour sans séance ne reçoit rien.

            « Ta journée est vide, dis-moi ce que tu veux accomplir » est la bonne
            phrase pour un compte qui n'a encore rien défini. Adressée à quelqu'un
            dont le programme dit « repos le mardi », elle contredit le plan que le
            coach lui a donné lui-même — et « tout est coché » serait tout aussi
            faux, puisqu'il n'y avait rien à cocher. Il n'y a rien à dire ce soir-là,
            et se taire est une réponse. La distinction n'existait pas tant que le
            serveur ignorait la récurrence.
          */
          if (avecProgression && !aDesTaches && aDesRoutines(donnees)) continue;

          /*
            Ce qu'il reste, plutôt que ce que dit le score.

            Le corps du message était le même pour tout le monde : quelqu'un qui
            avait tout coché à 15 h lisait à 18 h « il te reste la soirée pour
            finir ». Le titre, lui, portait déjà la jauge à 100 % — la
            notification se contredisait donc à l'intérieur d'elle-même, et c'est
            le genre de détail qui apprend qu'aucune de ces phrases n'est vraiment
            adressée à vous.

            La question se tranche sur les tâches restantes et non sur le score :
            le score est calculé par le client, et 100 % n'y garantit pas qu'il ne
            reste rien à cocher.
          */
          const restantes = taches.restantes.length;
          const toutEstFait = avecProgression && aDesTaches && restantes === 0;

          await this.sendNotification(user.id, {
            tag: 'progression',
            title: avecProgression && aDesTaches
              ? titreProgression(scores[aujourdhui] || 0, this.morningBrief.computeStreak(scores))
              : titreParDefaut,
            body: avecProgression && !aDesTaches
              ? "Ta journée est vide. Ouvre le chat et dis-moi ce que tu veux accomplir demain."
              : toutEstFait
                ? "Tout est coché. Tu peux poser la journée."
                : body,
            url: this.lienVers()
          });
        } catch (e) {
          echecs++;
          this.logger.error(`Rappel « ${titreParDefaut} » échoué pour ${user.id} : ${(e as any)?.message}`);
        }
      }
    }
    this.logger.log(`Sent bulk push reminders: ${titreParDefaut} (${echecs} échec(s))`);
  }
}
