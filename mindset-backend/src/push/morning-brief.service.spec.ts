import { Logger } from '@nestjs/common';
import { MorningBriefService } from './morning-brief.service';
import { JETONS_TEXTE_COURT, MODELES_COURTS } from '../common/modeles';
import { jourDeSemaine } from './recurrence';

/**
 * Toute la personnalisation du réveil tenait à un seul identifiant de modèle. S'il
 * disparaissait du catalogue Groq — ou se trouvait simplement interdit sur le projet,
 * ce qui est le défaut d'une clé neuve — `generate()` rendait null pour tout le monde,
 * tous les jours, et chaque brief repassait au texte générique sans que rien ne le
 * signale ailleurs qu'une ligne d'avertissement noyée dans les logs.
 *
 * C'est le pire genre de panne : l'application continue d'envoyer des notifications,
 * donc rien n'a l'air cassé.
 */
describe('MorningBriefService — écriture du message', () => {
  let service: MorningBriefService;
  let fetchMock: jest.Mock;
  const cleInitiale = process.env.GROQ_API_KEY;

  const reponseOk = (contenu: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenu } }] }),
  });
  /** Le modèle a été arrêté par `max_tokens` : même statut, même forme, phrase en moins. */
  const reponseCoupee = (contenu: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenu }, finish_reason: 'length' }] }),
  });
  const reponseInterdite = (modele: string) => ({
    ok: false,
    status: 403,
    json: async () => ({}),
    text: async () => `The model \`${modele}\` is blocked at the project level.`,
  });

  const modelesAppeles = () =>
    fetchMock.mock.calls.map((appel) => JSON.parse(appel[1].body).model as string);

  const sync = { daily_scores: {}, routines: [], micro_objectives: [] };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'cle-de-test';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    service = new MorningBriefService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (cleInitiale === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = cleInitiale;
  });

  it('essaie le petit modèle en premier, pour son quota compté à part', async () => {
    fetchMock.mockResolvedValueOnce(reponseOk('Debout, ta série t’attend.'));

    await service.generate('Yannis', sync);

    expect(modelesAppeles()).toEqual([MODELES_COURTS[0]]);
  });

  it('descend jusqu’au fournisseur payant quand toute la chaîne gratuite a refusé', async () => {
    /*
      Le chat avait ce filet, le brief non : quand le quota gratuit tombait, la
      notification du matin partait en version générique pour tout le monde, sans
      qu'une seule erreur soit levée. Le maillon payant est en dernier — il ne
      travaille que sur ce que Groq a refusé — et il laisse une trace, seule façon
      de relier une dépense à la saturation qui l'a causée.
    */
    process.env.SECOURS_API_KEY = 'cle-payante';
    process.env.SECOURS_MODELE = 'openai/gpt-oss-120b';
    process.env.SECOURS_API_URL = 'https://inference.exemple/v1/chat/completions';

    fetchMock
      .mockResolvedValueOnce(reponseInterdite(MODELES_COURTS[0]))
      .mockResolvedValueOnce(reponseInterdite(MODELES_COURTS[1]))
      .mockResolvedValueOnce(reponseOk('Debout, ta série t’attend.'));

    const texte = await service.generate('Yannis', sync);

    expect(texte).toBe('Debout, ta série t’attend.');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe('https://inference.exemple/v1/chat/completions');

    delete process.env.SECOURS_API_KEY;
    delete process.env.SECOURS_MODELE;
    delete process.env.SECOURS_API_URL;
  });

  it('borne le raisonnement du modèle, et lui laisse de quoi écrire après', async () => {
    /*
      Les modèles actuels réfléchissent avant d'écrire, sur le même budget que
      leur réponse. Il faut donc les deux garde-fous, et aucun ne remplace
      l'autre : le réglage réduit la dépense de réflexion, le budget décide de ce
      qui reste pour écrire une fois cette dépense faite.

      Sans le réglage, mesuré contre le vrai Groq, ils rendent un contenu vide et
      le brief part en version générique pour tout le monde, sans qu'aucune erreur
      ne soit levée — ce qui s'est produit du 18 au 19 août 2026.

      Avec le réglage mais à 80 jetons, mesuré le 21 août sur 14 appels : 4 textes
      utilisables seulement, le raisonnement consommant de 13 à 78 jetons selon
      l'humeur du modèle. À 200 : 12 sur 14. Le test regarde donc ce qui est
      envoyé, pas seulement ce qui revient.
    */
    fetchMock.mockResolvedValueOnce(reponseOk('Debout, ta série t’attend.'));

    await service.generate('Yannis', sync);

    const corps = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corps.reasoning_effort).toBeDefined();
    expect(corps.max_tokens).toBe(JETONS_TEXTE_COURT);
  });

  it('bascule sur le gros modèle quand le petit est interdit sur le projet', async () => {
    fetchMock
      .mockResolvedValueOnce(reponseInterdite(MODELES_COURTS[0]))
      .mockResolvedValueOnce(reponseOk('Debout, ta série t’attend.'));

    const texte = await service.generate('Yannis', sync);

    expect(texte).toBe('Debout, ta série t’attend.');
    expect(modelesAppeles()).toEqual([MODELES_COURTS[0], MODELES_COURTS[1]]);
  });

  it('rend null quand aucun modèle ne répond, pour laisser passer le générique', async () => {
    fetchMock.mockResolvedValue(reponseInterdite('peu importe'));

    const texte = await service.generate('Yannis', sync);

    // Une notification banale vaut mieux que pas de notification.
    expect(texte).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retire les guillemets dont le modèle entoure parfois sa phrase', async () => {
    fetchMock.mockResolvedValueOnce(reponseOk('"Debout, champion."'));

    expect(await service.generate('Yannis', sync)).toBe('Debout, champion.');
  });

  it('ne tente aucun appel sans clé', async () => {
    delete process.env.GROQ_API_KEY;

    expect(await service.generate('Yannis', sync)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /*
    Une notification ne se rattrape pas : elle est déjà sur l'écran verrouillé de
    quelqu'un quand on s'aperçoit qu'elle est coupée. D'où le seul arbitrage un peu
    fin de ce lot — il dépend de l'endroit où tombe la coupure.
  */
  describe('une réponse arrêtée par max_tokens', () => {
    it('refuse la phrase coupée avant le plafond, et laisse sa chance au modèle suivant', async () => {
      fetchMock
        .mockResolvedValueOnce(reponseCoupee('Debout Yannis, ta série de 4 jours tient encore si tu'))
        .mockResolvedValueOnce(reponseOk('Debout : ta série de 4 jours se joue ce matin.'));

      const texte = await service.generate('Yannis', sync);

      expect(texte).toBe('Debout : ta série de 4 jours se joue ce matin.');
      expect(modelesAppeles()).toEqual([MODELES_COURTS[0], MODELES_COURTS[1]]);
    });

    it('retombe sur le message générique si les deux modèles sont coupés', async () => {
      fetchMock.mockResolvedValue(reponseCoupee('Debout Yannis, ta série tient encore si tu'));

      expect(await service.generate('Yannis', sync)).toBeNull();
    });

    /*
      Le cas inverse, et c'est pour lui que la condition existe : au-delà du plafond,
      la phrase est de toute façon ramenée à 160 caractères suivis de points de
      suspension. Coupée ou non, ce qui part est identique — la rejeter dépenserait un
      second appel sur un quota quotidien compté, pour rien.
    */
    it('garde la phrase coupée au-delà du plafond, que le plafond absorbe déjà', async () => {
      const bavard = 'Debout Yannis. ' + 'Ta série de quatre jours tient encore ce matin. '.repeat(6);
      fetchMock.mockResolvedValueOnce(reponseCoupee(bavard));

      const texte = await service.generate('Yannis', sync);

      // 157 caractères conservés, plus le caractère de points de suspension.
      expect(texte).toHaveLength(158);
      expect(texte!.endsWith('…')).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Un compte qui n'a encore rien planifié s'est vu réclamer « 10m de footing » un
 * matin — une tâche qu'il n'avait jamais définie, et qui n'existait nulle part dans
 * ses données.
 *
 * L'origine n'était pas le modèle mais l'invite : trois états sont possibles (rien
 * de prévu, il reste des choses, tout est fait) et l'angle du jour n'en distinguait
 * que deux. Une journée vide retombait donc sur les angles du cas « il reste des
 * choses », dont deux ordonnent de citer une tâche précise. N'en ayant aucune sous
 * les yeux, le modèle obéissait en l'inventant.
 *
 * C'est l'état de tout compte neuf, et l'app est faite pour qu'on arrive sans rien :
 * les routines se définissent en parlant au coach.
 */
describe("MorningBriefService — quand la journée est vide", () => {
  const service = new MorningBriefService();

  const inviteAvec = (sync: any) => service.buildPrompt('Yannis', sync);

  /** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
  const jour = (recul: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - recul);
    return d.toISOString().slice(0, 10);
  };

  // L'angle tourne avec la date : se contenter de vérifier l'absence des angles
  // exigeants laisserait passer le bug un jour sur deux, selon l'angle tiré. On
  // exige donc la présence de l'interdiction, qui ne dépend d'aucune date.
  it("interdit explicitement de donner une tâche quand il n'y en a aucune", () => {
    const invite = inviteAvec({ routines: [], micro_objectives: [] });

    expect(invite).toContain('Aucune tâche planifiée');
    expect(invite).toMatch(/Ne lui donne AUCUNE tâche|Ne propose aucune activité précise/);
    expect(invite).not.toContain('Cite une tâche précise');
    expect(invite).not.toContain("ce qu'il lui reste à faire");
  });

  it('invite plutôt à décider de sa journée dans le chat', () => {
    const invite = inviteAvec({ routines: [], micro_objectives: [] });

    expect(invite.toLowerCase()).toContain('chat');
  });

  // Des objectifs sans aucune routine du jour restent une journée vide : c'est
  // exactement la situation où « Aller à la salle de sport » est devenu un footing.
  it('traite comme vide un compte qui a des objectifs mais rien à faire aujourd\'hui', () => {
    const invite = inviteAvec({
      routines: [],
      micro_objectives: [{ title: 'Aller à la salle de sport', done: false }],
    });

    expect(invite).not.toContain('Cite une tâche précise');
    expect(invite).toContain('Aller à la salle de sport');
  });

  it('garde les angles exigeants dès qu\'il reste vraiment quelque chose à faire', () => {
    const invite = inviteAvec({
      routines: [{ items: [{ title: 'Méditer 10 minutes', done: false }] }],
    });

    expect(invite).toContain('RESTE À FAIRE');
    expect(invite).not.toContain('AUCUNE tâche');
  });

  it('félicite sans rien réclamer quand tout est coché aujourd’hui', () => {
    const invite = inviteAvec({
      routines: [{ items: [{ title: 'Méditer 10 minutes', done: true }] }],
      last_routine_date: jour(0),
    });

    expect(invite).toContain('Tout est terminé');
    expect(invite).toContain('félicite');
  });

  /*
    La félicitation partie un matin à 10 h 50 : « Tu as terminé tous tes exercices »,
    une heure avant que l'app, ouverte, montre les six tâches intactes.

    Les cases ne sont décochées que par le client, à l'ouverture. Tant que personne
    n'ouvre l'app, la base garde la soirée de la veille — toute cochée — et le brief
    la lisait comme la journée du jour. Rien n'échouait : la donnée était vieille
    d'un jour et parfaitement plausible.
  */
  it('ne félicite pas pour les cases de la veille', () => {
    const invite = inviteAvec({
      routines: [{ items: [{ title: 'Squats (4×12)', done: true }, { title: 'Pompes (3×15)', done: true }] }],
      last_routine_date: jour(1),
    });

    expect(invite).not.toContain('Tout est terminé');
    expect(invite).not.toContain('DÉJÀ FAIT');
    expect(invite).toContain('RESTE À FAIRE');
    expect(invite).toContain('Squats (4×12)');
  });

  /*
    Un jour sans séance n'est pas une journée vide.

    Le coach est invité à poser un champ `jours` sur la plupart des tâches qu'il
    propose — c'est dans son invite. Quelqu'un qui suit un programme lundi,
    mercredi, vendredi a donc quatre matins par semaine sans rien à cocher : lui
    annoncer « ta journée est vide, dis-moi ce que tu veux faire » revient à donner
    tort au plan qu'on lui a soi-même donné.
  */
  const NOMS_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const unAutreJour = () => NOMS_JOURS[(jourDeSemaine() + 3) % 7];

  it("parle de repos, et non de vide, quand le programme ne prévoit rien aujourd'hui", () => {
    const invite = inviteAvec({
      routines: [{ items: [{ title: 'Squats (4×12)', jours: [unAutreJour()] }] }],
      last_routine_date: jour(0),
    });

    expect(invite).toContain('jour sans séance');
    expect(invite).not.toContain('Aucune tâche planifiée');
    expect(invite).not.toContain('AUCUNE tâche');
    // Et surtout : pas de tâche citée, puisqu'elle n'est pas au programme du jour.
    expect(invite).not.toContain('Squats');
  });

  it('garde le vide pour un compte qui n’a vraiment rien défini', () => {
    const invite = inviteAvec({ routines: [], last_routine_date: jour(0) });

    expect(invite).toContain('Aucune tâche planifiée');
    expect(invite).not.toContain('jour sans séance');
  });

  it('traite une date de routines absente comme périmée', () => {
    // C'est aussi ce que fait le client, dont le test est `lastDate !== today` :
    // sans date, il décoche. Le serveur doit conclure ce que l'écran montrera.
    const invite = inviteAvec({
      routines: [{ items: [{ title: 'Méditer 10 minutes', done: true }] }],
    });

    expect(invite).not.toContain('Tout est terminé');
    expect(invite).toContain('RESTE À FAIRE');
  });
});

/*
  Le deuxième jour, et ce que le coach a le droit de dire ce matin-là.

  Mesuré le 25 août 2026 : deux tiers de ceux qui agissent n'agissent qu'une seule
  journée. Quelqu'un qui a fini le questionnaire hier et n'a encore rien coché tombe
  dans l'état « rien » — et recevait jusque-là « ta journée est vide, dis-moi ce que
  tu veux faire », c'est-à-dire une question que le produit lui avait déjà posée la
  veille, et dont il avait la réponse en base depuis l'inscription.
*/
describe('MorningBriefService — ce qu’il a dit vouloir en s’inscrivant', () => {
  const service = new MorningBriefService();
  const vide = { routines: [], micro_objectives: [] };

  it('donne ses mots au modèle', () => {
    const invite = service.buildPrompt('Yannis', vide, {
      objectives: ['arrêter de repousser ma thèse'],
      situation: null,
    });

    expect(invite).toContain('arrêter de repousser ma thèse');
  });

  it('impose de partir de là quand la journée est vide', () => {
    const invite = service.buildPrompt('Yannis', vide, {
      objectives: ['arrêter de repousser ma thèse'],
      situation: null,
    });

    expect(invite).toMatch(/CE QU'IL A DIT VOULOIR|ses mots|ce pour quoi il est venu/);
    // L'interdiction d'inventer une tâche ne disparaît pas pour autant : c'est elle
    // qui a empêché « 10m de footing » d'être ordonné à un compte sans routine.
    expect(invite).toMatch(/sans jamais en inventer|N'invente aucune tâche/);
  });

  it('garde l’ancien angle pour un compte sans profil', () => {
    // `null` est un résultat normal : une partie des comptes n'a jamais fini le
    // questionnaire. L'invite doit rester celle d'avant, pas une version amputée.
    const invite = service.buildPrompt('Yannis', vide, null);

    expect(invite).toMatch(/Ne lui donne AUCUNE tâche|Ne propose aucune activité précise/);
    expect(invite).not.toContain('CE QU’IL A DIT VOULOIR');
  });

  it('ne cite pas un paragraphe entier', () => {
    const invite = service.buildPrompt('Yannis', vide, {
      objectives: ['a'.repeat(200)],
      situation: null,
    });

    expect(invite).not.toContain('aaaa');
    expect(invite).toMatch(/Ne lui donne AUCUNE tâche|Ne propose aucune activité précise/);
  });
});
