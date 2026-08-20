/**
 * Les routines, et le jour auquel leurs coches se rapportent.
 *
 * Les cases se décochent chaque nuit. Ce décochage n'existe que dans le
 * navigateur — le serveur ne remet jamais rien à zéro — et il ne tenait qu'à une
 * seule ligne, dans l'initialisation de l'état du Dashboard, c'est-à-dire au
 * **montage du composant**. Deux trous en découlaient, opposés et aussi silencieux
 * l'un que l'autre :
 *
 * - L'application ouverte au passage de minuit ne se décochait jamais. Or
 *   `mindset_last_routine_date` était réécrit à chaque changement des routines,
 *   sans condition : la première interaction du lendemain — une tâche ajoutée, un
 *   état redescendu du serveur — **datait d'aujourd'hui les coches de la veille**,
 *   et cette journée déjà pleine partait au serveur. Sur un téléphone, où
 *   l'application installée est mise en veille et non fermée, c'est le cas normal.
 * - Cocher depuis le bandeau, qui vit sur toutes les pages, écrivait les routines
 *   sans toucher à la date. Quelqu'un qui cochait ses tâches depuis la page
 *   Objectifs laissait donc la date d'hier sur les coches du jour, et le serveur
 *   les tenait pour périmées : plus de félicitation le soir, alors que tout était
 *   fait.
 *
 * D'où ce module. **La date n'est plus posée par qui écrit, mais par ce qui est
 * écrit** : `ecrireGroupes` date les coches du même geste qu'il les enregistre, et
 * `appliquerNouveauJour` est le seul endroit qui décoche. Tout chemin qui amène
 * des routines à l'écran passe par l'un ou l'autre.
 *
 * Module feuille, sans dépendance : `services/api.ts` l'appelle, et il ne peut donc
 * rien importer qui remonte jusqu'à lui.
 */

export const EVENEMENT_JOURNEE = 'mindset:journee';

/**
 * La clé du jour : `AAAA-MM-JJ` en UTC.
 *
 * Même convention que les scores et que `getTodayKey` — c'est aussi celle que le
 * serveur relit pour décider si les coches valent encore. Passer à l'heure locale
 * ici décalerait la frontière de deux heures d'un seul côté, et les deux ne
 * parleraient plus du même jour.
 */
export function cleJourRoutines(maintenant = new Date()): string {
  return maintenant.toISOString().slice(0, 10);
}

/** Les trois créneaux, tels qu'ils sont rangés dans le navigateur. */
export function lireGroupes(): any[] {
  try {
    const brut = localStorage.getItem('mindset_routines');
    const valeur = brut ? JSON.parse(brut) : [];
    return Array.isArray(valeur) ? valeur : [];
  } catch {
    return [];
  }
}

/**
 * Enregistre les routines **et** date leurs coches.
 *
 * Les deux écritures ne se séparent pas : une liste de coches sans le jour qu'elles
 * décrivent est une donnée qu'on ne peut plus interpréter, ni ici ni sur le serveur.
 */
export function ecrireGroupes(groupes: any[]): void {
  localStorage.setItem('mindset_routines', JSON.stringify(groupes));
  localStorage.setItem('mindset_last_routine_date', cleJourRoutines());
}

/**
 * Décoche tout si les coches enregistrées datent d'un autre jour.
 *
 * Rend `true` quand l'écran doit changer — à l'appelant de prévenir les autres vues
 * avec `signalerChangementRoutines()`. Une journée sans la moindre case cochée n'a
 * rien à réécrire : on se contente d'y poser la date, ce qui évite de déclencher une
 * remontée pour un changement qui n'en est pas un.
 */
export function appliquerNouveauJour(): boolean {
  const jour = cleJourRoutines();
  if (localStorage.getItem('mindset_last_routine_date') === jour) return false;

  const groupes = lireGroupes();
  const aDesCoches = groupes.some(
    (g: any) => Array.isArray(g?.items) && g.items.some((i: any) => i?.done),
  );

  if (!aDesCoches) {
    localStorage.setItem('mindset_last_routine_date', jour);
    return false;
  }

  ecrireGroupes(
    groupes.map((g: any) => ({
      ...g,
      items: Array.isArray(g?.items) ? g.items.map((i: any) => ({ ...i, done: false })) : [],
    })),
  );
  return true;
}

/*
  Prévenir les autres écrans.

  `storage` est l'événement que le Dashboard, le chat et les Objectifs écoutent
  déjà : le lancer met à jour la liste des routines si elle est affichée.
  `EVENEMENT_JOURNEE` s'y ajoute pour le bandeau, qui doit aussi se rafraîchir
  quand c'est le Dashboard qui a coché — et lui n'émet pas `storage` en écrivant
  ses routines, sous peine de se réveiller lui-même en boucle.
*/
export function signalerJournee(): void {
  window.dispatchEvent(new Event(EVENEMENT_JOURNEE));
}

export function signalerChangementRoutines(): void {
  window.dispatchEvent(new Event('storage'));
  signalerJournee();
}
