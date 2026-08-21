import { construirePromptBase } from './prompt-coach';

/*
  Ce que ce fichier peut prouver, et ce qu'il ne peut pas.

  **Il ne prouve rien du comportement du modèle.** Une règle présente dans le
  prompt n'est pas une règle suivie : la seule vérification qui vaille est de
  soumettre le texte au vrai modèle et de lire ce qui revient, ce qui a été fait
  le 21 août 2026 avant de livrer ces règles.

  Il garde en revanche ce qu'aucune mesure ne garde : qu'une règle acquise ne
  disparaisse pas d'une réécriture. Trois d'entre elles se sont payées cher, et
  la plus grave — le silence sur les rappels en cas de détresse — ne se
  remarquerait pas avant d'avoir envoyé une notification à quelqu'un qui va mal.
*/
describe('le prompt du coach', () => {
  const prompt = construirePromptBase({
    nomCoach: 'Coach IA',
    nomPersonne: 'Yannis',
    maintenantParis: 'jeudi 21 août 2026 à 13:30',
  });

  it('porte les noms et l’instant qu’on lui donne', () => {
    expect(prompt).toContain('Coach IA');
    expect(prompt).toContain('Yannis');
    // Sans l'instant présent, « rappelle-moi à 22 h 30 » n'a pas de date et le
    // modèle invente une journée.
    expect(prompt).toContain('jeudi 21 août 2026 à 13:30');
  });

  it('interdit toujours de poser un rappel en cas de détresse', () => {
    /*
      Mesuré : sans cette phrase, le modèle programmait de lui-même une
      notification à 9 h du matin disant d'appeler un service d'urgence, à
      quelqu'un qui venait d'écrire « j'en peux plus ». Bien intentionné, bien
      formé, et exactement ce qu'il ne faut pas faire.
    */
    expect(prompt).toContain('AUCUN rappel ici');
  });

  it('autorise la vue d’ensemble quand elle est demandée, sans en faire la réponse', () => {
    // Sans cette règle, « donne-moi toutes les notions à apprendre » recevait une
    // seule action du jour, et la personne en concluait que l'IA était limitée.
    expect(prompt).toContain("LA VUE D'ENSEMBLE EST UN DÛ QUAND ELLE EST DEMANDÉE");
    expect(prompt).toContain("La liste est le contexte, jamais la réponse");
  });

  it('exige que le refus soit dit', () => {
    // Un refus muet ne se lit pas comme une méthode : il se lit comme une panne.
    expect(prompt).toContain('UN REFUS SE DIT');
  });

  it('exige de répondre à la question posée', () => {
    // Mesuré : à « explique-moi tout sur le marketing digital », le coach
    // répondait des squats — le constat de la journée avait mangé la question.
    expect(prompt).toContain("MAIS TU RÉPONDS TOUJOURS À SA QUESTION");
  });

  it('interdit d’inventer un chiffre', () => {
    // Mesuré : « 0 % sur les 4 jours » sur des données qui ne disaient pas ça.
    expect(prompt).toContain('AUCUN chiffre inventé');
  });
});
