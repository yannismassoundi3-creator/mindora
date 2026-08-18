import { RappelService } from './rappel.service';

/*
  L'annulation d'un rappel, et pourquoi elle compte plus que sa pose.

  Le coach savait poser un rappel depuis ce matin, et pas en retirer un. À
  « annule celui de 22 h 30 » il répondait « c'est annulé » — et le rappel
  sonnait quand même. C'est le mensonge réparé le matin même, refait dans
  l'autre sens, et il est **plus grave** : la personne avait cette fois une
  raison de croire que c'était réglé, et son téléphone la contredisait à l'heure
  dite.

  Comme pour la pose, la règle est que seule l'écriture en base autorise une
  confirmation. C'est ce que ce fichier verrouille.
*/
describe("l'annulation d'un rappel", () => {
  describe('le marqueur', () => {
    it('sort le numéro et retire la balise du texte affiché', () => {
      const { texte, numeros } = RappelService.extraireAnnulations('Retiré.<ANNULE_RAPPEL 2>');

      expect(texte).toBe('Retiré.');
      expect(numeros).toEqual([2]);
    });

    it('ne compte pas deux fois le même numéro', () => {
      const { numeros } = RappelService.extraireAnnulations(
        '<ANNULE_RAPPEL 1><ANNULE_RAPPEL 1><ANNULE_RAPPEL 3>ok',
      );

      expect(numeros).toEqual([1, 3]);
    });

    it('retire la balise même quand le numéro ne désigne rien', () => {
      /*
        Deux exigences distinctes, et il faut les deux : un marqueur affiché tel
        quel casse le personnage, et un numéro hors liste ne doit produire aucune
        phrase rassurante. Le second point se joue plus bas — c'est le service qui
        décide de ce qui est confirmé, jamais le modèle.
      */
      const { texte, numeros } = RappelService.extraireAnnulations('Fait.<ANNULE_RAPPEL 9>');

      expect(texte).toBe('Fait.');
      expect(numeros).toEqual([9]);
    });

    it('laisse intacte une réponse sans balise', () => {
      const { texte, numeros } = RappelService.extraireAnnulations('Rien à retirer.');

      expect(texte).toBe('Rien à retirer.');
      expect(numeros).toEqual([]);
    });
  });

  describe('ce qui est vraiment annulé', () => {
    const dans = (heures: number) => new Date(Date.now() + heures * 3600000);

    /** Le service avec une base simulée : `annulerParNumero` relit la liste puis écrit. */
    const service = (liste: any[], count = 1) =>
      new RappelService({
        rappel: {
          findMany: jest.fn().mockResolvedValue(liste),
          updateMany: jest.fn().mockResolvedValue({ count }),
        },
      } as any);

    it('annule le rappel désigné par son rang dans la liste', () => {
      const s = service([
        { id: 'a', texte: 'premier', quand: dans(1) },
        { id: 'b', texte: 'second', quand: dans(2) },
      ]);

      return expect(s.annulerParNumero('u1', [2])).resolves.toEqual(['second']);
    });

    it('ignore un numéro hors liste au lieu de tomber', () => {
      // Le modèle peut inventer un numéro. Lever ici transformerait une réponse
      // déjà écrite en erreur 500, pour quelqu'un qui a juste demandé un retrait.
      const s = service([{ id: 'a', texte: 'seul', quand: dans(1) }]);

      return expect(s.annulerParNumero('u1', [7])).resolves.toEqual([]);
    });

    it("ne confirme rien quand la base n'a rien annulé", () => {
      // `count: 0` veut dire que la ligne était déjà partie, ou déjà annulée. On
      // ne confirme pas une annulation qui n'a pas eu lieu — c'est toute la règle.
      const s = service([{ id: 'a', texte: 'seul', quand: dans(1) }], 0);

      return expect(s.annulerParNumero('u1', [1])).resolves.toEqual([]);
    });

    it('ne touche pas à la base quand aucun numéro n’est demandé', () => {
      const s = service([{ id: 'a', texte: 'seul', quand: dans(1) }]);

      return expect(s.annulerParNumero('u1', [])).resolves.toEqual([]);
    });
  });
});
