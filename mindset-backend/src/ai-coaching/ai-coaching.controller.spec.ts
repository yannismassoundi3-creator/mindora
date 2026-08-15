import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AiCoachingController } from './ai-coaching.controller';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';
import { CoachOuvertureService } from './coach-ouverture.service';

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
    };
    ouverture = { ouverture: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiCoachingController],
      providers: [
        { provide: AiCoachingService, useValue: ia },
        { provide: AiQuotaService, useValue: quota },
        { provide: CoinLedgerService, useValue: coins },
        { provide: CoachOuvertureService, useValue: ouverture },
      ],
    }).compile();

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
  let coins: { spend: jest.Mock; refund: jest.Mock; getBalance: jest.Mock; estEnDecouverte: jest.Mock };
  let ouverture: { ouverture: jest.Mock };

  const requete = { user: { userId: 'u1' } } as any;
  const message = { prompt: 'Fais-moi un plan' } as any;

  beforeEach(async () => {
    ia = { chatWithAi: jest.fn().mockResolvedValue({ reply: 'Voilà.' }) };
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
    };
    ouverture = { ouverture: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiCoachingController],
      providers: [
        { provide: AiCoachingService, useValue: ia },
        { provide: AiQuotaService, useValue: quota },
        { provide: CoinLedgerService, useValue: coins },
        { provide: CoachOuvertureService, useValue: ouverture },
      ],
    }).compile();

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
    };
    ouverture = { ouverture: jest.fn().mockResolvedValue('Il te reste ta séance.') };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiCoachingController],
      providers: [
        { provide: AiCoachingService, useValue: {} },
        { provide: AiQuotaService, useValue: quota },
        { provide: CoinLedgerService, useValue: coins },
        { provide: CoachOuvertureService, useValue: ouverture },
      ],
    }).compile();

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
