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
