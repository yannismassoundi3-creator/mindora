import React, { useEffect } from 'react';
import './VictoryGlitchOverlay.css';
import { playGlitchSound } from '../utils/sounds';

interface VictoryGlitchOverlayProps {
  onClose: () => void;
}

export const VictoryGlitchOverlay: React.FC<VictoryGlitchOverlayProps> = ({ onClose }) => {
  useEffect(() => {
    playGlitchSound();
    
    // Appliquer le glitch sur TOUT le corps du document
    document.body.classList.add('global-glitch-active');
    
    const t = setTimeout(() => {
      document.body.classList.remove('global-glitch-active');
      onClose();
    }, 4500);

    return () => {
      clearTimeout(t);
      document.body.classList.remove('global-glitch-active');
    };
  }, [onClose]);

  return (
    <svg style={{ position: 'fixed', width: 0, height: 0, pointerEvents: 'none', zIndex: -1 }}>
      {/* Glitch 1: Grosse distorsion horizontale + sparation RVB */}
      <filter id="svg-glitch-1">
        <feTurbulence type="fractalNoise" baseFrequency="0.001 0.4" numOctaves="1" result="warp" />
        <feDisplacementMap in="SourceGraphic" in2="warp" scale="80" xChannelSelector="R" yChannelSelector="G" result="displaced" />
        
        <feColorMatrix in="displaced" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
        <feOffset in="red" dx="15" dy="0" result="red-offset" />
        
        <feColorMatrix in="displaced" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cyan" />
        <feOffset in="cyan" dx="-15" dy="0" result="cyan-offset" />
        
        <feBlend mode="screen" in="red-offset" in2="cyan-offset" />
      </filter>

      {/* Glitch 2: Bruit haute frquence, dcalage brutal */}
      <filter id="svg-glitch-2">
        <feTurbulence type="fractalNoise" baseFrequency="0.01 0.1" numOctaves="2" result="warp" />
        <feDisplacementMap in="SourceGraphic" in2="warp" scale="30" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
};
