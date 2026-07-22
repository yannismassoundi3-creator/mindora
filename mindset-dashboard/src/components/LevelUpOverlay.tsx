import React, { useState, useEffect } from 'react';
import './LevelUpOverlay.css';
import { playLevelUpSound } from '../utils/sounds';
import confetti from 'canvas-confetti';

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
          confetti({
            particleCount: 150,
            spread: 100,
            origin: { y: 0.5 },
            colors: ['#3b82f6', '#8b5cf6', '#ffffff', '#e2e8f0'],
            zIndex: 10000
          });
          
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
        {[...Array(15)].map((_, i) => (
          <div 
            key={i} 
            className="up-arrow" 
            style={{ 
              left: `${Math.random() * 100}%`, 
              animationDelay: `${Math.random() * 1.5}s`,
              width: `${30 + Math.random() * 40}px`,
              height: `${30 + Math.random() * 40}px`,
              opacity: 0.3 + Math.random() * 0.7
            }} 
          />
        ))}
      </div>
      
      <div className="level-up-content">
        <h2 className="level-up-title">Level Up</h2>
        <h1 className="level-up-number">Niveau {level}</h1>
      </div>
    </div>
  );
};
