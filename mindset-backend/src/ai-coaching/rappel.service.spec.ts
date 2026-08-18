import { RappelService } from './rappel.service';

/*
  Un rappel qui n'arrive pas ne produit aucune erreur.

  C'est tout le problème de cette fonctionnalité, et la raison d'être de ce
  fichier : rien ici ne se voit dans les journaux, ni à l'écran, ni dans une
  réponse HTTP. Une erreur se manifeste uniquement par le silence d'un téléphone,
  chez quelqu'un qui comptait sur l'heure. Ce qui est vérifié ci-dessous est donc
  exactement ce qui se paierait chez un utilisateur réel.
*/
describe('RappelService', () => {
  describe("l'heure de Paris", () => {
    /*
      Le piège le plus cher du lot.

      `new Date('2026-08-18T22:30')` est interprété dans le fuseau du serveur, et
      Render tourne en UTC. Un rappel demandé pour 22 h 30 serait donc parti à
      minuit trente en été — deux heures trop tard, tous les soirs, sans que rien
      ne le signale. Le décalage se mesure sur la date visée et non sur
      aujourd'hui, sinon un rappel posé fin octobre pour début novembre change de
      fuseau en route.
    */
    it('convertit une heure d’été (UTC+2)', () => {
      expect(RappelService.depuisParis('2026-08-18', 22, 30).toISOString()).toBe(
        '2026-08-18T20:30:00.000Z',
      );
    });

    it('convertit une heure d’hiver (UTC+1)', () => {
      expect(RappelService.depuisParis('2026-12-18', 22, 30).toISOString()).toBe(
        '2026-12-18T21:30:00.000Z',
      );
    });

    it('traite le changement d’heure sur la date visée, pas sur aujourd’hui', () => {
      // Dernier dimanche d'octobre 2026 : Paris repasse à UTC+1 dans la nuit.
      expect(RappelService.depuisParis('2026-10-24', 12, 0).toISOString()).toBe(
        '2026-10-24T10:00:00.000Z',
      );
      expect(RappelService.depuisParis('2026-10-26', 12, 0).toISOString()).toBe(
        '2026-10-26T11:00:00.000Z',
      );
    });
  });

  describe('le marqueur du coach', () => {
    const maintenant = new Date('2026-08-18T18:00:00.000Z');

    it('sort le rappel et retire le marqueur de la réponse', () => {
      const { texte, rappels } = RappelService.extraire(
        'Tu commences par le livre.<RAPPEL 2026-08-18T22:30>Recherche du livre sur Vinted</RAPPEL>',
        maintenant,
      );

      expect(texte).toBe('Tu commences par le livre.');
      expect(rappels).toHaveLength(1);
      expect(rappels[0].texte).toBe('Recherche du livre sur Vinted');
      expect(rappels[0].quand.toISOString()).toBe('2026-08-18T20:30:00.000Z');
    });

    it('retire le marqueur même quand il est inexploitable', () => {
      // Un marqueur affiché tel quel dans la conversation est la seule chose pire
      // qu'un rappel manquant : il montre la mécanique et casse le personnage.
      const { texte, rappels } = RappelService.extraire(
        'Debout.<RAPPEL 2026-08-17T07:00>hier matin</RAPPEL>',
        maintenant,
      );

      expect(texte).toBe('Debout.');
      expect(rappels).toHaveLength(0);
    });

    it('ignore une heure deja passee', () => {
      const { rappels } = RappelService.extraire(
        '<RAPPEL 2026-08-18T10:00>ce matin</RAPPEL>ok',
        maintenant,
      );
      expect(rappels).toHaveLength(0);
    });

    it('ignore une date hors horizon', () => {
      // Au-dela d'un mois, ce n'est plus un rappel de coaching : c'est un agenda,
      // et le coach n'en est pas un.
      const { rappels } = RappelService.extraire(
        '<RAPPEL 2027-08-18T10:00>l an prochain</RAPPEL>ok',
        maintenant,
      );
      expect(rappels).toHaveLength(0);
    });

    it('accepte un fuseau ajoute par le modele sans decaler l’heure', () => {
      /*
        La consigne demande l'heure de Paris. Un modele qui ajoute « Z » de son
        propre chef ne change pas ce qu'il a voulu dire — le prendre au mot
        decalerait le rappel de deux heures en ete, silencieusement.
      */
      const { rappels } = RappelService.extraire(
        '<RAPPEL 2026-08-18T22:30:00Z>ce soir</RAPPEL>',
        maintenant,
      );
      expect(rappels[0].quand.toISOString()).toBe('2026-08-18T20:30:00.000Z');
    });

    it('borne le nombre de rappels d’un seul echange', () => {
      // Une conversation n'est pas un agenda : dix rappels d'un coup viennent
      // d'un modele parti en boucle, pas d'une demande.
      const marqueurs = Array.from(
        { length: 6 },
        (_, i) => `<RAPPEL 2026-08-19T0${i + 1}:00>tache ${i}</RAPPEL>`,
      ).join('');

      const { rappels, texte } = RappelService.extraire(marqueurs + 'Voila.', maintenant);

      expect(rappels).toHaveLength(3);
      // Les marqueurs surnumeraires disparaissent quand meme du texte affiche.
      expect(texte).toBe('Voila.');
    });

    it('laisse intacte une reponse sans marqueur', () => {
      const { texte, rappels } = RappelService.extraire('Rien a programmer ici.', maintenant);
      expect(texte).toBe('Rien a programmer ici.');
      expect(rappels).toHaveLength(0);
    });
  });
});
