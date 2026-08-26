import { construirePromptBase, construirePromptPlan } from './prompt-coach';

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
    aujourdhui: '2026-08-21',
    demain: '2026-08-22',
  });

  it('porte les noms et l’instant qu’on lui donne', () => {
    expect(prompt).toContain('Coach IA');
    expect(prompt).toContain('Yannis');
    // Sans l'instant présent, « rappelle-moi à 22 h 30 » n'a pas de date et le
    // modèle invente une journée.
    expect(prompt).toContain('jeudi 21 août 2026 à 13:30');
  });

  it('donne la date du jour et celle du lendemain en clair machine', () => {
    /*
      « lundi 24 août 2026 à 12:11 » demandait deux opérations avant de servir :
      traduire en `2026-08-24`, puis comparer l'heure demandée à l'heure qu'il
      est. Le 24 août à 12 h 11, sur « rappelle-moi mes 25 pompes à 15h30 », le
      modèle a raté la seconde et posé le rappel au lendemain — le coach a
      confirmé « mardi 15:30 » et la personne l'a lu comme un oui.

      Les deux clés sont donc écrites toutes faites : il ne lui reste qu'à
      choisir laquelle recopier.
    */
    expect(prompt).toContain("AUJOURD'HUI = 2026-08-21");
    expect(prompt).toContain('DEMAIN = 2026-08-22');
  });

  it('fait du jour même le cas par défaut d’un rappel', () => {
    // La consigne disait « une heure déjà passée vaut le lendemain » et rien de
    // l'autre cas : la seule règle explicite poussait vers demain.
    expect(prompt).toContain('La date, tu la RECOPIES');
    expect(prompt).toContain("C'est AUJOURD'HUI (2026-08-21) dès que l'heure qu'il demande");
    expect(prompt).toContain("Ce n'est DEMAIN (2026-08-22) que dans deux cas");
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

  it('dit qu’un rappel non demandé sera jeté', () => {
    /*
      Mesuré au banc du 21 août 2026 : le modèle pose un rappel de sa propre
      initiative environ une fois sur quatre, alors que la règle le lui interdit
      en toutes lettres. Le code l'écarte désormais — mais tant qu'il l'ignore, il
      dépense à chaque fois la place qu'il aurait pu employer à lui parler.
    */
    expect(prompt).toContain("jetée par l'application avant d'être écrite");
  });
});

/*
  Le schéma du plan, et la seule faute qu'il ne rattrape pas.

  Mesuré contre le vrai Groq le 24 août 2026 : `openai/gpt-oss-20b` — dernier
  maillon de la chaîne, donc celui qui répond quand les deux premiers saturent —
  refuse « Je ne peux pas créer un plan complet pour toute la semaine en une seule
  réponse », puis écrit la routine en Markdown. La réponse est agréable à lire et
  l'application reste vide.

  Le code a désormais son filet — il redescend la chaîne en écartant le maillon
  qui a refusé — mais un filet ne remplace pas une consigne : il coûte un appel de
  plus à chaque fois qu'il sert.
*/
describe('le schéma du plan', () => {
  const plan = construirePromptPlan();

  it('interdit de refuser le bloc quand un plan est ordonné', () => {
    expect(plan).toContain("TU NE REFUSES JAMAIS D'ÉCRIRE CE BLOC");
    // Le refus mesuré, cité mot pour mot : c'est ce qui empêche de le reformuler
    // en quelque chose que le modèle ne reconnaîtrait plus.
    expect(plan).toContain('Je ne peux pas créer un plan complet en une seule réponse');
  });

  it('donne la sortie de secours plutôt que le refus', () => {
    // Un refus vient presque toujours d'une demande jugée trop large. Sans une
    // porte de sortie, l'interdiction ci-dessus n'a nulle part où mener.
    expect(plan).toContain('avec MOINS de tâches');
  });

  it('interdit d’écrire le plan en prose', () => {
    // C'est la forme exacte qu'a prise le refus : une belle routine en liste, dans
    // le texte, dont rien n'est ajouté ni cochable.
    expect(plan).toContain("TU NE L'ÉCRIS JAMAIS EN PROSE");
  });
});
