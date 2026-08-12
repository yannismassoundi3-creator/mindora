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
