import React, { useState, useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { playClickSound, playBloopSound } from '../utils/sounds';

export const AiExplanationModal: React.FC = () => {
  const [pendingAiExplanation, setPendingAiExplanation] = useState<string | null>(null);
  const [aiName, setAiName] = useState(() => localStorage.getItem('mindset_ai_name') || 'Faywa');

  useEffect(() => {
    // Check periodically for the trigger flag
    const checkExplanation = () => {
      const shouldTrigger = localStorage.getItem('mindset_trigger_explanation');
      if (shouldTrigger && shouldTrigger !== 'false') {
        const type = shouldTrigger;
        // Check if there is a specific explanation, otherwise fallback to the general one
        const specificKey = `mindset_pending_${type}_explanation`;
        let explanation = localStorage.getItem(specificKey);
        
        if (!explanation) {
          // Fallback if the AI didn't provide a specific one
          explanation = localStorage.getItem('mindset_pending_ai_explanation');
        }

        if (explanation) {
          setPendingAiExplanation(explanation);
          // Clean up so it doesn't trigger again
          localStorage.removeItem('mindset_trigger_explanation');
          localStorage.removeItem(specificKey);
          if (specificKey !== 'mindset_pending_ai_explanation') {
            localStorage.removeItem('mindset_pending_ai_explanation');
          }
          playBloopSound();
        } else {
          // If no explanation exists, clear the trigger
          localStorage.removeItem('mindset_trigger_explanation');
        }
      }
      const savedName = localStorage.getItem('mindset_ai_name');
      if (savedName && savedName !== aiName) {
        setAiName(savedName);
      }
    };

    checkExplanation();
    window.addEventListener('storage', checkExplanation);
    
    // Also set an interval to check frequently in case event is missed during transitions
    const interval = setInterval(checkExplanation, 1000);
    
    return () => {
      window.removeEventListener('storage', checkExplanation);
      clearInterval(interval);
    };
  }, [aiName]);

  const closeAiExplanation = () => {
    playClickSound();
    setPendingAiExplanation(null);
  };

  if (!pendingAiExplanation) return null;

  return (
    <div className="ai-explanation-modal-overlay fade-in" onClick={closeAiExplanation}>
      <div className="ai-explanation-modal scale-in" onClick={e => e.stopPropagation()}>
        <div className="ai-explanation-header">
          <div className="ai-avatar pulse-glow liquid-glass-orb"><Sparkles size={24} color="#fff" /></div>
          <h3>{aiName}</h3>
          <button className="close-btn" onClick={closeAiExplanation}><X size={20} /></button>
        </div>
        <div className="ai-explanation-body">
          <p>{pendingAiExplanation}</p>
        </div>
      </div>
    </div>
  );
};
