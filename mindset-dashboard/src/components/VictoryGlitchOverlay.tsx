import React, { useEffect, useState } from 'react';
import './VictoryGlitchOverlay.css';
import { playGlitchSound, vibrate } from '../utils/sounds';

interface VictoryGlitchOverlayProps {
  onClose: () => void;
}

export const VictoryGlitchOverlay: React.FC<VictoryGlitchOverlayProps> = ({ onClose }) => {
  const [stage, setStage] = useState<'initial' | 'glitch' | 'reveal' | 'fade'>('initial');

  useEffect(() => {
    // 1. Initial shock & shatter
    playGlitchSound();
    
    setStage('glitch');
    
    // 2. Heavy glitch phase
    const t1 = setTimeout(() => {
      setStage('reveal');
      vibrate([50, 50, 50]);
    }, 1200);

    // 3. Auto-close after reveal
    const t2 = setTimeout(() => {
      setStage('fade');
    }, 4500);

    const t3 = setTimeout(() => {
      onClose();
    }, 5000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onClose]);

  return (
    <div className={`victory-glitch-container stage-${stage}`}>
      {/* Background interference */}
      <div className="glitch-bg"></div>
      
      {/* Scanlines */}
      <div className="scanlines"></div>

      {/* Main text container */}
      <div className="glitch-text-wrapper">
        <h1 
          className="glitch-text main-title" 
          data-text="100% ATTEINT"
        >
          100% ATTEINT
        </h1>
        
        {stage === 'reveal' && (
          <div className="glitch-subtitle fade-in-up">
            <span className="subtitle-word">SYSTEME</span>
            <span className="subtitle-word">PIRATÉ.</span>
            <span className="subtitle-word">BRAVO</span>
            <span className="subtitle-word highlight">CHAMPION.</span>
          </div>
        )}
      </div>

      <div className="digital-noise"></div>
    </div>
  );
};
