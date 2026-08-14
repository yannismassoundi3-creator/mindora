import { api } from '../services/api';

/*
  Ce que la personne a déclaré vouloir devenir.

  Le questionnaire d'inscription demande « quel est ton objectif numéro 1 ici ? »,
  range la réponse en base, et ne la montre plus jamais. Elle ne servait qu'au
  prompt du coach. C'est pourtant la seule phrase qui explique pourquoi on coche
  des cases tous les jours : sans elle, l'application est un tableau de bord posé
  sur rien, et l'abonnement se vend comme un compteur qu'on a épuisé plutôt que
  comme la personne qu'on essaie de devenir.

  Le cache local n'est pas une optimisation. L'objectif s'affiche en haut du
  tableau de bord, au premier rendu, avant toute réponse du serveur : le lire
  depuis le réseau ferait apparaître la phrase une seconde après le reste, ce qui
  la ferait passer pour une notification plutôt que pour une entête.
*/

export const CLE_OBJECTIF = 'mindset_objectif_declare';
export const EVENEMENT_OBJECTIF = 'mindset:objectif';

/** Même plafond que le serveur (`ObjectifDto`) : une phrase, pas un texte. */
export const MAX_OBJECTIF = 120;

/** Ce que le navigateur en sait, tout de suite. */
export function lireObjectif(): string | null {
  const valeur = localStorage.getItem(CLE_OBJECTIF);
  return valeur && valeur.trim() ? valeur : null;
}

function retenir(objectif: string | null) {
  if (objectif) localStorage.setItem(CLE_OBJECTIF, objectif);
  else localStorage.removeItem(CLE_OBJECTIF);
  window.dispatchEvent(new CustomEvent(EVENEMENT_OBJECTIF, { detail: objectif }));
}

/**
 * Va chercher l'objectif au démarrage.
 *
 * Silencieux en cas d'échec : le navigateur garde ce qu'il avait, et une panne
 * réseau ne doit pas effacer de l'écran la phrase qui donne son sens au reste.
 * C'est la même règle que pour l'abonnement — ne jamais confondre « le serveur a
 * répondu non » et « on n'a pas pu demander ».
 */
export async function rafraichirObjectif(): Promise<string | null> {
  try {
    const reponse = await api.get('/ai-coaching/profil');
    const objectif = typeof reponse?.objectif === 'string' ? reponse.objectif.trim() : '';
    // Un compte sans profil rend `null`. On efface alors le cache local, sinon
    // l'objectif d'un compte précédent survivrait sur un appareil partagé.
    retenir(objectif || null);
    return objectif || null;
  } catch {
    return lireObjectif();
  }
}

/**
 * Change l'objectif.
 *
 * Écrit d'abord chez le serveur : c'est lui qui fait autorité, et c'est lui que
 * relira le coach. N'écrit en local que si l'enregistrement a abouti — afficher
 * un nouveau cap que le serveur n'a pas retenu ferait mentir l'écran et le coach
 * en même temps.
 */
export async function definirObjectif(objectif: string): Promise<string> {
  const propre = objectif.trim().slice(0, MAX_OBJECTIF);
  if (!propre) throw new Error('Un objectif ne peut pas être vide.');

  const reponse = await api.patch('/ai-coaching/profil', { objectif: propre });
  const retenu = typeof reponse?.objectif === 'string' ? reponse.objectif : propre;
  retenir(retenu);
  return retenu;
}
