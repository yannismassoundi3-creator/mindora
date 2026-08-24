import React from 'react';
import { playClickSound } from '../utils/sounds';
import { capacitesADecouvrir, retenirCapacite, type Capacite } from '../utils/capacitesCoach';
import './SuggestionsCoach.css';

/*
  Ce qu'on peut demander à son coach, montré au lieu d'être expliqué.

  Rapporté par les utilisateurs : « ils sont perdus, ils ne connaissent pas les
  fonctions de l'IA ». Le constat est juste, la cause n'est pas le manque
  d'explication. Le coach s'ouvrait sur **un champ vide** dont la seule indication
  était « Pose-moi une question sur tes objectifs… » : rien n'y laissait deviner
  qu'il construit un plan, pose un rappel daté ou dit ce qu'il a compris de
  quelqu'un. On tape « ça va ? », on reçoit une réponse polie, on en conclut que
  c'est un robot de conversation de plus. Les chiffres le disaient déjà : 5
  personnes sur 34 avaient parlé au coach une seule fois, et c'est la seule chose
  que l'abonnement vend.

  **Un tutoriel aurait expliqué l'interface au moment où elle importe le moins** —
  avant d'avoir la moindre donnée, et avant d'avoir décidé de rester. Ces
  propositions font l'inverse : ce sont de vrais messages, envoyés d'un geste, qui
  démontrent la capacité **en s'en servant**. On n'apprend pas qu'un coach peut
  refaire un plan, on lui en fait refaire un.

  Elles disparaissent dès qu'on lui a parlé : leur travail est fait, et un rang de
  boutons au-dessus d'une conversation en cours n'est plus une aide, c'est du
  décor.

  Deux détails qui ne se voient pas :

  - **Le vocabulaire est choisi.** « plan », « habitudes », « rappelle-moi » sont
    exactement les mots que le serveur guette (`MOTS_PLAN`) pour joindre le schéma
    du plan à l'invite. Une proposition mal formulée obtiendrait une réponse en
    prose là où la personne attend un plan appliqué dans l'app.
  - **Elles s'adaptent à l'état du compte**, sinon la première proposition dirait
    « fais-moi un plan » à quelqu'un qui en a déjà un — et le coach, lui, sait
    qu'il y en a un. Une suggestion à côté de la plaque coûte plus qu'aucune : elle
    apprend que l'app ne suit pas.
*/

/**
 * Trois propositions, jamais plus.
 *
 * Quatre tiendraient encore à l'écran, et c'est justement le problème : un menu se
 * lit, trois phrases se choisissent. Chacune ouvre une capacité différente — le
 * plan, le rappel daté, la lecture que le coach fait de la personne — pour qu'un
 * seul coup d'œil dise l'étendue de ce qu'il sait faire.
 */
export function suggestionsDuMoment(): Capacite[] {
  /*
    Ce qui reste à découvrir, et non les trois mêmes phrases indéfiniment.

    Elles ne s'affichaient qu'avant le tout premier mot : quelqu'un qui a écrit
    une fois ne les revoyait jamais, et c'est le profil dominant — 5 comptes sur
    34 avaient parlé au coach exactement une fois. Ils ont vu trois phrases, en
    ont cliqué une, et n'ont plus rien découvert. Le rappel daté, que rien à
    l'écran ne laisse deviner, mourait là.

    La liste et l'état de découverte vivent dans `utils/capacitesCoach` : deux
    endroits qui décideraient chacun de leur côté finiraient par proposer ici ce
    que l'accueil vient de faire essayer.
  */
  return capacitesADecouvrir(3);
}

/**
 * Les trois premières, juste après le questionnaire.
 *
 * Elles remplacent le message que l'app envoyait autrefois au nom de la personne.
 * La différence n'est pas la longueur du chemin — un geste dans les deux cas —
 * c'est **qui décide** : le plan ne s'écrit dans son application que si elle a
 * demandé un plan.
 *
 * Les trois ne sont pas trois formulations du même souhait, ce sont trois ambitions
 * différentes : tout de suite et en entier, une seule habitude, ou une seule étape.
 * Quelqu'un qui vient de déclarer quinze minutes par jour ne veut pas forcément d'un
 * programme complet, et rien jusqu'ici ne lui laissait le dire.
 *
 * Le vocabulaire reste choisi : « plan », « habitude » et « étape » sont tous les
 * trois dans `MOTS_PLAN` côté serveur. Sans ça, la réponse arriverait en prose là
 * où la personne attend un plan appliqué dans l'app.
 */
export function suggestionsPremierContact(): Capacite[] {
  return [
    {
      id: 'plan',
      titre: 'Tout de suite',
      phrase: 'Construis-moi mon plan complet, je te fais confiance',
    },
    {
      id: 'habitude',
      titre: 'Une seule chose',
      phrase: 'Commence petit : une seule habitude pour cette semaine',
    },
    {
      id: 'plan',
      titre: 'Une étape',
      phrase: 'Donne-moi juste une première étape à faire maintenant',
    },
  ];
}

interface Props {
  onChoisir: (texte: string) => void;
  /** Vrai au tout premier écran après le questionnaire. */
  premierContact?: boolean;
}

export const SuggestionsCoach: React.FC<Props> = ({ onChoisir, premierContact }) => {
  const propositions = premierContact ? suggestionsPremierContact() : suggestionsDuMoment();

  return (
    <div className="suggestions-coach">
      <p className="suggestions-coach-intro">
        {premierContact ? 'Réponds-lui, ou choisis :' : 'Tu peux lui demander :'}
      </p>
      <div className="suggestions-coach-liste">
        {propositions.map((capacite) => (
          <button
            key={capacite.phrase}
            type="button"
            className="suggestions-coach-puce"
            onClick={() => {
              playClickSound();
              // Retenu avant l'envoi : la réponse peut échouer, la capacité a
              // quand même été montrée et essayée.
              retenirCapacite(capacite.id);
              onChoisir(capacite.phrase);
            }}
          >
            {capacite.phrase}
          </button>
        ))}
      </div>
    </div>
  );
};
