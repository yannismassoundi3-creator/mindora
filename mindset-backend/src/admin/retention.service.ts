import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ce que deviennent les gens après leur inscription.
 *
 * Le tableau de bord administrateur donnait trois nombres — comptes, abonnés,
 * actifs aujourd'hui — qui ne répondent à aucune question utile : ils disent
 * combien de personnes sont arrivées, jamais combien sont restées. Or c'est la
 * seconde qui décide s'il faut faire connaître l'application ou d'abord la
 * corriger. Amener du monde sur un produit que l'on ne quitte pas revient à
 * remplir un seau ; l'amener sur un produit que l'on quitte revient à le remplir
 * percé.
 *
 * La matière existait déjà, inexploitée : `SyncData.daily_scores` porte une clé
 * par jour où la personne a agi dans l'application.
 */
@Injectable()
export class RetentionService {
  /**
   * Fenêtres de retour observées, en jours après l'inscription.
   *
   * J+1 dit si l'application a donné envie de revenir une fois ; J+7 si elle est
   * entrée dans une semaine ; J+30 si elle a tenu. Trois nombres suffisent à ce
   * stade — au-delà, on lit du bruit sur des effectifs de quelques dizaines.
   */
  private static readonly FENETRES = [1, 7, 30];

  /** Nombre de semaines d'inscription détaillées dans le tableau des cohortes. */
  private static readonly SEMAINES_COHORTES = 8;

  constructor(private readonly prisma: PrismaService) {}

  private static readonly JOUR_MS = 24 * 60 * 60 * 1000;

  /** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
  private static cleJour(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Les jours où cette personne a agi, sous forme de clés comparables.
   *
   * Une entrée présente vaut activité même si le score vaut zéro : le score
   * retombe à zéro quand on décoche tout, mais la clé n'est écrite que parce
   * qu'il y a eu une action ce jour-là. Ce qu'on mesure ici est la venue, pas la
   * performance.
   */
  private static joursActifs(dailyScores: unknown): string[] {
    if (!dailyScores || typeof dailyScores !== 'object' || Array.isArray(dailyScores)) return [];
    return Object.keys(dailyScores as Record<string, unknown>).filter((cle) =>
      /^\d{4}-\d{2}-\d{2}$/.test(cle),
    );
  }

  async getRetentionStats() {
    const maintenant = new Date();

    /*
      Un seul balayage des comptes, en ne chargant que ce qui sert. Les scores
      journaliers sont du JSON : ils ne se filtrent pas en SQL, il faut les lire.
      C'est sans conséquence sur quelques dizaines de comptes, mais cette requête
      est celle qui coûtera si l'application grandit — le jour où elle pèse, la
      réponse est une table d'activité, pas un index.
    */
    const comptes = await this.prisma.user.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        created_at: true,
        sync_data: { select: { daily_scores: true, updated_at: true } },
        subscription: { select: { status: true, plan_type: true } },
        /*
          Les deux marches manquantes de l'entonnoir. Entre « s'est inscrit » et
          « a fait quelque chose » il y a deux murs, et le tableau les confondait
          en une seule chute : le code reçu par e-mail, puis les six questions du
          questionnaire. Neuf comptes sur trente-quatre se perdaient là sans qu'on
          puisse dire lequel des deux les avait arrêtés — donc sans savoir lequel
          réparer.

          `refresh_tokens` répond au premier : un jeton n'existe que si une session
          a été ouverte, et ils ne sont jamais supprimés, seulement révoqués.
          `ai_profile` répond au second : la table n'est écrite qu'à la dernière
          étape du questionnaire.
        */
        _count: { select: { chat_messages: true, refresh_tokens: true } },
        ai_profile: { select: { id: true } },
      },
    });

    const depuis = (jours: number) => new Date(maintenant.getTime() - jours * RetentionService.JOUR_MS);
    const dansLaFenetre = (date: Date | null | undefined, jours: number) =>
      !!date && date.getTime() >= depuis(jours).getTime();

    let jamaisActifs = 0;
    let ontParleAuCoach = 0;
    let ontOuvertUneSession = 0;
    let ontFiniLeQuestionnaire = 0;
    let actifsAujourdhui = 0;
    let actifs7j = 0;
    let actifs30j = 0;

    // Numérateur et dénominateur séparés par fenêtre : voir `assez_ancien` plus bas.
    const retenus: Record<number, number> = { 1: 0, 7: 0, 30: 0 };
    const eligibles: Record<number, number> = { 1: 0, 7: 0, 30: 0 };

    const debutDuJour = new Date(maintenant);
    debutDuJour.setUTCHours(0, 0, 0, 0);

    for (const compte of comptes) {
      const jours = RetentionService.joursActifs(compte.sync_data?.daily_scores);
      const derniereSynchro = compte.sync_data?.updated_at ?? null;

      if (jours.length === 0) jamaisActifs++;
      if (compte._count.chat_messages > 0) ontParleAuCoach++;
      if (compte._count.refresh_tokens > 0) ontOuvertUneSession++;
      if (compte.ai_profile) ontFiniLeQuestionnaire++;

      if (derniereSynchro && derniereSynchro.getTime() >= debutDuJour.getTime()) actifsAujourdhui++;
      if (dansLaFenetre(derniereSynchro, 7)) actifs7j++;
      if (dansLaFenetre(derniereSynchro, 30)) actifs30j++;

      const inscription = compte.created_at;
      const jourInscription = RetentionService.cleJour(inscription);

      for (const fenetre of RetentionService.FENETRES) {
        /*
          Un compte créé hier ne peut pas être « revenu à J+7 » : le compter au
          dénominateur ferait passer une jeune cohorte pour un échec. C'est
          l'erreur la plus courante sur ce genre de tableau, et elle pousse à
          corriger un produit qui n'a rien fait de mal.
        */
        const assezAncien = maintenant.getTime() - inscription.getTime() >= fenetre * RetentionService.JOUR_MS;
        if (!assezAncien) continue;

        eligibles[fenetre]++;

        // Revenu = au moins un jour d'activité après celui de l'inscription, dans
        // la fenêtre. Cumulé plutôt que « pile le jour N » : sur de petits
        // effectifs, la rétention au jour exact ne mesure guère que le hasard.
        const limite = RetentionService.cleJour(
          new Date(inscription.getTime() + fenetre * RetentionService.JOUR_MS),
        );
        const revenu = jours.some((j) => j > jourInscription && j <= limite);
        if (revenu) retenus[fenetre]++;
      }
    }

    const part = (numerateur: number, denominateur: number) =>
      denominateur === 0 ? null : Math.round((numerateur / denominateur) * 1000) / 10;

    const abonnes = comptes.filter(
      (c) => c.subscription && ['ACTIVE', 'TRIALING'].includes(c.subscription.status),
    ).length;

    return {
      comptes: {
        total: comptes.length,
        actifsAujourdhui,
        actifs7j,
        actifs30j,
        /*
          Un compte créé puis jamais utilisé. C'est le trou le plus coûteux d'un
          produit : le coût d'acquisition est déjà payé, et il n'a rien produit.
        */
        jamaisActifs,
      },
      retention: RetentionService.FENETRES.map((fenetre) => ({
        fenetre,
        revenus: retenus[fenetre],
        // Seuls les comptes assez anciens pour que la question ait un sens.
        base: eligibles[fenetre],
        taux: part(retenus[fenetre], eligibles[fenetre]),
      })),
      /*
        L'entonnoir, dans l'ordre où on le perd. Chaque marche répond à une
        question différente : est-ce qu'on s'inscrit, est-ce qu'on entre, est-ce
        qu'on répond aux questions, est-ce qu'on essaie, est-ce qu'on parle au
        coach — le seul geste que l'abonnement fait payer —, et est-ce qu'on paie.

        Les marches se lisent chacune contre la précédente : c'est l'écart entre
        deux qui nomme le mur, jamais le chiffre seul.
      */
      entonnoir: {
        inscrits: comptes.length,
        ontOuvertUneSession,
        ontFiniLeQuestionnaire,
        ontAgi: comptes.length - jamaisActifs,
        ontParleAuCoach,
        abonnes,
      },
      cohortes: this.cohortes(comptes, maintenant),
      genere_le: maintenant.toISOString(),
    };
  }

  /**
   * Les inscrits regroupés par semaine d'arrivée.
   *
   * Un taux global mélange ceux qui sont arrivés avant les correctifs et ceux qui
   * sont arrivés après : il ne peut donc jamais dire si une correction a servi.
   * Les cohortes, si — c'est leur seul intérêt, et il est décisif quand on est en
   * train de réparer le produit chaque semaine.
   */
  private cohortes(
    comptes: Array<{
      created_at: Date;
      sync_data: { daily_scores: unknown; updated_at: Date } | null;
    }>,
    maintenant: Date,
  ) {
    const groupes = new Map<string, { inscrits: number; revenus: number; base: number }>();

    for (const compte of comptes) {
      const inscription = compte.created_at;
      const age = maintenant.getTime() - inscription.getTime();
      if (age > RetentionService.SEMAINES_COHORTES * 7 * RetentionService.JOUR_MS) continue;

      // Le lundi de la semaine d'inscription, en UTC, sert d'étiquette.
      const lundi = new Date(inscription);
      const jourSemaine = (lundi.getUTCDay() + 6) % 7;
      lundi.setUTCDate(lundi.getUTCDate() - jourSemaine);
      lundi.setUTCHours(0, 0, 0, 0);
      const cle = RetentionService.cleJour(lundi);

      const groupe = groupes.get(cle) ?? { inscrits: 0, revenus: 0, base: 0 };
      groupe.inscrits++;

      // Même précaution que plus haut : une semaine trop jeune n'a pas de taux.
      if (age >= 7 * RetentionService.JOUR_MS) {
        groupe.base++;
        const jours = RetentionService.joursActifs(compte.sync_data?.daily_scores);
        const jourInscription = RetentionService.cleJour(inscription);
        const limite = RetentionService.cleJour(
          new Date(inscription.getTime() + 7 * RetentionService.JOUR_MS),
        );
        if (jours.some((j) => j > jourInscription && j <= limite)) groupe.revenus++;
      }

      groupes.set(cle, groupe);
    }

    return [...groupes.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([semaine, g]) => ({
        semaine,
        inscrits: g.inscrits,
        revenusJ7: g.revenus,
        base: g.base,
        tauxJ7: g.base === 0 ? null : Math.round((g.revenus / g.base) * 1000) / 10,
      }));
  }
}
