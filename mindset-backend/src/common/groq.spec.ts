import { lireReponseGroq } from './groq';

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
