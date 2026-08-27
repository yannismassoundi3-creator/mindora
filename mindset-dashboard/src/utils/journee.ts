import { estPourAujourdhui } from './recurrence';
import { trouverIndex } from './correspondance';
import {
  ecrireGroupes,
  lireGroupes,
  signalerChangementRoutines,
  signalerJournee,
} from './jourRoutines';
import { getSecurePoints, setSecurePoints } from './secureStorage';
import { ajouterXp } from './progression';
import { playBloopSound } from './sounds';
import { noterTacheFaite } from './rythme';
import { api } from '../services/api';

/*
  L'état de la journée, lisible depuis n'importe quelle page.

  Le bandeau de commandement vit maintenant dans le Layout : il est affiché sur
  les Objectifs, les Habitudes, le Profil — partout où le tableau de bord n'est
  pas monté. Il ne peut donc plus se reposer sur l'état React du Dashboard, et le
  cochage ne peut plus passer par lui.

  Tout est recalculé ici à partir de `localStorage`, avec exactement les mêmes
  formules que le Dashboard. Deux lecteurs, une seule règle de calcul : c'est la
  seule façon d'éviter que les deux affichent des chiffres différents.

  Point à ne pas « corriger » sans y réfléchir : le score du jour est enregistré
  sous une clé **UTC** (`toISOString`) alors que la série se lit sur des clés
  **locales**. C'est le comportement d'origine du Dashboard ; le reproduire tel
  quel est délibéré, le changer déplacerait les séries de tout le monde.
*/

/*
  Les routines elles-mêmes vivent dans `jourRoutines.ts`, avec la date de leurs
  coches — les deux ne se séparent pas. Repris ici pour que rien n'ait à changer
  d'import : c'est ce module que les écrans connaissent.
*/
export { EVENEMENT_JOURNEE } from './jourRoutines';
export { lireGroupes, signalerJournee, signalerChangementRoutines };

export const EVENEMENT_TACHE_FAITE = 'mindset:tache-faite';
export const EVENEMENT_GAIN = 'mindset:gain';

/*
  Le chiffre qui s'envole du point touché. Défini ici plutôt que dans le
  composant qui l'affiche : les deux chemins de cochage — le bandeau et la liste
  du Dashboard — l'émettent, et aucun des deux n'a à connaître la couche
  graphique qui l'écoute.
*/
export function annoncerGain(
  texte: string,
  position: { x: number; y: number },
  negatif = false,
  couleur?: string,
) {
  window.dispatchEvent(new CustomEvent(EVENEMENT_GAIN, { detail: { ...position, texte, negatif, couleur } }));
}

export const EVENEMENT_VALIDATION = 'mindset:validation';

/** Ce que la couche graphique reçoit quand quelque chose vient d'être validé. */
export interface Validation {
  x: number;
  y: number;
  /**
   * Part de la journée faite **après** ce geste, entre 0 et 1.
   *
   * Absente là où elle n'aurait pas de sens : un objectif atteint ou un
   * abonnement pris ne se rapportent à aucune journée. L'anneau n'est alors pas
   * dessiné du tout — un anneau posé sur une part inventée serait pire que rien.
   */
  part?: number;
}

/*
  La marque laissée à l'endroit touché quand une action est validée.

  Remplace l'onde de 600 px qui traversait la page : elle partait deux fois pour
  une seule tâche, floutait tout son passage au moment où l'interface doit
  paraître instantanée, et surtout **ne disait rien**. Celle-ci montre la part de
  la journée désormais faite : un anneau incomplet demande à être fermé, ce
  qu'une décoration ne fera jamais.
*/
export function confirmerValidation(position: { x: number; y: number }, part?: number) {
  window.dispatchEvent(
    new CustomEvent(EVENEMENT_VALIDATION, { detail: { ...position, part } as Validation }),
  );
}

const NOMS_CRENEAUX: Record<string, string> = {
  morning: 'Matin',
  midday: 'Midi',
  evening: 'Soir',
};

export interface ProchaineAction {
  id: number;
  titre: string;
  duree?: string;
  creneau: string;
  indexGroupe: number;
}

export interface EtatDuJour {
  score: number;
  serie: number;
  faites: number;
  total: number;
  prochaine: ProchaineAction | null;
  seriePerdue: number;
}

function lireJSON<T>(cle: string, defaut: T): T {
  try {
    const brut = localStorage.getItem(cle);
    if (!brut) return defaut;
    const valeur = JSON.parse(brut);
    return valeur ?? defaut;
  } catch {
    return defaut;
  }
}

function cleUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function cleLocale(d: Date): string {
  const a = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${a}-${m}-${j}`;
}

/**
 * Les tâches d'un groupe qui concernent aujourd'hui.
 *
 * Une tâche du lundi comptée un mardi plafonnerait la journée sous les 100 %
 * quoi qu'on fasse : on serait puni pour ne pas avoir fait ce qui n'était pas
 * prévu. Une tâche sans jours déclarés reste quotidienne, donc rien ne change
 * pour tout ce qui existait avant.
 *
 * Le Dashboard en gardait une copie identique. Deux définitions de ce qui compte
 * dans une journée finissent par diverger, et celle-ci décide du score, du
 * damier et de la série.
 */
export function tachesDuJour(groupe: any): any[] {
  return Array.isArray(groupe?.items) ? groupe.items.filter((i: any) => estPourAujourdhui(i)) : [];
}

function calculerSerie(): number {
  const scores = lireJSON<Record<string, number>>('mindset_daily_scores', {});
  const aujourdhui = new Date();
  let serie = 0;

  const veille = new Date(aujourdhui);
  veille.setDate(veille.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const cle = cleLocale(veille);
    if (scores[cle] && scores[cle] > 0) {
      serie++;
      veille.setDate(veille.getDate() - 1);
    } else {
      break;
    }
  }

  if (scores[cleLocale(aujourdhui)] > 0) serie++;
  return serie;
}

// Les objectifs avancés aujourd'hui pèsent 10 points chacun, au prorata. Le filtre
// sur la date est le garde-fou de la série : sans lui, un objectif terminé lundi
// tiendrait le score au-dessus de zéro toute la semaine.
function bonusObjectifs(): number {
  const objectifs = lireJSON<any[]>('mindset_micro_obj', []);
  if (!Array.isArray(objectifs)) return 0;
  const aujourdhui = cleUTC();
  const total = objectifs.reduce((acc: number, o: any) => {
    if (o?.awardedDate !== aujourdhui) return acc;
    const cible = Number(o.total) > 0 ? Number(o.total) : 1;
    const part = o.done ? 1 : Math.min(1, Math.max(0, Number(o.progress) || 0) / cible);
    return acc + part * 10;
  }, 0);
  return Math.round(total);
}

export function lireEtatDuJour(): EtatDuJour {
  const groupes = lireGroupes();

  let total = 0;
  let faites = 0;
  let prochaine: ProchaineAction | null = null;

  for (let i = 0; i < groupes.length; i++) {
    for (const tache of tachesDuJour(groupes[i])) {
      total++;
      if (tache.done) {
        faites++;
      } else if (!prochaine) {
        prochaine = {
          id: tache.id,
          titre: tache.title || 'Tâche',
          duree: tache.time,
          creneau: NOMS_CRENEAUX[groupes[i]?.id] || groupes[i]?.title || '',
          indexGroupe: i,
        };
      }
    }
  }

  const base = Math.round((faites / (total || 1)) * 100);
  const score = Math.min(100, base + bonusObjectifs());

  return {
    score,
    serie: calculerSerie(),
    faites,
    total,
    prochaine,
    seriePerdue: parseInt(localStorage.getItem('mindset_lost_streak') || '0', 10),
  };
}

/*
  Cocher une tâche depuis le bandeau.

  Reprend pas à pas ce que fait `toggleRoutine` du Dashboard — vibration, onde de
  choc, son, cinq points, crédit serveur — et y ajoute ce dont le Dashboard se
  chargeait tout seul : l'écriture du score du jour. Sans elle, cocher depuis la
  page Objectifs ne compterait ni pour le score, ni pour le damier, ni pour la
  série, puisque personne n'est là pour recalculer.
*/
export function basculerTache(id: number, position: { x: number; y: number }): void {
  basculerPar((item: any) => item.id === id, position);
}

/**
 * Ce qu'a donné une demande de validation venue du chat.
 *
 * Le coach a besoin de savoir **exactement** ce qui s'est passé pour le dire :
 * une case déjà cochée, une tâche introuvable et une tâche cochée à l'instant
 * appellent trois phrases différentes. Rendre `void`, comme le fait le geste au
 * doigt, l'obligerait à deviner — et il annoncerait « c'est coché » sur une
 * tâche qui n'existe pas.
 */
export type ResultatValidation =
  | { etat: 'cochee'; titre: string }
  | { etat: 'deja-faite'; titre: string }
  | { etat: 'introuvable' };

/**
 * Cocher une tâche que la personne dit avoir faite, depuis la conversation.
 *
 * **Pourquoi c'est légitime.** Le score de cette application est déclaratif : la
 * personne coche elle-même ses cases. Lui faire dire « j'ai fait mes squats » au
 * coach puis lui demander d'aller cliquer ailleurs, c'est lui réclamer deux fois
 * la même affirmation. Rien n'est gagné en intégrité, tout est perdu en usage.
 *
 * **Trois différences avec le geste au doigt, toutes voulues.**
 *
 * 1. **Elle ne décoche jamais.** Le doigt bascule parce qu'on peut se tromper de
 *    case ; une phrase, elle, affirme. « J'ai fait mes squats » ne peut pas
 *    vouloir dire « retire-les », et une IA qui décoche sur un malentendu ferait
 *    perdre des points que personne ne saurait expliquer.
 * 2. **Une case déjà cochée n'est pas une erreur**, c'est un doublon : on le dit
 *    sans rien changer. Le crédit serveur porte déjà la tâche et le jour, donc
 *    rien ne serait recrédité — mais l'XP, elle, le serait.
 * 3. **Aucun effet visuel de position.** L'onde de choc, le « +5 » volant et la
 *    bulle du coach visent l'endroit du clic. Il n'y en a pas ici, et les faire
 *    surgir au hasard de l'écran donnerait l'impression d'un bug.
 *
 * Tout le reste est identique, et c'est le point : XP, monnaie, rythme, crédit
 * serveur, score du jour, signal aux autres écrans. Une tâche cochée depuis le
 * chat compte exactement autant qu'une tâche cochée au doigt.
 */
export function validerTacheParTitre(titre: string): ResultatValidation {
  // La même reconnaissance que les retouches du coach : accents, casse et
  // espaces tolérés, ambiguïté refusée. Voir `correspondance.ts`.
  for (const groupe of lireGroupes()) {
    const items = Array.isArray(groupe?.items) ? groupe.items : [];
    const i = trouverIndex(items, titre, (t: any) => t?.title);
    if (i === -1) continue;

    const vise = items[i];
    if (vise.done) return { etat: 'deja-faite', titre: vise.title };

    basculerPar((item: any) => item?.id === vise.id);
    return { etat: 'cochee', titre: vise.title };
  }

  return { etat: 'introuvable' };
}

/**
 * Le cœur commun : basculer la tâche que `vise` désigne, et en tirer toutes les
 * conséquences.
 *
 * Extrait le 27 août 2026 pour que le chat coche exactement comme le doigt. Deux
 * copies auraient divergé au premier ajustement, et « j'ai fait mes squats »
 * aurait fini par valoir moins qu'un clic — sans que rien ne le dise.
 *
 * `position` absente veut dire « ce geste n'a pas eu lieu à un endroit » : les
 * effets visuels qui visent un point de l'écran sont alors sautés, et eux seuls.
 */
function basculerPar(vise: (item: any) => boolean, position?: { x: number; y: number }): void {
  const groupes = lireGroupes();
  let etaitFaite = false;
  let tacheTouchee: any = null;

  const nouveaux = groupes.map((groupe: any) => ({
    ...groupe,
    items: (Array.isArray(groupe.items) ? groupe.items : []).map((item: any) => {
      if (tacheTouchee || !vise(item)) return item;
      etaitFaite = !!item.done;
      tacheTouchee = item;
      return { ...item, done: !item.done };
    }),
  }));

  if (!tacheTouchee) return;

  // `ecrireGroupes` et non un `setItem` direct : cocher depuis le bandeau doit
  // dater les coches, sinon le serveur les tient pour celles de la veille et la
  // journée bouclée ne compte pour rien.
  ecrireGroupes(nouveaux);

  /*
    Les effets qui visent un point de l'écran ne partent que s'il y en a un.

    L'onde de choc, le « +5 » volant et la bulle du coach naissent sous le doigt.
    Quand la coche vient du chat, ce doigt n'existe pas — les faire surgir au
    hasard de l'écran ne serait pas une récompense, ce serait un bug apparent.
    Tout le reste — points, XP, rythme, crédit serveur, score du jour — part dans
    les deux cas, et c'est ce qui fait qu'une tâche cochée depuis la conversation
    compte exactement autant.
  */
  if (position) {
    if ('vibrate' in navigator) navigator.vibrate([15, 10, 15]);
    window.dispatchEvent(
      new CustomEvent('triggerShockwave', { detail: { x: position.x, y: position.y, color: '#ffffff' } }),
    );
  }

  const points = getSecurePoints();
  if (!etaitFaite) {
    // L'heure, et rien d'autre : c'est elle qui permettra au coach de dire quelque
    // chose que personne d'autre ne saurait dire. Voir `utils/rythme.ts`.
    noterTacheFaite();
    if (position) {
      playBloopSound();
      window.dispatchEvent(
        new CustomEvent('triggerShockwave', { detail: { x: position.x, y: position.y, color: '#ec4899' } }),
      );
    }
    const nouveauSolde = points + 5;
    setSecurePoints(nouveauSolde);
    // Les points sont la monnaie, l'XP le parcours : une tâche faite alimente les
    // deux, mais la Boutique ne dépensera que la première.
    ajouterXp(5);
    window.dispatchEvent(new CustomEvent('pointsChanged', { detail: nouveauSolde }));
    // La clé porte la tâche et le jour : décocher puis recocher ne recrédite pas.
    api.claimCoins(`routine-${tacheTouchee.title || 'tache'}-${cleUTC()}`);
    if (position) {
      annoncerGain('+5', position);
      /*
        La bulle du coach est rendue par le Layout et non ici : le bandeau vit sur
        toutes les pages, or seul le Dashboard savait l'afficher. Passer par un
        événement évite au module de calcul de connaître quoi que ce soit à React.
      */
      window.dispatchEvent(
        new CustomEvent(EVENEMENT_TACHE_FAITE, {
          detail: { titre: tacheTouchee.title || 'Tâche', x: position.x, y: position.y },
        }),
      );
    }
  } else {
    const nouveauSolde = Math.max(0, points - 5);
    setSecurePoints(nouveauSolde);
    // Décocher annule le gain, ce n'est pas une dépense : sans cette reprise,
    // cocher et décocher en boucle serait une machine à niveaux.
    ajouterXp(-5);
    window.dispatchEvent(new CustomEvent('pointsChanged', { detail: nouveauSolde }));
    if (position) annoncerGain('−5', position, true);
  }

  enregistrerScoreDuJour();
  signalerChangementRoutines();
}

export function enregistrerScoreDuJour(): void {
  const { score } = lireEtatDuJour();
  localStorage.setItem('mental_score', score.toString());
  const scores = lireJSON<Record<string, number>>('mindset_daily_scores', {});
  scores[cleUTC()] = score;
  localStorage.setItem('mindset_daily_scores', JSON.stringify(scores));
}
