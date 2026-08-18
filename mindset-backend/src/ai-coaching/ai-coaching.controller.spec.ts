import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AiCoachingController } from './ai-coaching.controller';
import { CadenceGuard } from '../common/cadence.guard';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';
import { CoachOuvertureService } from './coach-ouverture.service';
import { ObservationService } from './observation.service';
import { WeeklyReviewService } from '../push/weekly-review.service';
import { BilanHebdoService } from '../push/bilan-hebdo.service';
import { AnalyseHabitudesService } from '../push/analyse-habitudes.service';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES_AUTOMATIQUES_INSCRIPTION } from '../common/message-inscription';

/**
 * Le remboursement est la contrepartie du débit anticipé : on prélève avant l'appel
 * pour que deux requêtes simultanées ne passent pas avec le même solde, ce qui rend
 * indispensable de rendre la mise quand l'IA échoue. Un compte gratuit n'a que dix
 * messages par mois ; les lui brûler sur une saturation du fournisseur ne se voit
 * dans aucun log et se paie en désabonnements.
 *
 * Ce chemin n'avait jamais tourné, faute de pouvoir provoquer une panne réelle.
 */
describe('AiCoachingController — débit et remboursement du chat', () => {
  let controller: AiCoachingController;
  let ia: { chatWithAi: jest.Mock };
  let quota: { consumeAiCredit: jest.Mock; refundAiCredit: jest.Mock; isSubscribed: jest.Mock };
  let coins: {
    spend: jest.Mock;
    refund: jest.Mock;
    getBalance: jest.Mock;
    estEnDecouverte: jest.Mock;
    estPremierMessage: jest.Mock;
  };
  let ouverture: { ouverture: jest.Mock };

  const requete = { user: { userId: 'u1' } } as any;
  const message = { prompt: 'Comment tu vas ?' } as any;

  beforeEach(async () => {
    ia = { chatWithAi: jest.fn() };
    quota = {
      consumeAiCredit: jest.fn().mockResolvedValue({}),
      refundAiCredit: jest.fn().mockResolvedValue({}),
      isSubscribed: jest.fn().mockResolvedValue(false),
    };
    coins = {
      spend: jest.fn().mockResolvedValue({ depense: 10, solde: 40 }),
      refund: jest.fn().mockResolvedValue({}),
      getBalance: jest.fn().mockResolvedValue(50),
      // Le cas par défaut de ces tests est un compte qui a passé la découverte et
      // paie donc ses messages ; les tests de la découverte la réactivent eux-mêmes.
      estEnDecouverte: jest.fn().mockResolvedValue(false),
      estPremierMessage: jest.fn().mockResolvedValue(false),
    };
    ouverture = { ouverture: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiCoachingController],
      providers: [
        { provide: AiCoachingService, useValue: ia },
        { provide: AiQuotaService, useValue: quota },
        { provide: CoinLedgerService, useValue: coins },
        { provide: CoachOuvertureService, useValue: ouverture },
        // L'observation a sa propre suite de tests : le vrai service convient ici,
        // et sans historique il ne trouve rien à dire — ce qui est la réponse
        // attendue pour tous les cas vérifiés dans ce fichier.
        { provide: ObservationService, useValue: new ObservationService() },
        // Idem : le bilan de semaine a ses propres tests. Le vrai service convient,
        // et sans historique il ne trouve aucune semaine à résumer.
        { provide: WeeklyReviewService, useValue: new WeeklyReviewService() },
        // Le cache de la lecture a ses propres tests ; ici on veut seulement que
        // le contrôleur puisse être construit et qu'aucune lecture ne soit rendue.
        { provide: BilanHebdoService, useValue: { lecture: jest.fn().mockResolvedValue(null) } },
        AnalyseHabitudesService,
        {
          provide: PrismaService,
          useValue: { syncData: { findUnique: jest.fn().mockResolvedValue(null) } },
        },
      ],
    })
      /*
        La cadence n'est pas le sujet de ces tests, et son garde reclame les
        fournisseurs du module Throttler. Le neutraliser ici evite de monter tout
        ce module pour verifier un debit de coins — et surtout evite que ces
        tests-la commencent a dependre d'un compteur de requetes.
        Sa propre logique est verifiee dans cadence.guard.spec.ts.
      */
      .overrideGuard(CadenceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiCoachingController>(AiCoachingController);
  });

  it('prélève avant d’appeler l’IA, jamais après', async () => {
    ia.chatWithAi.mockResolvedValue({ reply: 'Ça va.' });

    await controller.chat(requete, message);

    // Débiter après coup rouvrirait la fenêtre que le prélèvement anticipé ferme :
    // deux requêtes simultanées passeraient avec le même solde.
    expect(coins.spend.mock.invocationCallOrder[0]).toBeLessThan(ia.chatWithAi.mock.invocationCallOrder[0]);
    expect(quota.consumeAiCredit.mock.invocationCallOrder[0]).toBeLessThan(ia.chatWithAi.mock.invocationCallOrder[0]);
  });

  it('ne rembourse rien quand la réponse arrive, et annonce le solde restant', async () => {
    ia.chatWithAi.mockResolvedValue({ reply: 'Ça va.' });

    const resultat = await controller.chat(requete, message);

    // Le solde voyage avec la réponse : sans lui, l'app décomptait de son côté et
    // finissait par afficher un chiffre qui n'était plus celui de la base.
    expect(resultat).toEqual({ reply: 'Ça va.', coins: 40 });
    expect(coins.refund).not.toHaveBeenCalled();
    expect(quota.refundAiCredit).not.toHaveBeenCalled();
  });

  it('rend les coins et le crédit mensuel quand le service signale une panne', async () => {
    // Le cas réel : saturation du fournisseur. Le service répond 200 avec un message
    // d'attente et ce drapeau — pas d'exception, donc rien ne rembourserait sans lui.
    ia.chatWithAi.mockResolvedValue({ reply: 'Trop de monde me parle en ce moment…', erreur: true });

    const resultat: any = await controller.chat(requete, message);

    expect(coins.refund).toHaveBeenCalledWith('u1');
    expect(quota.refundAiCredit).toHaveBeenCalledWith('u1', 'chat');
    // La personne reçoit quand même le message d'attente.
    expect(resultat.reply).toContain('Trop de monde');
    // Et le solde annoncé est celui d'après remboursement, pas celui du débit :
    // afficher 40 alors que la base en a rendu 50 ferait croire à un message perdu.
    expect(resultat.coins).toBe(50);
  });

  it('rembourse aussi sur exception, sans masquer l’erreur', async () => {
    ia.chatWithAi.mockRejectedValue(new Error('base injoignable'));

    await expect(controller.chat(requete, message)).rejects.toThrow('base injoignable');

    expect(coins.refund).toHaveBeenCalledWith('u1');
    expect(quota.refundAiCredit).toHaveBeenCalledWith('u1', 'chat');
  });

  it('laisse remonter l’erreur d’origine si le remboursement échoue lui aussi', async () => {
    ia.chatWithAi.mockRejectedValue(new Error('base injoignable'));
    coins.refund.mockRejectedValue(new Error('écriture impossible'));

    // Un remboursement en échec ne doit jamais remplacer la cause : c'est elle qu'on
    // cherchera dans les logs.
    await expect(controller.chat(requete, message)).rejects.toThrow('base injoignable');
    expect(quota.refundAiCredit).toHaveBeenCalledWith('u1', 'chat');
  });

  /**
   * Le mur du quota tombe entre le débit des coins et l'appel à l'IA.
   *
   * `consumeAiCredit` lève quand la limite est atteinte, et cet appel vivait hors du
   * `try` qui rembourse : un compte gratuit ayant encore des coins mais plus de
   * messages se les faisait prélever pour une réponse qu'il ne recevait jamais.
   * C'est le cas le plus courant du produit, pas un cas limite — les coins se
   * regagnent en validant des routines, le quota mensuel non.
   */
  describe('quota épuisé alors que les coins restent', () => {
    const mur = new HttpException(
      { statusCode: 402, code: 'AI_QUOTA_EXCEEDED' },
      HttpStatus.PAYMENT_REQUIRED,
    );

    beforeEach(() => quota.consumeAiCredit.mockRejectedValue(mur));

    it('rend les coins prélevés', async () => {
      await expect(controller.chat(requete, message)).rejects.toThrow(HttpException);

      expect(coins.spend).toHaveBeenCalledWith('u1');
      expect(coins.refund).toHaveBeenCalledWith('u1');
    });

    it('ne rend pas un crédit d’IA qui n’a jamais été pris', async () => {
      await expect(controller.chat(requete, message)).rejects.toThrow(HttpException);

      // `refundAiCredit` efface la dernière ligne d'usage : l'appeler ici rendrait
      // un message précédent, bien réel, et l'offrirait une seconde fois.
      expect(quota.refundAiCredit).not.toHaveBeenCalled();
    });

    it('laisse remonter le 402 tel quel, pour que l’app ouvre l’écran d’abonnement', async () => {
      await expect(controller.chat(requete, message)).rejects.toBe(mur);
    });

    it('n’appelle jamais l’IA', async () => {
      await expect(controller.chat(requete, message)).rejects.toThrow(HttpException);

      expect(ia.chatWithAi).not.toHaveBeenCalled();
    });

    it('ne rembourse rien à un abonné, qui n’a rien dépensé', async () => {
      quota.isSubscribed.mockResolvedValue(true);

      // Un abonné arrive ici par le plafond quotidien (429). Lui « rendre » des coins
      // lui en offrirait dix à chaque fois qu'il touche son plafond.
      await expect(controller.chat(requete, message)).rejects.toThrow(HttpException);

      expect(coins.spend).not.toHaveBeenCalled();
      expect(coins.refund).not.toHaveBeenCalled();
    });

    it('laisse remonter le mur même si le remboursement échoue', async () => {
      coins.refund.mockRejectedValue(new Error('écriture impossible'));

      await expect(controller.chat(requete, message)).rejects.toBe(mur);
    });
  });

  /**
   * L'offre vendue dit « accès illimité ». Le serveur, lui, débitait dix coins par
   * message à tout le monde : un abonné payait 9,99 €/mois puis se faisait arrêter au
   * bout de cinq messages, avec pour seule issue d'aller valider des routines. Ces
   * deux cas verrouillent la promesse côté serveur, là où elle doit tenir.
   */
  describe('abonné', () => {
    beforeEach(() => quota.isSubscribed.mockResolvedValue(true));

    it('ne dépense aucun coin et reçoit son solde inchangé', async () => {
      ia.chatWithAi.mockResolvedValue({ reply: 'Ça va.' });

      const resultat = await controller.chat(requete, message);

      expect(coins.spend).not.toHaveBeenCalled();
      // Le solde reste affiché — il sert encore à la boutique —, simplement il ne bouge pas.
      expect(resultat).toEqual({ reply: 'Ça va.', coins: 50 });
    });

    it('ne se voit pas offrir des coins quand l’IA tombe en panne', async () => {
      ia.chatWithAi.mockRejectedValue(new Error('base injoignable'));

      await expect(controller.chat(requete, message)).rejects.toThrow('base injoignable');

      // Rembourser un débit qui n'a pas eu lieu créditerait dix coins à chaque panne
      // du fournisseur : de quoi s'en fabriquer en boucle.
      expect(coins.refund).not.toHaveBeenCalled();
      // Le crédit mensuel, lui, a bien été consommé : il doit être rendu.
      expect(quota.refundAiCredit).toHaveBeenCalledWith('u1', 'chat');
    });
  });
});

/**
 * Cinquante coins font cinq messages, et une conversation qui aboutit à un vrai plan
 * en consomme trois ou quatre. Beaucoup de gens rencontraient donc le mur juste avant
 * d'avoir vu ce que l'application sait faire — le pire moment pour parler d'abonnement,
 * puisqu'il n'y a encore rien à acheter dans leur tête.
 */
describe('AiCoachingController — messages de découverte', () => {
  let controller: AiCoachingController;
  let ia: { chatWithAi: jest.Mock };
  let quota: { consumeAiCredit: jest.Mock; refundAiCredit: jest.Mock; isSubscribed: jest.Mock };
  let coins: {
    spend: jest.Mock;
    refund: jest.Mock;
    getBalance: jest.Mock;
    estEnDecouverte: jest.Mock;
    estPremierMessage: jest.Mock;
  };
  let ouverture: { ouverture: jest.Mock };
  let prisma: any;
  let bilanHebdo: { lecture: jest.Mock };

  const requete = { user: { userId: 'u1' } } as any;
  const message = { prompt: 'Fais-moi un plan' } as any;

  beforeEach(async () => {
    ia = { chatWithAi: jest.fn().mockResolvedValue({ reply: 'Voilà.' }) };
    bilanHebdo = { lecture: jest.fn().mockResolvedValue(null) };
    prisma = {
      syncData: { findUnique: jest.fn().mockResolvedValue(null) },
      aIProfile: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ first_name: 'Yannis' }) },
    };
    quota = {
      consumeAiCredit: jest.fn().mockResolvedValue({}),
      refundAiCredit: jest.fn().mockResolvedValue({}),
      isSubscribed: jest.fn().mockResolvedValue(false),
    };
    coins = {
      spend: jest.fn().mockResolvedValue({ depense: 10, solde: 40 }),
      refund: jest.fn().mockResolvedValue({}),
      getBalance: jest.fn().mockResolvedValue(50),
      estEnDecouverte: jest.fn().mockResolvedValue(true),
      estPremierMessage: jest.fn().mockResolvedValue(false),
    };
    ouverture = { ouverture: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiCoachingController],
      providers: [
        { provide: AiCoachingService, useValue: ia },
        { provide: AiQuotaService, useValue: quota },
        { provide: CoinLedgerService, useValue: coins },
        { provide: CoachOuvertureService, useValue: ouverture },
        // L'observation a sa propre suite de tests : le vrai service convient ici,
        // et sans historique il ne trouve rien à dire — ce qui est la réponse
        // attendue pour tous les cas vérifiés dans ce fichier.
        { provide: ObservationService, useValue: new ObservationService() },
        // Idem : le bilan de semaine a ses propres tests. Le vrai service convient,
        // et sans historique il ne trouve aucune semaine à résumer.
        { provide: WeeklyReviewService, useValue: new WeeklyReviewService() },
        { provide: BilanHebdoService, useValue: bilanHebdo },
        AnalyseHabitudesService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      /*
        La cadence n'est pas le sujet de ces tests, et son garde reclame les
        fournisseurs du module Throttler. Le neutraliser ici evite de monter tout
        ce module pour verifier un debit de coins — et surtout evite que ces
        tests-la commencent a dependre d'un compteur de requetes.
        Sa propre logique est verifiee dans cadence.guard.spec.ts.
      */
      .overrideGuard(CadenceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiCoachingController>(AiCoachingController);
  });

  it('ne débite aucun coin sur les premiers messages', async () => {
    await controller.chat(requete, message);

    expect(coins.spend).not.toHaveBeenCalled();
  });

  // La limite annoncée reste la vraie limite : on rend la gratuité au coin, pas au
  // quota mensuel, sinon les dix messages promis deviendraient quinze sans le dire.
  it('consomme quand même le quota mensuel gratuit', async () => {
    await controller.chat(requete, message);

    expect(quota.consumeAiCredit).toHaveBeenCalledWith('u1', 'chat');
  });

  it('renvoie le solde réel, intact', async () => {
    const resultat: any = await controller.chat(requete, message);

    expect(resultat.coins).toBe(50);
  });

  // Rien n'a été prélevé : rembourser offrirait dix coins à chaque panne du fournisseur.
  it('ne rembourse rien quand le service tombe en panne', async () => {
    ia.chatWithAi.mockResolvedValue({ erreur: true });

    await controller.chat(requete, message);

    expect(coins.refund).not.toHaveBeenCalled();
  });

  it('reprend le débit une fois la découverte terminée', async () => {
    coins.estEnDecouverte.mockResolvedValue(false);

    await controller.chat(requete, message);

    expect(coins.spend).toHaveBeenCalledWith('u1');
  });

  /**
   * Le plan réclamé automatiquement à la fin du questionnaire.
   *
   * Il part au nom de la personne sans qu'elle l'écrive. Le facturer revenait à
   * lui prendre un de ses dix messages mensuels avant sa première lettre — et ces
   * messages-là sont exactement ceux qui décident si elle s'abonne.
   */
  /**
   * Le bilan de la semaine.
   *
   * Les chiffres appartiennent à la personne et lui sont rendus quoi qu'il
   * arrive ; c'est la **lecture** qui distingue l'abonné. Ces deux limites sont
   * les seules choses à ne jamais laisser glisser : donner la lecture à tout le
   * monde vide l'abonnement de son seul avantage visible, et la refuser à un
   * abonné lui fait payer pour rien.
   */
  describe('le bilan de la semaine', () => {
    const requeteBilan = { user: { userId: 'u1' } } as any;

    /** Sept jours pleins, pour que `resumerSemaine` ait de quoi répondre. */
    const semainePleine = () => {
      const scores: Record<string, number> = {};
      for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() - i * 86400000);
        scores[d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })] = 70;
      }
      return scores;
    };

    it('rend les chiffres à un compte gratuit, mais aucune lecture', async () => {
      quota.isSubscribed.mockResolvedValue(false);
      prisma.syncData.findUnique.mockResolvedValue({ daily_scores: semainePleine(), habits: [] });

      const r: any = await controller.getBilanSemaine(requeteBilan);

      expect(r.disponible).toBe(true);
      expect(r.abonne).toBe(false);
      expect(r.semaine.joursActifs).toBe(7);
      // La lecture est le seul avantage visible de l'abonnement : la donner ici
      // reviendrait à ne plus rien avoir à vendre.
      expect(r.lecture).toBeNull();
    });

    it("ne se dit pas disponible quand la semaine est vide", async () => {
      quota.isSubscribed.mockResolvedValue(true);
      prisma.syncData.findUnique.mockResolvedValue({ daily_scores: {}, habits: [] });

      const r: any = await controller.getBilanSemaine(requeteBilan);

      // « 0 jour actif, score moyen 0 % » n'est pas un bilan, c'est un reproche.
      expect(r.disponible).toBe(false);
      expect(r.semaine).toBeNull();
    });

    it("demande la lecture au service partagé, avec le prénom de la personne", async () => {
      /*
        Le cache et la génération vivent dans `BilanHebdoService`, testés dans leur
        propre fichier. Ce qui se joue ici est qu'un abonné passe bien par ce
        service-là : c'est le même que celui du cron du dimanche soir, et deux
        chemins distincts finiraient par rendre deux textes différents pour la même
        semaine selon qu'on arrive par la notification ou par l'écran.
      */
      quota.isSubscribed.mockResolvedValue(true);
      prisma.syncData.findUnique.mockResolvedValue({ daily_scores: semainePleine(), habits: [] });
      bilanHebdo.lecture.mockResolvedValue('Ta semaine tient.');

      const r: any = await controller.getBilanSemaine(requeteBilan);

      expect(r.lecture).toBe('Ta semaine tient.');
      expect(bilanHebdo.lecture).toHaveBeenCalledWith(
        'u1',
        'Yannis',
        expect.objectContaining({ joursActifs: 7 }),
        // Le levier part avec, quatrième argument : c'est lui qui nourrit la
        // lecture. `null` ici — aucune habitude dans cette fixture, donc rien à
        // rapprocher, et le service se tait plutôt que d'inventer un lien.
        null,
      );
    });

    /*
      La frontière de l'abonnement, sur cet écran précis.

      Elle est facile à déplacer sans s'en rendre compte : il suffit d'ajouter un
      champ au retour. La règle du produit est que les **chiffres** de quelqu'un
      lui appartiennent — les mettre derrière le péage reviendrait à lui vendre ce
      qu'il a déjà fait — alors que le **rapprochement** entre ses habitudes et le
      score de ses journées est le travail que l'application fait pour lui.
    */
    it('rend la trajectoire des habitudes à tout le monde, le levier aux seuls abonnés', async () => {
      const jour = (recul: number) =>
        new Date(Date.now() - recul * 86400000).toLocaleDateString('sv-SE', {
          timeZone: 'Europe/Paris',
        });

      // Trois journées à 90 avec l'habitude, trois à 50 sans : un écart franc.
      const scores: Record<string, number> = {};
      [1, 3, 5].forEach((r) => (scores[jour(r)] = 90));
      [2, 4, 6].forEach((r) => (scores[jour(r)] = 50));
      const habits = [{ title: 'Sport', history: [1, 3, 5].map(jour) }];

      prisma.syncData.findUnique.mockResolvedValue({ daily_scores: scores, habits });

      quota.isSubscribed.mockResolvedValue(false);
      const gratuit: any = await controller.getBilanSemaine(requeteBilan);
      expect(gratuit.analyse.habitudes[0]).toMatchObject({ titre: 'Sport', joursTenus: 3 });
      expect(gratuit.analyse.levier).toBeNull();

      quota.isSubscribed.mockResolvedValue(true);
      const abonne: any = await controller.getBilanSemaine(requeteBilan);
      expect(abonne.analyse.habitudes[0]).toMatchObject({ titre: 'Sport', joursTenus: 3 });
      expect(abonne.analyse.levier).toMatchObject({ titre: 'Sport', ecart: 40 });
    });

    it("ne demande aucune lecture pour un compte gratuit", async () => {
      // Le contraire coûterait un appel au modèle pour un texte qu'on ne montre
      // pas — et c'est le seul avantage visible de l'abonnement.
      quota.isSubscribed.mockResolvedValue(false);
      prisma.syncData.findUnique.mockResolvedValue({ daily_scores: semainePleine(), habits: [] });

      await controller.getBilanSemaine(requeteBilan);

      expect(bilanHebdo.lecture).not.toHaveBeenCalled();
    });
  });

  describe("le plan d'inscription", () => {
    const planAuto = {
      prompt: MESSAGES_AUTOMATIQUES_INSCRIPTION[0],
    } as any;

    it('ne touche ni aux coins ni au quota mensuel', async () => {
      coins.estEnDecouverte.mockResolvedValue(false);
      coins.estPremierMessage.mockResolvedValue(true);

      await controller.chat(requete, planAuto);

      expect(coins.spend).not.toHaveBeenCalled();
      expect(quota.consumeAiCredit).not.toHaveBeenCalled();
    });

    it("vaut aussi pour l'ancienne formulation, encore en base", async () => {
      coins.estEnDecouverte.mockResolvedValue(false);
      coins.estPremierMessage.mockResolvedValue(true);

      await controller.chat(requete, {
        prompt: MESSAGES_AUTOMATIQUES_INSCRIPTION[MESSAGES_AUTOMATIQUES_INSCRIPTION.length - 1],
      } as any);

      expect(quota.consumeAiCredit).not.toHaveBeenCalled();
    });

    it('est facturé si ce n’est pas le tout premier message', async () => {
      /*
        Le texte est fixe et lisible dans le code du navigateur : sans cette
        borne, le renvoyer en boucle donnerait une IA gratuite et illimitée à qui
        l'aurait remarqué.
      */
      coins.estEnDecouverte.mockResolvedValue(false);
      coins.estPremierMessage.mockResolvedValue(false);

      await controller.chat(requete, planAuto);

      expect(coins.spend).toHaveBeenCalledWith('u1');
      expect(quota.consumeAiCredit).toHaveBeenCalledWith('u1', 'chat');
    });

    it("ne va pas compter en base pour un message ordinaire", async () => {
      await controller.chat(requete, message);

      expect(coins.estPremierMessage).not.toHaveBeenCalled();
    });
  });

  // Un abonné ne paie jamais : inutile d'aller compter ses messages en base.
  it('ne compte même pas les messages d\'un abonné', async () => {
    quota.isSubscribed.mockResolvedValue(true);

    await controller.chat(requete, message);

    expect(coins.estEnDecouverte).not.toHaveBeenCalled();
    expect(coins.spend).not.toHaveBeenCalled();
  });
});

/**
 * La phrase d'ouverture est offerte, et elle doit le rester.
 *
 * C'est la première chose que voit quelqu'un qui découvre le coach, et il n'a rien
 * demandé pour l'obtenir — il a ouvert un écran. La faire payer en Énergie ou en
 * quota mensuel reviendrait à facturer l'accueil, et à vider en silence le compteur
 * de ceux qui n'ont pas encore compris à quoi il sert.
 */
describe('AiCoachingController — la phrase d\'ouverture', () => {
  let controller: AiCoachingController;
  let quota: any;
  let coins: any;
  let ouverture: { ouverture: jest.Mock };

  const requete = { user: { userId: 'u1' } } as any;

  beforeEach(async () => {
    quota = {
      consumeAiCredit: jest.fn().mockResolvedValue({}),
      refundAiCredit: jest.fn().mockResolvedValue({}),
      isSubscribed: jest.fn().mockResolvedValue(false),
      assertSubscribed: jest.fn(),
    };
    coins = {
      spend: jest.fn(),
      refund: jest.fn(),
      getBalance: jest.fn().mockResolvedValue(50),
      estEnDecouverte: jest.fn().mockResolvedValue(false),
      estPremierMessage: jest.fn().mockResolvedValue(false),
    };
    ouverture = { ouverture: jest.fn().mockResolvedValue('Il te reste ta séance.') };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiCoachingController],
      providers: [
        { provide: AiCoachingService, useValue: {} },
        { provide: AiQuotaService, useValue: quota },
        { provide: CoinLedgerService, useValue: coins },
        { provide: CoachOuvertureService, useValue: ouverture },
        // L'observation a sa propre suite de tests : le vrai service convient ici,
        // et sans historique il ne trouve rien à dire — ce qui est la réponse
        // attendue pour tous les cas vérifiés dans ce fichier.
        { provide: ObservationService, useValue: new ObservationService() },
        // Idem : le bilan de semaine a ses propres tests. Le vrai service convient,
        // et sans historique il ne trouve aucune semaine à résumer.
        { provide: WeeklyReviewService, useValue: new WeeklyReviewService() },
        // Le cache de la lecture a ses propres tests ; ici on veut seulement que
        // le contrôleur puisse être construit et qu'aucune lecture ne soit rendue.
        { provide: BilanHebdoService, useValue: { lecture: jest.fn().mockResolvedValue(null) } },
        AnalyseHabitudesService,
        {
          provide: PrismaService,
          useValue: { syncData: { findUnique: jest.fn().mockResolvedValue(null) } },
        },
      ],
    })
      /*
        La cadence n'est pas le sujet de ces tests, et son garde reclame les
        fournisseurs du module Throttler. Le neutraliser ici evite de monter tout
        ce module pour verifier un debit de coins — et surtout evite que ces
        tests-la commencent a dependre d'un compteur de requetes.
        Sa propre logique est verifiee dans cadence.guard.spec.ts.
      */
      .overrideGuard(CadenceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiCoachingController>(AiCoachingController);
  });

  it('ne débite ni Énergie ni quota mensuel', async () => {
    await controller.getOuverture(requete, { context: {} });

    expect(coins.spend).not.toHaveBeenCalled();
    expect(quota.consumeAiCredit).not.toHaveBeenCalled();
  });

  it('transmet le contexte et le nom du coach', async () => {
    const context = { routines: [{ items: [{ title: 'Sport', done: false }] }] };

    await controller.getOuverture(requete, { context, aiName: 'Jarvis' });

    expect(ouverture.ouverture).toHaveBeenCalledWith('u1', context, 'Jarvis');
  });

  /*
    Le navigateur sait composer sa propre phrase à partir des mêmes données locales.
    Laisser remonter l'exception afficherait une erreur à quelqu'un dont le seul
    geste a été d'ouvrir une conversation — et lui montrerait un coach en panne
    avant de lui montrer un coach.
  */
  it('rend une réponse vide plutôt qu\'une erreur quand le service échoue', async () => {
    ouverture.ouverture.mockRejectedValue(new Error('Groq injoignable'));

    await expect(controller.getOuverture(requete, {})).resolves.toEqual({ texte: null });
  });

  it('supporte un corps de requête absent', async () => {
    await expect(controller.getOuverture(requete, undefined as any)).resolves.toEqual({
      texte: 'Il te reste ta séance.',
    });
  });
});
