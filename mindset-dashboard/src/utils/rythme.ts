/*
  À quelle heure cette personne fait-elle réellement ce qu'elle a prévu ?

  L'application savait *ce qui* était coché et *quel jour*, jamais *quand*. Elle ne
  pouvait donc dire que des choses vraies de tout le monde : « il te reste trois
  tâches ». Or ce qui donne le sentiment d'être suivi, c'est une observation que
  personne d'autre n'aurait pu faire — « tu boucles ta journée après 21 h, presque
  toujours ».

  Le relevé tient dans une liste de soixante heures. Rien n'en sort de l'appareil :
  ce n'est pas dans l'état synchronisé, ce n'est pas envoyé au serveur, et le coach
  n'en reçoit que la conclusion, quand elle en vaut une.

  **Le silence est le comportement par défaut.** Une habitude s'établit sur des
  semaines ; sur quatre points, le « toujours » est une invention. Deux conditions
  doivent tomber ensemble pour qu'on parle, et le reste du temps `creneauDominant`
  rend `null` — ce que les appelants traitent comme « rien à dire », pas comme
  « pas de données ».
*/

const CLE = 'mindset_rythme_heures';

/**
 * Assez de points pour qu'une régularité veuille dire quelque chose.
 *
 * Huit tâches cochées, c'est deux ou trois jours d'usage réel. En dessous, on
 * décrirait une soirée particulière comme si c'était un tempérament.
 */
const ECHANTILLON_MINIMAL = 8;

/** En deçà, ce n'est pas une habitude mais une répartition. */
const PART_MINIMALE = 0.55;

/** Deux mois d'usage courant. Au-delà, on décrirait quelqu'un qui n'existe plus. */
const TAILLE_MAX = 60;

export type Creneau = 'nuit' | 'matin' | 'apres-midi' | 'soiree';

/** Les bornes sont celles du langage courant, pas celles d'une horloge. */
export function creneauDe(heure: number): Creneau {
  if (heure < 5) return 'nuit';
  if (heure < 12) return 'matin';
  if (heure < 18) return 'apres-midi';
  return 'soiree';
}

export const NOM_CRENEAU: Record<Creneau, string> = {
  nuit: 'en pleine nuit',
  matin: 'le matin',
  'apres-midi': "l'après-midi",
  soiree: 'en soirée',
};

function lire(): number[] {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || '[]');
    return Array.isArray(brut) ? brut.filter((h) => Number.isInteger(h) && h >= 0 && h <= 23) : [];
  } catch {
    return [];
  }
}

/**
 * Une tâche vient d'être cochée. On ne retient que l'heure.
 *
 * Pas la tâche, pas la date, pas la durée : l'heure seule suffit à la question
 * posée, et tout ce qu'on ne garde pas est autant qui ne peut pas fuir.
 */
export function noterTacheFaite(quand: Date = new Date()): void {
  try {
    const heures = lire();
    heures.push(quand.getHours());
    localStorage.setItem(CLE, JSON.stringify(heures.slice(-TAILLE_MAX)));
  } catch {
    // Un relevé perdu ne coûte qu'une observation : jamais une action de la personne.
  }
}

export interface RythmeDominant {
  creneau: Creneau;
  /** Part des tâches cochées dans ce créneau, entre 0 et 1. */
  part: number;
  echantillon: number;
}

/**
 * Le créneau où cette personne travaille vraiment — ou `null` s'il n'y en a pas.
 *
 * `null` n'est pas un échec : c'est la réponse honnête pour quelqu'un qui répartit
 * ses tâches, ou qui vient d'arriver. Dire « tu travailles en soirée » à quelqu'un
 * qui coche 40 % le soir et 35 % le matin est une erreur qu'on ne rattrape pas —
 * elle apprend en une phrase que le coach devine au lieu de savoir.
 */
export function creneauDominant(): RythmeDominant | null {
  const heures = lire();
  if (heures.length < ECHANTILLON_MINIMAL) return null;

  const comptes = new Map<Creneau, number>();
  for (const h of heures) {
    const c = creneauDe(h);
    comptes.set(c, (comptes.get(c) || 0) + 1);
  }

  let meilleur: Creneau = 'matin';
  let compte = 0;
  for (const [c, n] of comptes) {
    if (n > compte) {
      meilleur = c;
      compte = n;
    }
  }

  const part = compte / heures.length;
  if (part < PART_MINIMALE) return null;

  return { creneau: meilleur, part, echantillon: heures.length };
}
