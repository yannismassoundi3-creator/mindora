/*
  Les bannières que l'application se montre à elle-même.

  Rien à voir avec les notifications système (`push/`), qui arrivent quand l'app est
  fermée. Celles-ci vivent dans la page : le coach vient d'appliquer un plan, ou il a
  un mot à dire à l'arrivée.

  Le mécanisme était éparpillé — écriture dans `AIChat`, lecture et effacement dans
  `AiNotification`, aucune règle commune — et il en sortait trois défauts, tous
  invisibles à la lecture d'un seul des deux fichiers :

  - **Les vieilles notifications ressuscitaient.** Elles ne disparaissaient qu'en
    étant vues six secondes. Fermer l'onglet pendant ce délai les gardait en réserve,
    et « ✨ ton coach vient de mettre à jour tes routines » se rejouait deux jours
    plus tard, à l'ouverture suivante — annonçant comme une nouvelle quelque chose
    que la personne avait déjà vu, ou pire, oublié.
  - **Chaque ajout et chaque effacement réveillaient toute l'application.** L'écriture
    passe par `localStorage.setItem`, donc par l'instrumentation de synchro, et
    l'événement émis était `storage` — celui que le tableau de bord, les objectifs,
    les habitudes et le chat écoutent tous pour se recharger entièrement. Une croix
    de fermeture déclenchait une remontée réseau et quatre relectures d'état.
  - **La file pouvait atteindre cinquante entrées.** À six secondes chacune, cinq
    minutes de bannières.

  Tout est ici désormais, avec ses règles, et un événement à soi.
*/

const CLE = 'mindset_ai_notifications';

/** L'événement qui n'appartient qu'aux bannières. */
export const EVENEMENT_NOTIFICATION = 'mindset:notification';

/**
 * Au-delà, une bannière n'annonce plus rien.
 *
 * Deux heures : assez pour survivre à un rechargement de page ou à un aller-retour
 * dans une autre application, trop peu pour accueillir quelqu'un le lendemain avec
 * les nouvelles de la veille.
 */
const PEREMPTION_MS = 2 * 3600 * 1000;

/** Quatre bannières à la suite, c'est déjà beaucoup. Au-delà, on écarte les plus vieilles. */
const FILE_MAX = 4;

export interface NotificationApp {
  id: string;
  /** Décide de la destination au clic : 'coach', 'habit', 'routine', 'objective', 'nutrition'. */
  type: string;
  message: string;
  /** Première ligne, en gras. Facultatif : les anciennes entrées n'en ont pas. */
  titre?: string;
  /**
   * Le message envoyé au coach si l'on appuie sur la bannière.
   *
   * Sans lui, appuyer ouvre une conversation vide : la personne vient de lire une
   * remarque précise sur elle et se retrouve devant un champ de saisie, à devoir
   * reformuler ce qu'elle vient de lire. Avec lui, elle appuie et le coach est
   * déjà en train de répondre — c'est la différence entre une bannière qui informe
   * et une bannière qui engage la conversation.
   *
   * Écrit à la première personne : il part au nom de la personne.
   */
  invite?: string;
  timestamp: string;
}

function brut(): NotificationApp[] {
  try {
    const lu = JSON.parse(localStorage.getItem(CLE) || '[]');
    return Array.isArray(lu) ? lu.filter((n) => n && typeof n.id === 'string' && typeof n.message === 'string') : [];
  } catch {
    return [];
  }
}

function ecrire(liste: NotificationApp[]): void {
  try {
    localStorage.setItem(CLE, JSON.stringify(liste.slice(-FILE_MAX)));
  } catch {
    // Un stockage plein ne doit pas empêcher le plan qui vient d'être appliqué.
  }
  try {
    window.dispatchEvent(new Event(EVENEMENT_NOTIFICATION));
  } catch {}
}

/**
 * Les bannières à afficher, la plus récente en tête, les périmées écartées.
 *
 * L'écart est calculé à la lecture et non à l'écriture : une notification posée
 * pendant que l'onglet était ouvert ne se périme pas toute seule, personne n'étant
 * là pour la relire.
 */
export function lireNotifications(): NotificationApp[] {
  const limite = Date.now() - PEREMPTION_MS;
  return brut()
    .filter((n) => {
      const t = Date.parse(n.timestamp);
      // Un horodatage illisible ne condamne pas la notification : on la garde, et
      // c'est la file bornée qui finira par la sortir.
      return Number.isNaN(t) || t >= limite;
    })
    .reverse();
}

/** Ajoute une bannière. Sans effet si le message est vide. */
export function ajouterNotification(
  type: string,
  message: string,
  titre?: string,
  invite?: string,
): void {
  if (!message.trim()) return;
  const liste = brut();
  liste.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    type,
    message,
    titre,
    invite,
    timestamp: new Date().toISOString(),
  });
  ecrire(liste);
}

export function retirerNotification(id: string): void {
  ecrire(brut().filter((n) => n.id !== id));
}

/**
 * Y a-t-il déjà une bannière de ce type en attente ?
 *
 * Le mot du coach s'en sert : arriver dans l'application juste après avoir fait
 * appliquer un plan doit montrer le plan appliqué, pas un accueil par-dessus.
 */
export function notificationEnAttente(type?: string): boolean {
  const liste = lireNotifications();
  return type ? liste.some((n) => n.type === type) : liste.length > 0;
}
