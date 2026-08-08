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
        {/* 1. Dformation "Espace-Temps" en carrs */}
        <feTurbulence type="fractalNoise" baseFrequency="0.02 0.02" numOctaves="1" result="blocks" />
        <feComponentTransfer in="blocks" result="steppedBlocks">
          <feFuncR type="discrete" tableValues="0 0.5 1" />
          <feFuncG type="discrete" tableValues="0 0.5 1" />
        </feComponentTransfer>
        <feDisplacementMap in="SourceGraphic" in2="steppedBlocks" scale="80" xChannelSelector="R" yChannelSelector="G" result="square-displaced" />

        {/* 2. Bandes Horizontales Coupe (Style VHS / Image envoy) */}
        <feTurbulence type="fractalNoise" baseFrequency="0.001 0.15" numOctaves="1" result="strips" />
        <feComponentTransfer in="strips" result="steppedStrips">
          <feFuncR type="discrete" tableValues="0 0.3 0.7 1" />
        </feComponentTransfer>
        <feDisplacementMap in="square-displaced" in2="steppedStrips" scale="200" xChannelSelector="R" yChannelSelector="R" result="final-displaced" />

        {/* 3. Sparation RVB massive (Rouge/Cyan) */}
        <feColorMatrix in="final-displaced" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
        <feOffset in="red" dx="-40" dy="0" result="red-shifted" />

        <feColorMatrix in="final-displaced" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cyan" />
        <feOffset in="cyan" dx="40" dy="0" result="cyan-shifted" />

        <feBlend mode="screen" in="red-shifted" in2="cyan-shifted" result="rgb-split" />
      </filter>
    </svg>
  );
};
