import { AiCoachingService } from './ai-coaching.service';

/*
  Vingt messages, aucune date.

  L'historique envoyé au modèle ne portait que `role` et `content` : vingt
  messages pouvant couvrir deux semaines lui arrivaient comme une seule
  conversation d'aujourd'hui. Le coach relisait donc « je le fais demain », écrit
  quatre jours plus tôt, comme s'il venait d'être dit — et tenait pour à venir un
  « demain » depuis longtemps passé.

  C'est la même erreur que le rappel posé au mauvais jour, par le même chemin :
  une date que le modèle doit deviner, il la devine mal. Elle est plus discrète
  ici — rien ne s'affiche de travers, le coach répond simplement à côté du temps.
*/
describe("les jours dans l'historique du coach", () => {
  // Lundi 24 août 2026, 12 h 11 à Paris.
  const lundiMidi = new Date('2026-08-24T10:11:00.000Z');
  const msg = (content: string, iso?: string) => ({
    role: 'user',
    content,
    quand: iso ? new Date(iso) : undefined,
  });

  it('ne marque pas les messages du jour', () => {
    // Le cas courant, et le plus fréquent de loin : un repère y serait du bruit
    // payé à chaque message.
    const sortie = AiCoachingService.marquerLesJours(
      [msg('Salut', '2026-08-24T07:00:00.000Z'), msg('C’est fait', '2026-08-24T09:30:00.000Z')],
      lundiMidi,
    );

    expect(sortie.map((m) => m.content)).toEqual(['Salut', 'C’est fait']);
  });

  it('marque le premier message de la veille, et lui seul', () => {
    const sortie = AiCoachingService.marquerLesJours(
      [
        msg('Je commence demain', '2026-08-23T18:00:00.000Z'),
        msg('Promis', '2026-08-23T18:05:00.000Z'),
        msg('Bon', '2026-08-24T09:00:00.000Z'),
      ],
      lundiMidi,
    );

    expect(sortie.map((m) => m.content)).toEqual(['[hier] Je commence demain', 'Promis', 'Bon']);
  });

  it('donne la date au-delà de la veille', () => {
    const sortie = AiCoachingService.marquerLesJours(
      [msg('Objectif de la semaine', '2026-08-19T10:00:00.000Z')],
      lundiMidi,
    );

    expect(sortie[0].content).toBe('[mercredi 19 août] Objectif de la semaine');
  });

  it('lit le jour à Paris, pas à UTC', () => {
    /*
      23 h 30 le 23 août à Paris, c'est déjà le 24 en UTC. Un message écrit hier
      soir serait passé pour un message d'aujourd'hui — exactement le décalage
      que le reste du projet paie depuis le début sur les clés de jour.
    */
    const sortie = AiCoachingService.marquerLesJours(
      [msg('Dernière ligne droite', '2026-08-23T21:30:00.000Z')],
      lundiMidi,
    );

    expect(sortie[0].content).toBe('[hier] Dernière ligne droite');
  });

  it('laisse passer un message sans date plutôt que d’inventer', () => {
    // Une date absente n'autorise aucune déduction : on n'écrit rien.
    const sortie = AiCoachingService.marquerLesJours([msg('Message orphelin')], lundiMidi);

    expect(sortie[0].content).toBe('Message orphelin');
    expect(sortie[0]).not.toHaveProperty('quand');
  });
});
