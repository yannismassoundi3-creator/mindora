import {
  FILTRE_MESSAGES_AUTOMATIQUES,
  FILTRE_MESSAGES_ECRITS,
  MESSAGES_AUTOMATIQUES_INSCRIPTION,
  estMessageAutomatique,
} from './message-inscription';

/**
 * Ce fichier verrouille une règle qu'un commentaire ne suffit pas à tenir :
 * **on ajoute une formulation, on n'en remplace jamais une**.
 *
 * Les lignes déjà écrites en base gardent le texte de leur époque. Le jour où
 * quelqu'un modifie le message d'inscription et met à jour la constante en
 * écrasant l'ancienne, tous les questionnaires antérieurs se remettent à compter
 * comme des conversations — et le tableau de bord réaffiche la conversion
 * parfaite et mécanique qu'on a mis un correctif à faire disparaître. Rien ne
 * planterait, rien ne le signalerait.
 */
describe('messages automatiques du questionnaire', () => {
  /**
   * La formulation d'origine, écrite en dur ici exprès.
   *
   * L'importer depuis la constante ne prouverait rien — le test suivrait la
   * modification qu'il est censé empêcher.
   */
  const FORMULATION_ORIGINE =
    "Je viens de terminer mon inscription. Donne-moi mon plan pour aujourd'hui : mes routines, mes habitudes et mes objectifs.";

  it("conserve la formulation d'origine, quoi qu'il arrive ensuite", () => {
    expect(MESSAGES_AUTOMATIQUES_INSCRIPTION).toContain(FORMULATION_ORIGINE);
  });

  it('reconnaît un message automatique et laisse passer les autres', () => {
    expect(estMessageAutomatique(FORMULATION_ORIGINE)).toBe(true);
    expect(estMessageAutomatique("J'ai du mal à me lever le matin")).toBe(false);
    expect(estMessageAutomatique(null)).toBe(false);
    expect(estMessageAutomatique('')).toBe(false);
  });

  it('ne retient que les messages écrits par la personne', () => {
    expect(FILTRE_MESSAGES_ECRITS.sender).toBe('user');
    // Les réponses du coach comptent double sinon : une ligne par échange.
    expect(FILTRE_MESSAGES_ECRITS.text.notIn).toEqual([...MESSAGES_AUTOMATIQUES_INSCRIPTION]);
  });

  it('compte les automatiques exactement à l’inverse', () => {
    // Les deux filtres doivent partitionner les messages de la personne : une
    // formulation présente dans l'un et absente de l'autre disparaîtrait des deux
    // compteurs, et le total du tableau ne tomberait plus juste.
    expect(FILTRE_MESSAGES_AUTOMATIQUES.text.in).toEqual(FILTRE_MESSAGES_ECRITS.text.notIn);
    expect(FILTRE_MESSAGES_AUTOMATIQUES.sender).toBe(FILTRE_MESSAGES_ECRITS.sender);
  });
});
