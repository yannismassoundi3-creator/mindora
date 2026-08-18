import { AnalyseHabitudesService } from './analyse-habitudes.service';

/**
 * Ce que ce fichier surveille, c'est le silence.
 *
 * Un service qui cherche un lien entre deux séries en trouve toujours un si on ne
 * l'en empêche pas. La plupart des tests ci-dessous vérifient donc qu'il ne dit
 * **rien** : pas assez de journées d'un côté, écart trop faible, semaine
 * précédente inexistante. Le cas où il parle est le plus facile à écrire et le
 * moins utile à garder.
 */
describe('AnalyseHabitudesService', () => {
  const service = new AnalyseHabitudesService();

  /** Un mardi à midi UTC : figé, sinon la fenêtre glisse d'un test à l'autre. */
  const MAINTENANT = Date.UTC(2026, 7, 18, 12, 0, 0);

  /** La clé d'un jour de recul, calculée comme le service la calcule. */
  const jour = (recul: number) =>
    new Date(MAINTENANT - recul * 86400000).toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Paris',
    });

  /** Des scores journaliers à partir d'une table { recul: score }. */
  const scores = (table: Record<number, number>) =>
    Object.fromEntries(Object.entries(table).map(([r, v]) => [jour(Number(r)), v]));

  const habitude = (titre: string, reculs: number[]) => ({
    title: titre,
    history: reculs.map(jour),
  });

  const analyser = (sc: Record<string, number>, habits: unknown) =>
    service.analyser(sc, habits, MAINTENANT);

  describe('trajectoire des habitudes', () => {
    it('compare les sept derniers jours aux sept précédents', () => {
      const { habitudes } = analyser(
        // Il faut une journée vécue la semaine d'avant pour que la comparaison existe.
        scores({ 1: 80, 3: 60, 9: 70 }),
        [habitude('Sommeil', [1, 2]), habitude('Sport', [8, 9, 10, 11, 12])],
      );

      expect(habitudes).toEqual([
        { titre: 'Sommeil', joursTenus: 2, joursTenusAvant: 0, evolution: 2 },
        { titre: 'Sport', joursTenus: 0, joursTenusAvant: 5, evolution: -5 },
      ]);
    });

    it('se tait sur l’évolution quand il n’y a pas eu de semaine précédente', () => {
      // Un compte créé il y a trois jours : « -5 par rapport à la semaine dernière »
      // inventerait une comparaison, comme le fait déjà l'évolution du score.
      const { habitudes } = analyser(scores({ 1: 80, 2: 60 }), [habitude('Sommeil', [1, 2])]);

      expect(habitudes[0]).toEqual({
        titre: 'Sommeil',
        joursTenus: 2,
        joursTenusAvant: null,
        evolution: null,
      });
    });

    it('ignore aujourd’hui, comme le fait le score de la semaine', () => {
      // La journée en cours est incomplète : la compter ferait afficher une
      // habitude à 1/7 le matin où elle vient d'être cochée, puis 0/7 le lendemain.
      const { habitudes } = analyser(scores({ 1: 80 }), [habitude('Sommeil', [0])]);
      expect(habitudes[0].joursTenus).toBe(0);
    });

    it('survit à des habitudes abîmées', () => {
      const { habitudes } = analyser(scores({ 1: 80 }), [
        { title: '', history: [jour(1)] },
        { title: 'Sans historique' },
        { name: 'Ancien nom de champ', completed_dates: [jour(1), jour(2)] },
        'pas un objet',
      ]);

      expect(habitudes.map((h) => h.titre)).toEqual(['Ancien nom de champ', 'Sans historique']);
    });
  });

  describe('levier', () => {
    /** Trois journées à 90 avec l'habitude, trois à 50 sans : un écart de 40 points. */
    const semaineContrastee = scores({ 1: 90, 2: 50, 3: 90, 4: 50, 5: 90, 6: 50 });

    it('rapproche une habitude du score des journées', () => {
      const { levier } = analyser(semaineContrastee, [habitude('Sport', [1, 3, 5])]);

      expect(levier).toEqual({
        titre: 'Sport',
        scoreAvec: 90,
        scoreSans: 50,
        ecart: 40,
        joursAvec: 3,
        joursSans: 3,
      });
    });

    it('se tait quand un côté a moins de trois journées', () => {
      // Deux journées avec : la moyenne tient à une seule, un lundi exceptionnel
      // suffirait à fabriquer un levier.
      const { levier } = analyser(semaineContrastee, [habitude('Sport', [1, 3])]);
      expect(levier).toBeNull();
    });

    it('se tait quand l’écart est trop faible', () => {
      const serre = scores({ 1: 70, 2: 62, 3: 70, 4: 62, 5: 70, 6: 62 });
      const { levier } = analyser(serre, [habitude('Sport', [1, 3, 5])]);
      expect(levier).toBeNull();
    });

    it('se tait sur un écart négatif', () => {
      // Une habitude tenue surtout les jours creux — parce qu'elle est la seule
      // chose qu'on arrive encore à faire. Le dire se lit comme un reproche.
      const { levier } = analyser(semaineContrastee, [habitude('Sport', [2, 4, 6])]);
      expect(levier).toBeNull();
    });

    it('retient le lien le plus net quand plusieurs passent le seuil', () => {
      const sc = scores({ 1: 95, 2: 40, 3: 95, 4: 40, 5: 95, 6: 40, 7: 70 });
      const { levier } = analyser(sc, [
        habitude('Faible', [1, 3, 7]),
        habitude('Fort', [1, 3, 5]),
      ]);
      expect(levier?.titre).toBe('Fort');
    });

    it('ne regarde pas au-delà de sa fenêtre', () => {
      // Une habitude abandonnée il y a deux mois ne décrit plus personne.
      const vieux = scores({ 1: 50, 2: 50, 3: 50, 40: 95, 41: 95, 42: 95 });
      const { levier } = analyser(vieux, [habitude('Sport', [40, 41, 42])]);
      expect(levier).toBeNull();
    });

    it('ignore les journées sans score', () => {
      // Un jour absent de daily_scores n'est pas un jour à zéro : il ne s'est rien
      // passé, et le compter ferait baisser artificiellement le côté « sans ».
      const { levier } = analyser(scores({ 1: 90, 3: 90, 5: 90, 2: 50, 4: 50, 6: 50 }), [
        habitude('Sport', [1, 3, 5, 20, 21]),
      ]);
      expect(levier?.joursAvec).toBe(3);
      expect(levier?.joursSans).toBe(3);
    });
  });

  it('ne rend rien sur un compte vide, sans lever', () => {
    expect(service.analyser(null, null, MAINTENANT)).toEqual({ habitudes: [], levier: null });
    expect(service.analyser(undefined, 'pas un tableau', MAINTENANT)).toEqual({
      habitudes: [],
      levier: null,
    });
  });
});
