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
