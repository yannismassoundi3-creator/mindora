import React, { useState, useEffect, useRef } from 'react';
import './LevelUpOverlay.css';
import { playLevelUpSound } from '../utils/sounds';
import { EVENEMENT_XP, niveauPourXp, lireXp, type DetailXp } from '../utils/progression';

/*
  L'annonce d'un passage de niveau.

  Elle suivait `pointsChanged`, donc la monnaie : dépenser en Boutique faisait
  baisser le niveau mémorisé ici, et la remontée rejouait l'animation pour un
  niveau déjà atteint. Deux écritures de points ne prévenaient d'ailleurs pas du
  tout (Boutique et Inventaire), ce qui suffisait à désynchroniser durablement le
  niveau retenu. Elle suit maintenant l'expérience, qui ne bouge que pour un gain
  ou l'annulation d'un gain.
*/
export const LevelUpOverlay: React.FC = () => {
  const [show, setShow] = useState(false);
  const [level, setLevel] = useState(() => niveauPourXp(lireXp()));
  /*
    Le niveau est gardé aussi dans une ref : jouer un son et programmer une
    fermeture depuis la fonction de mise à jour d'un état est un effet de bord que
    React s'autorise à rejouer (StrictMode le fait systématiquement en
    développement), ce qui doublait le son.
  */
  const niveauConnu = useRef(level);

  useEffect(() => {
    const surXp = (e: Event) => {
      const detail = (e as CustomEvent<DetailXp>).detail;
      const nouveau = niveauPourXp(detail?.xp ?? lireXp());
      // `gain` écarte le rattrapage du serveur : sur un appareil neuf, l'XP passe
      // de 0 au total du compte, ce qui n'est pas un passage de niveau.
      if (detail?.gain && nouveau > niveauConnu.current) {
        playLevelUpSound();
        setShow(true);
        setTimeout(() => setShow(false), 3000);
      }
      niveauConnu.current = nouveau;
      setLevel(nouveau);
    };

    window.addEventListener(EVENEMENT_XP, surXp);
    return () => window.removeEventListener(EVENEMENT_XP, surXp);
  }, []);

  if (!show) return null;

  return (
    <div className="level-up-overlay">
      <div className="arrows-container">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="up-arrow"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 1.5}s`,
              width: `${15 + Math.random() * 15}px`,
              height: `${15 + Math.random() * 15}px`,
            }}
          />
        ))}
      </div>

      <div className="level-up-content">
        <h2 className="level-up-title">Niveau Supérieur</h2>
        <h1 className="level-up-number">Niv. {level}</h1>
      </div>
    </div>
  );
};
