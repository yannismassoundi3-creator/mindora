import { describe, it, expect } from 'vitest';
import { extrairePlan, reparerJson, retirerObjetsDePlan } from './extractionPlan';

/*
  Les retouches voyagent dans le même bloc `<PLAN>` que le plan complet, et c'est
  volontaire : le transport est éprouvé — balises mutilées, virgules en rafale,
  objets nus sans balise. Mais il ne reconnaissait un plan qu'à ses champs, et
  `edits` n'en faisait pas partie.

  Ce qui se serait passé sans cette entrée : le bloc n'aurait été ni appliqué ni
  retiré, et la personne aurait lu son JSON en clair sous la réponse du coach.
  C'est exactement la panne de production du 22 août, sur le chemin neuf.
*/
describe('un bloc qui ne contient que des retouches', () => {
  const EDITS = '{"edits":[{"op":"habit.rename","target":"Méditation 10 min","value":"Méditation 5 min"}]}';

  it('est extrait et retiré du texte affiché', () => {
    const reponse = `Je passe ta méditation à 5 minutes : tenue 2 fois sur 7.\n<PLAN>${EDITS}</PLAN>`;

    const { texte, json, planPresent } = extrairePlan(reponse);

    expect(planPresent).toBe(true);
    expect(JSON.parse(json).edits[0].op).toBe('habit.rename');
    expect(texte).toBe('Je passe ta méditation à 5 minutes : tenue 2 fois sur 7.');
    expect(texte).not.toContain('edits');
  });

  it('est reconnu même quand la fermeture est mutilée', () => {
    /*
      « ; ↘'PLAN> » a été vu en production. L'ouverture suffit à condamner la
      suite : ce qui vient après n'a jamais vocation à être lu par un humain.

      Le débris de la balise reste collé au JSON — c'est le comportement réel — et
      c'est `reparerJson` qui le retire, exactement comme le fait le chat avant de
      parser. Le test suit donc le même parcours : mesurer une étape isolée aurait
      décrit un chemin que personne n'emprunte.
    */
    const { texte, json } = extrairePlan(`Fait.\n<PLAN>${EDITS}↘'PLAN>`);

    expect(JSON.parse(reparerJson(json)).edits).toHaveLength(1);
    expect(texte).toBe('Fait.');
  });

  it('est reconnu sans aucune balise', () => {
    // Le modèle oublie parfois les balises et se contente d'un objet nu.
    const { json, planPresent } = extrairePlan(`Voilà.\n${EDITS}`);

    expect(planPresent).toBe(true);
    expect(JSON.parse(json).edits).toHaveLength(1);
  });

  it('ne survit pas au nettoyage de dernier recours', () => {
    // La ceinture après les bretelles : même si l'extraction rate, l'objet ne
    // doit jamais s'afficher.
    expect(retirerObjetsDePlan(`Fait. ${EDITS}`)).toBe('Fait. ');
  });

  it('laisse tranquille un objet JSON qui n’est pas un plan', () => {
    // Du JSON peut légitimement apparaître dans une réponse qui parle de code.
    const autre = '{"reps":12,"series":4}';
    expect(retirerObjetsDePlan(`Voici : ${autre}`)).toBe(`Voici : ${autre}`);
  });
});
