import { ObservationService } from './observation.service';

/**
 * Ce qui est vérifié ici, c'est que le coach ne devine pas.
 *
 * Une observation fausse coûte plus cher que pas d'observation : elle apprend en
 * une phrase que l'application raconte n'importe quoi, et elle le fait au moment
 * précis où l'on essayait de montrer qu'elle suit vraiment quelqu'un. Les tests
 * portent donc d'abord sur les cas où le service doit se taire — trop peu de
 * jours, trop peu d'occurrences, écart trop faible.
 */
describe('ObservationService', () => {
  const service = new ObservationService();

  /** Le mercredi 2025-08-20 à midi UTC, pour que les jours de semaine soient stables. */
  const MAINTENANT = new Date('2025-08-20T12:00:00Z');

  const cle = (recul: number) => {
    const d = new Date(MAINTENANT);
    d.setUTCDate(d.getUTCDate() - recul);
    return d.toISOString().slice(0, 10);
  };

  /** Un historique : `scores[recul] = score`, du plus récent au plus ancien. */
  const historique = (scores: number[]) => {
    const s: Record<string, number> = {};
    scores.forEach((score, recul) => {
      s[cle(recul)] = score;
    });
    return s;
  };

  /** Le jour de la semaine d'un recul donné, pour construire des motifs voulus. */
  const jourDe = (recul: number) => new Date(cle(recul) + 'T12:00:00Z').getUTCDay();

  describe('quand il faut se taire', () => {
    it("ne dit rien sans historique", () => {
      expect(service.meilleure(null, MAINTENANT)).toBeNull();
      expect(service.meilleure({}, MAINTENANT)).toBeNull();
    });

    it("ne dit rien sur moins de douze jours", () => {
      // Onze jours pleins : le motif serait peut-être là, mais on n'en sait rien.
      const scores = historique(Array(11).fill(80));
      expect(service.meilleure(scores, MAINTENANT)).toBeNull();
    });

    it("ne dit rien d'un compte qui n'a agi que deux fois", () => {
      const scores = historique([80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80]);
      expect(service.meilleure(scores, MAINTENANT)).toBeNull();
    });

    it("ne compte pas comme des échecs les jours d'avant l'inscription", () => {
      // Un compte de quinze jours, régulier depuis le début. Sans le garde sur le
      // premier jour connu, les treize jours antérieurs vaudraient zéro et il
      // passerait pour quelqu'un qui vient par à-coups.
      const scores = historique(Array(15).fill(70));
      const o = service.meilleure(scores, MAINTENANT);
      expect(o?.code).not.toBe('regularite');
      if (o?.code === 'regularite') expect(o.titre).not.toContain('à-coups');
    });

    it("ne nomme pas un jour faible sur un seul mauvais samedi", () => {
      /*
        Vingt jours à 80 %, sauf un seul samedi à zéro. La moyenne des samedis
        tombe alors à 53 % contre 80 % ailleurs : l'écart franchit le seuil, et
        « tes samedis tournent à 53 % » serait exact tout en étant complètement
        trompeur. Il n'y a pas de motif, il y a un mauvais samedi.
      */
      const scores: Record<string, number> = {};
      for (let recul = 0; recul < 20; recul++) {
        scores[cle(recul)] = jourDe(recul) === 6 && recul < 7 ? 0 : 80;
      }
      const o = service.observations(scores, MAINTENANT).find((x) => x.code === 'jourFaible');
      expect(o).toBeUndefined();
    });

    it("ne nomme pas un écart trop faible pour être autre chose que du bruit", () => {
      // 75 % contre 65 % : dix points, moitié moins que le seuil.
      const scores: Record<string, number> = {};
      for (let recul = 0; recul < 28; recul++) {
        scores[cle(recul)] = jourDe(recul) === 6 ? 65 : 75;
      }
      const o = service.observations(scores, MAINTENANT).find((x) => x.code === 'jourFaible');
      expect(o).toBeUndefined();
    });

    it("ne dit rien d'une régularité moyenne", () => {
      // Un jour sur deux : ni exemplaire ni erratique. Il n'y a rien à en dire.
      const scores: Record<string, number> = {};
      for (let recul = 0; recul < 28; recul++) scores[cle(recul)] = recul % 2 === 0 ? 70 : 0;
      const o = service.observations(scores, MAINTENANT).find((x) => x.code === 'regularite');
      expect(o).toBeUndefined();
    });
  });

  describe('quand le motif est réel', () => {
    it('nomme le jour de la semaine qui tombe systématiquement', () => {
      const scores: Record<string, number> = {};
      for (let recul = 0; recul < 28; recul++) {
        scores[cle(recul)] = jourDe(recul) === 6 ? 0 : 85;
      }
      const o = service.observations(scores, MAINTENANT).find((x) => x.code === 'jourFaible');
      expect(o).toBeDefined();
      expect(o!.titre).toContain('samedi');
      // Le fait doit porter les chiffres réels, pas une impression.
      expect(o!.fait).toMatch(/\d/);
    });

    it('voit le décrochage du week-end', () => {
      const scores: Record<string, number> = {};
      for (let recul = 0; recul < 28; recul++) {
        scores[cle(recul)] = [0, 6].includes(jourDe(recul)) ? 20 : 90;
      }
      const o = service.observations(scores, MAINTENANT).find((x) => x.code === 'weekend');
      expect(o).toBeDefined();
      expect(o!.fait).toContain('90');
      expect(o!.fait).toContain('20');
    });

    it('voit une chute par rapport à la semaine précédente', () => {
      // Sept jours à 20 %, les sept d'avant à 90 %.
      const scores = historique([...Array(7).fill(20), ...Array(14).fill(90)]);
      const o = service.observations(scores, MAINTENANT).find((x) => x.code === 'rechute');
      expect(o).toBeDefined();
      expect(o!.titre).toBe('Tu ralentis');
    });

    it('fait passer une chute avant une progression et avant un record', () => {
      // Une chute qu'on nomme tôt se rattrape ; c'est elle qui doit sortir.
      const scores = historique([...Array(7).fill(20), ...Array(14).fill(90)]);
      const toutes = service.observations(scores, MAINTENANT);
      expect(toutes[0].code).toBe('rechute');
    });

    it('reconnaît une série record en cours', () => {
      const scores = historique(Array(20).fill(75));
      const o = service.observations(scores, MAINTENANT).find((x) => x.code === 'record');
      expect(o).toBeDefined();
      expect(o!.fait).toContain("d'affilée");
    });

    it("propose une invite écrite à la première personne", () => {
      // Elle part telle quelle dans la conversation, au nom de la personne : à la
      // troisième personne, le coach recevrait un message parlant de quelqu'un d'autre.
      const scores: Record<string, number> = {};
      for (let recul = 0; recul < 28; recul++) {
        scores[cle(recul)] = jourDe(recul) === 6 ? 0 : 85;
      }
      const o = service.meilleure(scores, MAINTENANT)!;
      expect(o.invite).toMatch(/\b(je|mes|mon|ma|j'|aide-moi)\b/i);
    });
  });
});
