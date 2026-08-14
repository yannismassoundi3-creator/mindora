/**
 * Le bilan de la semaine, tel qu'on peut le montrer à quelqu'un.
 *
 * L'application produit déjà cette matière — un score par jour dans
 * `mindset_daily_scores` — mais elle ne sort jamais de l'écran. Pour un produit
 * dont le sujet est la régularité, c'est le seul objet naturellement montrable :
 * la preuve d'assiduité est exactement ce dont les gens sont fiers.
 *
 * Les clés de jour sont en UTC, comme partout ailleurs dans l'application
 * (`cleUTC` de `journee.ts`, `getTodayKey` du Dashboard et des Objectifs). Ne pas
 * mélanger avec l'heure locale ici : un décalage d'un jour ferait afficher une
 * semaine décalée, et le défaut serait invisible la moitié de l'année.
 */
import { lireProgression } from './progression';

export interface JourSemaine {
  cle: string;
  /** Initiale du jour, pour l'axe. */
  initiale: string;
  score: number;
  /** Un jour qui n'est pas encore arrivé n'est pas un échec. */
  aVenir: boolean;
}

export interface BilanSemaine {
  jours: JourSemaine[];
  /** Jours où quelque chose a été fait, parmi ceux déjà passés. */
  joursActifs: number;
  /** Jours déjà écoulés de la semaine, aujourd'hui compris. */
  joursEcoules: number;
  /** Moyenne des scores sur les jours écoulés, arrondie. */
  moyenne: number;
  meilleurJour: number;
  serie: number;
  niveau: number;
  rang: string;
  couleurRang: string;
  /** Le lundi de la semaine décrite, pour l'afficher en toutes lettres. */
  debut: Date;
}

const INITIALES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function cleUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Le lundi de la semaine contenant `date`, en UTC. */
function lundiDeLaSemaine(date: Date): Date {
  const d = new Date(date);
  const jour = (d.getUTCDay() + 6) % 7; // 0 = lundi
  d.setUTCDate(d.getUTCDate() - jour);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function lireScores(): Record<string, number> {
  try {
    const brut = localStorage.getItem('mindset_daily_scores');
    const valeur = brut ? JSON.parse(brut) : {};
    return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : {};
  } catch {
    return {};
  }
}

/**
 * La série en cours, recomptée ici plutôt qu'importée.
 *
 * `journee.ts` garde la sienne privée et la calcule à partir d'aujourd'hui ; la
 * même règle est reprise à l'identique — un jour compte s'il porte un score
 * supérieur à zéro, et la chaîne s'arrête au premier trou. Un jour d'aujourd'hui
 * encore vide n'interrompt pas la série : la journée n'est pas finie.
 */
function calculerSerie(scores: Record<string, number>): number {
  let serie = 0;
  const curseur = new Date();
  curseur.setUTCHours(0, 0, 0, 0);

  if (!(scores[cleUTC(curseur)] > 0)) curseur.setUTCDate(curseur.getUTCDate() - 1);

  for (let i = 0; i < 400; i++) {
    if (scores[cleUTC(curseur)] > 0) {
      serie++;
      curseur.setUTCDate(curseur.getUTCDate() - 1);
    } else break;
  }
  return serie;
}

export function lireBilanSemaine(reference = new Date()): BilanSemaine {
  const scores = lireScores();
  const debut = lundiDeLaSemaine(reference);
  const aujourdhui = cleUTC(reference);

  const jours: JourSemaine[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(debut);
    d.setUTCDate(d.getUTCDate() + i);
    const cle = cleUTC(d);
    jours.push({
      cle,
      initiale: INITIALES[i],
      score: Math.max(0, Math.min(100, Number(scores[cle]) || 0)),
      aVenir: cle > aujourdhui,
    });
  }

  const ecoules = jours.filter((j) => !j.aVenir);
  const somme = ecoules.reduce((n, j) => n + j.score, 0);
  const progression = lireProgression();

  return {
    jours,
    joursActifs: ecoules.filter((j) => j.score > 0).length,
    joursEcoules: ecoules.length,
    // Sur les jours écoulés seulement : diviser par sept un mercredi donnerait un
    // chiffre faux et décourageant, pour une semaine qui se passe bien.
    moyenne: ecoules.length === 0 ? 0 : Math.round(somme / ecoules.length),
    meilleurJour: ecoules.reduce((m, j) => Math.max(m, j.score), 0),
    serie: calculerSerie(scores),
    niveau: progression.niveau,
    rang: progression.rang.name,
    couleurRang: progression.rang.color,
    debut,
  };
}
