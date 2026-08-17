import { lireFournisseurSecours, verifierSecours } from './fournisseur-secours';

/**
 * Le contrôle du secours n'a qu'un seul devoir : dire la vérité sur ce qui cloche.
 *
 * Il sert au moment où l'on doute d'une configuration qu'on ne peut pas relire —
 * les valeurs sont masquées sur Render. Un diagnostic approximatif y coûte plus
 * cher qu'une absence de diagnostic : il envoie corriger la mauvaise variable. Il
 * a déjà accusé une adresse parfaitement correcte alors que la faute venait du
 * budget de jetons demandé ici même.
 */
describe('fournisseur de secours', () => {
  const initial = { ...process.env };
  let fetchMock: jest.Mock;

  const reponse = (corps: any, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => corps,
    text: async () => JSON.stringify(corps),
  });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    process.env.SECOURS_API_KEY = 'cle';
    process.env.SECOURS_MODELE = 'un/modele';
    process.env.SECOURS_API_URL = 'https://exemple.test/v1/chat/completions';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...initial };
  });

  it('laisse au modèle de quoi répondre', async () => {
    // Le contrôle demandait 5 jetons. Un modèle à raisonnement les dépense avant
    // d'écrire son premier mot : le budget doit couvrir la réflexion ET la réponse,
    // sans quoi on accuse le fournisseur d'un défaut qui vient d'ici.
    fetchMock.mockResolvedValue(reponse({ choices: [{ message: { content: 'ok' } }] }));

    await verifierSecours();

    const corps = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corps.max_tokens).toBeGreaterThanOrEqual(100);
  });

  it('rend le verdict et la latence quand tout va bien', async () => {
    fetchMock.mockResolvedValue(reponse({ choices: [{ message: { content: 'ok' } }] }));

    const etat = await verifierSecours();

    expect(etat.ok).toBe(true);
    expect(etat.erreur).toBeNull();
    expect(etat.modele).toBe('un/modele');
    expect(etat.latenceMs).not.toBeNull();
  });

  it("distingue « pas de place pour répondre » de « mauvaise adresse »", async () => {
    // 200, structure OpenAI valide, mais rien à lire : la faute est au budget de
    // jetons, pas à l'adresse. Le message doit le dire, sinon on part corriger
    // une variable qui n'a rien fait.
    fetchMock.mockResolvedValue(
      reponse({ choices: [{ finish_reason: 'length', message: { content: null, reasoning: '...' } }] }),
    );

    const etat = await verifierSecours();

    expect(etat.ok).toBe(false);
    expect(etat.erreur).toContain('length');
    expect(etat.erreur).toContain('reasoning');
    expect(etat.erreur).not.toContain('format OpenAI');
  });

  it("n'accuse l'adresse que lorsqu'il n'y a aucune structure reconnaissable", async () => {
    fetchMock.mockResolvedValue(reponse({ resultat: 'autre chose' }));

    const etat = await verifierSecours();

    expect(etat.ok).toBe(false);
    expect(etat.erreur).toContain('format OpenAI');
  });

  it('ne laisse jamais ressortir la clé dans un message d’erreur', async () => {
    // Un fournisseur peut recopier la clé dans son corps d'erreur. Ce message est
    // affiché à l'écran et recopié dans des échanges : elle n'a rien à y faire.
    process.env.SECOURS_API_KEY = 'secret-tres-identifiable';
    fetchMock.mockResolvedValue(
      reponse({ error: 'clé secret-tres-identifiable refusée' }, false, 401),
    );

    const etat = await verifierSecours();

    expect(etat.erreur).not.toContain('secret-tres-identifiable');
    expect(etat.erreur).toContain('***');
  });

  it('reste inerte sans clé, et le dit', async () => {
    delete process.env.SECOURS_API_KEY;

    expect(lireFournisseurSecours()).toBeNull();
    const etat = await verifierSecours();

    expect(etat.configure).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
