import React, { useState, useEffect } from 'react';
import './StreakBrokenOverlay.css';
import { playShatterSound } from '../utils/sounds';

export const StreakBrokenOverlay: React.FC = () => {
  const [show, setShow] = useState(false);
  const [lostStreak, setLostStreak] = useState(0);

  useEffect(() => {
    const handleStreakBroken = (e: CustomEvent) => {
      setLostStreak(e.detail.lostStreak);
      playShatterSound();
      setShow(true);
      setTimeout(() => setShow(false), 4000); // 4 seconds
    };

    window.addEventListener('streakBroken', handleStreakBroken as EventListener);
    return () => window.removeEventListener('streakBroken', handleStreakBroken as EventListener);
  }, []);

  if (!show) return null;

  return (
    <div className="streak-broken-overlay">
      <div className="broken-glitch"></div>
      <div className="streak-broken-content">
        <div className="broken-emoji">💔</div>
        <h1 className="broken-title">SÉRIE BRISÉE</h1>
        <p className="broken-subtitle">Ta série de {lostStreak} jours est perdue.</p>
        <p className="broken-subtitle" style={{ fontSize: '1.2rem', color: '#ef4444' }}>-50 XP (Mode Hardcore)</p>
      </div>
    </div>
  );
};
