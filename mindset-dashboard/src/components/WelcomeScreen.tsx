import React, { useState } from 'react';
import { Brain, ArrowRight } from 'lucide-react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  onComplete: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onComplete }) => {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const aiName = localStorage.getItem('mindset_ai_name') || 'MINDORA OS';
  const userName = localStorage.getItem('mindset_user_name');

  const welcomeMessage = userName 
    ? `Bonjour ${userName}. Qu'est-ce qu'on accomplit aujourd'hui ?`
    : `"Initialisation des protocoles. Prêt à forger une discipline d'acier ?"`;

  const handleStart = () => {
    setIsFadingOut(true);
    setTimeout(() => {
      onComplete();
    }, 700);
  };

  return (
    <div className={`welcome-screen-container ${isFadingOut ? 'fade-out' : ''}`}>
      <div className="welcome-glow"></div>
      <div className="welcome-glow-secondary"></div>
      
      <div className="welcome-content glass-panel">
        <div className="ai-welcome-avatar pulse">
          <Brain size={48} color="#fff" />
        </div>
        <h2 className="ai-name-label">{aiName}</h2>
        <h1 className="welcome-message">
          {welcomeMessage}
        </h1>
        <p className="welcome-subtext">
          Une interface neuronale pour traquer tes objectifs, automatiser tes habitudes et maximiser ton potentiel quotidien.
        </p>
        
        <button className="welcome-btn" onClick={handleStart}>
          Activer le Système <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
};
