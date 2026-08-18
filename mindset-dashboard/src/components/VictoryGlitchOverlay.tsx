import React, { useEffect, useMemo, useState } from 'react';
import './VictoryGlitchOverlay.css';
import { playGlitchSound } from '../utils/sounds';
import { lireEtatDuJour } from '../utils/journee';

interface VictoryGlitchOverlayProps {
  onClose: () => void;
}

/*
  Les 100 % de la journée.

  L'effet d'avant était une explosion : trois ondes de choc concentriques, une
  gerbe de vingt-six éclats dorés et vingt-deux traits blancs clignotants. Beaucoup
  de mouvement, et un registre — celui du feu d'artifice — que n'importe quelle
  application de to-do sort au moindre prétexte. Yannis n'en voulait plus, tout en
  gardant le thème.

  Le registre est donc renversé, sans quitter le glitch : au lieu d'exploser, le
  message **se décode**. Un balayage traverse l'écran une fois, le titre arrive
  dédoublé en cyan et magenta puis se recale, la grille de fond se stabilise. On
  passe du feu d'artifice au signal qui s'accroche — ce qui, pour une application
  qui parle de discipline, dit à peu près la bonne chose.

  Bonus non décoratif : cinquante et un éléments animés deviennent cinq. Cette
  scène se joue sur un téléphone, au moment précis où la personne vient de cocher
  sa dernière tâche — ce n'est pas là qu'il faut faire ramer l'appareil.
*/
export const VictoryGlitchOverlay: React.FC<VictoryGlitchOverlayProps> = ({ onClose }) => {
  const [sort, setSort] = useState(false);
  const etat = useMemo(() => lireEtatDuJour(), []);

  useEffect(() => {
    playGlitchSound();
    document.body.classList.add('cyber-glitch-active');

    // La secousse ponctue l'impact, elle ne s'installe pas.
    const finSecousse = setTimeout(() => document.body.classList.remove('cyber-glitch-active'), 280);
    const debutSortie = setTimeout(() => setSort(true), 2500);
    const fin = setTimeout(onClose, 3000);

    return () => {
      clearTimeout(finSecousse);
      clearTimeout(debutSortie);
      clearTimeout(fin);
      document.body.classList.remove('cyber-glitch-active');
    };
  }, [onClose]);

  const titre = 'Journée pleine';

  return (
    <div className={`cyber-glitch-container ${sort ? 'sort' : ''}`}>
      {/* La grille : le décor du signal, pas un effet. Elle se stabilise et reste. */}
      <div className="victoire-grille" />

      {/* Le balayage passe une seule fois, de haut en bas, et révèle le message. */}
      <div className="victoire-balayage" />

      <div className="victoire-carte">
        <span className="victoire-sur-titre">Énergie au maximum</span>
        {/*
          Le titre est écrit trois fois : une fois pour de vrai, et deux fois par
          les pseudo-éléments qui portent les décalages cyan et magenta. D'où
          `data-texte` — `content: attr()` est le seul moyen de dédoubler un texte
          sans le recopier dans le balisage, où un lecteur d'écran le lirait trois
          fois de suite.
        */}
        <strong className="victoire-titre" data-texte={titre}>
          {titre}
        </strong>
        <div className="victoire-chiffres">
          <span>
            <strong>{etat.faites}</strong> tâche{etat.faites > 1 ? 's' : ''}
          </span>
          <span className="victoire-separateur" />
          <span>
            série de <strong>{etat.serie} j</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
