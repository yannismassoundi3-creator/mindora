import React, { useEffect, useMemo, useState } from 'react';
import './VictoryGlitchOverlay.css';
import { playGlitchSound } from '../utils/sounds';
import { lireEtatDuJour } from '../utils/journee';

interface VictoryGlitchOverlayProps {
  onClose: () => void;
}

/*
  Les 100 % de la journée.

  L'effet existait déjà — secousse, ondes concentriques, lignes de parasites —
  mais il ne **disait** rien : huit dixièmes de seconde de scintillement, et on
  revenait au tableau de bord sans savoir ce qui venait d'être franchi. Le seul
  moment de la journée qui mérite d'être marqué passait pour un bug d'affichage.

  Il annonce désormais l'événement en toutes lettres, avec les chiffres qui l'ont
  produit, et laisse le temps de le lire. La secousse est raccourcie : elle
  ponctue, elle ne s'installe pas.
*/
export const VictoryGlitchOverlay: React.FC<VictoryGlitchOverlayProps> = ({ onClose }) => {
  const [sort, setSort] = useState(false);
  const etat = useMemo(() => lireEtatDuJour(), []);

  useEffect(() => {
    playGlitchSound();
    document.body.classList.add('cyber-glitch-active');

    // La secousse est décrochée du reste : elle dure le temps de l'impact, pas
    // celui du message.
    const finSecousse = setTimeout(() => document.body.classList.remove('cyber-glitch-active'), 350);
    const debutSortie = setTimeout(() => setSort(true), 2500);
    const fin = setTimeout(onClose, 3000);

    return () => {
      clearTimeout(finSecousse);
      clearTimeout(debutSortie);
      clearTimeout(fin);
      document.body.classList.remove('cyber-glitch-active');
    };
  }, [onClose]);

  const lignes = useMemo(
    () =>
      [...Array(22)].map(() => ({
        top: `${Math.random() * 100}%`,
        left: `${Math.random() * 100}%`,
        width: `${Math.random() * 150 + 30}px`,
        delay: `${Math.random() * 0.2}s`,
      })),
    [],
  );

  // Les éclats partent du centre dans toutes les directions. Les angles sont
  // tirés une fois pour toutes : recalculés à chaque rendu, la gerbe repartirait
  // de zéro au moindre changement d'état.
  const eclats = useMemo(
    () =>
      [...Array(26)].map((_, i) => ({
        angle: (360 / 26) * i + Math.random() * 8,
        distance: 120 + Math.random() * 180,
        delai: Math.random() * 0.18,
        taille: 4 + Math.random() * 5,
      })),
    [],
  );

  return (
    <div className={`cyber-glitch-container ${sort ? 'sort' : ''}`}>
      <div className="cyber-shockwave"></div>
      <div className="cyber-shockwave delay-1"></div>
      <div className="cyber-shockwave delay-2"></div>

      <div className="glitch-lines">
        {lignes.map((style, i) => (
          <div
            key={i}
            className="glitch-line"
            style={{ top: style.top, left: style.left, width: style.width, animationDelay: style.delay }}
          ></div>
        ))}
      </div>

      <div className="victoire-eclats">
        {eclats.map((e, i) => (
          <span
            key={i}
            className="victoire-eclat"
            style={
              {
                '--angle': `${e.angle}deg`,
                '--distance': `${e.distance}px`,
                '--taille': `${e.taille}px`,
                animationDelay: `${e.delai}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="victoire-carte">
        <span className="victoire-sur-titre">Énergie au maximum</span>
        <strong className="victoire-titre">Journée pleine</strong>
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
