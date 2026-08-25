/**
 * Ce que la personne a dit vouloir en s'inscrivant, prêt à être cité.
 *
 * **Pourquoi ça existe, et pourquoi c'est ici.** Mesuré le 25 août 2026 : le haut
 * de l'entonnoir est réglé — la quasi-totalité des inscrits finit le questionnaire
 * et la majorité écrit au coach le jour même — mais deux tiers de ceux qui agissent
 * n'agissent qu'une seule journée. Le seul trait commun de tous ceux qui ont tenu
 * plus d'un jour est d'avoir parlé au coach. Autrement dit : ce qui ramène les
 * gens, c'est d'être reconnus, pas d'être rappelés.
 *
 * Or le produit demandait six réponses à l'inscription puis n'en citait jamais
 * aucune. Le brief du matin parlait des tâches du jour, les relances d'une série
 * interrompue — deux choses que n'importe quelle application d'habitudes sait
 * dire. Ce module rend disponible la seule qu'aucune autre ne peut dire.
 *
 * **Module feuille, sans aucun import.** Le brief du matin (module push) et les
 * relances (module relances) en ont besoin tous les deux. Faire dépendre l'un de
 * l'autre pour une extraction de chaîne de caractères créerait un lien entre
 * l'envoi de notifications et l'envoi d'e-mails que rien ne justifie — c'est le
 * raisonnement déjà tenu pour `STATUTS_ABONNES`, et pour `clesCache.ts` côté
 * navigateur.
 */

/** Le profil, réduit à ce qui sert ici. Les deux champs sont facultatifs en base. */
export type ProfilCitable = {
  objectives?: string[] | null;
  situation?: string | null;
} | null | undefined;

/**
 * Longueur au-delà de laquelle un objectif ne se cite plus dans une phrase.
 *
 * Le champ est libre : certains y écrivent trois mots, d'autres un paragraphe. Un
 * paragraphe recollé au milieu d'un e-mail ne se lit pas comme une citation, il se
 * lit comme un bug — et couper au caractère près produirait une phrase tronquée,
 * ce qui est pire que de ne rien citer.
 */
export const REPERE_MAX = 90;

/** En deçà, ce n'est pas un objectif : c'est une case remplie pour passer. */
export const REPERE_MIN = 4;

/**
 * Le premier repère utilisable, ou `null`.
 *
 * **`null` est un résultat normal, pas une panne.** Une partie des comptes n'a
 * jamais fini le questionnaire, et d'autres ont répondu n'importe quoi pour
 * avancer. La citation est un supplément : chaque message qui s'en sert doit se
 * tenir debout sans elle, et c'est vérifié dans les tests des deux appelants. La
 * règle générale du projet s'applique — on ne compose jamais une phrase autour
 * d'une donnée qu'on n'a pas.
 *
 * Les objectifs passent avant `situation` parce qu'ils répondent à « qu'est-ce que
 * tu veux » quand l'autre répond à « où tu en es ». Un message qui reprend contact
 * parle de la destination, pas du point de départ.
 */
export function repereDuProfil(profil: ProfilCitable): string | null {
  if (!profil) return null;

  const candidats = [...(profil.objectives ?? []), profil.situation ?? ''];

  for (const brut of candidats) {
    if (typeof brut !== 'string') continue;
    // Les retours à la ligne d'un champ libre casseraient la partie texte de
    // l'e-mail, où une ligne vide vaut fin de paragraphe.
    const propre = brut.replace(/\s+/g, ' ').trim();
    if (propre.length < REPERE_MIN) continue;
    if (propre.length > REPERE_MAX) continue;
    return propre;
  }

  return null;
}
