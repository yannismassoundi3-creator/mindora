import { lireEtatDuJour } from './journee';
import { lireObjectif } from './objectif';
import { creneauDominant, creneauDe, NOM_CRENEAU } from './rythme';

/*
  Le mot que le coach glisse à l'arrivée.

  On ouvrait l'application sur un tableau de bord muet : des chiffres justes, et
  personne pour les lire. Le coach, lui, ne parlait que si on allait le chercher —
  or c'est au moment où l'on arrive qu'une phrase change la suite de la journée.

  Ce mot est une **bannière**, pas une conversation : deux lignes, un titre, et un
  appui pour aller en parler. Il est composé ici, dans le navigateur, et non demandé
  au modèle. Trois raisons, dans cet ordre :

  1. **Il ne doit jamais mentir sur l'heure.** La phrase écrite par le coach est mise
     en cache six heures côté serveur ; à l'ouverture d'une app, ce délai suffit à
     annoncer le matin à quelqu'un qui arrive le soir.
  2. **Il ne doit jamais être coupé.** Une bannière tient sur deux lignes. Tronquer
     une phrase de coach au milieu est pire que ne rien dire.
  3. **Il ne coûte rien.** Ni quota Groq, ni Énergie, ni attente réseau : quelqu'un
     qui ouvre l'app n'a rien demandé.

  La vraie phrase du coach reste dans la conversation, où elle a la place de
  respirer — et c'est justement là que la bannière emmène.

  **Rien ne s'invente ici.** Chaque phrase ne cite que des chiffres présents dans
  l'état local, et l'observation sur le rythme ne sort que si `creneauDominant()`
  la juge établie. C'est la règle qui tient déjà les invites du coach : une
  approximation dite avec assurance apprend en une phrase qu'on devine.
*/

export interface MotDuCoach {
  titre: string;
  message: string;
}

const CLE_DERNIER = 'mindset_mot_coach_le';

/**
 * Le temps minimum entre deux mots d'accueil.
 *
 * Quatre heures. Ce qui rend une bannière insupportable n'est pas son contenu mais
 * sa fréquence : reparaître à chaque retour sur le tableau de bord la ferait
 * écarter d'un revers de pouce sans être lue, et on aurait dépensé le seul endroit
 * où le coach peut prendre la parole en premier. Quatre heures découpent aussi la
 * journée à peu près comme elle se vit — le matin, l'après-midi, le soir.
 */
const INTERVALLE_MS = 4 * 3600 * 1000;

/**
 * Le mot à dire maintenant, s'il y en a un et si c'est le moment.
 *
 * L'horodatage est posé ici, au moment de rendre le mot, et pas par l'appelant :
 * un appelant qui oublie de le poser transforme la règle en décoration.
 */
export function motDuCoachDuMoment(prenom?: string): MotDuCoach | null {
  const dernier = Number(localStorage.getItem(CLE_DERNIER) || 0);
  if (dernier && Date.now() - dernier < INTERVALLE_MS) return null;

  const mot = composerMotDuCoach(prenom);
  if (!mot) return null;

  localStorage.setItem(CLE_DERNIER, String(Date.now()));
  return mot;
}

/** « Construire une discipline de fer » → « construire une discipline de fer ». */
function enMinuscule(phrase: string): string {
  return phrase.charAt(0).toLocaleLowerCase('fr-FR') + phrase.slice(1);
}

/**
 * Ce qui tient dans une bannière de deux lignes.
 *
 * Le texte y est coupé à deux lignes par le CSS, et une phrase de coach amputée
 * au milieu est pire que pas de phrase. Le plafond est donc appliqué ici, à la
 * composition, où l'on peut choisir **ce** qu'on sacrifie.
 */
const BUDGET_CARACTERES = 110;

/**
 * Assemble une phrase de base et le meilleur complément qui tienne encore.
 *
 * Les compléments sont donnés par ordre de valeur, du plus personnel au plus
 * générique. On en garde **un seul** : deux observations dans une bannière, et
 * aucune des deux ne se lit. Si aucun ne rentre, la base seule fait le travail —
 * elle est déjà vraie et déjà précise.
 */
function assembler(base: string, complements: string[]): string {
  for (const complement of complements) {
    if (!complement) continue;
    if (base.length + 1 + complement.length <= BUDGET_CARACTERES) return `${base} ${complement}`;
  }
  return base;
}

/**
 * L'observation sur le rythme, quand elle est méritée et qu'elle apporte quelque
 * chose à l'instant présent.
 *
 * Elle se tait dans deux cas, et les deux comptent : quand le relevé ne dit rien de
 * net, et quand ce qu'il dit est déjà sous les yeux de la personne — annoncer « tu
 * travailles en soirée » à 21 h à quelqu'un qui coche sa dernière tâche est une
 * évidence servie comme une révélation.
 */
function observationRythme(heureActuelle: number, retrospective = false): string {
  const rythme = creneauDominant();
  if (!rythme) return '';

  const frequence = rythme.part >= 0.8 ? 'presque toujours' : 'souvent';

  /*
    Deux formulations, parce que ce n'est pas la même observation.

    Journée finie, on constate : « et comme presque toujours, ça s'est joué en
    soirée » parle de la personne, au passé. C'est vrai même à 21 h — c'est même là
    que ça tombe le plus juste, elle vient de le faire. La règle du « ne pas énoncer
    l'évidence » ne s'applique donc pas ici.

    Journée en cours, on annonce : « comme souvent, ça se joue en soirée chez toi »
    prédit la suite. Dite à 21 h à quelqu'un qui a encore trois choses à faire, elle
    devient une évidence servie comme une révélation — d'où le silence quand le
    créneau observé est celui de l'instant.
  */
  if (retrospective) return `Et comme ${frequence}, ça s'est joué ${NOM_CRENEAU[rythme.creneau]}.`;

  if (rythme.creneau === creneauDe(heureActuelle)) return '';
  return `Comme ${frequence}, ça se joue ${NOM_CRENEAU[rythme.creneau]} chez toi.`;
}

/**
 * Ce que le coach a à dire à l'arrivée, ou `null` s'il n'a rien à dire.
 *
 * `null` est une réponse à part entière : une bannière qui apparaît chaque fois
 * qu'on ouvre l'app, avec ou sans contenu, devient un élément de décor qu'on écarte
 * sans lire — et on aura dépensé le seul endroit où le coach peut parler en premier.
 */
export function composerMotDuCoach(prenom?: string): MotDuCoach | null {
  const { faites, total, prochaine, serie } = lireEtatDuJour();
  const objectif = lireObjectif();
  const heure = new Date().getHours();
  const nom = (prenom || '').trim();

  // Rien de prévu. Ce n'est pas un échec — c'est un compte neuf, ou une journée
  // qu'on n'a pas encore posée. Le geste attendu est de parler, pas de cocher.
  if (total === 0) {
    // Le cap d'abord, la demande ensuite : l'inverse donnerait une consigne suivie
    // d'un rappel, là où l'ordre naturel est « voilà où tu vas, dis-moi comment ».
    const avecCap = objectif
      ? `Tu veux ${enMinuscule(objectif)}. Dis-moi comment tu vois ta journée, je m'occupe du plan.`
      : '';
    return {
      titre: nom ? `${nom}, rien n'est posé pour aujourd'hui` : "Rien n'est posé pour aujourd'hui",
      message:
        avecCap && avecCap.length <= BUDGET_CARACTERES
          ? avecCap
          : "Dis-moi ce que tu veux changer, je m'occupe du plan.",
    };
  }

  // Tout est fait. On reconnaît, on ne redemande rien — et c'est le seul moment où
  // relier l'effort du jour au cap déclaré ne sonne pas comme une leçon.
  if (!prochaine) {
    return {
      titre: `Journée bouclée — ${faites}/${faites}`,
      /*
        Le rythme passe **avant** le cap déclaré, et c'est un renversement voulu.

        Les deux se disputaient l'unique complément, et le cap gagnait toujours : il
        est présent tous les jours, il tient dans le budget, et il sortait donc à
        chaque journée bouclée. L'observation sur le rythme, elle, n'existe qu'une
        fois le relevé établi — autrement dit rarement, et seulement quand elle a
        quelque chose à dire. La laisser derrière revenait à ne l'afficher jamais.

        C'est aussi l'ordre qui a du sens à lire : une phrase que le coach ne peut
        dire qu'à cette personne-là vaut mieux qu'une phrase qu'il redit chaque soir.
      */
      message: assembler('Tu as fait tout ce qui était prévu.', [
        observationRythme(heure, true),
        objectif ? `C'est comme ça qu'on finit par ${enMinuscule(objectif)}.` : '',
        serie >= 2 ? `${serie} jours d'affilée.` : '',
      ]),
    };
  }

  const reste = total - faites;

  // Le soir, avec des choses en attente : c'est le seul moment où la bannière a une
  // urgence légitime. Elle nomme **une** action — deux, et c'est une liste ; une
  // liste, et on repousse.
  if (heure >= 18) {
    // « 0/3 de fait » est un constat d'échec servi en ouverture. Quand rien n'est
    // encore coché, on passe directement à ce qu'il y a à faire.
    const avancement = faites > 0 ? `${faites}/${total} de fait. ` : '';
    return {
      titre: reste === 1 ? 'Il en reste une' : `Il en reste ${reste}`,
      message: assembler(`${avancement}La prochaine : « ${prochaine.titre} ».`, [
        serie >= 2 ? `Ta série de ${serie} jours se joue là.` : 'Et la journée se termine.',
      ]),
    };
  }

  return {
    titre: faites > 0 ? `${faites}/${total} aujourd'hui` : `${reste} chose${reste > 1 ? 's' : ''} au programme`,
    message: assembler(
      `Commence par « ${prochaine.titre} »${prochaine.duree ? ` (${prochaine.duree})` : ''}.`,
      [observationRythme(heure), serie >= 2 ? `Ta série de ${serie} jours tient encore.` : ''],
    ),
  };
}
