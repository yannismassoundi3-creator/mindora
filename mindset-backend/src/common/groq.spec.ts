import { lireReponseGroq, corpsGroq, pourModele } from './groq';

/**
 * Une réponse coupée par `max_tokens` arrive avec un statut 200 et la même forme
 * qu'une réponse terminée. Tout le projet la lisait donc comme complète, et la seule
 * chose qui distinguait les deux — `finish_reason` — n'était lue nulle part.
 *
 * Ces cas fixent surtout la règle du silence : un fournisseur qui ne renseigne pas le
 * champ ne doit pas voir ses réponses rejetées, sans quoi le garde-fou coûterait plus
 * qu'il ne rapporte.
 */
describe('lireReponseGroq', () => {
  const reponse = (contenu: any, finish?: string) => ({
    choices: [{ message: { content: contenu }, ...(finish ? { finish_reason: finish } : {}) }],
  });

  it('rend le texte débarrassé de ses espaces de bord', () => {
    expect(lireReponseGroq(reponse('  Debout.  ', 'stop'))).toEqual({ texte: 'Debout.', tronque: false });
  });

  it('signale la coupure par max_tokens', () => {
    expect(lireReponseGroq(reponse('Debout, et n’oublie pas de', 'length')).tronque).toBe(true);
  });

  it('tient une réponse terminée pour entière', () => {
    expect(lireReponseGroq(reponse('Debout.', 'stop')).tronque).toBe(false);
  });

  // Le champ manquant est le cas de tous les tests déjà écrits dans ce projet, dont
  // les fausses réponses n'ont jamais porté de `finish_reason`. Le traiter comme une
  // troncature ferait échouer la moitié de la suite — et rejetterait en production
  // des réponses parfaitement complètes.
  it('tient une réponse sans finish_reason pour entière', () => {
    expect(lireReponseGroq(reponse('Debout.')).tronque).toBe(false);
  });

  it('rend null sur un contenu vide, une forme inattendue ou rien du tout', () => {
    expect(lireReponseGroq(reponse('   ', 'stop')).texte).toBeNull();
    expect(lireReponseGroq(reponse(null, 'stop')).texte).toBeNull();
    expect(lireReponseGroq({ choices: [] }).texte).toBeNull();
    expect(lireReponseGroq(undefined).texte).toBeNull();
  });

  // Un modèle à raisonnement peut dépenser tout son budget avant d'écrire un mot :
  // c'est ce qu'a fait `openai/gpt-oss-120b` à cinq jetons. Vide et coupé à la fois.
  it('rapporte les deux à la fois quand le budget part en raisonnement', () => {
    expect(lireReponseGroq(reponse('', 'length'))).toEqual({ texte: null, tronque: true });
  });
});

/**
 * Le réglage qui décide si le modèle écrit quelque chose.
 *
 * Les modèles arrivés le 18 août 2026 réfléchissent avant d'écrire, sur le même
 * budget. À 80 jetons — celui du brief du matin — `openai/gpt-oss-20b` dépense
 * tout en raisonnement et rend un contenu vide : le service retombe sur son repli
 * local, et personne ne l'apprend. Ces cas fixent la seule chose qui l'empêche.
 */
describe('corpsGroq', () => {
  const messages = [{ role: 'user', content: 'Bonjour' }];

  it('borne le raisonnement des GPT-OSS, sinon ils épuisent le budget avant d’écrire', () => {
    const corps = corpsGroq({ modele: 'openai/gpt-oss-20b', messages, temperature: 0.7, jetons: 80 });
    expect(corps).toMatchObject({ model: 'openai/gpt-oss-20b', max_tokens: 80, reasoning_effort: 'low' });
  });

  it('emploie le vocabulaire de Qwen, qui refuse « low » d’un 400', () => {
    expect(corpsGroq({ modele: 'qwen/qwen3.6-27b', messages, temperature: 0.7, jetons: 80 }).reasoning_effort).toBe(
      'none',
    );
  });

  it('n’envoie rien à un modèle inconnu : un paramètre refusé coûte l’appel entier', () => {
    expect(corpsGroq({ modele: 'un-modele-inconnu', messages, temperature: 0.7, jetons: 80 })).not.toHaveProperty(
      'reasoning_effort',
    );
  });
});

describe('pourModele', () => {
  const corps = { model: 'openai/gpt-oss-120b', messages: [], temperature: 0.3, max_tokens: 1500, reasoning_effort: 'low' };

  it('ne transporte pas le réglage d’une famille à l’autre', () => {
    // « low » est valide chez GPT-OSS et refusé par Qwen. Reconduit tel quel, il
    // ferait échouer le maillon de repli au moment précis où on compte dessus —
    // et l'échec ressemblerait à un modèle retiré du catalogue.
    expect(pourModele(corps, 'qwen/qwen3.6-27b')).toMatchObject({
      model: 'qwen/qwen3.6-27b',
      reasoning_effort: 'none',
      max_tokens: 1500,
    });
  });

  it('n’envoie aucun réglage au fournisseur de secours, dont on ne sait rien', () => {
    expect(pourModele(corps, 'openai/gpt-oss-120b', false)).not.toHaveProperty('reasoning_effort');
  });
});
