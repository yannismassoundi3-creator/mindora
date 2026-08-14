import React, { useState, useEffect, useRef } from 'react';
import './RankUpOverlay.css';
import { getRankForLevel, type Rank } from '../utils/ranks';
import { playLevelUpSound } from '../utils/sounds';
import { RankIcon } from './RankIcon';
import { EVENEMENT_XP, niveauPourXp, lireXp, type DetailXp } from '../utils/progression';

/*
  L'annonce d'une promotion de rang.

  Même correction que pour `LevelUpOverlay` : elle suivait les points, donc la
  monnaie. Un achat en Boutique faisait rétrograder pour de bon (4050 points
  moins un cosmétique à 3000 rendait le rang Novice), et comme rien ici ne réagit
  à une descente, la perte était silencieuse. Le rang se lit désormais sur
  l'expérience, qu'aucune dépense ne touche.
*/
export const RankUpOverlay: React.FC = () => {
  const [show, setShow] = useState(false);
  const [rank, setRank] = useState<Rank>(() => getRankForLevel(niveauPourXp(lireXp())));
  // Voir `LevelUpOverlay` : le son ne doit pas partir d'une fonction de mise à jour.
  const rangConnu = useRef(rank);

  useEffect(() => {
    const surXp = (e: Event) => {
      const detail = (e as CustomEvent<DetailXp>).detail;
      const nouveau = getRankForLevel(niveauPourXp(detail?.xp ?? lireXp()));
      // Voir `LevelUpOverlay` : le rattrapage venu du serveur n'est pas une montée.
      if (detail?.gain && nouveau.minLevel > rangConnu.current.minLevel) {
        playLevelUpSound();
        setShow(true);
        setTimeout(() => setShow(false), 5500); // 5,5 s, le temps du fondu
      }
      rangConnu.current = nouveau;
      setRank(nouveau);
    };

    window.addEventListener(EVENEMENT_XP, surXp);
    return () => window.removeEventListener(EVENEMENT_XP, surXp);
  }, []);

  if (!show) return null;

  return (
    <div className="rank-up-overlay" style={{ '--rank-color': rank.color } as any}>
      <div className="rank-up-backdrop"></div>

      {/* Liquid Glass Waves */}
      <div className="liquid-waves-container">
        <div className="liquid-wave lw1"></div>
        <div className="liquid-wave lw2"></div>
        <div className="liquid-wave lw3"></div>
      </div>

      <div className="rank-up-content">
        <h2 className="rank-up-title">PROMOTION !</h2>
        <div className={`rank-up-emblem ${rank.cssClass || ''}`}>
          <div style={{ filter: `drop-shadow(0 0 20px ${rank.color}) drop-shadow(0 0 40px ${rank.color})` }}>
            <RankIcon iconName={rank.iconName} size={120} color={rank.color} />
          </div>
        </div>
        <h1 className="rank-up-name" style={{ color: rank.color, textShadow: `0 0 20px ${rank.color}` }}>
          RANG {rank.name.toUpperCase()}
        </h1>
      </div>
    </div>
  );
};
