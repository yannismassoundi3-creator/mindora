import React, { useState } from 'react';
import { Brain, ArrowRight } from 'lucide-react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  onComplete: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onComplete }) => {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const aiName = localStorage.getItem('mindset_ai_name') || 'DISCIPLIX OS';
  const userName = localStorage.getItem('mindset_user_name');

  /*
    L'écran d'accueil doit dire la même chose que la page publique, sinon la
    promesse qui a fait cliquer se perd entre les deux. Pour quelqu'un qui arrive
    sans compte, c'est donc le slogan lui-même ; pour quelqu'un qu'on connaît,
    c'est la question qui ouvre sa journée.
  */
  const welcomeMessage = userName
    ? `Bonjour ${userName}. Qu'est-ce qu'on accomplit aujourd'hui ?`
    : `Deviens la personne que tu prétends vouloir être.`;

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
        {/*
          « Une interface neuronale pour […] maximiser ton potentiel quotidien »
          ne décrivait rien de ce que fait l'application, et employait un mot qui
          ne veut rien dire. À la place, la boucle : c'est elle qu'il faut avoir
          comprise avant de créer un compte, et c'est la même phrase que sur la
          page publique et dans la carte des premiers pas.
        */}
        <p className="welcome-subtext">
          Tu dis qui tu veux devenir, {aiName} te donne quoi faire aujourd'hui, tu le fais.
          Demain, on recommence — et c'est la répétition qui te change.
        </p>
        
        <button className="welcome-btn" onClick={handleStart}>
          Activer le Système <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
};
