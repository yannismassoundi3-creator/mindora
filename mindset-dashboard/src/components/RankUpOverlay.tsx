import React, { useState, useEffect } from 'react';
import './RankUpOverlay.css';
import { getRankForLevel, type Rank } from '../utils/ranks';
import { playLevelUpSound } from '../utils/sounds';

export const RankUpOverlay: React.FC = () => {
  const [show, setShow] = useState(false);
  const [rank, setRank] = useState<Rank>(() => {
    const points = parseInt(localStorage.getItem('mindset_points') || '0', 10);
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
          setTimeout(() => setShow(false), 4500); // 4.5 seconds duration
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
      <div className="rank-up-content">
        <h2 className="rank-up-title">PROMOTION !</h2>
        <div className={`rank-up-emblem ${rank.cssClass || ''}`}>
          <span className="rank-up-icon">{rank.icon}</span>
        </div>
        <h1 className="rank-up-name" style={{ color: rank.color, textShadow: `0 0 20px ${rank.color}` }}>
          RANG {rank.name.toUpperCase()}
        </h1>
      </div>
    </div>
  );
};
