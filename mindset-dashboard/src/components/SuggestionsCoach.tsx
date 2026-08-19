import React from 'react';
import { playClickSound } from '../utils/sounds';
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

/** Une liste du stockage local, tolérante à tout ce qui n'est pas un tableau. */
function liste(cle: string): any[] {
  try {
    const parse = JSON.parse(localStorage.getItem(cle) || '[]');
    return Array.isArray(parse) ? parse : [];
  } catch {
    return [];
  }
}

/** Combien de journées ce compte a-t-il vraiment vécues ? */
function joursVecus(): number {
  try {
    const scores = JSON.parse(localStorage.getItem('mindset_daily_scores') || '{}');
    return scores && typeof scores === 'object' ? Object.keys(scores).length : 0;
  } catch {
    return 0;
  }
}

/**
 * Trois propositions, jamais plus.
 *
 * Quatre tiendraient encore à l'écran, et c'est justement le problème : un menu se
 * lit, trois phrases se choisissent. Chacune ouvre une capacité différente — le
 * plan, le rappel daté, la lecture que le coach fait de la personne — pour qu'un
 * seul coup d'œil dise l'étendue de ce qu'il sait faire.
 */
export function suggestionsDuMoment(): string[] {
  const aUnPlan = liste('mindset_routines').length > 0;
  const aDesHabitudes = liste('mindset_habits').length > 0;
  const jours = joursVecus();

  const propositions: string[] = [];

  propositions.push(
    aUnPlan
      ? "J'ai décroché hier, adapte mon plan pour aujourd'hui"
      : 'Fais-moi un plan pour la semaine',
  );

  // Le rappel daté est la capacité la moins devinable de toutes : rien à l'écran ne
  // laisse imaginer qu'une phrase tapée dans un chat fera sonner un téléphone.
  propositions.push('Rappelle-moi de méditer ce soir à 22 h 30');

  propositions.push(
    jours >= 3
      ? "Qu'est-ce que tu as compris de moi ?"
      : aDesHabitudes
        ? 'Que dois-je faire en priorité aujourd’hui ?'
        : 'Propose-moi deux habitudes simples à tenir',
  );

  return propositions;
}

interface Props {
  onChoisir: (texte: string) => void;
}

export const SuggestionsCoach: React.FC<Props> = ({ onChoisir }) => {
  const propositions = suggestionsDuMoment();

  return (
    <div className="suggestions-coach">
      <p className="suggestions-coach-intro">Tu peux lui demander :</p>
      <div className="suggestions-coach-liste">
        {propositions.map((texte) => (
          <button
            key={texte}
            type="button"
            className="suggestions-coach-puce"
            onClick={() => {
              playClickSound();
              onChoisir(texte);
            }}
          >
            {texte}
          </button>
        ))}
      </div>
    </div>
  );
};
