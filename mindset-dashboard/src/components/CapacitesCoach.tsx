import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { playClickSound } from '../utils/sounds';
import { capacitesADecouvrir, retenirCapacite } from '../utils/capacitesCoach';
import './CapacitesCoach.css';

/*
  Ce que le coach sait faire, sur l'écran d'accueil.

  Le produit vend un coach, et l'abonnement ne se paie que pour lui. Or rien sur
  le tableau de bord ne disait ce qu'il sait faire : le bandeau propose un plan
  quand la journée est vide, la bannière dit un mot, et c'est tout. Les trois
  propositions qui montrent l'étendue vivaient **dans le chat**, donc invisibles
  pour qui ne l'ouvre pas — et elles n'y sortaient qu'avant le tout premier mot.

  D'où cette carte, et son unique règle : **elle montre ce qui n'a pas encore été
  essayé, et disparaît quand il ne reste rien.** Ce n'est pas un tutoriel, qui
  expliquerait tout au moment où ça n'intéresse personne ; c'est une porte vers
  une capacité précise, franchie d'un geste. On n'apprend pas qu'un coach pose des
  rappels, on lui en fait poser un.

  Elle n'apparaît jamais en même temps que « Comment ça marche » : deux blocs
  pédagogiques empilés sur un téléphone, ce n'est plus de l'aide, c'est un
  manuel — et le tableau de bord doit parler de la journée de la personne.
*/

interface Props {
  nomCoach: string;
  onOuvrirChat: () => void;
}

export const CapacitesCoach: React.FC<Props> = ({ nomCoach, onOuvrirChat }) => {
  /*
    Figées au montage, et pas relues à chaque rendu.

    Sans ça, cliquer une puce retirerait la capacité de la liste dans le même
    souffle : la carte se réorganiserait sous le doigt pendant que la navigation
    s'ouvre. Le rafraîchissement a lieu au prochain retour sur l'accueil, ce qui
    est exactement le bon moment — la capacité a alors vraiment été exercée.
  */
  const [capacites] = useState(() => capacitesADecouvrir(3));

  if (!capacites.length) return null;

  const demander = (id: (typeof capacites)[number]['id'], phrase: string) => {
    playClickSound();
    retenirCapacite(id);
    /*
      Le message part avec la navigation, il n'est pas seulement suggéré.

      Même mécanisme que la carte d'observation : le chat lit cette clé à
      l'ouverture. Déposer la personne devant un champ vide après avoir promis
      une capacité lui ferait retaper elle-même ce qu'elle vient de choisir.
    */
    localStorage.setItem('mindset_pending_chat_msg', phrase);
    window.dispatchEvent(new CustomEvent('mindset_pending_chat_msg', { detail: phrase }));
    onOuvrirChat();
  };

  return (
    <section className="capacites-coach glass-panel">
      <div className="capacites-coach-entete">
        <Sparkles size={16} />
        <h3>{nomCoach} sait aussi</h3>
      </div>

      <ul className="capacites-coach-liste">
        {capacites.map((c) => (
          <li key={c.phrase}>
            {/*
              La phrase exacte qui sera envoyée, et rien d'autre.

              Le titre de la capacité (« Te rappeler à l'heure ») a été affiché
              au-dessus d'elle pendant une version : la puce faisait alors deux
              lignes, et les trois montaient à 249 px sur un téléphone — un tiers
              du premier écran pour une aide à la découverte. C'est la phrase qui
              travaille, pas le titre : quelqu'un qui a lu « Rappelle-moi de
              méditer ce soir à 22 h 30 » sait ensuite en écrire une autre tout
              seul, et l'en-tête de la carte dit déjà de quoi il s'agit.

              Le titre reste dans l'étiquette accessible, où il ne coûte aucune
              hauteur : au lecteur d'écran, une phrase seule ne dit pas quelle
              capacité on ouvre.
            */}
            <button
              type="button"
              className="capacites-coach-item"
              aria-label={`${c.titre} — ${c.phrase}`}
              onClick={() => demander(c.id, c.phrase)}
            >
              « {c.phrase} »
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
