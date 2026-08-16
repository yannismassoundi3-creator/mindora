/**
 * « Aujourd'hui », tel que le lit quelqu'un à Paris.
 *
 * Le serveur tourne en UTC. Toute journée calculée avec `setHours(0,0,0,0)` ou
 * `toISOString().slice(0,10)` commence donc à 2 h du matin heure française l'été,
 * 1 h l'hiver : une inscription de 00 h 30 est rangée dans la veille, un score du
 * soir bascule au mauvais jour. Rien ne plante, rien ne se voit — c'est le pire
 * cas pour un chiffre qu'on regarde le matin pour décider quoi faire.
 *
 * Une seule définition, partagée : deux endroits qui calculent « le début de la
 * journée » chacun de leur côté finissent toujours par diverger, et l'écran
 * affiche alors deux nombres qui prétendent répondre à la même question.
 */

export const FUSEAU_AFFICHAGE = 'Europe/Paris';

/** Les champs de date-heure d'un instant, lus dans le fuseau d'affichage. */
function parties(date: Date) {
  const morceaux = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSEAU_AFFICHAGE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const champ = (type: string) => morceaux.find((p) => p.type === type)?.value ?? '00';
  return {
    annee: champ('year'),
    mois: champ('month'),
    jour: champ('day'),
    heure: champ('hour'),
    minute: champ('minute'),
    seconde: champ('second'),
  };
}

/** `YYYY-MM-DD` du jour local — la clé qui regroupe une journée. */
export function cleJourParis(date: Date = new Date()): string {
  const p = parties(date);
  return `${p.annee}-${p.mois}-${p.jour}`;
}

/** `HH:MM` local. */
export function heureParis(date: Date = new Date()): string {
  const p = parties(date);
  return `${p.heure}:${p.minute}`;
}

/** Décalage du fuseau à cet instant précis, en minutes (60 l'hiver, 120 l'été). */
function decalageMinutes(date: Date): number {
  const p = parties(date);
  const commeUTC = Date.UTC(
    Number(p.annee),
    Number(p.mois) - 1,
    Number(p.jour),
    Number(p.heure),
    Number(p.minute),
    Number(p.seconde),
  );
  return (commeUTC - date.getTime()) / 60000;
}

/** L'instant UTC où commence la journée locale `cle` (`YYYY-MM-DD`). */
export function minuitParis(cle: string): Date {
  const [annee, mois, jour] = cle.split('-').map(Number);
  // Le décalage est mesuré à midi : un 2 h 30 du matin peut ne pas exister le jour
  // du passage à l'heure d'été, midi existe toujours.
  const decalage = decalageMinutes(new Date(Date.UTC(annee, mois - 1, jour, 12)));
  return new Date(Date.UTC(annee, mois - 1, jour, 0, 0, 0) - decalage * 60000);
}

/** L'instant UTC où a commencé la journée en cours. */
export function debutDuJourParis(maintenant: Date = new Date()): Date {
  return minuitParis(cleJourParis(maintenant));
}

/**
 * Les clés des `combien` derniers jours, du plus ancien au plus récent.
 *
 * Construites par arithmétique de calendrier plutôt qu'en retirant 24 h à
 * répétition : les deux nuits de changement d'heure durent 23 et 25 heures, et une
 * soustraction d'horloge y saute ou y répète un jour.
 */
export function derniersJoursParis(cleAujourdhui: string, combien: number): string[] {
  const [annee, mois, jour] = cleAujourdhui.split('-').map(Number);
  const cles: string[] = [];
  for (let recul = combien - 1; recul >= 0; recul--) {
    cles.push(new Date(Date.UTC(annee, mois - 1, jour - recul)).toISOString().slice(0, 10));
  }
  return cles;
}
