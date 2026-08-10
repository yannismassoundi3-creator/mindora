import React, { useState, useEffect } from 'react';
import './RankUpOverlay.css';
import { getRankForLevel, type Rank } from '../utils/ranks';
import { playLevelUpSound } from '../utils/sounds';
import { RankIcon } from './RankIcon';
import { getSecurePoints } from '../utils/secureStorage';

export const RankUpOverlay: React.FC = () => {
  const [show, setShow] = useState(false);
  const [rank, setRank] = useState<Rank>(() => {
    const points = getSecurePoints();
    const level = Math.floor(Math.sqrt(points / 50)) + 1;
    return getRankForLevel(level);
  });

  useEffect(() => {
    const handlePointsChanged = (e: CustomEvent) => {
      const newPoints = e.detail;
      const newLevel = Math.floor(Math.sqrt(newPoints / 50)) + 1;
      const newRank = getRankForLevel(newLevel);
      
      setRank(prevRank => {
        if (newRank.minLevel > prevRank.minLevel) {
          playLevelUpSound();
          setShow(true);
          setTimeout(() => setShow(false), 5500); // Increased timeout to 5.5s for smooth fade
        }
        return newRank;
      });
    };

    window.addEventListener('pointsChanged', handlePointsChanged as EventListener);
    return () => window.removeEventListener('pointsChanged', handlePointsChanged as EventListener);
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
