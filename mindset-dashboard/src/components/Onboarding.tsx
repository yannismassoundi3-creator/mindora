import React, { useState, useEffect } from 'react';
import { ArrowRight, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import './Onboarding.css';

interface OnboardingProps {
  onComplete: () => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Réponses utilisateur (simulation)
  const [answers, setAnswers] = useState({
    job: '',
    consistency: '',
    goal: '',
    aiName: ''
  });
  const [tempAiName, setTempAiName] = useState('');

  const nextStep = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setStep(s => s + 1);
      setIsAnimating(false);
    }, 400); // Temps de la transition CSS
  };

  const handleAnswer = (key: string, value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    nextStep();
  };

  // Autoplay la génération finale
  useEffect(() => {
    if (step === 5) { // Étape de chargement/génération
      const timer = setTimeout(() => {
        setStep(6);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const handleComplete = () => {
    localStorage.setItem('mindset_ai_name', answers.aiName || 'Coach IA');
    onComplete();
  };

  return (
    <div className="onboarding-container">
      {/* Background IA Glow */}
      <div className="ai-bg-glow"></div>

      <div className={`onboarding-content ${isAnimating ? 'fade-out' : 'fade-in'}`}>
        
        {step === 0 && (
          <div className="step-card">
            <div className="ai-avatar-large">
              <Sparkles size={32} color="#fff" />
            </div>
            <h1 className="onboarding-title">Salut. Je suis ton Coach IA.</h1>
            <p className="onboarding-subtitle">Je vais t'aider à reprogrammer ton esprit pour atteindre l'excellence. Commençons par faire connaissance.</p>
            <button className="btn-primary onboarding-btn" onClick={nextStep}>
              C'est parti <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="step-card">
            <h2 className="question-title">Que fais-tu dans la vie ?</h2>
            <div className="options-grid">
              <button className="glass-panel option-btn" onClick={() => handleAnswer('job', 'Entrepreneur')}>Entrepreneur</button>
              <button className="glass-panel option-btn" onClick={() => handleAnswer('job', 'Étudiant')}>Étudiant</button>
              <button className="glass-panel option-btn" onClick={() => handleAnswer('job', 'Salarié')}>Salarié</button>
              <button className="glass-panel option-btn" onClick={() => handleAnswer('job', 'Freelance')}>Freelance / Créateur</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="step-card">
            <h2 className="question-title">Es-tu quelqu'un de constant dans tes projets ?</h2>
            <div className="options-list">
              <button className="glass-panel option-btn" onClick={() => handleAnswer('consistency', 'high')}>
                <strong>Oui, très discipliné</strong>
                <span>Je n'abandonne jamais ce que je commence.</span>
              </button>
              <button className="glass-panel option-btn" onClick={() => handleAnswer('consistency', 'medium')}>
                <strong>En dents de scie</strong>
                <span>J'ai des périodes de forte motivation, puis je relâche.</span>
              </button>
              <button className="glass-panel option-btn" onClick={() => handleAnswer('consistency', 'low')}>
                <strong>J'ai du mal à finir</strong>
                <span>Je suis souvent dispersé et j'abandonne vite.</span>
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="step-card">
            <h2 className="question-title">Quel est ton objectif numéro 1 ici ?</h2>
            <div className="options-grid">
              <button className="glass-panel option-btn" onClick={() => handleAnswer('goal', 'business')}>Exploser mon Business</button>
              <button className="glass-panel option-btn" onClick={() => handleAnswer('goal', 'discipline')}>Discipline de fer</button>
              <button className="glass-panel option-btn" onClick={() => handleAnswer('goal', 'health')}>Santé & Énergie</button>
              <button className="glass-panel option-btn" onClick={() => handleAnswer('goal', 'mental')}>Santé Mentale</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="step-card">
            <h2 className="question-title">Comment veux-tu m'appeler ?</h2>
            <p className="onboarding-subtitle" style={{marginBottom: '20px'}}>Donne-moi un prénom. (ex: Athena, Jarvis, Coach...)</p>
            <input 
              type="text" 
              className="routine-edit-input" 
              style={{width: '100%', padding: '16px', fontSize: '1.2rem', marginBottom: '24px'}}
              placeholder="Nom de l'IA..."
              value={tempAiName}
              onChange={(e) => setTempAiName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tempAiName.trim()) {
                  handleAnswer('aiName', tempAiName.trim());
                }
              }}
              autoFocus
            />
            <button className="btn-primary onboarding-btn" onClick={() => handleAnswer('aiName', tempAiName.trim() || 'Coach IA')}>
              Valider ce nom
            </button>
          </div>
        )}

        {step === 5 && (
          <div className="step-card center-all">
            <Loader2 size={48} className="spinner" color="var(--accent-purple)" />
            <h2 className="loading-title">Analyse en cours...</h2>
            <p className="onboarding-subtitle">Je génère ton programme personnalisé en fonction de ton profil.</p>
            <div className="loading-bar-container">
              <div className="loading-bar"></div>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="step-card success-card">
            <div className="success-icon-large">
              <CheckCircle2 size={40} color="#fff" />
            </div>
            <h2 className="onboarding-title">Ton plan est prêt.</h2>
            <p className="onboarding-subtitle">J'ai construit un programme sur-mesure pour t'aider à atteindre tes objectifs de {answers.goal === 'business' ? 'business' : 'discipline'}. On commence tout de suite sur ton Dashboard.</p>
            <button className="btn-primary onboarding-btn glow" onClick={handleComplete}>
              Accéder à mon Dashboard <ArrowRight size={18} />
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
