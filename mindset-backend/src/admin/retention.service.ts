import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FILTRE_MESSAGES_ECRITS } from '../common/message-inscription';
import { debutDuJourParis } from '../common/jour-paris';

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

  /**
   * Longueur maximale du classement nominatif.
   *
   * Il sert à écrire à des gens, pas à contempler une liste : au-delà d'une
   * vingtaine de lignes on ne contacte plus personne. La borne évite aussi qu'une
   * réponse d'API grossisse avec la base sans que rien ne le décide.
   */
  private static readonly CLASSEMENT_MAX = 20;

  constructor(private readonly prisma: PrismaService) {}

  private static readonly JOUR_MS = 24 * 60 * 60 * 1000;

  /** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
  private static cleJour(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * La même chose, pour une date qui peut manquer.
   *
   * Une seule colonne vide — un abonnement importé à la main, une ligne écrite par
   * une version antérieure du schéma — suffirait sinon à faire échouer **tout**
   * l'endpoint d'administration sur un `toISOString` d'`undefined`. Un tableau de
   * bord doit se dégrader, jamais s'éteindre : une case vide se voit et se
   * corrige, une page blanche ne dit rien de ce qui manque.
   */
  private static cleJourOuNull(date: Date | null | undefined): string | null {
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? RetentionService.cleJour(date)
      : null;
  }

  /**
   * Les jours où cette personne a agi, sous forme de clés comparables.
   *
   * Une entrée présente vaut activité même si le score vaut zéro : le score
   * retombe à zéro quand on décoche tout, mais la clé n'est écrite que parce
   * qu'il y a eu une action ce jour-là. Ce qu'on mesure ici est la venue, pas la
   * performance.
   */
  private static joursActifs(dailyScores: unknown, cleMax: string): string[] {
    if (!dailyScores || typeof dailyScores !== 'object' || Array.isArray(dailyScores)) return [];
    return Object.keys(dailyScores as Record<string, unknown>).filter(
      // Les clés sont écrites par le navigateur, donc par son horloge. Un appareil
      // réglé en avance produit des jours qui n'ont pas encore eu lieu : comptés,
      // ils inventent des venues. Les dates comparables en `YYYY-MM-DD`, la borne
      // est une comparaison de chaînes.
      (cle) => /^\d{4}-\d{2}-\d{2}$/.test(cle) && cle <= cleMax,
    );
  }

  /**
   * La médiane, pas la moyenne.
   *
   * Un compte qui ouvre l'application tous les jours depuis un mois suffit à tirer
   * la moyenne vers le haut sur quelques dizaines d'inscrits, et à faire croire
   * que le cas ordinaire lui ressemble. La médiane décrit la personne du milieu,
   * qui est celle dont on parle quand on demande « combien de fois elle revient ».
   */
  private static mediane(valeurs: number[]): number | null {
    if (valeurs.length === 0) return null;
    const tries = [...valeurs].sort((a, b) => a - b);
    const milieu = Math.floor(tries.length / 2);
    const brute =
      tries.length % 2 === 0 ? (tries[milieu - 1] + tries[milieu]) / 2 : tries[milieu];
    return Math.round(brute * 10) / 10;
  }

  /**
   * Les paliers de fréquence, dans l'ordre où ils se lisent.
   *
   * Le premier est le seul qui compte vraiment : une personne venue un seul jour
   * n'est jamais revenue. Les suivants s'élargissent parce qu'à quelques dizaines
   * de comptes, une case par jour ne montrerait que du bruit.
   */
  private static readonly PALIERS: ReadonlyArray<{
    cle: string;
    libelle: string;
    min: number;
    max: number;
  }> = [
    { cle: '1', libelle: 'Un seul jour', min: 1, max: 1 },
    { cle: '2', libelle: '2 jours', min: 2, max: 2 },
    { cle: '3-4', libelle: '3 à 4 jours', min: 3, max: 4 },
    { cle: '5-7', libelle: '5 à 7 jours', min: 5, max: 7 },
    { cle: '8-14', libelle: '8 à 14 jours', min: 8, max: 14 },
    { cle: '15+', libelle: '15 jours ou plus', min: 15, max: Number.POSITIVE_INFINITY },
  ];

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
        // Nominatif, comme le tableau des arrivées du jour : à cette échelle, savoir
        // qui est engagé permet de lui écrire, ce qu'aucun taux ne permet.
        first_name: true,
        email: true,
        sync_data: { select: { daily_scores: true, updated_at: true } },
        subscription: {
          select: {
            status: true,
            plan_type: true,
            // Quand l'abonnement a été pris, et jusqu'à quand il court. Le second
            // est ce qui distingue un abonné qui va se renouveler d'un essai qui
            // s'arrête dans trois jours — deux personnes à qui l'on ne parle pas
            // de la même façon.
            created_at: true,
            current_period_end: true,
            cancel_at_period_end: true,
          },
        },
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

          Le décompte des messages est filtré : il comptait toutes les lignes, y
          compris les réponses du coach et le plan que le questionnaire réclame
          automatiquement au nom de la personne. La marche « ont parlé au coach »
          était donc franchie par quiconque avait fini l'inscription — c'est-à-dire
          que l'entonnoir montrait une marche qui n'existait pas.
        */
        _count: {
          select: { chat_messages: { where: FILTRE_MESSAGES_ECRITS }, refresh_tokens: true },
        },
        ai_profile: { select: { id: true } },
      },
    });

    /*
      Les ouvertures, agrégées par personne.

      Une ligne par compte et par jour : la somme donne le nombre d'ouvertures, le
      nombre de lignes donne le nombre de jours où l'app a été ouverte. Les deux
      en une requête, et rien à charger en mémoire.

      Ce compteur n'existe que depuis sa mise en service : il ne dit rien du passé,
      et `depuis` est là pour que personne ne lise ces chiffres comme s'il couvrait
      toute la vie du produit.
    */
    const idsVivants = new Set(comptes.map((c) => c.id));
    const ouverturesParCompte = (
      await this.prisma.appOuverture.groupBy({
        by: ['user_id'],
        _sum: { nombre: true },
        _count: { jour: true },
      })
    ).filter((o) => idsVivants.has(o.user_id));

    const premiereJournee = await this.prisma.appOuverture.aggregate({
      _min: { jour: true },
    });

    /*
      Ce que les gens ont tapé, et ce à quoi le coach a répondu.

      Les deux ne se confondent pas, et l'écart n'était visible nulle part. Le
      message de la personne est écrit en base **avant** l'appel au modèle ; quand
      celui-ci échoue — fournisseur saturé, délai dépassé, réponse vide — les coins
      et le crédit mensuel sont rendus, mais la ligne du message reste. Elle est
      donc comptée comme un échange alors que personne n'a rien reçu.

      La soustraction est exacte, et c'est ce qui la rend utilisable : un échange
      réussi écrit exactement une ligne `user` et une ligne `ai`, un échec écrit la
      première et pas la seconde. `user − ai` est donc le nombre de fois où
      quelqu'un a parlé dans le vide, sans approximation ni correction à appliquer.

      Le plan réclamé automatiquement compte ici comme le reste : lui aussi peut
      échouer, et quand il échoue la personne arrive sur un tableau de bord vide
      après six questions — c'est même le pire moment pour que ça arrive.
    */
    const lignesParSender = await this.prisma.chatMessage.groupBy({
      by: ['user_id', 'sender'],
      _count: { _all: true },
    });

    /*
      Les causes des silences, groupées.

      Le décompte des silences se déduit des messages ; leur cause, non — elle
      n'existe que si on l'a écrite au moment de l'échec. Ces lignes ne commencent
      donc qu'à la mise en service de la trace, et le tableau le dit plutôt que de
      laisser lire « aucune saturation » là où il faut lire « rien n'était mesuré ».
    */
    const [echecsParCause, premierEchec] = await Promise.all([
      this.prisma.coachEchec.groupBy({ by: ['code'], _count: { _all: true } }),
      this.prisma.coachEchec.aggregate({ _min: { created_at: true } }),
    ]);

    let messagesTapes = 0;
    let reponsesRecues = 0;
    const comptesSansReponse = new Set<string>();
    const tapesParCompte = new Map<string, number>();
    const reponsesParCompte = new Map<string, number>();

    for (const ligne of lignesParSender) {
      if (!idsVivants.has(ligne.user_id)) continue;
      const n = ligne._count._all;
      if (ligne.sender === 'user') {
        messagesTapes += n;
        tapesParCompte.set(ligne.user_id, n);
      } else if (ligne.sender === 'ai') {
        reponsesRecues += n;
        reponsesParCompte.set(ligne.user_id, n);
      }
    }

    for (const [id, tapes] of tapesParCompte) {
      if (tapes > (reponsesParCompte.get(id) ?? 0)) comptesSansReponse.add(id);
    }

    const depuis = (jours: number) => new Date(maintenant.getTime() - jours * RetentionService.JOUR_MS);
    const dansLaFenetre = (date: Date | null | undefined, jours: number) =>
      !!date && date.getTime() >= depuis(jours).getTime();

    let jamaisActifs = 0;
    let ontParleAuCoach = 0;
    let ontOuvertUneSession = 0;
    let ontFiniLeQuestionnaire = 0;
    let ontAgiSansQuestionnaire = 0;
    let actifsAujourdhui = 0;
    let actifs7j = 0;
    let actifs30j = 0;

    // Numérateur et dénominateur séparés par fenêtre : voir `assez_ancien` plus bas.
    const retenus: Record<number, number> = { 1: 0, 7: 0, 30: 0 };
    const eligibles: Record<number, number> = { 1: 0, 7: 0, 30: 0 };

    /*
      La même journée que la carte « Actifs aujourd'hui » du haut de page, et que
      le bloc du jour : minuit heure de Paris. Ce calcul était fait ici en UTC,
      c'est-à-dire à 2 h du matin heure française — la page affichait donc deux
      fois le libellé « Actifs aujourd'hui » avec deux nombres différents, celui
      d'ici oubliant tous les jours quiconque avait agi entre minuit et 2 h.
    */
    const debutDuJour = debutDuJourParis(maintenant);
    const cleAujourdhui = RetentionService.cleJour(maintenant);

    /*
      Le nombre de jours où chacun est venu agir, et le nombre de jours qu'il a eu
      pour le faire. La rétention dit si on revient ; ces deux listes disent
      combien de fois — ce n'est pas la même question, et la seconde est celle qui
      décrit un usage. Quelqu'un qui revient une fois puis disparaît et quelqu'un
      qui vient trois jours sur quatre comptent tous les deux pour « revenu ».
    */
    const joursActifsParCompte: number[] = [];
    const regularites: number[] = [];

    /*
      Le classement nominatif : qui a écrit au coach ET qui est revenu.

      Les taux disent combien, jamais qui. À quarante-sept comptes, c'est « qui »
      qui sert — on peut écrire à ces gens-là, leur demander ce qui manque, ou
      simplement voir à quoi ressemble quelqu'un que le produit tient.

      Les deux conditions ensemble, parce que séparées elles ne valent pas
      grand-chose : quelqu'un qui a écrit une fois puis disparu n'a rien confirmé,
      et quelqu'un qui revient sans jamais parler au coach n'a pas touché à ce que
      l'abonnement fait payer.
    */
    const classement: Array<{
      prenom: string;
      email: string;
      messages: number;
      joursActifs: number;
      dernierJourActif: string | null;
      abonne: boolean;
      inscritLe: string;
    }> = [];
    let ontEcritSansRevenir = 0;
    let sontRevenusSansEcrire = 0;

    for (const compte of comptes) {
      const jours = RetentionService.joursActifs(compte.sync_data?.daily_scores, cleAujourdhui);
      const derniereSynchro = compte.sync_data?.updated_at ?? null;

      if (jours.length > 0) {
        joursActifsParCompte.push(jours.length);

        // Le jour de l'inscription compte : il a été une occasion de venir, et la
        // plupart des gens l'utilisent. L'exclure gonflerait la régularité de
        // tous les comptes récents.
        const joursEcoules =
          Math.floor((maintenant.getTime() - compte.created_at.getTime()) / RetentionService.JOUR_MS) + 1;
        /*
          Sept jours d'ancienneté au minimum. En dessous, le rapport est mécanique :
          un compte créé aujourd'hui et venu aujourd'hui affiche 100 % de
          régularité, ce qui ne décrit aucune habitude.
        */
        if (joursEcoules >= 7) {
          regularites.push(Math.min(1, jours.length / joursEcoules));
        }
      }

      if (jours.length === 0) jamaisActifs++;
      if (compte._count.chat_messages > 0) ontParleAuCoach++;
      if (compte._count.refresh_tokens > 0) ontOuvertUneSession++;
      if (compte.ai_profile) ontFiniLeQuestionnaire++;

      /*
        Ceux qui se servent de l'application sans avoir jamais répondu aux six
        questions. C'est ce nombre qui interdit de lire « on perd 21 personnes au
        questionnaire » : une partie d'entre elles ne sont pas perdues du tout,
        elles ont simplement sauté l'étape et utilisent le produit quand même.
      */
      if (jours.length > 0 && !compte.ai_profile) ontAgiSansQuestionnaire++;

      /*
        « Revenu » = actif au moins deux journées distinctes. Le jour de
        l'inscription en est une : quelqu'un qui n'a qu'une seule clé n'est jamais
        repassé, quelle que soit son activité ce jour-là.
      */
      const aEcrit = compte._count.chat_messages > 0;
      const estRevenu = jours.length >= 2;

      if (aEcrit && estRevenu) {
        classement.push({
          prenom: compte.first_name,
          email: compte.email,
          messages: compte._count.chat_messages,
          joursActifs: jours.length,
          // Trié comme des chaînes `YYYY-MM-DD`, donc comparables directement.
          dernierJourActif: jours.length > 0 ? [...jours].sort().at(-1)! : null,
          abonne: !!compte.subscription && ['ACTIVE', 'TRIALING'].includes(compte.subscription.status),
          inscritLe: RetentionService.cleJour(compte.created_at),
        });
      } else if (aEcrit) {
        ontEcritSansRevenir++;
      } else if (estRevenu) {
        sontRevenusSansEcrire++;
      }

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
      /*
        Combien de fois une personne revient.

        La rétention range chacun en « revenu » ou « pas revenu » ; à l'intérieur
        du premier groupe, quelqu'un venu deux jours et quelqu'un venu vingt-cinq
        sont indiscernables. Or c'est précisément l'écart entre les deux qui dit
        si l'application est devenue une habitude ou seulement une curiosité.

        Compté en jours distincts d'activité réelle, jamais en ouvertures : une
        clé n'apparaît dans `daily_scores` que parce qu'il s'est passé quelque
        chose ce jour-là.
      */
      frequence: {
        // Les comptes jamais actifs sont exclus : ils sont déjà comptés à part, et
        // les mêler ici ferait dire « la moitié vient un jour ou moins », ce qui
        // confond deux problèmes — ne pas commencer, et ne pas continuer.
        base: joursActifsParCompte.length,
        medianeJours: RetentionService.mediane(joursActifsParCompte),
        // Montrée à côté de la médiane, jamais seule : l'écart entre les deux est
        // ce qui révèle qu'une poignée de comptes porte tout l'usage.
        moyenneJours:
          joursActifsParCompte.length === 0
            ? null
            : Math.round(
                (joursActifsParCompte.reduce((s, n) => s + n, 0) / joursActifsParCompte.length) * 10,
              ) / 10,
        // Le seul seuil qui compte vraiment : y a-t-il eu une deuxième fois.
        revenusAuMoinsUneFois: joursActifsParCompte.filter((n) => n >= 2).length,
        distribution: RetentionService.PALIERS.map((palier) => {
          const nombre = joursActifsParCompte.filter(
            (n) => n >= palier.min && n <= palier.max,
          ).length;
          return {
            cle: palier.cle,
            libelle: palier.libelle,
            comptes: nombre,
            part: part(nombre, joursActifsParCompte.length),
          };
        }),
        /*
          À quel rythme. « Cinq jours d'activité » ne veut pas dire la même chose
          sur une semaine d'ancienneté et sur deux mois : sans ce rapport, un
          ancien compte tiède passe pour un compte fidèle.

          Exprimé en jours pour dix — « elle vient 3 jours sur 10 » se lit, « 0,3 »
          se calcule.
        */
        regularite: {
          base: regularites.length,
          joursPourDix: RetentionService.mediane(regularites.map((r) => r * 10)),
        },
      },
      /*
        Combien de fois l'application est ouverte — et non plus seulement combien
        de fois il s'y passe quelque chose.

        Tout le reste de ce tableau se lit sur des traces laissées par une action.
        Quelqu'un qui ouvre, regarde sa journée et referme ne laissait donc rien :
        il était compté comme quelqu'un qui n'est jamais venu. C'est l'écart entre
        les deux qui manque le plus, parce qu'il désigne deux produits différents —
        celui qu'on n'ouvre pas, et celui qu'on ouvre sans rien y faire.

        Une ouverture est une reprise après trente minutes d'absence, décidée par
        le navigateur : dans une application d'une seule page, revenir sur l'onglet
        n'est pas une ouverture. Voir `utils/venue.ts`.
      */
      ouvertures: {
        /*
          Le jour où la mesure a commencé. Sans lui, ces chiffres se liraient comme
          l'histoire complète du produit alors qu'ils commencent à leur mise en
          service — et ils paraîtraient catastrophiques le premier jour.
        */
        depuis: premiereJournee._min.jour ?? null,
        base: ouverturesParCompte.length,
        total: ouverturesParCompte.reduce((s, o) => s + (o._sum.nombre ?? 0), 0),
        medianeParPersonne: RetentionService.mediane(
          ouverturesParCompte.map((o) => o._sum.nombre ?? 0),
        ),
        medianeJours: RetentionService.mediane(ouverturesParCompte.map((o) => o._count.jour)),
        // « Quand elle vient, elle ouvre l'app N fois. » Au-dessus de 1, il y a un
        // retour dans la journée — c'est le signe d'habitude le plus net qu'on
        // puisse lire sans rien demander à personne.
        medianeParJourOuvert: RetentionService.mediane(
          ouverturesParCompte
            .filter((o) => o._count.jour > 0)
            .map((o) => (o._sum.nombre ?? 0) / o._count.jour),
        ),
      },
      retention: RetentionService.FENETRES.map((fenetre) => ({
        fenetre,
        revenus: retenus[fenetre],
        // Seuls les comptes assez anciens pour que la question ait un sens.
        base: eligibles[fenetre],
        taux: part(retenus[fenetre], eligibles[fenetre]),
      })),
      /*
        Deux blocs, et c'est tout l'objet de cette structure.

        Ces six nombres étaient présentés comme un seul entonnoir descendant, où
        chaque marche se lit contre la précédente. Or ils ne s'emboîtent pas tous :
        « a fait au moins une action » (36) passait sous « a fini le questionnaire »
        (21) et **remontait** — un entonnoir qui remonte n'est pas un entonnoir. Les
        deux nombres étaient justes ; leur mise en file inventait une séquence qui
        n'existe pas, et faisait lire « on perd 21 personnes au questionnaire »
        alors qu'une bonne partie d'entre elles se servent de l'app sans lui.

        `entree` : les seules marches réellement emboîtées. On ne peut pas finir le
        questionnaire sans avoir ouvert de session, ni ouvrir de session sans s'être
        inscrit. L'écart entre deux nomme donc bien un mur.

        `usage` : ce qu'ils font ensuite. Ces mesures se recoupent et ne s'ordonnent
        pas — on peut parler au coach sans avoir coché une seule habitude — et se
        rapportent chacune au total des inscrits, jamais l'une à l'autre.
      */
      entonnoir: {
        /*
          Les six champs à plat sont ceux de l'ancienne forme, et ils restent.

          Le front et l'API se déploient séparément — Render et Vercel, deux
          chaînes indépendantes, parfois à dix minutes d'écart et parfois
          davantage quand GitHub tousse. Livrer la nouvelle forme seule a suffi à
          afficher « NaN % » sur toutes les marches pendant l'intervalle : l'ancien
          écran lisait `entonnoir.inscrits`, désormais absent, et divisait par
          `undefined`.

          Une réponse doit donc rester lisible par la version précédente du client
          le temps que celle-ci disparaisse. Ces champs partiront dans un second
          temps, quand plus aucun onglet ouvert ne les réclamera.
        */
        inscrits: comptes.length,
        ontOuvertUneSession,
        ontFiniLeQuestionnaire,
        ontAgi: comptes.length - jamaisActifs,
        ontParleAuCoach,
        abonnes,

        entree: {
          inscrits: comptes.length,
          ontOuvertUneSession,
          ontFiniLeQuestionnaire,
        },
        usage: {
          ontAgi: comptes.length - jamaisActifs,
          ontParleAuCoach,
          abonnes,
          // Le nombre qui interdit de lire la chute du questionnaire comme une perte.
          ontAgiSansQuestionnaire,
        },
      },
      /*
        Le classement, et de quoi le lire.

        Trié par jours actifs d'abord, messages ensuite. **Pas par un score
        composite** : mélanger deux grandeurs sans rapport dans un seul nombre
        produit un classement que personne ne peut contester, donc que personne ne
        peut corriger — et il faudrait choisir des coefficients qu'aucune donnée ne
        justifie. Deux colonnes visibles et une règle dite en toutes lettres valent
        mieux qu'un chiffre qui a l'air savant.

        Revenir passe avant écrire : parler au coach une fois arrive le jour de
        l'inscription, revenir dix jours est ce qui ne s'achète pas.
      */
      classement: {
        comptes: classement
          .sort((a, b) => b.joursActifs - a.joursActifs || b.messages - a.messages)
          .slice(0, RetentionService.CLASSEMENT_MAX),
        /*
          Les deux populations écartées, comptées à part. Sans elles, un classement
          court se lirait comme une panne : on saurait que trois personnes y
          figurent, jamais combien ont failli y être.
        */
        ontEcritSansRevenir,
        sontRevenusSansEcrire,
      },
      /*
        Ce que le coach a laissé sans réponse.

        Le chiffre le plus coûteux du tableau, et il n'existait nulle part : chaque
        unité est quelqu'un qui a écrit au coach — le seul geste que l'abonnement
        fait payer — et n'a rien reçu. Compté sur toute l'histoire des comptes
        vivants, pas sur une fenêtre : une déception ne s'efface pas au bout de
        quatorze jours.
      */
      coach: {
        messagesTapes,
        /*
          Parmi eux, ceux que quelqu'un a réellement écrits.

          `messagesTapes` compte toutes les lignes `user`, et jusqu'au 23 août 2026
          la fin du questionnaire en déposait une au nom de la personne pour
          réclamer son plan. Les deux populations se lisaient donc dans le même
          nombre, alors qu'un silence ne veut pas dire la même chose de part et
          d'autre : sur un message écrit, quelqu'un a parlé au coach et n'a rien
          reçu ; sur un plan automatique, quelqu'un a répondu à six questions et
          s'est retrouvé devant un tableau de bord vide sans avoir rien demandé.
          Deux déceptions, deux réparations, un seul chiffre — c'est exactement le
          genre de total qui se laisse lire sans rien apprendre.

          Le filtre est celui qui sert déjà à l'entonnoir (`FILTRE_MESSAGES_ECRITS`),
          par comparaison exacte de texte : aucune approximation, donc aucun vrai
          message écarté par erreur.
        */
        messagesEcrits: comptes.reduce((total, c) => total + c._count.chat_messages, 0),
        reponsesRecues,
        sansReponse: Math.max(0, messagesTapes - reponsesRecues),
        // Combien de personnes en ont fait les frais, au moins une fois. Un même
        // compte peut porter dix échecs : le total dit l'ampleur, celui-ci dit
        // combien de gens ont vu le produit ne pas répondre.
        comptesTouches: comptesSansReponse.size,
        /*
          Pourquoi, quand on le sait.

          Saturation, délai dépassé, clé refusée, réponse vide : quatre causes, quatre
          gestes différents, et jusqu'ici aucune n'était conservée. `mesureDepuis`
          est là pour que ce tableau ne se lise jamais comme un bilan de toute
          l'histoire : les silences antérieurs à la trace n'y figurent pas, et rien
          d'autre ne permettrait de s'en apercevoir.
        */
        causes: echecsParCause
          .map((e) => ({ code: e.code, nombre: e._count._all }))
          .sort((a, b) => b.nombre - a.nombre),
        mesureDepuis: RetentionService.cleJourOuNull(premierEchec._min.created_at),
        /*
          Qui, nommément.

          Le décompte seul ne se répare pas : il dit que quatre personnes ont vu le
          coach se taire, jamais lesquelles. Or la seule question qui compte dès
          qu'il y a un abonné est de savoir s'il en fait partie — il a payé
          précisément pour cette réponse, et c'est le seul cas où le silence se
          rembourse en euros. Trié par silences, l'abonné d'abord.
        */
        sansReponseDetail: comptes
          .filter((c) => (tapesParCompte.get(c.id) ?? 0) > (reponsesParCompte.get(c.id) ?? 0))
          .map((c) => {
            const tapes = tapesParCompte.get(c.id) ?? 0;
            const recues = reponsesParCompte.get(c.id) ?? 0;
            return {
              prenom: c.first_name,
              email: c.email,
              tapes,
              /*
                Combien de ces lignes la personne a écrites elle-même.

                C'est ce qui rend la ligne actionnable au lieu d'être seulement
                inquiétante. `ecrits: 0` avec `manques: 1` ne se lit plus « son
                message est resté sans réponse » mais « son plan d'inscription n'est
                jamais arrivé » — elle n'a rien tapé du tout, et ce qu'elle a vu,
                c'est un tableau de bord vide au sortir du questionnaire.

                Sans ce nombre, les deux cas sont indiscernables et on va chercher
                une panne du coach là où il n'y a jamais eu de conversation.
              */
              ecrits: c._count.chat_messages,
              recues,
              manques: tapes - recues,
              abonne: !!c.subscription && ['ACTIVE', 'TRIALING'].includes(c.subscription.status),
            };
          })
          .sort((a, b) => Number(b.abonne) - Number(a.abonne) || b.manques - a.manques)
          .slice(0, RetentionService.CLASSEMENT_MAX),
      },
      /*
        Qui paie, nommément.

        Deux abonnés sur quarante-sept : à ce stade ce ne sont pas des statistiques,
        ce sont des personnes qu'on peut remercier, interroger, et dont on peut
        apprendre pourquoi elles ont dit oui. `cancel_at_period_end` est joint parce
        qu'un abonné qui a déjà résilié est celui à qui il faut parler en premier,
        et rien ailleurs ne le signale.
      */
      abonnesDetail: comptes
        .filter((c) => c.subscription && ['ACTIVE', 'TRIALING'].includes(c.subscription.status))
        .map((c) => ({
          prenom: c.first_name,
          email: c.email,
          statut: c.subscription!.status,
          formule: c.subscription!.plan_type,
          depuis: RetentionService.cleJourOuNull(c.subscription!.created_at),
          finPeriode: RetentionService.cleJourOuNull(c.subscription!.current_period_end),
          resilie: !!c.subscription!.cancel_at_period_end,
          inscritLe: RetentionService.cleJour(c.created_at),
          messages: c._count.chat_messages,
        }))
        // Le plus récent d'abord. Une date absente passe en dernier plutôt que de
        // fausser la comparaison — elle ne doit pas se retrouver en tête par accident.
        .sort((a, b) => (b.depuis ?? '').localeCompare(a.depuis ?? '')),
      cohortes: this.cohortes(comptes, maintenant),
      genere_le: maintenant.toISOString(),
    };
  }

  /**
   * L'instant où l'accueil à l'inscription est parti en production.
   *
   * Écrit en dur, et c'est voulu : c'est une date d'événement, pas un réglage.
   * Une variable d'environnement se change par mégarde, et déplacerait la
   * frontière entre les deux groupes — la mesure dirait alors autre chose sans
   * que personne ne l'ait décidé.
   *
   * Déploiement Render du commit `4e143ca`, vérifié sur `/health`.
   */
  static readonly ACCUEIL_DEPUIS = new Date('2026-08-20T21:57:45.000Z');

  /**
   * L'accueil a-t-il décollé le jour 2 ?
   *
   * On vient d'expédier deux mécanismes censés ramener les gens le lendemain — le
   * brief du matin par e-mail, puis l'accueil à l'inscription — et **rien ne
   * disait s'ils servent**. Le panneau savait compter les messages partis, jamais
   * les gens revenus après les avoir lus. Sans cette mesure, la question « faut-il
   * continuer » se tranche à l'impression.
   *
   * **La coupure se fait sur la date d'inscription, pas sur « a reçu l'e-mail ».**
   * Comparer ceux qui l'ont reçu à ceux qui ne l'ont pas reçu comparerait aussi
   * les adresses valides aux adresses mortes, les boîtes ouvertes aux boîtes
   * abandonnées : le groupe témoin serait fait de gens différents, pas seulement
   * de gens non accueillis. La date, elle, ne trie personne.
   *
   * **Ce que cette mesure ne peut pas faire**, et qu'il faut lire avec elle : à
   * quelques dizaines de comptes, elle donne une direction, jamais une preuve. Et
   * si la provenance du trafic change en même temps, elle mesure les deux à la
   * fois. C'est pour ça que `comptes` est rendu à côté de chaque taux — un taux
   * sur quatre personnes ne veut rien dire, et doit se voir tout de suite.
   */
  async effetAccueil() {
    const maintenant = new Date();
    const cleMax = RetentionService.cleJour(maintenant);

    /*
      Trente jours de recul, pas toute la base.

      Le groupe témoin doit ressembler au groupe accueilli sur tout le reste :
      même produit, même façon d'arriver. Les inscrits d'il y a trois mois ont
      connu une application différente, et les mêler ferait attribuer à l'accueil
      ce qui revient à trois semaines de corrections.
    */
    const comptes = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        created_at: { gte: new Date(maintenant.getTime() - 30 * RetentionService.JOUR_MS) },
      },
      select: {
        created_at: true,
        sync_data: { select: { daily_scores: true } },
        relances: { where: { motif: 'bienvenue' }, select: { envoye_le: true } },
      },
    });

    const groupe = (nom: 'avant' | 'apres') => ({ nom, comptes: 0, mesurables: 0, revenus: 0 });
    const avant = groupe('avant');
    const apres = groupe('apres');
    let accueillis = 0;

    for (const compte of comptes) {
      const cible = compte.created_at >= RetentionService.ACCUEIL_DEPUIS ? apres : avant;
      cible.comptes++;

      if (cible === apres && compte.relances.length > 0) accueillis++;

      /*
        Un compte de quelques heures n'a pas encore eu son lendemain.

        Le compter comme « pas revenu » ferait tomber le taux du groupe récent à
        chaque nouvelle inscription — l'accueil paraîtrait nuire d'autant plus
        qu'il amène du monde. C'est la faute classique de ce genre de mesure, et
        elle produit un chiffre parfaitement plausible.
      */
      if (maintenant.getTime() - compte.created_at.getTime() < RetentionService.JOUR_MS) continue;
      cible.mesurables++;

      // Même définition du retour que les cohortes : une clé de jour postérieure
      // au jour d'inscription et au plus tard le lendemain. Deux définitions du
      // même mot dans un seul panneau, et les deux chiffres cessent d'être
      // comparables sans que rien ne le signale.
      const jours = RetentionService.joursActifs(compte.sync_data?.daily_scores, cleMax);
      const jourInscription = RetentionService.cleJour(compte.created_at);
      const lendemain = RetentionService.cleJour(
        new Date(compte.created_at.getTime() + RetentionService.JOUR_MS),
      );
      if (jours.some((j) => j > jourInscription && j <= lendemain)) cible.revenus++;
    }

    const taux = (g: { mesurables: number; revenus: number }) =>
      g.mesurables === 0 ? null : Math.round((g.revenus / g.mesurables) * 1000) / 10;

    return {
      depuis: RetentionService.ACCUEIL_DEPUIS,
      avant: { ...avant, tauxJ1: taux(avant) },
      apres: { ...apres, tauxJ1: taux(apres) },
      /*
        Combien, parmi les inscrits depuis, portent vraiment la trace de l'envoi.

        C'est la sonde qui distingue « l'accueil ne sert à rien » de « l'accueil
        n'est jamais parti ». Les deux donnent le même taux, et sans ce chiffre on
        conclurait la première en étant dans la seconde.
      */
      accueillis,
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
        const jours = RetentionService.joursActifs(
          compte.sync_data?.daily_scores,
          RetentionService.cleJour(maintenant),
        );
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
