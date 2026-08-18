import { Test, TestingModule } from '@nestjs/testing';
import { RelanceEmailService } from './relance-email.service';
import { PrismaService } from '../prisma/prisma.service';

/*
  Ce qui se vérifie ici tient en une phrase : on n'écrit qu'à ceux à qui on a
  quelque chose à dire, et jamais deux fois. Un service de relance qui se trompe ne
  produit pas d'erreur — il produit des e-mails, chez de vraies personnes, et
  l'incident se découvre à la réputation d'expéditeur perdue.
*/
describe('RelanceEmailService', () => {
  let service: RelanceEmailService;
  let prisma: any;

  const JOUR = 86_400_000;
  const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR);
  const cle = (jours: number) => ilYA(jours).toISOString().slice(0, 10);

  const compte = (opts: {
    inscritIlYA: number;
    joursActifs?: number[];
    dejaEnvoyes?: string[];
    email?: string;
  }) => {
    const daily_scores: Record<string, number> = {};
    for (const j of opts.joursActifs ?? []) daily_scores[cle(j)] = 50;
    return {
      id: `u-${Math.random()}`,
      email: opts.email ?? 'yannis@example.com',
      first_name: 'Yannis',
      created_at: ilYA(opts.inscritIlYA),
      sync_data: { daily_scores },
      relances: (opts.dejaEnvoyes ?? []).map((motif) => ({ motif })),
    };
  };

  /**
   * Les deux populations de la tournée, distinguées sur la requête.
   *
   * `tournee()` interroge la base deux fois : ceux qui s'éloignent, puis les
   * abonnés à remercier. Un mock qui rend la même liste aux deux ferait remercier
   * tout le monde, et les tests de relance mesureraient alors le mauvais motif.
   */
  const avec = async (comptes: any[], abonnes: any[] = []) => {
    prisma.user.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.subscription ? abonnes : comptes),
    );
    return service.tournee();
  };

  /** Un abonné tel que le rend la requête des remerciements. */
  const abonne = (opts: { email?: string; inscritIlYA?: number } = {}) => ({
    id: `a-${Math.random()}`,
    email: opts.email ?? 'abonne@example.com',
    first_name: 'Mohamed',
    created_at: ilYA(opts.inscritIlYA ?? 0),
  });

  beforeEach(async () => {
    prisma = {
      user: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      relanceEmail: { create: jest.fn().mockResolvedValue({}) },
    };
    process.env.BREVO_API_KEY = 'cle-de-test';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' }) as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [RelanceEmailService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RelanceEmailService);
  });

  afterEach(() => {
    delete process.env.BREVO_API_KEY;
  });

  describe('à qui on écrit', () => {
    it('écrit à celui qui s’est inscrit et n’est jamais entré', async () => {
      const bilan = await avec([compte({ inscritIlYA: 3 })]);

      expect(bilan.envoyes).toBe(1);
      expect(bilan.parMotif).toEqual({ jamais_ouvert: 1 });
    });

    it('laisse tranquille celui qui vient de s’inscrire', async () => {
      // Quelqu'un qui s'inscrit le soir et compte revenir le surlendemain n'a rien
      // abandonné. « Tu n'es jamais revenu » lui apprendrait surtout que personne
      // ne regarde vraiment.
      const bilan = await avec([compte({ inscritIlYA: 1 })]);

      expect(bilan.envoyes).toBe(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('écrit à celui qui a commencé puis s’est arrêté', async () => {
      const bilan = await avec([compte({ inscritIlYA: 10, joursActifs: [10, 9, 5] })]);

      expect(bilan.parMotif).toEqual({ decroche: 1 });
    });

    it('ne dérange pas quelqu’un venu hier', async () => {
      const bilan = await avec([compte({ inscritIlYA: 10, joursActifs: [10, 1] })]);

      expect(bilan.envoyes).toBe(0);
    });

    it('se tait passé un mois', async () => {
      // Écrire à quelqu'un inscrit il y a trois mois n'est plus une relance, c'est
      // du démarchage — et c'est ce qui fait signaler un expéditeur.
      const bilan = await avec([
        compte({ inscritIlYA: 90 }),
        compte({ inscritIlYA: 90, joursActifs: [90, 89] }),
      ]);

      expect(bilan.envoyes).toBe(0);
    });

    it('ne renvoie jamais le même motif deux fois', async () => {
      // Sans cette mémoire, l'état du compte ne changeant pas, le même e-mail
      // repartirait tous les matins jusqu'au signalement.
      const bilan = await avec([
        compte({ inscritIlYA: 5, dejaEnvoyes: ['jamais_ouvert'] }),
        compte({ inscritIlYA: 10, joursActifs: [10, 6], dejaEnvoyes: ['decroche'] }),
      ]);

      expect(bilan.envoyes).toBe(0);
      expect(prisma.relanceEmail.create).not.toHaveBeenCalled();
    });

    it('peut relancer un décrocheur déjà relancé pour ne jamais avoir ouvert', async () => {
      // Les deux motifs décrivent deux moments différents de la même personne : le
      // second n'est pas une répétition du premier.
      const bilan = await avec([
        compte({ inscritIlYA: 20, joursActifs: [12], dejaEnvoyes: ['jamais_ouvert'] }),
      ]);

      expect(bilan.parMotif).toEqual({ decroche: 1 });
    });
  });

  describe('ce qui est écrit en base', () => {
    it('n’inscrit rien quand Brevo a refusé', async () => {
      /*
        La trace dit « envoyé », pas « tenté ». L'écrire sur un échec condamnerait
        la personne à ne jamais recevoir la relance tout en donnant à croire qu'elle
        l'a reçue — la panne muette caractéristique de ce projet.
      */
      (global.fetch as any).mockResolvedValue({ ok: false, text: async () => 'quota dépassé' });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const bilan = await avec([compte({ inscritIlYA: 3 })]);

      expect(bilan.envoyes).toBe(0);
      expect(bilan.echecs).toBe(1);
      expect(prisma.relanceEmail.create).not.toHaveBeenCalled();
    });

    it('borne le nombre d’envois par tournée', async () => {
      // Une salve massive est ce qui abîme une réputation d'expéditeur, et le premier
      // passage de la tâche trouve d'un coup tout l'historique des comptes dormants.
      const beaucoup = Array.from({ length: RelanceEmailService.MAX_PAR_TOURNEE + 12 }, () =>
        compte({ inscritIlYA: 5 }),
      );

      const bilan = await avec(beaucoup);

      expect(bilan.envoyes).toBe(RelanceEmailService.MAX_PAR_TOURNEE);
    });

    it('ne demande à la base que les comptes joignables et récents', async () => {
      await avec([]);

      const filtre = prisma.user.findMany.mock.calls[0][0].where;
      expect(filtre.deleted_at).toBeNull();
      // Un refus doit se traduire par un compte jamais lu, et non par un compte lu
      // puis écarté : c'est la même chose ici, mais pas le jour où quelqu'un ajoute
      // une branche d'envoi plus bas.
      expect(filtre.relances_email).toBe(true);
    });
  });

  describe('le mode simulation', () => {
    it('n’envoie rien et n’écrit rien, mais dit qui recevrait quoi', async () => {
      // Un envoi est irréversible et sort du produit : la liste doit pouvoir se
      // lire avant, sans avoir à la déduire du code.
      const eloignes = [
        compte({ inscritIlYA: 4, email: 'jamais@example.com' }),
        compte({ inscritIlYA: 12, joursActifs: [12, 8], email: 'parti@example.com' }),
        compte({ inscritIlYA: 12, joursActifs: [12, 1], email: 'actif@example.com' }),
      ];
      prisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.subscription ? [] : eloignes),
      );

      const bilan = await service.tournee(true);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(prisma.relanceEmail.create).not.toHaveBeenCalled();
      expect(bilan.simulation).toBe(true);
      expect(bilan.parMotif).toEqual({ jamais_ouvert: 1, decroche: 1 });
      expect(bilan.destinataires).toEqual([
        { email: 'jamais@example.com', motif: 'jamais_ouvert', inscritIlYA: 4 },
        { email: 'parti@example.com', motif: 'decroche', inscritIlYA: 12 },
      ]);
    });

    it('ne sort pas les adresses quand l’envoi est réel', async () => {
      // Le décompte suffit à savoir ce qui s'est passé ; une réponse d'API n'est
      // pas un endroit où laisser traîner les adresses de tout le monde.
      const bilan = await avec([compte({ inscritIlYA: 4 })]);

      expect(bilan.destinataires).toBeUndefined();
      expect(bilan.envoyes).toBe(1);
    });
  });

  describe('ce qui décide du dossier indésirables', () => {
    const corpsEnvoye = () => JSON.parse((global.fetch as any).mock.calls[0][1].body);

    it('annonce le retrait en en-tête, pas seulement en pied de page', async () => {
      /*
        Depuis février 2024, Gmail et Yahoo exigent `List-Unsubscribe` de tout
        expéditeur de masse. Sans lui, le message part en indésirable avant d'être
        lu, et aucun soin apporté au texte ne rattrape ça. C'est aussi cet en-tête
        qui fait apparaître « Se désabonner » à côté de l'expéditeur — le bouton
        que les gens utilisent au lieu de « Signaler comme indésirable », lequel
        pèse à lui seul autant que des centaines de désabonnements.
      */
      await avec([compte({ inscritIlYA: 3 })]);

      const corps = corpsEnvoye();
      expect(corps.headers['List-Unsubscribe']).toMatch(/^<https?:\/\/.+\/emails\/retrait\?u=.+&s=.+>$/);
      expect(corps.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    });

    it('part en texte et en HTML', async () => {
      // Un message qui n'a qu'une partie HTML est un signal d'indésirable à lui
      // seul : les filtres attendent le multipart de n'importe quel client normal.
      await avec([compte({ inscritIlYA: 3 })]);

      const corps = corpsEnvoye();
      expect(corps.textContent).toContain('tu n');
      expect(corps.textContent).toContain('/emails/retrait');
      expect(corps.htmlContent).toContain('<p>');
    });

    it('ne crie pas et ne promet rien dans le sujet', async () => {
      // Majuscules, points d'exclamation et vocabulaire de campagne sont ce que
      // les filtres cherchent en premier.
      await avec([compte({ inscritIlYA: 3 })]);

      const sujet = corpsEnvoye().subject;
      expect(sujet).not.toMatch(/!/);
      expect(sujet).not.toBe(sujet.toUpperCase());
      expect(sujet).not.toMatch(/gratuit|promo|offre|urgent|derni[èe]re chance/i);
    });
  });

  describe('le lien de retrait', () => {
    it('refuse une signature fabriquée', async () => {
      expect(RelanceEmailService.verifierSignature('u1', 'n-importe-quoi')).toBe(false);
      expect(RelanceEmailService.verifierSignature('u1', '')).toBe(false);
    });

    it('accepte la sienne, et pas celle d’un autre compte', async () => {
      const signature = RelanceEmailService.signature('u1');

      expect(RelanceEmailService.verifierSignature('u1', signature)).toBe(true);
      // Sans cette liaison, changer un caractère de l'URL désabonnerait un inconnu.
      expect(RelanceEmailService.verifierSignature('u2', signature)).toBe(false);
    });

    it('coupe les relances sans toucher au reste du compte', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

      await service.retirer('u1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { relances_email: false },
      });
    });
  });

  /*
    Le remerciement.

    C'est le seul message qui répond à un geste au lieu d'en réclamer un. Ce qui
    se vérifie ici est exactement ce qui coûterait cher à rater : qu'il parte une
    fois, qu'il ne reparte jamais, et qu'il ne se transforme pas en relance.
  */
  describe('le merci aux abonnés', () => {
    it('part une fois à celui qui vient de prendre l’abonnement', async () => {
      const bilan = await avec([], [abonne({ email: 'mohamed@example.com' })]);

      expect(bilan.parMotif).toEqual({ merci_abonnement: 1 });
      expect(prisma.relanceEmail.create).toHaveBeenCalledWith({
        data: { user_id: expect.any(String), motif: 'merci_abonnement' },
      });
    });

    it('ne demande que les abonnés jamais remerciés, et joignables', async () => {
      /*
        L'unicité se joue dans la requête, pas après : la filtrer en mémoire
        marcherait tant que la liste tient dans une page, puis cesserait
        silencieusement. Et l'absence de borne d'ancienneté est volontaire — on
        peut s'abonner six mois après son inscription.
      */
      await avec([], []);

      const requete = prisma.user.findMany.mock.calls
        .map(([a]: any) => a)
        .find((a: any) => a?.where?.subscription);

      expect(requete.where).toEqual(
        expect.objectContaining({
          deleted_at: null,
          relances_email: true,
          subscription: { status: { in: ['ACTIVE', 'TRIALING'] } },
          relances: { none: { motif: 'merci_abonnement' } },
        }),
      );
      expect(requete.where.created_at).toBeUndefined();
    });

    it('ne demande rien en retour', async () => {
      // Un merci muni d'un bouton redevient une relance. C'est le seul message du
      // produit qui n'a pas d'appel à l'action, et ça doit le rester.
      await avec([], [abonne()]);

      const corps = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      // Un seul lien, et c'est celui du retrait : le pied de page en porte
      // toujours un, l'absence de bouton se vérifie donc au compte et non à
      // l'absence de balise.
      const liens = corps.htmlContent.match(/<a /g) ?? [];
      expect(liens).toHaveLength(1);
      expect(corps.htmlContent).toContain('/emails/retrait');
      expect(corps.textContent).toContain('merci');
    });

    it('n’écrit pas deux fois à la même personne dans une tournée', async () => {
      // Un merci suivi le même jour d'un « tu n'es jamais revenu » se contredirait
      // tout seul. Le cas existe : on peut s'abonner puis ne pas ouvrir l'app.
      const dormant = compte({ inscritIlYA: 5 });
      const bilan = await avec([dormant], [{ ...dormant }]);

      expect(bilan.envoyes).toBe(1);
      expect(bilan.parMotif).toEqual({ merci_abonnement: 1 });
    });

    it('n’inscrit rien quand l’envoi échoue', async () => {
      // La trace dit « envoyé », pas « tenté » : l'inscrire sur un échec priverait
      // définitivement quelqu'un de son remerciement.
      (global.fetch as any).mockResolvedValue({ ok: false, text: async () => 'refus' });

      const bilan = await avec([], [abonne()]);

      expect(bilan.echecs).toBe(1);
      expect(bilan.envoyes).toBe(0);
      expect(prisma.relanceEmail.create).not.toHaveBeenCalled();
    });
  });
});
