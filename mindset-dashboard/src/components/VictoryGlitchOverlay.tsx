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
    }, 500);

    return () => {
      clearTimeout(t);
      document.body.classList.remove('global-glitch-active');
    };
  }, [onClose]);

  return (
    <svg style={{ position: 'fixed', width: 0, height: 0, pointerEvents: 'none', zIndex: -1 }}>
      <filter id="svg-macro-glitch">
        {/* Gnre un bruit trs grand (basses frquences) */}
        <feTurbulence type="fractalNoise" baseFrequency="0.015 0.02" numOctaves="1" result="noise" />
        
        {/* Transforme le bruit fluide en blocs carrs / paliers (macro-blocking) */}
        <feComponentTransfer in="noise" result="steppedNoise">
           <feFuncR type="discrete" tableValues="0 0.3 0.6 0.9 1" />
           <feFuncG type="discrete" tableValues="0 0.3 0.6 0.9 1" />
        </feComponentTransfer>
        
        {/* Dcale l'image violemment en utilisant ces gros blocs */}
        <feDisplacementMap in="SourceGraphic" in2="steppedNoise" scale="250" xChannelSelector="R" yChannelSelector="G" result="displaced" />
        
        {/* Applique une corruption de couleur style JPEG/MP4 cass */}
        <feColorMatrix in="displaced" type="matrix" values="
          1.5 0   0   0 -0.2
          0   0.5 0.8 0 -0.1
          0.2 0   1.2 0 -0.1
          0   0   0   1  0" />
      </filter>
    </svg>
  );
};
