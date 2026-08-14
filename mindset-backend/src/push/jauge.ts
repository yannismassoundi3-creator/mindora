/**
 * La progression du jour, écrite pour tenir dans un titre de notification.
 *
 * Une notification web ne peut pas être animée : la spécification ne prévoit ni
 * animation ni barre de progression, et un GIF passé en `image` s'affiche figé sur
 * sa première image. Ce qui reste — et qui produit le même effet que la barre de
 * Duolingo — c'est une jauge en caractères pleins, lisible sur l'écran verrouillé
 * des deux systèmes, sans dépendance, sans image à générer ni à héberger.
 *
 * Elle est volontairement courte : Android tronque le titre autour de quarante
 * caractères, iOS autour de trente-cinq. Une jauge qui déborde n'est plus une jauge,
 * c'est un titre coupé au milieu.
 */

/** Nombre de segments. Cinq tient partout ; huit était déjà tronqué sur iPhone. */
const SEGMENTS = 5;

const PLEIN = '▓';
const VIDE = '░';

/**
 * Rend la jauge seule, sans pourcentage : « ▓▓▓░░ ».
 *
 * Le score est ramené entre 0 et 100 avant d'être découpé : `daily_scores` vient de
 * l'application, donc d'un client qu'on ne contrôle pas, et une valeur de 320 ferait
 * afficher une jauge plus longue que le titre.
 */
export function jauge(score: number): string {
  const borne = Math.max(0, Math.min(100, Math.round(score || 0)));
  // On arrondit vers le bas : afficher un segment plein pour 1 % laisserait croire
  // que quelque chose est acquis alors que la journée n'a pas commencé.
  const pleins = Math.floor((borne / 100) * SEGMENTS);
  return PLEIN.repeat(pleins) + VIDE.repeat(SEGMENTS - pleins);
}

/**
 * Le titre complet : jauge, pourcentage, et la série quand elle existe.
 *
 * La série n'apparaît qu'à partir de deux jours. À un jour, « 1 j 🔥 » ne récompense
 * rien — tout le monde l'a dès sa première action — et occupe la place au moment où
 * le titre est déjà le plus long.
 */
export function titreProgression(score: number, serie = 0): string {
  const borne = Math.max(0, Math.min(100, Math.round(score || 0)));
  const flamme = serie >= 2 ? ` · ${serie} j 🔥` : '';
  return `${jauge(borne)} ${borne} %${flamme}`;
}
