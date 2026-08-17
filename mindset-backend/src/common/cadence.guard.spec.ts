import { HttpException } from '@nestjs/common';
import { CadenceGuard } from './cadence.guard';

/**
 * Ce qui est vérifié ici n'est pas que le garde compte — `@nestjs/throttler` s'en
 * charge — mais les deux choses qu'il change, et qui sont précisément celles qui
 * font la différence entre une protection et une nuisance.
 */
describe('CadenceGuard', () => {
  const garde = new (CadenceGuard as any)({}, {}, {});

  describe('la clé de comptage', () => {
    it('compte par compte quand la personne est authentifiée', async () => {
      // Par IP, deux personnes derrière la même box se bloquent mutuellement,
      // pendant que quelqu'un qui change de réseau passe à travers.
      const cle = await garde.getTracker({ user: { userId: 'u1' }, ip: '1.2.3.4' });

      expect(cle).toBe('compte:u1');
    });

    it("retombe sur l'adresse plutôt que de ne rien compter", async () => {
      // Le pire des deux mondes serait de laisser passer sans compter faute
      // d'identité connue.
      const cle = await garde.getTracker({ ip: '1.2.3.4' });

      expect(cle).toBe('ip:1.2.3.4');
    });

    it('ne confond pas deux comptes derrière la même adresse', async () => {
      const a = await garde.getTracker({ user: { userId: 'u1' }, ip: '1.2.3.4' });
      const b = await garde.getTracker({ user: { userId: 'u2' }, ip: '1.2.3.4' });

      expect(a).not.toBe(b);
    });
  });

  describe('le refus', () => {
    const refus = async (secondesAvantReprise: number) => {
      try {
        await garde.throwThrottlingException({}, { timeToExpire: secondesAvantReprise });
        throw new Error('aurait dû lever');
      } catch (e) {
        return e as HttpException;
      }
    };

    it('porte un code que le client peut reconnaître', async () => {
      // Sans lui, l'écran de conversation affiche sa phrase d'erreur générique et
      // annonce une panne au moment où tout fonctionne comme prévu.
      const e = await refus(1140);
      const corps: any = e.getResponse();

      expect(e.getStatus()).toBe(429);
      expect(corps.code).toBe('AI_CADENCE');
    });

    it('annonce une attente en minutes, jamais en secondes', async () => {
      const corps: any = (await refus(1140)).getResponse();

      expect(corps.minutes).toBe(19);
      expect(corps.message).toContain('19 minutes');
      expect(corps.message).not.toContain('1140');
    });

    it('accorde le singulier, et ne descend jamais sous une minute', async () => {
      // « Reprend dans 0 minute » se lit comme un bug ; il vaut mieux annoncer une
      // minute de trop qu'une reprise immédiate qui n'arrivera pas.
      const corps: any = (await refus(20)).getResponse();

      expect(corps.minutes).toBe(1);
      expect(corps.message).toContain('1 minute ');
    });
  });
});
