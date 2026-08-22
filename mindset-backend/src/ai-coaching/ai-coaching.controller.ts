import { BadRequestException, Controller, Post, Patch, Get, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';
import { CoachOuvertureService } from './coach-ouverture.service';
import { ObservationService } from './observation.service';
import { AnalyseCompleteService } from './analyse-complete.service';
import { WeeklyReviewService } from '../push/weekly-review.service';
import { BilanHebdoService } from '../push/bilan-hebdo.service';
import { AnalyseHabitudesService } from '../push/analyse-habitudes.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatDto } from './dto/chat.dto';
import { ObjectifDto } from './dto/objectif.dto';
import { CadrageDto } from './dto/cadrage.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CadenceGuard } from '../common/cadence.guard';
import { Request } from 'express';

@ApiTags('AI Coaching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-coaching')
export class AiCoachingController {
  constructor(
    private readonly aiCoachingService: AiCoachingService,
    private readonly aiQuota: AiQuotaService,
    private readonly coins: CoinLedgerService,
    private readonly ouverture: CoachOuvertureService,
    private readonly observations: ObservationService,
    // Le même service que la notification du dimanche soir : les chiffres d'une
    // semaine ne doivent avoir qu'une seule définition, sinon l'écran et la
    // notification finiront par annoncer deux semaines différentes.
    private readonly bilan: WeeklyReviewService,
    private readonly bilanHebdo: BilanHebdoService,
    private readonly analyseHabitudes: AnalyseHabitudesService,
    private readonly analyseComplete: AnalyseCompleteService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('quota')
  @ApiOperation({ summary: 'Messages IA restants pour le mois en cours' })
  async getQuota(@Req() req: Request) {
    const userId = (req.user as any).userId;
    const [quota, solde, claims] = await Promise.all([
      this.aiQuota.getQuota(userId),
      this.coins.getBalance(userId),
      this.coins.claimsAujourdhui(userId),
    ]);
    return {
      ...quota,
      coins: solde,
      coutParMessage: CoinLedgerService.COUT_MESSAGE,
      actionsCrediteesAujourdhui: claims,
      plafondQuotidien: CoinLedgerService.ACTIONS_MAX_PAR_JOUR,
    };
  }

  // Le plafond quotidien borne le gain, pas le nombre d'appels : sans ça, marteler
  // cette route reste un moyen de charger la base pour rien.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('coins/claim')
  @ApiOperation({ summary: 'Créditer les coins d\'une action validée (idempotent)' })
  async claimCoins(@Req() req: Request, @Body() body: { eventKey: string }) {
    return this.coins.claim((req.user as any).userId, body?.eventKey);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('onboarding')
  @ApiOperation({ summary: 'Soumettre le questionnaire intelligent (Onboarding)' })
  async submitOnboarding(@Req() req: Request, @Body() data: any) {
    const userId = (req.user as any).userId;
    return this.aiCoachingService.processOnboarding(userId, data);
  }

  /*
    Dix messages par vingt minutes, comptés par compte.

    Les coins bornent le nombre total de messages, jamais la cadence : avec 500
    coins on pouvait en envoyer 50 en dix secondes et saturer l'IA pour tout le
    monde. La fenêtre valait une minute — assez pour empêcher un script, pas pour
    empêcher quelqu'un d'occuper le fournisseur toute la journée à plein régime.

    `CadenceGuard` remplace le décompte par IP du garde-fou standard : sur une
    route authentifiée, compter par adresse punit deux personnes derrière la même
    box et laisse passer qui change de réseau. Il rend aussi un code lisible,
    `AI_CADENCE`, sans quoi le refus s'affiche sous la phrase d'erreur générique du
    chat et se lit comme une panne.

    **Ce plafond est volontairement plus serré que l'usage légitime le plus
    intense.** Un abonné a droit à 50 messages par jour ; il peut donc atteindre
    cette limite au cours d'une vraie conversation, et devra attendre. C'est le
    prix demandé pour la protection — et le refus, lui, ne consomme ni coins ni
    quota : le garde s'exécute avant le contrôleur.
  */
  @UseGuards(CadenceGuard)
  @Throttle({ default: { limit: 10, ttl: 1_200_000 } })
  @Post('chat')
  @ApiOperation({ summary: 'Discuter avec le Coach IA' })
  @ApiResponse({ status: 402, description: 'Coins insuffisants ou quota mensuel épuisé.' })
  async chat(@Req() req: Request, @Body() body: ChatDto) {
    const userId = (req.user as any).userId;

    // Les coins bornent les comptes gratuits ; ils ne s'appliquent pas aux abonnés.
    // Avant, si : un abonné payait 9,99 €/mois pour un « accès illimité » et se
    // retrouvait quand même arrêté au bout de cinq messages, avec pour seule issue
    // d'aller valider des routines. On vendait une promesse que le serveur refusait
    // de tenir.
    //
    // Un abonné reste borné par deux choses, qui ne sont pas une monnaie : la cadence
    // (@Throttle, pour tout le monde) et un plafond quotidien de messages
    // (AiQuotaService.PAID_DAILY_MESSAGES), garde-fou contre un compte emballé qui
    // épuiserait à lui seul le quota Groq partagé par tous.
    const abonne = await this.aiQuota.isSubscribed(userId);

    // Les tout premiers messages ne coûtent rien : voir MESSAGES_DECOUVERTE. On ne
    // pose même pas la question pour un abonné, qui ne paie de toute façon pas.
    const decouverte = abonne ? false : await this.coins.estEnDecouverte(userId);

    /*
      La première chose qu'on dit à son coach ne se facture pas.

      Jusqu'au 23 août 2026, cette gratuité visait une phrase précise : celle que la
      fin du questionnaire envoyait au nom de la personne pour réclamer son plan. La
      condition portait donc sur son texte exact, et devait être bornée par « et c'est
      son tout premier message » — sans quoi renvoyer cette phrase en boucle offrait
      une IA gratuite et illimitée à qui l'aurait repérée dans le code du navigateur.

      Le coach demande maintenant avant de construire, et cette phrase n'est plus
      envoyée par personne. Ce qu'il fallait garder n'était pas le texte, c'était
      l'intention : le premier message décide de tout le reste, et le facturer revient
      à prélever un des dix messages du mois avant d'avoir montré quoi que ce soit.

      La borne devient plus sûre en devenant plus simple. « Zéro message en base » ne
      se rejoue pas, quelle que soit la phrase envoyée — là où une comparaison de
      texte devait être défendue contre elle-même.
    */
    const premierEchange = await this.coins.estPremierMessage(userId);

    const gratuit = abonne || decouverte || premierEchange;

    const debit = gratuit ? null : await this.coins.spend(userId);

    /*
      Le mur du quota tombe après le débit des coins — il doit donc les rendre.

      `consumeAiCredit` ne fait pas que compter : il **lève** quand la limite est
      atteinte, 402 pour un gratuit au bout de ses dix messages du mois, 429 pour un
      abonné au bout de son plafond quotidien. Cet appel était hors du `try`, si bien
      qu'un compte gratuit ayant encore des coins mais plus de messages se les faisait
      prélever pour une réponse qu'il ne recevait jamais — sans remboursement, sans
      trace, et à chaque tentative.

      Le cas n'a rien d'exotique, c'est même le plus courant : les coins se regagnent
      en validant des routines, le quota mensuel non. Tout compte gratuit un peu actif
      finit par se retrouver avec des coins et zéro message, et c'est précisément
      l'instant où on lui ouvre l'écran d'abonnement — en lui prenant sa monnaie au
      passage.

      On ne passe pas par `rembourser()` : il rendrait aussi un crédit d'IA qui n'a
      jamais été pris, et `refundAiCredit` efface la dernière ligne d'usage — celle
      d'un message précédent, bien réel, qui serait ainsi offert deux fois.
    */
    try {
      // Le premier message ne touche pas non plus au quota mensuel : ce serait
      // reprendre d'une main ce que la ligne ci-dessus vient d'accorder.
      if (!premierEchange) await this.aiQuota.consumeAiCredit(userId, 'chat');
    } catch (e) {
      if (!gratuit) {
        await this.coins
          .refund(userId)
          .catch((err: any) =>
            console.error(`[Remboursement] coins NON rendus à ${userId} : ${err?.message}`),
          );
      }
      throw e;
    }

    // Débiter avant l'appel est nécessaire (sinon deux requêtes simultanées passent
    // avec le même solde), mais l'IA peut échouer ensuite — saturation du fournisseur
    // en tête. On rend alors ce qui a été prélevé : un compte gratuit n'a que dix
    // messages par mois, les lui brûler sur une panne n'est pas défendable.
    try {
      const reponse = await this.aiCoachingService.chatWithAi(userId, body.prompt, body.context);
      if ((reponse as any)?.erreur) {
        await this.rembourser(userId, gratuit);
        // Après remboursement, le solde n'est plus celui du débit : on le relit.
        return { ...reponse, coins: await this.coins.getBalance(userId) };
      }
      // Le solde accompagne la réponse : sans lui, l'app tenait sa propre
      // comptabilité en parallèle de la base, et les deux chiffres divergeaient.
      // Un abonné n'a rien dépensé, mais l'app affiche quand même un compteur.
      return { ...reponse, coins: debit ? debit.solde : await this.coins.getBalance(userId) };
    } catch (e) {
      await this.rembourser(userId, gratuit);
      throw e;
    }
  }

  /**
   * Le remboursement ne doit jamais masquer l'erreur d'origine.
   *
   * Un abonné n'a pas été débité de coins : lui en rendre lui en offrirait dix à
   * chaque panne du fournisseur d'IA. Il en va de même des messages de découverte,
   * qui n'ont rien prélevé non plus — d'où `gratuit` et non `abonne`.
   */
  private async rembourser(userId: string, gratuit: boolean) {
    /*
      Avaler l'échec est nécessaire, le taire ne l'est pas.

      Le `catch` protège l'erreur d'origine, qui doit remonter telle quelle — ça,
      c'est juste. Mais il ne journalisait rien : si la base hoquetait ici, la
      personne restait débitée d'un message qu'elle n'a jamais reçu, et il n'existait
      aucune trace nulle part. Ni pour elle, ni pour nous, ni après coup. C'est le
      seul endroit du produit où de la monnaie disparaît sans laisser de reçu.
    */
    const tracer = (quoi: string) => (e: any) =>
      console.error(`[Remboursement] ${quoi} NON rendu à ${userId} : ${e?.message}`);

    await Promise.all([
      gratuit ? Promise.resolve() : this.coins.refund(userId).catch(tracer('coins')),
      this.aiQuota.refundAiCredit(userId, 'chat').catch(tracer('crédit mensuel')),
    ]);
  }

  @Get('profil')
  @ApiOperation({ summary: 'Ce que la personne a déclaré vouloir devenir' })
  async getProfil(@Req() req: Request) {
    return this.aiCoachingService.lireProfil((req.user as any).userId);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch('profil')
  @ApiOperation({ summary: 'Changer l\'objectif déclaré' })
  async patchProfil(@Req() req: Request, @Body() body: ObjectifDto) {
    return this.aiCoachingService.majObjectif((req.user as any).userId, body?.objectif);
  }

  /**
   * Compléter après coup ce qui cadre le plan.
   *
   * Route séparée de `PATCH profil` plutôt qu'un champ de plus : l'objectif est
   * obligatoire et non vide, alors qu'ici tout est optionnel et la chaîne vide a un
   * sens (effacer une contrainte périmée). Mélanger les deux aurait obligé à relâcher
   * la validation de l'objectif, qui s'affiche en haut de l'application.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch('profil/cadrage')
  @ApiOperation({ summary: 'Temps disponible, niveau de départ et contraintes' })
  async patchCadrage(@Req() req: Request, @Body() body: CadrageDto) {
    return this.aiCoachingService.majCadrage((req.user as any).userId, body);
  }

  /**
   * La première phrase du coach.
   *
   * Ni Énergie ni quota mensuel ne sont décomptés : la personne n'a rien demandé,
   * elle vient d'ouvrir un écran. C'est un POST et non un GET parce qu'elle envoie
   * l'état de sa journée — les routines vivent dans le navigateur, pas en base.
   *
   * `@Throttle` est le seul garde-fou contre le rechargement en boucle ; le cache
   * du service borne déjà le coût dans le cas normal.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('ouverture')
  @ApiOperation({ summary: 'Phrase d\'ouverture du coach (gratuite, mise en cache)' })
  async getOuverture(@Req() req: Request, @Body() body: { context?: any; aiName?: string }) {
    const texte = await this.ouverture
      .ouverture((req.user as any).userId, body?.context, body?.aiName)
      // Une ouverture ratée n'est pas un incident : le navigateur sait composer la
      // sienne. Lever ici afficherait une erreur à quelqu'un qui a seulement ouvert
      // une conversation.
      .catch(() => null);
    return { texte };
  }

  /**
   * Ce que le coach a remarqué sur cette personne.
   *
   * Gratuite et sans quota, volontairement : c'est l'argument du produit, et le
   * cacher derrière l'abonnement reviendrait à demander de payer pour savoir
   * pourquoi payer. Ce qui se paie, c'est la suite — développer l'observation
   * dans la conversation, ce qui consomme des messages.
   *
   * Le motif est calculé, jamais deviné par le modèle : voir `ObservationService`.
   */
  @Get('observation')
  @ApiOperation({ summary: "Le motif que le coach a repéré dans l'historique" })
  async getObservation(@Req() req: Request) {
    const userId = (req.user as any).userId;
    const sync = await this.prisma.syncData
      .findUnique({ where: { user_id: userId }, select: { daily_scores: true } })
      .catch(() => null);

    const observation = this.observations.meilleure(
      sync?.daily_scores as Record<string, number> | null,
    );

    // `null` est une réponse : le navigateur n'affiche alors aucune carte plutôt
    // qu'une carte vide. Il n'y a pas d'erreur à signaler — il n'y a rien à dire.
    return { observation };
  }

  /**
   * L'analyse complète : ce que le coach a compris de la personne.
   *
   * Réservée aux abonnés, et c'est le seul endroit du produit où une lecture est
   * refusée à quelqu'un. La contrepartie est écrite juste au-dessus : la carte
   * gratuite montre **qu'il y a** quelque chose à lire, et combien de motifs
   * tiennent. Elle ne montre pas lesquels. Faire payer pour savoir pourquoi payer
   * serait une impasse ; faire payer la suite d'une phrase qu'on a déjà lue est
   * la seule forme de mur qui se justifie ici.
   *
   * Un compte gratuit reçoit 200 et `verrouille: true`, pas une erreur : ce n'est
   * pas une panne, c'est un état du compte, et le navigateur doit pouvoir dessiner
   * la version fermée sans traiter un échec.
   */
  @Get('analyse')
  @ApiOperation({ summary: "L'analyse complète du coach, réservée aux abonnés" })
  async getAnalyse(@Req() req: Request) {
    const userId = (req.user as any).userId;

    const [abonne, compte] = await Promise.all([
      this.aiQuota.isSubscribed(userId),
      this.prisma.user
        .findUnique({ where: { id: userId }, select: { first_name: true } })
        .catch(() => null),
    ]);

    if (!abonne) {
      /*
        Ce qu'un compte gratuit apprend : le nombre, jamais le contenu.

        Les motifs sont recalculés ici plutôt que devinés côté navigateur — c'est
        le même calcul que pour les abonnés, et il coûte une lecture de scores.
        Aucun appel au modèle n'est fait : verrouillé veut dire qu'on ne paie rien
        non plus.
      */
      const sync = await this.prisma.syncData
        .findUnique({ where: { user_id: userId }, select: { daily_scores: true } })
        .catch(() => null);

      return {
        verrouille: true,
        nombreFaits: this.observations.observations(
          sync?.daily_scores as Record<string, number> | null,
        ).length,
      };
    }

    const analyse = await this.analyseComplete.pour(userId, compte?.first_name || 'toi');
    return { verrouille: false, ...analyse };
  }

  /**
   * Le bilan de la semaine écoulée.
   *
   * Les chiffres sont rendus à tout le monde : ce sont les siens, et les cacher
   * derrière l'abonnement transformerait une application de suivi en péage. Ce
   * qui distingue l'abonné, c'est la **lecture** — ce qui a tenu, ce qui a lâché,
   * et la seule chose à changer. C'est la contrepartie la plus visible de
   * l'abonnement, et la seule qu'on puisse montrer sans la donner.
   *
   * `@Throttle` borne les rechargements ; le cache hebdomadaire borne le coût
   * réel, un bilan ne changeant qu'une fois par jour au plus.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('bilan-semaine')
  @ApiOperation({ summary: 'Bilan de la semaine — chiffres pour tous, lecture du coach pour les abonnés' })
  async getBilanSemaine(@Req() req: Request) {
    const userId = (req.user as any).userId;

    const [sync, abonne] = await Promise.all([
      this.prisma.syncData
        .findUnique({ where: { user_id: userId }, select: { daily_scores: true, habits: true } })
        .catch(() => null),
      this.aiQuota.isSubscribed(userId),
    ]);

    const semaine = this.bilan.resumerSemaine(
      sync?.daily_scores as Record<string, number> | null,
      sync?.habits,
    );

    // Rien à raconter : sept jours sans la moindre action. Afficher « 0 jour actif,
    // score moyen 0 % » à quelqu'un qui n'a rien fait est un reproche, pas un bilan.
    if (!semaine) {
      return { disponible: false, abonne, semaine: null, analyse: null, lecture: null };
    }

    /*
      L'analyse, et où passe la frontière de l'abonnement.

      La trajectoire de chaque habitude — 2/7 cette semaine contre 5/7 la
      précédente — reste à tout le monde : ce sont ses propres jours, comptés. La
      mettre derrière le péage reviendrait à lui vendre ce qu'il a déjà fait.

      Le **levier** est d'un autre ordre. Croiser quatre semaines de scores avec
      quatre semaines d'habitudes pour en sortir « tes journées avec cette
      habitude valent 24 points de plus » est un travail que l'application fait
      *pour* elle, et que personne ne peut faire de tête. C'est ça qu'on paie —
      pas l'accès à ses propres chiffres.
    */
    const analyse = this.analyseHabitudes.analyser(
      sync?.daily_scores as Record<string, number> | null,
      sync?.habits,
    );

    if (!abonne) {
      return {
        disponible: true,
        abonne: false,
        semaine,
        analyse: { habitudes: analyse.habitudes, levier: null },
        lecture: null,
      };
    }

    const prenom = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { first_name: true } })
      .then((u) => u?.first_name ?? '')
      .catch(() => '');

    // Le cache et la génération vivent dans `BilanHebdoService`, partagé avec le
    // cron du dimanche soir qui prépare la même lecture d'avance. Deux copies de
    // cette règle finiraient par rendre deux textes différents pour la même
    // semaine, selon qu'on arrive par la notification ou par l'écran.
    const lecture = await this.bilanHebdo
      .lecture(userId, prenom, semaine, analyse.levier)
      .catch(() => null);
    return { disponible: true, abonne: true, semaine, analyse, lecture };
  }

  @Get('history')
  @ApiOperation({ summary: 'Récupérer l\'historique des conversations avec l\'IA' })
  async getHistory(@Req() req: Request) {
    const userId = (req.user as any)?.userId;
    return this.aiCoachingService.getChatHistory(userId);
  }

  /**
   * Signaler une réponse du coach.
   *
   * Une IA qui écrit du texte lu par des gens finit par écrire quelque chose de
   * choquant, de faux ou de dangereux. Sans ce canal, cela arrive **une fois, à
   * une personne, et personne d'autre ne l'apprend** : le message vit dans son
   * navigateur, l'historique s'y remet à zéro chaque nuit, et il ne reste rien.
   * C'est aussi ce qu'Apple exige de toute application où une IA s'adresse au
   * public — mais l'exigence rejoint ici l'intérêt du produit.
   *
   * Le texte signalé est recopié en base pour cette raison précise : le retrouver
   * autrement serait impossible. La cadence est serrée parce que rien d'utile ne
   * justifie dix signalements par minute.
   */
  @Post('signalement')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Signaler une réponse du coach jugée choquante ou dangereuse' })
  async signaler(@Req() req: Request, @Body() corps: { message?: string; motif?: string }) {
    const userId = (req.user as any)?.userId;
    const message = (corps?.message ?? '').trim();

    // Un signalement vide ne désigne rien : il encombrerait la liste que quelqu'un
    // doit lire, et c'est cette lisibilité qui fait tout l'intérêt du mécanisme.
    if (!message) throw new BadRequestException('Aucun message à signaler.');

    await this.prisma.signalementIA.create({
      data: {
        user_id: userId,
        message: message.slice(0, 4000),
        motif: (corps?.motif ?? '').trim().slice(0, 500) || null,
      },
    });

    return { enregistre: true };
  }

  /*
    La lecture à voix haute des messages est retirée (15 août 2026).

    `OPENAI_API_KEY` n'a jamais été posée sur Render : la route levait donc avant
    même d'appeler OpenAI, et le `catch` du navigateur se contentait de remettre
    l'icône dans son état initial. Un abonné voyait un bouton qui ne faisait rien,
    sans message ni erreur — la pire forme de panne, celle dont personne ne se
    plaint parce qu'elle n'a l'air de rien.

    Retirer la route en même temps que le bouton, et non seulement le bouton : elle
    restait appelable au jeton près, sur une API facturée à l'usage, sans que rien
    dans l'application ne l'appelle.
  */
}
