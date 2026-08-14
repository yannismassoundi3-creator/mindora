/**
 * L'expérience, le niveau et le rang.
 *
 * Jusqu'ici, `mindset_points` servait à deux choses incompatibles : c'était la
 * monnaie de la Boutique *et* le compteur qui décidait du niveau. Acheter un
 * cosmétique faisait donc rétrograder — mesuré : 4050 points (niveau 10, rang
 * Initié) moins « Démon du Feu » à 3000 rendait 1050 points, soit le niveau 5 et
 * le rang Novice. La perte était en plus silencieuse, `RankUpOverlay` ne réagissant
 * qu'aux montées. Perdre sa série (−50 points) pouvait de la même façon coûter un
 * rang.
 *
 * Les deux compteurs sont désormais séparés :
 * - `mindset_points` reste la monnaie : on la gagne, on la dépense, elle descend.
 * - `mindset_xp` est le parcours : elle ne descend **que** si un gain est annulé.
 *
 * La nuance entre annuler et dépenser est ce qui tient l'ensemble : décocher une
 * tâche cochée par erreur retire les 5 XP correspondants (sans quoi cocher et
 * décocher en boucle serait une machine à niveaux), tandis qu'un achat ou une
 * pénalité ne touchent pas au parcours.
 */
import { getRankForLevel, RANKS, type Rank } from './ranks';
import { getSecurePoints } from './secureStorage';

/**
 * Coût du premier niveau, et donc pente de toute la courbe : il faut
 * `XP_PALIER × (niveau − 1)²` points d'expérience pour atteindre un niveau.
 *
 * Valait 50, ce qui rendait la moitié des rangs décoratifs. À rythme soutenu
 * (12 tâches, 3 habitudes et 2 objectifs par jour, soit ~115 XP), « Maître »
 * demandait 2,9 ans et « Légende » 11,7 ans — personne ne les aurait vus. À 10,
 * la même assiduité donne Initié en une semaine, Discipliné en un mois, Élite en
 * 2,4 mois, Maître en 7 mois et Légende en 2,3 ans : le dernier rang reste un
 * exploit, mais un exploit atteignable.
 *
 * Conséquence de la migration, volontaire : les comptes existants reprennent leur
 * solde de points comme XP de départ, qui vaut maintenant cinq fois plus en
 * niveaux. Personne ne rétrograde, certains montent d'un rang.
 */
export const XP_PALIER = 10;

/** L'XP totale nécessaire pour atteindre ce niveau. */
export function xpDuNiveau(niveau: number): number {
  return XP_PALIER * Math.pow(niveau - 1, 2);
}

/** Le niveau atteint avec cette XP. Exactement l'inverse de `xpDuNiveau`. */
export function niveauPourXp(xp: number): number {
  if (!Number.isFinite(xp) || xp < 0) return 1;
  return Math.floor(Math.sqrt(xp / XP_PALIER)) + 1;
}

const CLE_XP = 'mindset_xp';
const CLE_SIGNATURE = 'mindset_xp_signature';
const SEL = 'm1nd53t_xp_2026';

// Même empreinte que `secureStorage`, pour la même raison : décourager la
// modification à la main dans la console. Ce n'est pas de la cryptographie, et
// l'économie de jeu reste falsifiable — elle n'ouvre aucun accès payant.
function empreinte(valeur: number): string {
  let hash = 0;
  const texte = `${valeur}_${SEL}`;
  for (let i = 0; i < texte.length; i++) {
    hash = (hash << 5) - hash + texte.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(16);
}

/** Prévient les écrans qui affichent le niveau. */
export const EVENEMENT_XP = 'mindset:xp';

/**
 * Ce que porte l'événement.
 *
 * `gain` distingue une action de la personne d'une valeur simplement posée, et
 * cette nuance n'est pas cosmétique : sur un appareil neuf, le stockage local est
 * vide, l'application démarre donc au niveau 1 puis reçoit du serveur l'expérience
 * réelle du compte. Sans ce drapeau, les animations liraient ce rattrapage comme
 * une montée et annonceraient « PROMOTION ! » à chaque première connexion.
 */
export interface DetailXp {
  xp: number;
  gain: boolean;
}

function ecrire(xp: number, gain: boolean): number {
  const valeur = Math.max(0, Math.floor(xp));
  localStorage.setItem(CLE_XP, valeur.toString());
  localStorage.setItem(CLE_SIGNATURE, empreinte(valeur));
  window.dispatchEvent(new CustomEvent<DetailXp>(EVENEMENT_XP, { detail: { xp: valeur, gain } }));
  return valeur;
}

/**
 * L'XP du compte, en la créant au besoin.
 *
 * Un compte antérieur à cette séparation n'a pas de ligne d'XP : son solde de
 * points en tient lieu, une seule fois. C'est le seul moment où les deux
 * compteurs se touchent — ensuite ils vivent leur vie, et dépenser ses points ne
 * reprend plus rien au parcours.
 */
export function lireXp(): number {
  const brut = localStorage.getItem(CLE_XP);

  if (brut === null) return ecrire(getSecurePoints(), false);

  const valeur = parseInt(brut, 10);
  if (isNaN(valeur)) return ecrire(getSecurePoints(), false);

  const signature = localStorage.getItem(CLE_SIGNATURE);
  if (signature && signature !== empreinte(valeur)) {
    console.warn('⚠️ Signature d’XP invalide : retour au solde de points.');
    return ecrire(getSecurePoints(), false);
  }
  // Signée nulle part : c'est une valeur descendue du serveur, on la signe.
  if (!signature) return ecrire(valeur, false);

  return valeur;
}

/**
 * Crédite (ou reprend, si `montant` est négatif) de l'expérience.
 *
 * N'est appelée que pour un gain ou l'annulation d'un gain. Une dépense en
 * Boutique et la pénalité de série perdue ne passent volontairement pas par ici.
 */
export function ajouterXp(montant: number): number {
  return ecrire(lireXp() + montant, true);
}

/** Pose une XP venue du serveur, sans la confondre avec un gain. */
export function definirXp(xp: number): number {
  return ecrire(xp, false);
}

export interface EtatProgression {
  xp: number;
  niveau: number;
  rang: Rank;
  /** Le rang suivant, ou `null` pour qui a atteint le dernier. */
  rangSuivant: Rank | null;
  /** XP restante avant le prochain niveau. */
  xpAvantNiveau: number;
  /** XP restante avant le prochain rang. */
  xpAvantRang: number;
  /** Avancement dans le niveau en cours, de 0 à 1. */
  partNiveau: number;
  /** Avancement vers le rang suivant, de 0 à 1. */
  partRang: number;
}

/**
 * Tout ce qu'un écran a besoin de savoir, calculé au même endroit.
 *
 * La formule du niveau était recopiée dans quatre fichiers (Dashboard, Profile et
 * les deux animations), et son inverse dans un cinquième avec cinquante points
 * d'écart. Deux copies d'une même règle finissent toujours par diverger.
 */
export function lireProgression(xpConnue?: number): EtatProgression {
  const xp = xpConnue ?? lireXp();
  const niveau = niveauPourXp(xp);
  const rang = getRankForLevel(niveau);

  const socleNiveau = xpDuNiveau(niveau);
  const cibleNiveau = xpDuNiveau(niveau + 1);

  const rangSuivant = RANKS.find((r) => r.minLevel > niveau) ?? null;
  const socleRang = xpDuNiveau(rang.minLevel);
  const cibleRang = rangSuivant ? xpDuNiveau(rangSuivant.minLevel) : socleNiveau;

  // `max(1, …)` protège la division du dernier rang, où socle et cible se rejoignent.
  const partRang = rangSuivant ? (xp - socleRang) / Math.max(1, cibleRang - socleRang) : 1;

  return {
    xp,
    niveau,
    rang,
    rangSuivant,
    xpAvantNiveau: Math.max(0, cibleNiveau - xp),
    xpAvantRang: rangSuivant ? Math.max(0, cibleRang - xp) : 0,
    partNiveau: (xp - socleNiveau) / Math.max(1, cibleNiveau - socleNiveau),
    partRang: Math.min(1, Math.max(0, partRang)),
  };
}
