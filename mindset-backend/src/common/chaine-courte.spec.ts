import { chaineCourte, appelerMaillon, MaillonCourt } from './chaine-courte';
import { MODELES_COURTS } from './modeles';

/**
 * Le filet des textes courts.
 *
 * Le chat descendait vers un fournisseur payant quand Groq saturait ; le brief du
 * matin, le coup de pouce, le bilan, l'analyse complète et la mémoire longue,
 * non. Ils se taisaient et retombaient sur leurs textes locaux, sans une erreur.
 * Ces cas fixent ce qui les en empêche — et surtout l'ordre, car un maillon
 * payant placé ailleurs qu'en dernier ferait payer ce que Groq donnait.
 */
describe('chaineCourte', () => {
  const initial = { ...process.env };

  beforeEach(() => {
    delete process.env.SECOURS_API_KEY;
    delete process.env.SECOURS_MODELE;
    delete process.env.SECOURS_API_URL;
  });

  afterAll(() => {
    process.env = initial;
  });

  const configurerSecours = () => {
    process.env.SECOURS_API_KEY = 'cle-payante';
    process.env.SECOURS_MODELE = 'openai/gpt-oss-120b';
    process.env.SECOURS_API_URL = 'https://inference.exemple/v1/chat/completions';
  };

  it('rend les modèles gratuits, dans l’ordre, quand aucun secours n’existe', () => {
    const chaine = chaineCourte('cle-groq');
    expect(chaine.map((m) => m.modele)).toEqual([...MODELES_COURTS]);
    expect(chaine.every((m) => !m.paye)).toBe(true);
  });

  it('place le maillon payant en dernier, jamais avant', () => {
    configurerSecours();
    const chaine = chaineCourte('cle-groq');

    expect(chaine).toHaveLength(MODELES_COURTS.length + 1);
    expect(chaine[chaine.length - 1].paye).toBe(true);
    expect(chaine.slice(0, -1).some((m) => m.paye)).toBe(false);
  });

  it('garde le secours quand la clé Groq manque', () => {
    /*
      Chaque service commençait par « pas de clé Groq, pas de texte ». Ce
      raccourci ferait taire un secours parfaitement configuré au motif que la clé
      gratuite manque — c'est-à-dire le jour précis où il servirait.
    */
    configurerSecours();
    const chaine = chaineCourte(undefined);

    expect(chaine).toHaveLength(1);
    expect(chaine[0]).toMatchObject({ paye: true, url: 'https://inference.exemple/v1/chat/completions' });
  });

  it('rend une chaîne vide quand rien n’est configuré : l’appelant se tait', () => {
    expect(chaineCourte(undefined)).toEqual([]);
  });
});

describe('appelerMaillon', () => {
  const maillon: MaillonCourt = {
    modele: 'openai/gpt-oss-20b',
    url: 'https://exemple/v1/chat/completions',
    apiKey: 'cle',
    paye: true,
  };
  const demande = { messages: [{ role: 'user', content: 'salut' }], temperature: 0.7, jetons: 80 };
  const signal = new AbortController().signal;

  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  const corpsEnvoye = (rang: number) => JSON.parse(fetchMock.mock.calls[rang][1].body);

  it('borne le raisonnement même chez le fournisseur payant', async () => {
    // Différence assumée avec le chat : 1500 jetons absorbent une réflexion, 80
    // non. Payer quelqu'un pour qu'il rende du vide serait le pire des deux mondes.
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await appelerMaillon(maillon, demande, signal);

    expect(corpsEnvoye(0).reasoning_effort).toBe('low');
    expect(corpsEnvoye(0).max_tokens).toBe(80);
  });

  it('réessaie une fois sans le réglage quand le fournisseur le refuse', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"unknown parameter reasoning_effort"}}', { status: 400 }),
      )
      .mockResolvedValueOnce(new Response('{"choices":[]}', { status: 200 }));

    const reponse = await appelerMaillon(maillon, demande, signal);

    expect(reponse.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(corpsEnvoye(1)).not.toHaveProperty('reasoning_effort');
  });

  it('ne réessaie pas un 400 qui parle d’autre chose, et en garde le corps', async () => {
    // Le corps du fournisseur nomme la faute mieux qu'aucune phrase écrite ici ;
    // le consommer pour le lire ne doit pas le faire disparaître de la réponse.
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"model not found"}}', { status: 400 }));

    const reponse = await appelerMaillon(maillon, demande, signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reponse.status).toBe(400);
    await expect(reponse.text()).resolves.toContain('model not found');
  });
});
