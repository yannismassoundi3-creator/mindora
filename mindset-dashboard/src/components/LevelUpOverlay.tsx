import React, { useState, useEffect } from 'react';
import './LevelUpOverlay.css';
import { playLevelUpSound } from '../utils/sounds';

export const LevelUpOverlay: React.FC = () => {
  const [show, setShow] = useState(false);
  const [level, setLevel] = useState(() => {
    const points = parseInt(localStorage.getItem('mindset_points') || '0', 10);
    return Math.floor(Math.sqrt(points / 50)) + 1;
  });

  useEffect(() => {
    const handlePointsChanged = (e: CustomEvent) => {
      const newPoints = e.detail;
      const newLevel = Math.floor(Math.sqrt(newPoints / 50)) + 1;
      
      setLevel(prevLevel => {
        if (newLevel > prevLevel) {
          // Trigger Level Up!
          playLevelUpSound();
          setShow(true);
          setTimeout(() => setShow(false), 3000); // 3 seconds
        }
        return newLevel;
      });
    };

    window.addEventListener('pointsChanged', handlePointsChanged as EventListener);
    return () => window.removeEventListener('pointsChanged', handlePointsChanged as EventListener);
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
