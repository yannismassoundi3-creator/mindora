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

  it('interdit aussi les statistiques sur le monde', () => {
    /*
      Mesuré le 26 août 2026 sur `gpt-oss-120b`, en réponse à « j'ai fini ma
      routine » : « la réflexion écrite augmente la persévérance de +15 % selon
      les études de suivi ». Le chiffre n'existe pas.

      La règle 6 lui demande d'expliquer pourquoi une méthode marche ; il
      satisfaisait cette règle en violant la première. Il suffit d'une
      vérification pour qu'il ne croie plus aucun chiffre du coach — y compris
      les vrais, ceux qui viennent de ses propres données.
    */
    expect(prompt).toContain('Cela vaut aussi pour les chiffres sur le monde');
    expect(prompt).toContain('21 jours');
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

  /*
    Le garde-fou qui manquait, et qui a coûté une panne de production.

    Groq compte 8 000 jetons par MINUTE pour l'organisation entière, `max_tokens`
    inclus. Le 26 août 2026, l'invite d'une demande de plan pesait 6 045 jetons ;
    en montant `max_tokens` à 2600 « pour éviter les troncatures », le total est
    passé au-dessus de la limite et les TROIS modèles ont rendu 413 sur un vrai
    utilisateur. Une requête plus grosse que la limite par minute ne passe jamais.

    Le calcul du plafond ci-dessous : 8 000 − 1 500 de réponse = 6 500 pour
    l'invite et le contexte. Un compte chargé pèse ~1 000 jetons de contexte, et
    les tokeniseurs varient de 10 % d'un modèle à l'autre (mesuré : 8 965 sur
    gpt-oss-120b contre 9 554 sur qwen pour la même requête). Reste ~4 800.

    **Ce test ne protège pas un style, il protège la fonctionnalité.** Une règle
    ajoutée sans en retirer une autre finit par supprimer les demandes de plan.
  */
  it('reste sous le budget qui le rend envoyable', () => {
    const invite =
      construirePromptBase({
        nomCoach: 'Coach IA',
        nomPersonne: 'Yannis',
        maintenantParis: 'jeudi 21 août 2026 à 13:30',
        aujourdhui: '2026-08-21',
        demain: '2026-08-22',
      }) + plan;

    // ~3,6 caractères par jeton en français : l'ordre de grandeur suffit, la
    // marge est prise dans le plafond.
    const jetons = Math.round(invite.length / 3.6);

    expect(jetons).toBeLessThan(4800);
  });

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

  it('fait du budget temps un calcul, pas une intention', () => {
    /*
      Mesuré le 26 août 2026 sur `openai/gpt-oss-20b` — le maillon des heures de
      pointe — pour quelqu'un ayant déclaré 20 minutes : 3×5 le matin, 3×15 le
      midi, 10 le soir, tous les jours. **70 minutes.** Et le modèle avait écrit
      « Tu as 20 min par jour, pas plus » dans la phrase juste au-dessus du bloc.

      La consigne disait « additionne » sans dire quoi additionner ni quoi faire
      du résultat. Elle nomme désormais le cas exact, et demande la somme dans
      l'explication — un contrôle qu'on doit écrire est un contrôle qu'on fait.
    */
    expect(plan).toContain('SON TEMPS DISPONIBLE FIXE LE VOLUME, ET ÇA SE CALCULE');
    expect(plan).toContain('trois tâches de 15 minutes dans MIDDAY font 45 minutes');
    expect(plan).toContain('Dis la somme obtenue dans "routineExplanation"');
  });

  it('borne ce qui précède le bloc à deux phrases', () => {
    /*
      Effet de bord mesuré le 26 août 2026, après avoir durci la règle du budget
      temps : `gpt-oss-20b` s'est mis à recopier ses quatre explications **en prose
      avant le bloc**, puis à énumérer routines et repas. La réponse a dépassé le
      plafond de jetons et le JSON s'est arrêté en plein milieu d'un titre.

      Écrire deux fois la même explication est donc la façon la plus sûre de se
      faire couper — et une réponse coupée n'installe rien du tout.
    */
    expect(plan).toContain('AVANT LE BLOC : DEUX PHRASES, PAS UNE DE PLUS');
    expect(plan).toContain('les écrire deux fois');
  });

  it('interdit les titres de séance numérotés', () => {
    // « Séance 1 », « Séance 2 » : le même défaut que « Musculation », avec un
    // chiffre en plus. Devant sa tâche, la personne ne sait toujours pas quoi faire.
    expect(plan).toContain('"Séance 1", "Séance 2"');
  });
});
