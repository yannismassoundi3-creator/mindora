import { Logger } from '@nestjs/common';
import { WeeklyReviewService } from './weekly-review.service';

/**
 * Le bilan du dimanche envoyait à tout le monde la même phrase, qui promettait un
 * « plan d'attaque pour lundi » que rien ne préparait, et citait le score mental du
 * jour — celui d'un dimanche soir — comme s'il résumait la semaine.
 *
 * Il dit maintenant la vérité des chiffres à tout le monde, et les abonnés reçoivent
 * en plus la lecture qu'en fait le coach. Ces tests verrouillent la partie qui ne
 * dépend d'aucun modèle : le calcul.
 */
describe('WeeklyReviewService — résumé de la semaine', () => {
  const service = new WeeklyReviewService();

  /** Même convention que le service : clé du jour en heure de Paris. */
  const cle = (ilYaNJours: number) =>
    new Date(Date.now() - ilYaNJours * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

  it('compte les jours actifs et la moyenne des jours travaillés', () => {
    const s = service.resumerSemaine({ [cle(1)]: 60, [cle(2)]: 40, [cle(3)]: 0 }, []);

    // Les jours à zéro ne sont pas des jours travaillés : les inclure dans la moyenne
    // punirait deux fois un jour de repos, une fois dans le compte et une fois dans le score.
    expect(s).toMatchObject({ joursActifs: 2, scoreMoyen: 50, meilleurScore: 60 });
  });

  // Envoyer « 0 jour actif, score moyen 0 % » à quelqu'un qui n'a rien fait de la
  // semaine est un reproche, pas un service. On se tait.
  it('ne rend rien quand la semaine est vide', () => {
    expect(service.resumerSemaine({}, [])).toBeNull();
    expect(service.resumerSemaine(null, [])).toBeNull();
    expect(service.resumerSemaine({ [cle(1)]: 0 }, [])).toBeNull();
  });

  it('ignore les jours antérieurs à la semaine écoulée', () => {
    const s = service.resumerSemaine({ [cle(1)]: 50, [cle(20)]: 100 }, []);

    expect(s?.joursActifs).toBe(1);
    expect(s?.meilleurScore).toBe(50);
  });

  it('compare à la semaine précédente', () => {
    const s = service.resumerSemaine({ [cle(1)]: 80, [cle(9)]: 50 }, []);

    expect(s?.evolution).toBe(30);
  });

  // « +42 » face à rien ferait passer un premier essai pour un exploit.
  it("n'annonce aucune évolution sans semaine précédente", () => {
    const s = service.resumerSemaine({ [cle(1)]: 80 }, []);

    expect(s?.evolution).toBe(0);
  });

  it('classe les habitudes de la plus tenue à la moins tenue', () => {
    const s = service.resumerSemaine({ [cle(1)]: 50 }, [
      { title: 'Lecture', history: [cle(1)] },
      { title: 'Sport', history: [cle(1), cle(2), cle(3)] },
    ]);

    expect(s?.habitudes.map((h) => `${h.titre}:${h.joursTenus}`)).toEqual(['Sport:3', 'Lecture:1']);
  });

  it('survit à des données mal formées', () => {
    const s = service.resumerSemaine({ [cle(1)]: 50 }, [
      { title: 'Sans historique' },
      { history: [cle(1)] },
      null,
    ] as any);

    // L'entrée sans titre est écartée : une ligne « : tenue 1/7 » dans le bilan
    // n'apprendrait rien à personne.
    expect(s?.habitudes).toEqual([{ titre: 'Sans historique', joursTenus: 0 }]);
  });
});

describe('WeeklyReviewService — texte des comptes gratuits', () => {
  const service = new WeeklyReviewService();
  const semaine = { joursActifs: 4, scoreMoyen: 62, meilleurScore: 90, evolution: 0, habitudes: [] };

  // Ce texte doit rester utile tout seul : c'est ce qui rend honnête la version
  // payante, qui ajoute une lecture par-dessus au lieu de retirer quelque chose.
  it('donne les chiffres réels', () => {
    const t = service.texteFactuel('Yannis', semaine);

    expect(t).toContain('4 jours actifs');
    expect(t).toContain('62%');
  });

  it("mentionne l'évolution seulement quand il y en a une", () => {
    expect(service.texteFactuel('Yannis', semaine)).not.toContain('vs semaine');
    expect(service.texteFactuel('Yannis', { ...semaine, evolution: 12 })).toContain('+12 pts');
    expect(service.texteFactuel('Yannis', { ...semaine, evolution: -8 })).toContain('-8 pts');
  });

  it('reste lisible sans prénom', () => {
    expect(service.texteFactuel('', semaine)).toMatch(/^Ta semaine/);
  });

  it("accorde le singulier sur une seule journée", () => {
    expect(service.texteFactuel('Yannis', { ...semaine, joursActifs: 1 })).toContain('1 jour actif,');
  });
});

/**
 * La partie qui dépend du modèle, elle, se simule.
 *
 * Le bilan part une fois par semaine : une phrase coupée au milieu d'un mot y reste
 * sept jours sur l'écran de quelqu'un, et rien ne permet de la rattraper. C'est ce
 * qui justifie de préférer le texte factuel, moins bon mais entier.
 */
describe('WeeklyReviewService — une réponse coupée par max_tokens', () => {
  let service: WeeklyReviewService;
  let fetchMock: jest.Mock;
  const cleInitiale = process.env.GROQ_API_KEY;

  const semaine = { joursActifs: 4, scoreMoyen: 62, meilleurScore: 90, evolution: 0, habitudes: [] };

  const reponseOk = (contenu: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenu } }] }),
  });
  const reponseCoupee = (contenu: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenu }, finish_reason: 'length' }] }),
  });

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'cle-de-test';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    service = new WeeklyReviewService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (cleInitiale === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = cleInitiale;
  });

  it('refuse la phrase coupée avant le plafond et essaie le modèle suivant', async () => {
    fetchMock
      .mockResolvedValueOnce(reponseCoupee('Quatre jours tenus cette semaine, et le point à surveiller'))
      .mockResolvedValueOnce(reponseOk('Quatre jours tenus. Vise cinq la semaine prochaine.'));

    expect(await service.generate('Yannis', semaine)).toBe('Quatre jours tenus. Vise cinq la semaine prochaine.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retombe sur le texte factuel si les deux modèles sont coupés', async () => {
    fetchMock.mockResolvedValue(reponseCoupee('Quatre jours tenus cette semaine, et'));

    expect(await service.generate('Yannis', semaine)).toBeNull();
  });

  // Au-delà du plafond, la coupure est absorbée : le résultat est identique, et un
  // second appel se paierait sur un quota quotidien déjà compté.
  it('garde la phrase coupée que le plafond tronque de toute façon', async () => {
    fetchMock.mockResolvedValueOnce(reponseCoupee('Quatre jours tenus cette semaine. '.repeat(10)));

    const texte = await service.generate('Yannis', semaine);

    expect(texte!.length).toBeLessThanOrEqual(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Le plafond ne doit pas se voir.
   *
   * Il coupait au caractère près : l'écran de bilan finissait sur « qui pourrait
   * avoir u… », sur la lecture que l'abonnement paie. Un texte qui s'arrête sur
   * une phrase entière se lit comme un texte terminé ; un texte coupé au milieu
   * d'un mot dit au lecteur qu'on lui a retiré quelque chose.
   */
  describe('le plafond de longueur', () => {
    it('finit sur une phrase complète, sans points de suspension', async () => {
      fetchMock.mockResolvedValueOnce(reponseOk('Quatre jours tenus cette semaine. '.repeat(10)));

      const texte = await service.generate('Yannis', semaine);

      expect(texte!.endsWith('.')).toBe(true);
      expect(texte).not.toContain('…');
      expect(texte!.length).toBeLessThanOrEqual(200);
    });

    it('ne coupe jamais au milieu d’un mot', async () => {
      // Une seule phrase interminable : aucune ponctuation où s'arrêter proprement.
      fetchMock.mockResolvedValueOnce(reponseOk('discipline '.repeat(40)));

      const texte = await service.generate('Yannis', semaine);

      expect(texte!.endsWith('…')).toBe(true);
      // Le mot qui précède les points de suspension est entier.
      expect(texte!.slice(0, -1).trim().endsWith('discipline')).toBe(true);
    });

    it("laisse passer intact un texte qui tient sous le plafond", async () => {
      fetchMock.mockResolvedValueOnce(reponseOk('Quatre jours tenus. Vise cinq la semaine prochaine.'));

      expect(await service.generate('Yannis', semaine)).toBe(
        'Quatre jours tenus. Vise cinq la semaine prochaine.',
      );
    });

    it("ne coupe pas sur le point d'un nombre décimal", async () => {
      // « 69.5 » contient un point : sans l'espace exigée après la ponctuation, la
      // coupure tomberait au milieu d'une donnée chiffrée.
      const long = 'Ton score atteint 69.5 pour cette semaine complete et reguliere. ';
      fetchMock.mockResolvedValueOnce(reponseOk(long.repeat(4)));

      const texte = await service.generate('Yannis', semaine);

      expect(texte!.endsWith('69.')).toBe(false);
      expect(texte!.endsWith('.')).toBe(true);
    });
  });
});
