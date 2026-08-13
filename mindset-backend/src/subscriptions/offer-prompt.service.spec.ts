import { Test, TestingModule } from '@nestjs/testing';
import { OfferPromptService, type Palier } from './offer-prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoinLedgerService } from '../ai-coaching/coin-ledger.service';

/**
 * La cadence de relance est de la logique de dates pure : elle ne lève jamais
 * d'exception, elle se contente de parler trop souvent ou plus jamais. Les deux
 * fautes sont invisibles en lecture de code et coûteuses en production — l'une
 * fait désinstaller, l'autre ne vend rien.
 */
describe('OfferPromptService — quand reparler de l\'abonnement', () => {
  let service: OfferPromptService;
  let prisma: any;

  /** 12h pour que les calculs en jours ne dépendent pas du fuseau. */
  const LE = (jour: number) => new Date(2026, 0, jour, 12, 0, 0);

  /** Compte type : inscrit le 1er, gratuit, jamais relancé, cinquante coins. */
  const compte = (sur: Partial<Record<string, any>> = {}) => ({
    created_at: LE(1),
    subscription: null,
    sync_data: { ai_credits: CoinLedgerService.SOLDE_DEPART },
    offer_prompt: null,
    ...sur,
  });

  const memoire = (dernier_palier: Palier, vueLe: Date, reports = 0) => ({
    dernier_palier,
    derniere_vue: vueLe,
    vues: 1,
    reports,
    ouvertures: 0,
  });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      aiUsage: { count: jest.fn().mockResolvedValue(0) },
      offerPrompt: {
        upsert: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OfferPromptService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(OfferPromptService);
  });

  const decider = async (utilisateur: any, le: Date) => {
    prisma.user.findUnique.mockResolvedValue(utilisateur);
    return service.decider('u1', le);
  };

  describe('qui ne doit jamais être relancé', () => {
    it('un abonné : il n\'a rien à acheter', async () => {
      const d = await decider(compte({ subscription: { status: 'ACTIVE' } }), LE(40));
      expect(d).toMatchObject({ afficher: false, raison: 'abonne' });
    });

    // Le webhook écrit désormais le statut réel de Stripe : pendant les sept jours
    // d'essai, un nouvel abonné est TRIALING. L'oublier ici reviendrait à lui vendre
    // ce qu'il vient d'acheter, précisément la semaine où il décide s'il garde.
    it('un compte en essai : TRIALING est un abonnement payé', async () => {
      const d = await decider(compte({ subscription: { status: 'TRIALING' } }), LE(40));
      expect(d).toMatchObject({ afficher: false, raison: 'abonne' });
    });

    it('un compte de moins de trois jours : il n\'a pas encore vu ce qu\'il achèterait', async () => {
      const d = await decider(compte(), LE(3)); // inscrit le 1er → 2 jours
      expect(d).toMatchObject({ afficher: false, raison: 'trop_jeune' });
    });
  });

  describe('les paliers, franchis un par un', () => {
    it('le troisième jour ouvre le premier palier', async () => {
      const d = await decider(compte(), LE(4));
      expect(d).toMatchObject({ afficher: true, palier: 'j3', jours: 3 });
    });

    it('un compte ancien jamais relancé commence quand même par j3', async () => {
      const d = await decider(compte(), LE(200));
      expect(d.palier).toBe('j3');
    });

    it('après j3, rien tant que le compte n\'a pas sept jours', async () => {
      const d = await decider(compte({ offer_prompt: memoire('j3', LE(4)) }), LE(6));
      expect(d).toMatchObject({ afficher: false });
    });

    // Les deux règles se cumulent : le seuil du palier dit qu'on *pourrait* parler,
    // le délai minimum dit qu'on s'est déjà adressé à cette personne cette semaine.
    it('sept jours d\'ancienneté ne suffisent pas si j3 date de trois jours', async () => {
      const d = await decider(compte({ offer_prompt: memoire('j3', LE(5)) }), LE(8));
      expect(d).toMatchObject({ afficher: false, raison: 'trop_recent' });
    });

    it('le septième jour ouvre j7 — mais seulement une semaine après j3', async () => {
      const d = await decider(compte({ offer_prompt: memoire('j3', LE(4)) }), LE(22));
      expect(d).toMatchObject({ afficher: true, palier: 'j7' });
    });

    it('j21 vient ensuite, jamais avant', async () => {
      const d = await decider(compte({ offer_prompt: memoire('j7', LE(8)) }), LE(30));
      expect(d).toMatchObject({ afficher: true, palier: 'j21' });
    });
  });

  describe('la protection contre le harcèlement', () => {
    it('jamais deux relances dans la même semaine', async () => {
      const d = await decider(compte({ offer_prompt: memoire('j3', LE(20)) }), LE(24));
      expect(d).toMatchObject({ afficher: false, raison: 'trop_recent' });
    });

    // Trois « plus tard » ne sont plus une hésitation, c'est une réponse.
    it('après trois reports, la cadence passe au mois', async () => {
      const apresTroisRefus = compte({ offer_prompt: memoire('j21', LE(20), 3) });
      expect(await decider(apresTroisRefus, LE(45))).toMatchObject({ raison: 'trop_recent' });
      expect(await decider(apresTroisRefus, LE(55))).toMatchObject({ afficher: true });
    });

    it('une fois les paliers datés épuisés, une seule relance par mois', async () => {
      const fini = compte({ offer_prompt: memoire('j21', LE(22)) });
      // Le délai minimum de sept jours est franchi, mais pas le mois.
      expect(await decider(fini, LE(35))).toMatchObject({ afficher: false });
      expect(await decider(fini, LE(53))).toMatchObject({ afficher: true, palier: 'recurrent' });
    });

    it('et le rythme mensuel se maintient ensuite', async () => {
      const boucle = compte({ offer_prompt: memoire('recurrent', LE(60)) });
      expect(await decider(boucle, LE(80))).toMatchObject({ afficher: false });
      expect(await decider(boucle, LE(95))).toMatchObject({ afficher: true, palier: 'recurrent' });
    });
  });

  describe('l\'angle : ce dont on parle une fois qu\'on parle', () => {
    it('bloqué faute de coins : c\'est la seule chose qui l\'intéresse', async () => {
      const d = await decider(compte({ sync_data: { ai_credits: 5 } }), LE(10));
      expect(d.angle).toBe('coins');
    });

    it('quota mensuel presque épuisé', async () => {
      prisma.aiUsage.count.mockResolvedValue(9);
      const d = await decider(compte(), LE(10));
      expect(d).toMatchObject({ angle: 'quota', messagesUtilises: 9, messagesRestants: 1 });
    });

    it('sinon, on parle du temps passé ensemble', async () => {
      const d = await decider(compte(), LE(10));
      expect(d).toMatchObject({ angle: 'temps', coins: CoinLedgerService.SOLDE_DEPART });
    });

    // getBalance ouvre la ligne à cinquante ; lire l'absence de ligne comme un zéro
    // annoncerait « tu n'as plus de coins » à quelqu'un qui a ses cinquante intacts.
    it('un compte qui n\'a jamais synchronisé n\'est pas un compte à zéro', async () => {
      const d = await decider(compte({ sync_data: null }), LE(10));
      expect(d).toMatchObject({ angle: 'temps', coins: CoinLedgerService.SOLDE_DEPART });
    });
  });

  describe('ce qu\'on retient de la relance', () => {
    it('un affichage fait courir le délai', async () => {
      await service.enregistrer('u1', 'j7', 'vue');
      const args = prisma.offerPrompt.upsert.mock.calls[0][0];
      expect(args.update.derniere_vue).toBeInstanceOf(Date);
      expect(args.update.vues).toEqual({ increment: 1 });
    });

    // Sinon un clic sur « Découvrir Pro » repousserait la relance suivante d'une
    // semaine de plus : on punirait l'intérêt.
    it('une ouverture de l\'offre ne repousse pas la relance suivante', async () => {
      await service.enregistrer('u1', 'j7', 'ouvert');
      const args = prisma.offerPrompt.upsert.mock.calls[0][0];
      expect(args.update.derniere_vue).toBeUndefined();
      expect(args.update.ouvertures).toEqual({ increment: 1 });
    });

    it('un report est compté à part : c\'est lui qui déclenche la fatigue', async () => {
      await service.enregistrer('u1', 'j3', 'reporte');
      const args = prisma.offerPrompt.upsert.mock.calls[0][0];
      expect(args.update.reports).toEqual({ increment: 1 });
    });
  });
});
