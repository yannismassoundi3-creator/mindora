import { estPourAujourdhui } from './recurrence';
import { getSecurePoints, setSecurePoints } from './secureStorage';
import { playBloopSound } from './sounds';
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

export const EVENEMENT_JOURNEE = 'mindset:journee';
export const EVENEMENT_TACHE_FAITE = 'mindset:tache-faite';

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

export function lireGroupes(): any[] {
  const groupes = lireJSON<any[]>('mindset_routines', []);
  return Array.isArray(groupes) ? groupes : [];
}

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
  Prévenir les autres écrans.

  `storage` est l'événement que le Dashboard, le chat et les Objectifs écoutent
  déjà : le lancer met à jour la liste des routines si elle est affichée.
  `EVENEMENT_JOURNEE` s'y ajoute pour le bandeau, qui doit aussi se rafraîchir
  quand c'est le Dashboard qui a coché — et lui n'émet pas `storage` en écrivant
  ses routines, sous peine de se réveiller lui-même en boucle.
*/
export function signalerJournee() {
  window.dispatchEvent(new Event(EVENEMENT_JOURNEE));
}

export function signalerChangementRoutines() {
  window.dispatchEvent(new Event('storage'));
  signalerJournee();
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
  const groupes = lireGroupes();
  let etaitFaite = false;
  let tacheTouchee: any = null;

  const nouveaux = groupes.map((groupe: any) => ({
    ...groupe,
    items: (Array.isArray(groupe.items) ? groupe.items : []).map((item: any) => {
      if (item.id !== id) return item;
      etaitFaite = !!item.done;
      tacheTouchee = item;
      return { ...item, done: !item.done };
    }),
  }));

  if (!tacheTouchee) return;

  localStorage.setItem('mindset_routines', JSON.stringify(nouveaux));

  if ('vibrate' in navigator) navigator.vibrate([15, 10, 15]);
  window.dispatchEvent(
    new CustomEvent('triggerShockwave', { detail: { x: position.x, y: position.y, color: '#ffffff' } }),
  );

  const points = getSecurePoints();
  if (!etaitFaite) {
    playBloopSound();
    window.dispatchEvent(
      new CustomEvent('triggerShockwave', { detail: { x: position.x, y: position.y, color: '#ec4899' } }),
    );
    const nouveauSolde = points + 5;
    setSecurePoints(nouveauSolde);
    window.dispatchEvent(new CustomEvent('pointsChanged', { detail: nouveauSolde }));
    // La clé porte la tâche et le jour : décocher puis recocher ne recrédite pas.
    api.claimCoins(`routine-${tacheTouchee.title || 'tache'}-${cleUTC()}`);
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
  } else {
    const nouveauSolde = Math.max(0, points - 5);
    setSecurePoints(nouveauSolde);
    window.dispatchEvent(new CustomEvent('pointsChanged', { detail: nouveauSolde }));
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
