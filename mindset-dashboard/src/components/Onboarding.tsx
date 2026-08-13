import React, { useState, useEffect } from 'react';
import { ArrowRight, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import './Onboarding.css';
import { api, CLE_PROFIL_EN_ATTENTE } from '../services/api';

interface OnboardingProps {
  onComplete: () => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Réponses envoyées au serveur à la dernière étape, et relues par le coach ensuite.
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
    if (isAnimating) return; // Prevent double click
    setAnswers(prev => ({ ...prev, [key]: value }));
    nextStep();
  };

  // L'écran final annonçait « Je génère ton programme personnalisé » puis attendait
  // trois secondes avant de passer à la suite. Rien n'était envoyé : le métier, la
  // constance et l'objectif étaient collectés puis perdus à la fermeture du composant.
  // Le coach possède pourtant tout un mécanisme pour relire ce profil à chaque message
  // et respecter ce qui lui a été déclaré — il lisait une table que personne ne
  // remplissait jamais.
  useEffect(() => {
    if (step !== 5) return;

    let annule = false;

    const enregistrer = async () => {
      const debut = Date.now();
      const reponses = {
        job: answers.job,
        consistency: answers.consistency,
        goal: answers.goal,
      };
      try {
        await api.post('/ai-coaching/onboarding', reponses);
        localStorage.removeItem(CLE_PROFIL_EN_ATTENTE);
      } catch (e) {
        // Un profil non enregistré dégrade le coaching, il ne doit pas interdire
        // l'entrée dans l'application : la personne vient de créer son compte.
        //
        // Mais l'échec était purement et simplement avalé, et c'est ce qui coûtait
        // cher : le serveur est seul juge de « a-t-on déjà posé les questions », et
        // il répond d'après la table des profils. Une seule requête ratée — un jeton
        // expiré, un réseau qui saute — et le questionnaire revenait à chaque
        // connexion, indéfiniment, sans que rien n'ait l'air cassé.
        //
        // Les réponses sont donc gardées ici, et renvoyées au prochain démarrage.
        // On ne redemande à quelqu'un que ce qu'on n'a vraiment pas.
        console.error('Profil non enregistré, réponses conservées pour un nouvel essai', e);
        localStorage.setItem(CLE_PROFIL_EN_ATTENTE, JSON.stringify(reponses));
      }

      // Durée plancher de l'écran de chargement : sans elle, une réponse rapide le
      // fait disparaître avant d'avoir été lu, et l'attente réelle donne l'impression
      // que l'application est bloquée.
      const restant = 1800 - (Date.now() - debut);
      if (restant > 0) await new Promise((r) => setTimeout(r, restant));

      if (annule) return;
      localStorage.setItem('mindset_ai_name', answers.aiName || 'Coach IA');
      onComplete();
    };

    enregistrer();
    return () => {
      annule = true;
    };
  }, [step, answers, onComplete]);

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
            <p className="onboarding-subtitle">Je vais t'aider à forger ta discipline pour atteindre l'excellence. Commençons par faire connaissance.</p>
            <button className="btn-primary onboarding-btn" disabled={isAnimating} onClick={nextStep}>
              C'est parti <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="step-card">
            <h2 className="question-title">Que fais-tu dans la vie ?</h2>
            <div className="options-grid">
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('job', 'Entrepreneur')}>Entrepreneur</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('job', 'Étudiant')}>Étudiant</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('job', 'Salarié')}>Salarié</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('job', 'Freelance')}>Freelance / Créateur</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="step-card">
            <h2 className="question-title">Es-tu quelqu'un de constant dans tes projets ?</h2>
            <div className="options-list">
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('consistency', 'high')}>
                <strong>Oui, très discipliné</strong>
                <span>Je n'abandonne jamais ce que je commence.</span>
              </button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('consistency', 'medium')}>
                <strong>En dents de scie</strong>
                <span>J'ai des périodes de forte motivation, puis je relâche.</span>
              </button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('consistency', 'low')}>
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
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('goal', 'business')}>Exploser mon Business</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('goal', 'discipline')}>Discipline de fer</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('goal', 'health')}>Santé & Énergie</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('goal', 'mental')}>Santé Mentale</button>
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
                if (e.key === 'Enter' && tempAiName.trim() && !isAnimating) {
                  handleAnswer('aiName', tempAiName.trim());
                }
              }}
              autoFocus
            />
            <button className="btn-primary onboarding-btn" disabled={isAnimating} onClick={() => handleAnswer('aiName', tempAiName.trim() || 'Coach IA')}>
              Valider ce nom
            </button>
          </div>
        )}

        {step === 5 && (
          <div className="step-card center-all">
            <Loader2 size={48} className="spinner" color="var(--accent-purple)" />
            <h2 className="loading-title">Analyse en cours...</h2>
            {/* Annonçait « Je génère ton programme personnalisé » alors qu'aucun
                programme n'était produit — ni ici, ni sur le serveur. On décrit ce
                qui se passe vraiment : le profil part au coach. */}
            <p className="onboarding-subtitle">J'enregistre ton profil. Je saurai qui tu es dès notre premier échange.</p>
            <div className="loading-bar-container">
              <div className="loading-bar"></div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
