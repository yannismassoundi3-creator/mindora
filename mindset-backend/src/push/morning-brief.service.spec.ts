import { Logger } from '@nestjs/common';
import { MorningBriefService } from './morning-brief.service';

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

    expect(modelesAppeles()).toEqual(['llama-3.1-8b-instant']);
  });

  it('bascule sur le gros modèle quand le petit est interdit sur le projet', async () => {
    fetchMock
      .mockResolvedValueOnce(reponseInterdite('llama-3.1-8b-instant'))
      .mockResolvedValueOnce(reponseOk('Debout, ta série t’attend.'));

    const texte = await service.generate('Yannis', sync);

    expect(texte).toBe('Debout, ta série t’attend.');
    expect(modelesAppeles()).toEqual(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);
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

  it('félicite sans rien réclamer quand tout est coché', () => {
    const invite = inviteAvec({
      routines: [{ items: [{ title: 'Méditer 10 minutes', done: true }] }],
    });

    expect(invite).toContain('Tout est terminé');
    expect(invite).toContain('félicite');
  });
});
