import { lireEtatDuJour } from './journee';
import { lireObjectif } from './objectif';

/*
  La phrase d'ouverture du coach, composée par le navigateur.

  Elle sert deux fois. D'abord tout de suite : elle s'affiche au montage du chat,
  sans attendre le réseau, parce qu'un écran de conversation qui reste vide une
  seconde donne l'impression d'un coach qui cherche ses mots. Ensuite en repli :
  si le modèle ne répond pas — quota Groq épuisé, panne, appareil hors ligne —
  c'est elle qui reste, et elle doit tenir toute seule.

  Elle n'a pas à rivaliser avec la version écrite par le modèle : elle ne connaît
  ni les échanges passés ni la tendance. Mais elle connaît la journée, la série et
  l'objectif déclaré, et cela suffit déjà à dire quelque chose que personne
  d'autre ne pourrait dire — ce que « Comment je peux t'aider aujourd'hui ? » ne
  faisait pas.
*/

/** « Construire une discipline de fer » → « construire une discipline de fer ». */
function enMinuscule(phrase: string): string {
  return phrase.charAt(0).toLocaleLowerCase('fr-FR') + phrase.slice(1);
}

/**
 * Rappelle la série, mais seulement quand elle veut dire quelque chose.
 *
 * À un jour, « c'est ton 1er jour d'affilée » est une phrase vide ; au-delà, c'est
 * précisément ce qu'on ne veut pas perdre, et donc le meilleur argument pour ne
 * pas s'arrêter là.
 */
function mentionSerie(serie: number): string {
  return serie >= 2 ? ` Tu tiens depuis ${serie} jours, ne casse pas ça maintenant.` : '';
}

/**
 * Le marqueur posé par le questionnaire, lu une fois par le chat au montage.
 *
 * Il ne dit pas « cette personne est nouvelle » — le chat le devinerait — mais
 * « elle sort du questionnaire à l'instant », ce qui n'est vrai qu'une fois et ne
 * se déduit d'aucun état.
 */
export const CLE_PREMIER_CONTACT = 'mindset_premier_contact';

/** Le temps que la personne s'est donné, tel qu'elle l'a choisi au questionnaire. */
export const CLE_MINUTES_PAR_JOUR = 'mindset_minutes_par_jour';

/** « 60 » → « 1 heure ». Les quatre valeurs du questionnaire, et rien d'autre. */
function formaterBudget(minutes: number): string {
  if (minutes >= 120) return '2 heures ou plus';
  if (minutes >= 60) return '1 heure';
  return `${minutes} minutes`;
}

/**
 * La première phrase du coach, juste après le questionnaire.
 *
 * Elle **demande au lieu de donner**, et c'est tout son objet. Jusqu'au 23 août
 * 2026, la fin du questionnaire envoyait un message au nom de la personne pour
 * réclamer son plan : elle répondait à six questions et recevait, sans avoir rien
 * tapé, un programme complet déjà inscrit dans son application. Le plan était juste,
 * et il arrivait quand même comme une décision prise sans elle.
 *
 * Ce qui est repris ici n'est pas la rapidité — la conversation s'ouvre toujours
 * dans la foulée, et les propositions dessous partent d'un seul geste — c'est le
 * consentement : rien ne s'écrit dans son app avant qu'elle l'ait demandé.
 *
 * Elle nomme l'objectif et le budget déclarés parce qu'une question posée par
 * quelqu'un qui vient d'écouter ne se lit pas comme un formulaire de plus.
 */
export function composerPremierContact(nomUtilisateur?: string): string {
  const objectif = lireObjectif();
  const brut = Number(localStorage.getItem(CLE_MINUTES_PAR_JOUR));
  const budget = Number.isFinite(brut) && brut > 0 ? ` et ${formaterBudget(brut)} par jour` : '';
  const prenom = (nomUtilisateur || '').trim();

  if (objectif) {
    return `C'est noté${prenom ? `, ${prenom}` : ''} : ${enMinuscule(objectif)}${budget}. Je peux te construire ton plan tout de suite — mais je préfère te demander d'abord : par quoi tu veux commencer ?`;
  }

  return `${prenom ? `${prenom}, j` : 'J'}'ai tes réponses. Avant de te construire quoi que ce soit : par quoi tu veux commencer ?`;
}

export function composerOuverture(nomUtilisateur?: string): string {
  const { faites, total, prochaine, serie } = lireEtatDuJour();
  const objectif = lireObjectif();
  const prenom = (nomUtilisateur || '').trim();

  // Rien de planifié. Le geste attendu n'est pas de cocher quelque chose — il n'y
  // a rien à cocher — mais de dire ce qu'on veut, ce que l'app est faite pour
  // recevoir : on arrive les mains vides et le plan se construit ici.
  if (total === 0) {
    if (objectif) {
      return `Tu m'as dit vouloir ${enMinuscule(objectif)}. On n'a encore rien posé pour aujourd'hui — dis-moi à quoi devrait ressembler ta journée et je te construis le plan.`;
    }
    return `${prenom ? `${prenom}, o` : 'O'}n n'a encore rien posé ensemble. Dis-moi ce que tu veux changer en premier, et je m'occupe du plan.`;
  }

  // Tout est fait. Ne rien redemander : c'est le moment de relier l'effort au cap,
  // pas d'ajouter une tâche.
  if (!prochaine) {
    const fin = objectif
      ? ` C'est exactement comme ça qu'on finit par ${enMinuscule(objectif)}.`
      : ' Journée pleine.';
    return `Tout est coché, ${faites} sur ${faites}.${fin}${mentionSerie(serie)}`;
  }

  // Il reste quelque chose : on nomme une seule action, la prochaine. Deux, et
  // c'est une liste ; une liste, et on repousse.
  const duree = prochaine.duree ? ` (${prochaine.duree})` : '';
  const reste = total - faites;
  const avancement =
    faites > 0 ? `${faites} sur ${total} de fait` : `${reste} chose${reste > 1 ? 's' : ''} au programme`;

  return `${avancement}. La prochaine, c'est « ${prochaine.titre} »${duree} — commence par celle-là.${mentionSerie(serie)}`;
}
