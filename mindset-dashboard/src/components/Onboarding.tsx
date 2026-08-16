import React, { useState, useEffect } from 'react';
import { ArrowRight, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import './Onboarding.css';
import { api, CLE_PROFIL_EN_ATTENTE } from '../services/api';

interface OnboardingProps {
  onComplete: () => void;
}

/**
 * L'écran de chargement final, celui qui envoie le profil.
 *
 * Nommé plutôt que codé en dur : il était écrit « 5 » à un endroit et le nombre
 * d'étapes ailleurs, si bien qu'insérer une question au milieu envoyait le profil
 * avant qu'elle ait été posée — sans que rien n'ait l'air cassé.
 */
const ETAPE_ENREGISTREMENT = 8;

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Réponses envoyées au serveur à la dernière étape, et relues par le coach ensuite.
  //
  // Les trois premières ne suffisaient pas : quatre métiers, trois constances, quatre
  // objectifs, soit quarante-huit profils possibles pour toute la base. Le coach ne
  // pouvait pas écrire un plan qui ressemble à quelqu'un, et retombait sur l'exemple
  // de son prompt — tout le monde recevait le même programme. D'où le temps réellement
  // disponible (qui borne le volume), le point de départ (qui décide de la difficulté)
  // et un champ libre, seul endroit du parcours où l'on peut dire ce qu'aucun bouton
  // ne prévoyait.
  const [answers, setAnswers] = useState({
    job: '',
    consistency: '',
    goal: '',
    minutesParJour: 0,
    niveau: '',
    situation: '',
    aiName: ''
  });
  const [tempAiName, setTempAiName] = useState('');
  const [tempSituation, setTempSituation] = useState('');

  const nextStep = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setStep(s => s + 1);
      setIsAnimating(false);
    }, 400); // Temps de la transition CSS
  };

  const handleAnswer = (key: string, value: string | number) => {
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
    if (step !== ETAPE_ENREGISTREMENT) return;

    let annule = false;

    const enregistrer = async () => {
      const debut = Date.now();
      const reponses = {
        job: answers.job,
        consistency: answers.consistency,
        goal: answers.goal,
        minutesParJour: answers.minutesParJour,
        niveau: answers.niveau,
        situation: answers.situation,
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

      /*
        Le questionnaire se termine dans la conversation, pas sur le tableau de bord.

        Mesuré le 16 août 2026 : sur 25 comptes ayant fait quelque chose dans l'app,
        5 seulement avaient jamais écrit au coach. Or le coach est la seule chose que
        l'abonnement fait payer — personne n'achète ce qu'il n'a pas essayé, et le
        taux d'abonnés ne peut pas dépasser celui des gens qui l'ont vu fonctionner.

        La cause était dans l'enchaînement : on posait six questions, puis on déposait
        la personne devant un tableau de bord vide, avec un bouton parmi d'autres pour
        aller parler. Elle venait de raconter sa vie à quelqu'un qui ne lui a jamais
        répondu. Le premier message part donc tout seul, et c'est le coach qui rend le
        plan — ce que le parcours promettait depuis le début.

        Il est écrit à la première personne parce qu'il est envoyé en son nom, et il
        nomme routines, habitudes et objectifs parce que c'est ce vocabulaire qui fait
        joindre le schéma du plan côté serveur (`MOTS_PLAN`).
      */
      localStorage.setItem(
        'mindset_pending_chat_msg',
        "Je viens de terminer mon inscription. Donne-moi mon plan pour aujourd'hui : mes routines, mes habitudes et mes objectifs.",
      );

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

        {/* Le temps réel, pas le temps rêvé : c'est lui qui borne le volume du plan.
            Sans cette réponse, le coach prescrivait une heure et demie à des gens qui
            en avaient vingt minutes, et le plan était abandonné le premier jour. */}
        {step === 4 && (
          <div className="step-card">
            <h2 className="question-title">Combien de temps par jour, vraiment ?</h2>
            <p className="onboarding-subtitle" style={{marginBottom: '20px'}}>Réponds honnêtement. Je construirai ton plan autour de ce chiffre, pas autour de celui que tu aimerais.</p>
            <div className="options-grid">
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('minutesParJour', 15)}>15 min</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('minutesParJour', 30)}>30 min</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('minutesParJour', 60)}>1 heure</button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('minutesParJour', 120)}>2 heures ou plus</button>
            </div>
          </div>
        )}

        {/* Le point de départ décide de la difficulté. Se tromper de niveau est la
            façon la plus rapide de perdre quelqu'un : trop dur, il échoue et s'en veut ;
            trop facile, il s'ennuie et part. */}
        {step === 5 && (
          <div className="step-card">
            <h2 className="question-title">Où en es-tu physiquement ?</h2>
            <div className="options-list">
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('niveau', 'sedentaire')}>
                <strong>Sédentaire</strong>
                <span>Je ne fais aucun sport en ce moment.</span>
              </button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('niveau', 'reprise')}>
                <strong>En reprise</strong>
                <span>J'en ai fait, j'ai arrêté, je m'y remets.</span>
              </button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('niveau', 'regulier')}>
                <strong>Irrégulier</strong>
                <span>J'en fais, mais sans rythme fixe.</span>
              </button>
              <button className="glass-panel option-btn" disabled={isAnimating} onClick={() => handleAnswer('niveau', 'confirme')}>
                <strong>Confirmé</strong>
                <span>Je m'entraîne sérieusement et régulièrement.</span>
              </button>
            </div>
          </div>
        )}

        {/* La seule question ouverte du parcours, et de loin la plus utile : c'est le
            seul endroit où quelqu'un peut dire ce qu'aucun bouton ne prévoyait. Elle
            est explicitement facultative — la rendre obligatoire ferait écrire
            n'importe quoi à ceux qui n'ont rien à dire, et le coach lirait ce bruit
            à chaque message. */}
        {step === 6 && (
          <div className="step-card">
            <h2 className="question-title">Ce que je dois absolument savoir ?</h2>
            <p className="onboarding-subtitle" style={{marginBottom: '20px'}}>Une blessure, des horaires impossibles, pas de salle, un enfant, une échéance. En une phrase — c'est ce qui fera que ton plan est le tien.</p>
            <textarea
              className="routine-edit-input"
              style={{width: '100%', padding: '16px', fontSize: '1rem', marginBottom: '20px', minHeight: '110px', resize: 'none'}}
              placeholder="Ex : genou fragile, je bosse en 3x8, pas de matériel chez moi..."
              maxLength={600}
              value={tempSituation}
              onChange={(e) => setTempSituation(e.target.value)}
              autoFocus
            />
            <button className="btn-primary onboarding-btn" disabled={isAnimating} onClick={() => handleAnswer('situation', tempSituation.trim())}>
              {tempSituation.trim() ? 'Continuer' : 'Rien de particulier'} <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 7 && (
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

        {step === ETAPE_ENREGISTREMENT && (
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
