import React, { useEffect, useMemo } from 'react';
import './VictoryGlitchOverlay.css';
import { playGlitchSound } from '../utils/sounds';

interface VictoryGlitchOverlayProps {
  onClose: () => void;
}

export const VictoryGlitchOverlay: React.FC<VictoryGlitchOverlayProps> = ({ onClose }) => {
  useEffect(() => {
    playGlitchSound();
    
    document.body.classList.add('cyber-glitch-active');
    
    const t = setTimeout(() => {
      document.body.classList.remove('cyber-glitch-active');
      onClose();
    }, 500);

    return () => {
      clearTimeout(t);
      document.body.classList.remove('cyber-glitch-active');
    };
  }, [onClose]);

  // Generate random lines only once per mount
  const lines = useMemo(() => {
    return [...Array(25)].map((_, i) => ({
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      width: `${Math.random() * 150 + 30}px`,
      delay: `${Math.random() * 0.2}s`
    }));
  }, []);

  return (
    <div className="cyber-glitch-container">
      {/* Concentric shockwaves */}
      <div className="cyber-shockwave"></div>
      <div className="cyber-shockwave delay-1"></div>
      <div className="cyber-shockwave delay-2"></div>
      
      {/* Random glowing horizontal lines */}
      <div className="glitch-lines">
        {lines.map((style, i) => (
          <div key={i} className="glitch-line" style={{
            top: style.top,
            left: style.left,
            width: style.width,
            animationDelay: style.delay
          }}></div>
        ))}
      </div>
    </div>
  );
};
