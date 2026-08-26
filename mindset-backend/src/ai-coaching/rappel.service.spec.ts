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

  /*
    Les deux formes reellement produites par le modele, relevees au banc d essai du
    21 aout 2026 sur deux reponses sur deux -- et sur des rappels que personne
    n avait demandes. Aucune n est reconnue par MARQUEUR, donc aucune ne s effacait :
    la balise s affichait telle quelle dans la bulle de conversation.

    Une balise en clair a l ecran est ce qui coute le plus cher ici. La personne ne
    voit pas une balise, elle voit un produit qui se demonte devant elle.
  */
  describe('une balise mal formee', () => {
    it('ne s affiche jamais, meme avec un deux-points en trop', () => {
      const { texte, rappels } = RappelService.extraire(
        'Fais tes squats.<RAPPEL 2026-08-22T09:00:>Envoie ton tableau.</RAPPEL>',
      );

      expect(texte).not.toContain('<RAPPEL');
      expect(texte).not.toContain('</RAPPEL>');
      // Rien n est programme : seule une balise reconnue ecrit une ligne. Le
      // nettoyage cache le symptome, il ne repare pas le rappel.
      expect(rappels).toHaveLength(0);
      // Le texte du modele reste lisible : on retire la balise, jamais les mots.
      expect(texte).toContain('Fais tes squats.');
      expect(texte).toContain('Envoie ton tableau.');
    });

    it('ne s affiche pas non plus sans balise fermante', () => {
      const { texte } = RappelService.extraire(
        'Lis 10 pages.<RAPPEL 2026-08-22T09:00:>Envoie ton resume.',
      );

      expect(texte).not.toContain('<RAPPEL');
      expect(texte).toContain('Lis 10 pages.');
    });

    it('laisse intacte une balise bien formee sans demande a comparer', () => {
      // Le filet ne doit pas manger ce qui marche : une balise valide est lue par
      // MARQUEUR et disparait par ce chemin-la, en programmant vraiment un rappel.
      const demain = new Date(Date.now() + 86400000);
      const jour = demain.toISOString().slice(0, 10);
      const { texte, rappels } = RappelService.extraire(
        `Fais tes squats.<RAPPEL ${jour}T23:30>Series de squats.</RAPPEL>`,
      );

      expect(rappels).toHaveLength(1);
      expect(texte).toBe('Fais tes squats.');
    });
  });

  /*
    Le rappel que personne n avait demande.

    Mesure du 21 aout 2026 : deux reponses sur deux posaient un rappel dont il n
    avait jamais ete question, dont une sur un message de detresse — « appelle un
    service d urgence », programme a 9 h du matin. La regle 11 l interdit en
    toutes lettres depuis, et le modele recommence dans environ un cas sur quatre.
    Une consigne d invite n est pas un garde-fou.

    Le juge est le message de la personne, jamais la reponse du coach : se fier a
    ce que le modele ecrit lui permettrait de s autoriser lui-meme, en annoncant
    le rappel qu il s apprete a poser.

    L asymetrie est voulue : refuser a tort un rappel reclame refait la panne d
    origine de ce fichier. On accepte donc large.
  */
  describe('le rappel que personne n a demande', () => {
    const lundiMidi = new Date('2026-08-24T10:11:00.000Z');
    const balise = 'Voila.<RAPPEL 2026-08-24T15:30>Tes pompes</RAPPEL>';

    const pose = (demande: string) => RappelService.extraire(balise, lundiMidi, demande);

    it('ecarte le rappel pose sur un message qui n en parle pas', () => {
      const { rappels, refuses, texte } = pose("C'est fait, j'ai termine ma routine");

      expect(rappels).toHaveLength(0);
      expect(refuses).toBe(1);
      // La balise disparait quand meme du texte affiche : un marqueur en clair
      // reste la pire des sorties.
      expect(texte).toBe('Voila.');
    });

    it('ecarte le rappel pose sur un message de detresse', () => {
      // Le cas le plus grave du lot, et le seul ou le modele croyait bien faire.
      const { rappels, refuses } = pose("j'en peux plus, je n'y arrive pas");

      expect(rappels).toHaveLength(0);
      expect(refuses).toBe(1);
    });

    it('ecarte le rappel pose sur une question ouverte', () => {
      const { rappels } = pose('Explique-moi tout sur le marketing digital');
      expect(rappels).toHaveLength(0);
    });

    it('accepte quand elle le demande par le verbe', () => {
      for (const demande of [
        'Rappelle-moi de faire mes pompes',
        'reveille moi stp',
        'previens-moi quand ce sera le moment',
        'fais-moi penser a appeler ma mere',
      ]) {
        expect(pose(demande).rappels).toHaveLength(1);
      }
    });

    it('accepte quand elle donne une heure, sans nommer le rappel', () => {
      // « a 15h30 de faire mes pompes » est une demande de rappel, et aucun verbe
      // de rappel n y figure.
      for (const demande of [
        'a 15h30 mes 25 pompes',
        'ce soir a 22:30 la meditation',
        'note pour midi : appeler le client',
      ]) {
        expect(pose(demande).rappels).toHaveLength(1);
      }
    });

    it('lit les accents comme leur absence', () => {
      // Personne ne relit son message avant de l envoyer.
      expect(RappelService.estUneDemandeDeRappel('réveille-moi à 7h')).toBe(true);
      expect(RappelService.estUneDemandeDeRappel('reveille moi a 7h')).toBe(true);
      expect(RappelService.estUneDemandeDeRappel('préviens-moi')).toBe(true);
    });

    it('laisse passer quand la demande est inconnue', () => {
      // Sans le message, on ne sait rien : c est le cas de la demonstration, ou
      // rien n est ecrit de toute facon. Refuser par defaut ferait disparaitre
      // des rappels reels au premier appel qui oublierait de passer le message.
      expect(RappelService.extraire(balise, lundiMidi).rappels).toHaveLength(1);
    });
  });

  /*
    Les formes que le petit maillon ecrit vraiment.

    `openai/gpt-oss-20b` est celui sur lequel la chaine retombe des que Groq
    sature — donc celui qui repond aux heures de pointe. Mesure le 24 aout 2026
    sur le message d un vrai utilisateur, quatre appels : il a produit trois
    formes differentes, dont deux que le serveur refusait.

    Une balise refusee ne programme rien. La personne lit une reponse normale et
    ne l apprend qu a l heure dite, en ne recevant rien — la panne muette de ce
    fichier, dans sa version la plus courante.
  */
  /*
    Le caractere qu on ne voit pas, et qui cassait tout deux fois.

    Mesure le 26 aout 2026 contre le vrai Groq, sur `openai/gpt-oss-120b` — le
    GROS modele, pas le petit : un espace de largeur nulle entre le chevron et le
    mot RAPPEL. Verifie aux octets, E2 80 8B.

    La balise n etait ni lue — donc aucun rappel programme — ni nettoyee, parce
    que `\s` ne couvre pas U+200B en JavaScript. Elle s affichait donc en clair
    dans la conversation, ce que ce fichier designe comme sa faute la plus chere.
  */
  describe('le caractere invisible dans la balise', () => {
    const lundi = new Date('2026-08-24T10:11:00.000Z');
    // Par son point de code : colle en clair, il serait illisible a la relecture.
    const ZWSP = String.fromCharCode(0x200b);

    it('programme quand meme le rappel', () => {
      const { rappels } = RappelService.extraire(
        `Tes pompes.<${ZWSP}RAPPEL 2026-08-24T15:30>Fais tes 25 pompes.</RAPPEL>`,
        lundi,
        'rappelle-moi mes pompes a 15h30',
      );

      expect(rappels).toHaveLength(1);
      expect(rappels[0].texte).toBe('Fais tes 25 pompes.');
    });

    it('ne laisse aucune balise a l ecran', () => {
      const { texte } = RappelService.extraire(
        `Tes pompes.<${ZWSP}RAPPEL 2026-08-24T15:30>Fais tes 25 pompes.</RAPPEL>`,
        lundi,
        'rappelle-moi mes pompes a 15h30',
      );

      expect(texte).toBe('Tes pompes.');
      expect(texte).not.toContain('RAPPEL');
    });

    it('nettoie aussi une balise invisible et non fermee', () => {
      // La forme exacte du 26 aout : ouverture abimee, aucune fermeture. Rien
      // n est programme — la balise est incomplete — mais rien ne s affiche non
      // plus, et c est ce qui manquait.
      const { texte, rappels } = RappelService.extraire(
        `Fais la planche.<${ZWSP}RAPPEL 2026-08-24T15:30>Termine les squats.`,
        lundi,
        "j'ai pas pu, j'etais creve",
      );

      expect(rappels).toHaveLength(0);
      expect(texte).not.toContain('RAPPEL');
      expect(texte).toContain('Fais la planche.');
    });

    it('ecarte une annulation invisible plutot que de l afficher', () => {
      const { texte, numeros } = RappelService.extraireAnnulations(
        `C est retire.<${ZWSP}ANNULE_RAPPEL 1>`,
      );

      expect(numeros).toEqual([1]);
      expect(texte).toBe('C est retire.');
    });
  });

  describe('les formes abimees par les petits modeles', () => {
    const lundiSoir = new Date('2026-08-24T10:11:00.000Z');

    it('accepte un espace apres le chevron et une casse libre', () => {
      const { rappels } = RappelService.extraire(
        '< Rappel 2026-08-24T15:30>Fais tes 25 pompes.</RAPPEL>',
        lundiSoir,
      );

      expect(rappels).toHaveLength(1);
      expect(rappels[0].quand.toISOString()).toBe('2026-08-24T13:30:00.000Z');
    });

    it('accepte une date collee a l heure, sans le T', () => {
      // Vu deux fois sur deux. La date est de longueur fixe, l heure aussi :
      // rien n oblige a ce que quelque chose les separe.
      const { rappels } = RappelService.extraire(
        '<RAPPEL 2026-08-2415:30>Fais tes 25 pompes.</RAPPEL>',
        lundiSoir,
      );

      expect(rappels).toHaveLength(1);
      expect(rappels[0].quand.toISOString()).toBe('2026-08-24T13:30:00.000Z');
    });

    it('accepte une fermeture espacee', () => {
      const { texte, rappels } = RappelService.extraire(
        'Tes pompes.<RAPPEL 2026-08-24T15:30>25 pompes.< / RAPPEL >',
        lundiSoir,
      );

      expect(rappels).toHaveLength(1);
      expect(texte).toBe('Tes pompes.');
    });

    it('refuse toujours ce qui n est pas une date', () => {
      // La tolerance porte sur la ponctuation, jamais sur le fond : une balise
      // sans date lisible ne doit pas devenir un rappel invente.
      const { rappels } = RappelService.extraire(
        '<RAPPEL demain 15:30>Fais tes pompes.</RAPPEL>',
        lundiSoir,
      );

      expect(rappels).toHaveLength(0);
    });
  });

  /*
    Le rappel qui arrive le bon jour, vingt-sept heures trop tard.

    Constate le 24 aout 2026 a 12 h 11 : « Rappel moi de faire mes 25 pompes a
    15h30 », coach « c est note », et la ligne ecrite est celle de MARDI 15 h 30.
    La balise etait bien formee, le rappel existe, il sonnera -- simplement pas le
    jour ou on l attendait. Aucun journal, aucune erreur : c est la panne muette
    du projet dans sa version la plus polie, puisque le produit confirme.

    La cause est dans l invite et elle y est corrigee, mais une consigne au modele
    ne se verifie qu apres coup, chez la personne. Ce qui suit ne depend d aucun
    modele.
  */
  describe('le report injustifie au lendemain', () => {
    // Lundi 24 aout 2026, 12 h 11 a Paris.
    const lundiMidi = new Date('2026-08-24T10:11:00.000Z');

    it('ramene a aujourd hui une heure encore a venir', () => {
      const { rappels } = RappelService.extraire(
        'Tes pompes.<RAPPEL 2026-08-25T15:30>25 pompes</RAPPEL>',
        lundiMidi,
        'Rappel moi de faire mes 25 pompes a 15h30',
      );

      // 15 h 30 heure de Paris, le jour meme : 13 h 30 UTC.
      expect(rappels[0].quand.toISOString()).toBe('2026-08-24T13:30:00.000Z');
    });

    it('respecte un lendemain qu il a demande', () => {
      const { rappels } = RappelService.extraire(
        'Note.<RAPPEL 2026-08-25T15:30>25 pompes</RAPPEL>',
        lundiMidi,
        'Rappelle-moi demain a 15h30 pour mes pompes',
      );

      expect(rappels[0].quand.toISOString()).toBe('2026-08-25T13:30:00.000Z');
    });

    it('respecte un jour de la semaine nomme', () => {
      const { rappels } = RappelService.extraire(
        'Note.<RAPPEL 2026-08-25T15:30>25 pompes</RAPPEL>',
        lundiMidi,
        'Rappelle-moi mardi a 15h30',
      );

      expect(rappels[0].quand.toISOString()).toBe('2026-08-25T13:30:00.000Z');
    });

    it('ne touche pas a une heure deja passee aujourd hui', () => {
      // « rappelle-moi a 8 h » lance a midi : le lendemain est le seul jour ou ce
      // rappel peut encore servir, et le modele a eu raison.
      const { rappels } = RappelService.extraire(
        'Note.<RAPPEL 2026-08-25T08:00>Petit-dejeuner</RAPPEL>',
        lundiMidi,
        'Rappelle-moi a 8h de prendre mon petit-dejeuner',
      );

      expect(rappels[0].quand.toISOString()).toBe('2026-08-25T06:00:00.000Z');
    });

    it('compte ce qu il a recale, pour que le journal nomme le modele', () => {
      /*
        Un filet qui repare en silence est la meme panne muette que celle qu il
        repare : sans ce compte, on ne saurait jamais lequel des trois maillons
        de la chaine se trompe de jour, ni si le changement d invite a servi.
      */
      const rate = RappelService.extraire(
        'A.<RAPPEL 2026-08-25T15:30>pompes</RAPPEL>',
        lundiMidi,
        'Rappelle-moi a 15h30',
      );
      expect(rate.recales).toBe(1);

      const juste = RappelService.extraire(
        'A.<RAPPEL 2026-08-24T15:30>pompes</RAPPEL>',
        lundiMidi,
        'Rappelle-moi a 15h30',
      );
      expect(juste.recales).toBe(0);
    });

    it('ne touche a rien au-dela du lendemain', () => {
      // Un rappel pose a trois jours n est pas un decalage d un jour : c est une
      // demande qu on ne sait pas relire, et on n y touche pas.
      const { rappels } = RappelService.extraire(
        'Note.<RAPPEL 2026-08-27T15:30>25 pompes</RAPPEL>',
        lundiMidi,
        'Rappelle-moi a 15h30',
      );

      expect(rappels[0].quand.toISOString()).toBe('2026-08-27T13:30:00.000Z');
    });
  });

  /*
    « je te le rappelle mardi 15:30 » : la phrase qu a lue l utilisateur du 24
    aout. Elle ne dit pas que c est le lendemain, et elle ne dirait pas davantage
    qu un « mardi » est dans huit jours. Le seul mot qui aurait permis de voir
    l erreur tout de suite etait celui que le format ne pouvait pas produire.
  */
  describe('le libelle rendu a la personne', () => {
    const lundiMidi = new Date('2026-08-24T10:11:00.000Z');

    it('dit aujourd hui quand c est aujourd hui', () => {
      expect(RappelService.libelleQuand(new Date('2026-08-24T13:30:00.000Z'), lundiMidi)).toBe(
        "aujourd'hui à 15:30",
      );
    });

    it('dit demain quand c est demain', () => {
      expect(RappelService.libelleQuand(new Date('2026-08-25T13:30:00.000Z'), lundiMidi)).toBe(
        'demain à 15:30',
      );
    });

    it('donne la date des que le jour de la semaine ne suffit plus', () => {
      expect(RappelService.libelleQuand(new Date('2026-08-31T13:30:00.000Z'), lundiMidi)).toBe(
        'lundi 31 août à 15:30',
      );
    });

    it('lit le jour a Paris, pas a UTC', () => {
      // 23 h 30 heure de Paris le 24 aout, c est deja le 25 en UTC : un libelle
      // calcule sur l instant brut annoncerait « demain » a quelqu un qui attend
      // ce soir.
      expect(RappelService.libelleQuand(new Date('2026-08-24T21:30:00.000Z'), lundiMidi)).toBe(
        "aujourd'hui à 23:30",
      );
    });
  });
});
