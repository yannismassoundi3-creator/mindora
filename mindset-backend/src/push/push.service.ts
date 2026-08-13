import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MorningBriefService } from './morning-brief.service';
import { WeeklyReviewService } from './weekly-review.service';
import * as cron from 'node-cron';
import * as webpush from 'web-push';

/** Décompte d'une tournée de briefs, identique dans le log et dans la réponse HTTP. */
export interface ResumeTournee {
  personnalises: number;
  generiques: number;
  dormantsIgnores: number;
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
   * On passe par FRONTEND_URL, déjà utilisée par l'authentification et les abonnements,
   * pour qu'un changement de domaine n'ait plus à être répercuté à six endroits.
   */
  private lienApp(chemin = ''): string {
    // La barre finale est retirée : selon comment la variable est saisie sur Render,
    // on obtiendrait sinon une adresse en « //?auth=true » sur la moitié des envois.
    const base = (process.env.FRONTEND_URL || 'https://disciplix-ai.vercel.app').replace(/\/+$/, '');
    return base + chemin;
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
  ) {
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:mindoraappli@gmail.com';
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

    planifier('0 10 * * *', 'Briefs du matin', () => this.sendMorningBriefs());
    planifier('0 18 * * *', 'Check-in 18h', () =>
      this.sendBulkReminders('Check-in de 18h 🎯', 'Où en es-tu dans tes objectifs ? Viens faire le point.'));
    planifier('0 20 * * *', 'Alerte série 20h', () => this.checkStreaksAndWarn(20));
    planifier('0 22 * * *', 'Dernière chance 22h', () => this.checkStreaksAndWarn(22));
    planifier('0 20 * * 0', 'Bilan hebdomadaire', () => this.sendWeeklyReports());
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

      // Comme pour le brief du matin : un échec sur une personne ne doit pas
      // interrompre la tournée des suivantes.
      try {
        if (hour === 20) {
          if (missedDays >= 4) {
            // AI Dynamic Adjustment Prompt
            await this.sendNotification(user.id, {
              title: '🤖 Coach IA : Stratégie',
              body: 'Je remarque que tu as du mal depuis quelques jours. Ouvre le Chat IA pour réduire la difficulté de tes objectifs.',
              url: this.lienVers('chat')
            });
          } else if (scoreToday === 0 && scoreYesterday > 0) {
            // Warning 1st day miss
            await this.sendNotification(user.id, {
              title: 'Attention ! 😡',
              body: 'Tu n\'as pas encore fait tes routines aujourd\'hui. Ne brise pas ton rythme !',
              url: this.lienVers()
            });
          }
        } else if (hour === 22) {
          // Warning 2nd day miss (Urgency)
          if (missedDays === 2) {
            await this.sendNotification(user.id, {
              title: '🚨 URGENCE STREAK 🚨',
              body: 'Dernier avertissement ! Ta série va disparaître à minuit si tu n\'agis pas tout de suite !',
              url: this.lienVers()
            });
          } else if (scoreToday === 0 && scoreYesterday > 0) {
            // Normal night review for those who just haven't finished today yet
            await this.sendNotification(user.id, {
              title: 'C\'est l\'heure du bilan 🌙',
              body: 'Valide tes dernières routines avant de dormir.',
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

        const texte =
          (abonne ? await this.weeklyReview.generate(prenom, semaine) : null) ??
          this.weeklyReview.texteFactuel(prenom, semaine);

        await this.sendNotification(user.id, {
          title: '📊 Bilan de ta semaine',
          body: texte,
          url: this.lienVers(abonne ? 'chat' : 'dashboard'),
        });
        envoyes++;
      } catch (e) {
        this.logger.error(`Bilan hebdomadaire échoué pour ${user.id} : ${(e as any)?.message}`);
      }
    }

    this.logger.log(`[Bilan hebdo] ${envoyes} envoyé(s), ${ignores} sans activité cette semaine`);
    return { envoyes, ignores };
  }

  /**
   * Rappel du matin, écrit par l'IA à partir des données de chaque personne.
   *
   * Les comptes dormants sont ignorés : générer un message coûte un appel IA, et
   * relancer quelqu'un parti depuis des semaines avec un texte personnalisé ne le
   * fera pas revenir. Si l'IA est indisponible, on retombe sur le message générique
   * plutôt que de ne rien envoyer.
   */
  async sendMorningBriefs(declencheur = 'cron'): Promise<ResumeTournee> {
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
    const promesse = this.executerTourneeBriefs();
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

  private async executerTourneeBriefs(): Promise<ResumeTournee> {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true, sync_data: true },
    });

    let personnalises = 0;
    let generiques = 0;
    let ignores = 0;
    let echecs = 0;

    for (const user of users) {
      if (!user.push_subscriptions?.length) continue;

      if (!this.morningBrief.isActive(user.sync_data?.updated_at)) {
        ignores++;
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
        `${ignores} compte(s) dormant(s) ignoré(s), ${echecs} échec(s)`,
    );

    // Renvoyé pour que le suivi de tournée expose le même décompte que le log.
    return { personnalises, generiques, dormantsIgnores: ignores, echecs, comptesExamines: users.length };
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

    const envoi = await this.sendNotification(user.id, {
      title: texte ? '🎯 Ton brief du jour' : 'Réveil ! ☀️',
      body,
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

  async sendBulkReminders(title: string, body: string) {
    const users = await this.prisma.user.findMany({
      include: { push_subscriptions: true }
    });
    let echecs = 0;
    for (const user of users) {
      if (user.push_subscriptions && user.push_subscriptions.length > 0) {
        try {
          await this.sendNotification(user.id, {
            title,
            body,
            url: this.lienVers()
          });
        } catch (e) {
          echecs++;
          this.logger.error(`Rappel « ${title} » échoué pour ${user.id} : ${(e as any)?.message}`);
        }
      }
    }
    this.logger.log(`Sent bulk push reminders: ${title} (${echecs} échec(s))`);
  }
}
