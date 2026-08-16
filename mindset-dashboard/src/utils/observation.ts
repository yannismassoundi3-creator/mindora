import { api } from '../services/api';
import { CLE_OBSERVATION, CLE_OBSERVATION_BANNIERE } from './clesCache';

/*
  Ce que le coach a remarqué sur cette personne.

  Le motif est calculé côté serveur, à partir de l'historique jour par jour
  (`ObservationService`), et jamais deviné par le modèle : un modèle à qui l'on
  demande « que remarques-tu ? » trouve toujours quelque chose, y compris dans du
  bruit, et le dit avec le même aplomb que s'il avait raison.

  Ici on ne fait que deux choses, et elles comptent autant que le calcul :

  1. **Ne pas redemander à chaque écran.** L'observation change au rythme des
     journées, pas des clics. Elle est gardée une demi-journée dans le navigateur.
  2. **Ne pas la resservir tous les jours.** Une remarque personnelle répétée
     chaque matin cesse d'être une remarque et devient un bandeau. Elle ne
     reparaît qu'après plusieurs jours, ou si elle a changé.
*/

export interface Observation {
  code: string;
  titre: string;
  /** Le fait, avec ses chiffres. C'est lui qu'on montre. */
  fait: string;
  /** Ce que la personne dira au coach si elle appuie. Première personne. */
  invite: string;
}

// Les noms vivent dans `clesCache.ts` : l'instrumentation de `setItem` doit les
// connaître sans dépendre de ce module, qui lui-même dépend d'`api.ts`.
const CLE_CACHE = CLE_OBSERVATION;
const CLE_DERNIERE_BANNIERE = CLE_OBSERVATION_BANNIERE;

/** Au-delà, on redemande au serveur. Une demi-journée suffit : l'historique bouge par jour. */
const FRAICHEUR_MS = 12 * 3600 * 1000;

/**
 * Délai minimum entre deux bannières d'observation.
 *
 * Trois jours. C'est ce qui fait la valeur de la chose : une remarque qu'on ne
 * reçoit pas tous les jours se lit, une remarque quotidienne se balaie. Le mot
 * d'accueil ordinaire continue de passer entre-temps — il parle de la journée,
 * pas de la personne, et ne s'use pas de la même façon.
 */
const INTERVALLE_BANNIERE_MS = 3 * 24 * 3600 * 1000;

interface EnCache {
  observation: Observation | null;
  le: number;
}

function lireCache(): EnCache | null {
  try {
    const brut = localStorage.getItem(CLE_CACHE);
    if (!brut) return null;
    const lu = JSON.parse(brut);
    if (typeof lu?.le !== 'number') return null;
    return lu;
  } catch {
    return null;
  }
}

/**
 * L'observation du moment, depuis le cache ou le serveur.
 *
 * Rend `null` sans bruit en cas d'échec réseau : c'est un bonus d'affichage, pas
 * une donnée dont dépend l'application. Montrer une erreur ici reviendrait à
 * signaler une panne à quelqu'un qui n'a rien demandé.
 */
export async function chargerObservation(): Promise<Observation | null> {
  const cache = lireCache();
  if (cache && Date.now() - cache.le < FRAICHEUR_MS) return cache.observation;

  try {
    const reponse = await api.get('/ai-coaching/observation');
    const observation: Observation | null = reponse?.observation ?? null;
    localStorage.setItem(CLE_CACHE, JSON.stringify({ observation, le: Date.now() }));
    return observation;
  } catch {
    // Le cache périmé vaut mieux que rien : un fait d'hier reste vrai.
    return cache?.observation ?? null;
  }
}

/**
 * L'observation, si c'est le moment d'en faire une bannière.
 *
 * Rend `null` quand il n'y a rien à dire, quand on l'a déjà dite récemment, ou
 * quand c'est la même qu'à la dernière fois. Ce troisième cas est le plus
 * important : répéter mot pour mot « tu lâches le samedi » tous les trois jours
 * apprend surtout que personne ne suit rien.
 */
export async function observationPourBanniere(): Promise<Observation | null> {
  const observation = await chargerObservation();
  if (!observation) return null;

  try {
    const brut = localStorage.getItem(CLE_DERNIERE_BANNIERE);
    if (brut) {
      const { le, code } = JSON.parse(brut);
      const tropTot = typeof le === 'number' && Date.now() - le < INTERVALLE_BANNIERE_MS;
      if (tropTot && code === observation.code) return null;
      if (tropTot) return null;
    }
  } catch {
    // Un repère illisible se comporte comme un repère absent : on peut parler.
  }

  // Le repère est posé ici, au moment de rendre l'observation, et non chez
  // l'appelant : un appelant qui oublie de le poser transforme la règle en
  // décoration. Même principe que `motDuCoachDuMoment`.
  localStorage.setItem(
    CLE_DERNIERE_BANNIERE,
    JSON.stringify({ le: Date.now(), code: observation.code }),
  );
  return observation;
}
