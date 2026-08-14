import { jauge, titreProgression } from './jauge';

describe('jauge', () => {
  it('rend cinq segments quel que soit le score', () => {
    for (const score of [0, 1, 37, 99, 100]) {
      expect(jauge(score)).toHaveLength(5);
    }
  });

  it('ne remplit rien à 0 et tout à 100', () => {
    expect(jauge(0)).toBe('░░░░░');
    expect(jauge(100)).toBe('▓▓▓▓▓');
  });

  it('arrondit vers le bas : un pour cent ne vaut pas un segment acquis', () => {
    expect(jauge(1)).toBe('░░░░░');
    expect(jauge(19)).toBe('░░░░░');
    expect(jauge(20)).toBe('▓░░░░');
  });

  it("borne les scores absurdes venus d'un client modifié", () => {
    expect(jauge(320)).toBe('▓▓▓▓▓');
    expect(jauge(-40)).toBe('░░░░░');
    expect(jauge(NaN)).toBe('░░░░░');
  });

  it('reste assez court pour ne pas être tronqué sur iPhone', () => {
    expect(titreProgression(100, 365).length).toBeLessThanOrEqual(35);
  });

  it("n'affiche la série qu'à partir de deux jours", () => {
    expect(titreProgression(60, 0)).toBe('▓▓▓░░ 60 %');
    expect(titreProgression(60, 1)).toBe('▓▓▓░░ 60 %');
    expect(titreProgression(60, 2)).toBe('▓▓▓░░ 60 % · 2 j 🔥');
  });
});
