import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { planInstalleVide, resumerPlanInstalle, resumerPlanSansNouveaute } from './resumePlan';

/*
  Ce module décide de ce que la personne lit sous la réponse du coach. Ce qui se
  vérifie ici n'est donc pas la mise en forme, mais **qu'il ne dise jamais plus
  que ce qui a été écrit** : c'est la faute que ce projet répète — annoncer un
  succès pendant que les listes n'ont pas bougé.
*/
describe('le résumé du plan installé', () => {
  it('nomme les tâches, par créneau, dans l’ordre de la journée', () => {
    const resume = resumerPlanInstalle({
      ...planInstalleVide(),
      taches: [
        { creneau: 'Soir', titre: 'Front lever tuck (3x10s)' },
        { creneau: 'Matin', titre: 'Tractions strictes (4x6)' },
        { creneau: 'Matin', titre: 'Dips (4x8)' },
      ],
    });

    expect(resume).toContain('3 tâches');
    expect(resume).toContain('- **Matin** : Tractions strictes (4x6) · Dips (4x8)');
    expect(resume).toContain('- **Soir** : Front lever tuck (3x10s)');
    expect(resume.indexOf('Matin')).toBeLessThan(resume.indexOf('Soir'));
    // Un créneau vide se tait : une ligne « Midi : » ferait croire à un oubli.
    expect(resume).not.toContain('Midi');
  });

  it('accorde les nombres et cite chaque catégorie touchée', () => {
    const resume = resumerPlanInstalle({
      taches: [{ creneau: 'Matin', titre: 'Tractions (4x6)' }],
      habitudes: ['Lecture 10 min', 'Étirements du soir'],
      repas: ['Déjeuner'],
      objectifs: ['Muscle-up propre'],
    });

    expect(resume).toContain('1 tâche, 2 habitudes, 1 repas, 1 objectif.');
    expect(resume).toContain('- **Habitudes** : Lecture 10 min · Étirements du soir');
    expect(resume).toContain('- **Repas** : Déjeuner');
    expect(resume).toContain('- **Objectifs** : Muscle-up propre');
  });

  it('borne la liste plutôt que de remplir la conversation', () => {
    const taches = Array.from({ length: 14 }, (_, i) => ({ creneau: 'Matin', titre: `Tâche ${i + 1}` }));
    const resume = resumerPlanInstalle({ ...planInstalleVide(), taches });

    expect(resume).toContain('14 tâches');
    expect(resume).toContain('Tâche 10');
    expect(resume).not.toContain('Tâche 11');
    expect(resume).toContain('+4');
  });

  it('se rend en liste dans la conversation, pas en un pavé', () => {
    /*
      Le seul point de ce module qui ne se voit pas en lisant la chaîne : la bulle
      passe par `ReactMarkdown` **sans `remark-breaks`**. Un simple retour à la
      ligne y vaut une espace — les créneaux se retrouveraient collés bout à bout
      dans un paragraphe unique, ce que ce résumé existe précisément pour éviter.

      On rend donc le texte comme l'écran le rend, et on compte les puces.
    */
    const resume = resumerPlanInstalle({
      ...planInstalleVide(),
      taches: [
        { creneau: 'Matin', titre: 'Tractions (4x6)' },
        { creneau: 'Soir', titre: 'Front lever tuck (3x10s)' },
      ],
      objectifs: ['Muscle-up propre'],
    });

    const html = renderToStaticMarkup(createElement(ReactMarkdown, null, resume));

    expect((html.match(/<li>/g) ?? []).length).toBe(3);
    expect(html).toContain('<strong>Matin</strong>');
  });

  it('ne dit rien quand rien n’a été écrit', () => {
    /*
      Le cas arrive vraiment : `applyPlanData` écarte les doublons, donc un plan
      redemandé à l'identique n'installe rien. C'est l'appelant qui choisit alors
      la phrase — ici, on refuse seulement d'inventer un succès.
    */
    expect(resumerPlanInstalle(planInstalleVide())).toBe('');
    expect(resumerPlanSansNouveaute()).toContain('Rien de neuf');
  });

  it('garde un créneau que le mappage n’a pas reconnu', () => {
    // Mieux vaut une ligne « Autres » qu'une tâche installée dont le résumé ne
    // parle pas : le décompte annoncé ne correspondrait plus à ce qui est listé.
    const resume = resumerPlanInstalle({
      ...planInstalleVide(),
      taches: [{ creneau: 'nuit', titre: 'Respiration (5 min)' }],
    });
    expect(resume).toContain('- **Autres** : Respiration (5 min)');
  });
});
