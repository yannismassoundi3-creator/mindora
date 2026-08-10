import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Sparkles, Play, Square, Loader } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { playBloopSound, playErrorSound } from '../utils/sounds';
import { AI_COSMETICS } from '../utils/cosmetics';
import './AIChat.css';
import { api } from '../services/api';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
}

export const AIChat: React.FC = () => {
  const aiName = localStorage.getItem('mindset_ai_name') || 'FAYWA';

  const [messages, setMessages] = useState<Message[]>(() => {
    const defaultMessage = {
      id: 1,
      text: `Bonjour, je suis ${aiName}. Comment je peux t'aider aujourd'hui ?`,
      sender: 'ai' as const,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    const today = new Date().toLocaleDateString();
    const savedDate = localStorage.getItem('mindset_ai_chat_date');
    if (savedDate !== today) {
      localStorage.setItem('mindset_ai_chat_date', today);
      localStorage.removeItem('mindset_ai_chat_history');
      return [defaultMessage];
    }
    
    const savedHistory = localStorage.getItem('mindset_ai_chat_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    
    return [defaultMessage];
  });

  const cleanMessageText = (text: string) => {
    let cleaned = text;
    // Aggressive scrubbing to remove any leaked JSON or code blocks
    cleaned = cleaned.replace(/```json\s*\{[\s\S]*?\}\s*```/ig, '');
    cleaned = cleaned.replace(/```\s*\{[\s\S]*?\}\s*```/g, (match) => {
      if (match.includes('"newHabits"') || match.includes('"newRoutines"') || match.includes('"replace')) return '';
      return match;
    });
    // Match any block starting with { and containing our keywords, up to the last }
    cleaned = cleaned.replace(/\{[\s\S]*?"(newHabits|newRoutines|newNutrition|newObjectives|newMacroObjectives|replaceRoutines|replaceHabits)"[\s\S]*?\}/g, '');
    
    cleaned = cleaned.replace(/Voici le.*?JSON.*?:/ig, '').trim();
    cleaned = cleaned.replace(/Voici .*?plan.*?:/ig, '').trim();
    return cleaned;
  };

  useEffect(() => {
    // Fetch persistent history from backend
    api.get('/ai-coaching/history').then((data: any) => {
      if (Array.isArray(data) && data.length > 0) {
        const cleanedData = data.map((m: any) => ({
          ...m,
          text: cleanMessageText(m.text)
        }));
        setMessages(cleanedData);
      }
    }).catch(e => console.error("Could not fetch persistent chat history", e));
  }, []);

  useEffect(() => {
    localStorage.setItem('mindset_ai_chat_history', JSON.stringify(messages));
  }, [messages]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isAiAwake, setIsAiAwake] = useState(true);
  const [isPlayingAudio, setIsPlayingAudio] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayVoice = async (messageId: number, text: string) => {
    if (isPlayingAudio === messageId && audioRef.current) {
      audioRef.current.pause();
      setIsPlayingAudio(null);
      return;
    }

    setIsPlayingAudio(messageId);
    
    try {
      // Nettoyer le markdown pour la voix
      const cleanText = text.replace(/[*_#`]/g, '').trim();
      const response = await api.post('/ai-coaching/tts', { text: cleanText });
      
      if (response && response.audioBase64) {
        const audioUrl = `data:audio/mp3;base64,${response.audioBase64}`;
        
        if (audioRef.current) {
          audioRef.current.pause();
        }
        
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        
        audio.onended = () => setIsPlayingAudio(null);
        audio.play();
      } else {
        setIsPlayingAudio(null);
      }
    } catch (error) {
      console.error("Erreur de génération vocale:", error);
      setIsPlayingAudio(null);
    }
  };

  const [equippedSkinId, setEquippedSkinId] = useState<string | null>(() => localStorage.getItem('mindset_ai_skin_id'));
  
  useEffect(() => {
    const handleStorage = () => {
      setEquippedSkinId(localStorage.getItem('mindset_ai_skin_id'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const equippedCosmetic = AI_COSMETICS.find(c => c.id === equippedSkinId);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isInitialMount = useRef(true);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      scrollToBottom('auto');
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
    } else {
      scrollToBottom('smooth');
    }
  }, [messages, isTyping]);

  useEffect(() => {
    const handlePendingMsg = (e?: any) => {
      const msg = e?.detail || localStorage.getItem('mindset_pending_chat_msg');
      if (msg) {
        localStorage.removeItem('mindset_pending_chat_msg');
        setTimeout(() => handleSend(undefined, msg), 500);
      }
    };
    
    window.addEventListener('mindset_pending_chat_msg', handlePendingMsg);
    handlePendingMsg(); // Check on mount
    
    return () => window.removeEventListener('mindset_pending_chat_msg', handlePendingMsg);
  }, []);

  const addAiNotification = (type: string, message: string) => {
    try {
      const notifs = JSON.parse(localStorage.getItem('mindset_ai_notifications') || '[]');
      notifs.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        type,
        message,
        timestamp: new Date().toISOString()
      });
      // Keep only last 50 notifications to prevent bloat
      if (notifs.length > 50) notifs.shift();
      localStorage.setItem('mindset_ai_notifications', JSON.stringify(notifs));
    } catch (e) {
      console.error(e);
    }
  };

  const applyPlanData = (rawPlanData: any) => {
    if (!rawPlanData) return;
    
    // Si l'IA a imbriqué les données dans un objet "plan" ou "actionPlan"
    const dataObj = rawPlanData.plan || rawPlanData.actionPlan || rawPlanData;
    let planData = { ...dataObj };

    if (planData.routineExplanation) {
      localStorage.setItem('mindset_pending_ai_explanation', planData.routineExplanation);
    }
    
    // Remplacement granulaire basé sur les nouveaux flags (pour éviter de tout supprimer par erreur)
    if (planData.replaceHabits === true) localStorage.setItem('mindset_habits', '[]');
    if (planData.replaceMicroObjectives === true) localStorage.setItem('mindset_micro_obj', '[]');
    if (planData.replaceMacroObjectives === true) localStorage.setItem('mindset_macro_obj', '[]');
    if (planData.replaceRoutines === true) {
      localStorage.setItem('mindset_routines', JSON.stringify([
        { id: 'morning', title: 'Routine Matinale', icon: 'sun', items: [] },
        { id: 'midday', title: 'Routine de Midi', icon: 'sun', items: [] },
        { id: 'evening', title: 'Routine du Soir', icon: 'moon', items: [] }
      ]));
    }
    if (planData.replaceNutrition === true) localStorage.setItem('mindset_nutrition', '[]');

    const habitsList = planData.newHabits || planData.habits;
    if (habitsList && Array.isArray(habitsList) && habitsList.length > 0) {
      let existingHabits: any[] = [];
      try {
        const parsed = JSON.parse(localStorage.getItem('mindset_habits') || '[]');
        existingHabits = Array.isArray(parsed) ? parsed : [];
      } catch {}
      
      const newEntries = habitsList.map((h: any) => {
        const colors = ['#3b82f6', '#ec4899', '#8b5cf6', '#10b981', '#fcd34d', '#ef4444'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        return {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: h.name || h.title || 'Nouvelle Habitude',
          icon: 'target',
          color: randomColor,
          xp: 0,
          level: 1,
          history: []
        };
      });
      localStorage.setItem('mindset_habits', JSON.stringify([...existingHabits, ...newEntries]));
      addAiNotification('habit', `✨ ${aiName} a ajouté de nouvelles habitudes stratégiques pour toi.`);
    }
    
    const routinesList = planData.newRoutines || planData.routines;
    if (routinesList && Array.isArray(routinesList) && routinesList.length > 0) {
      let existingRoutines: any[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem('mindset_routines') || '[]');
        existingRoutines = Array.isArray(saved) && saved.length > 0 ? saved : [
          { id: 'morning', title: 'Routine Matinale', icon: 'sun', items: [] },
          { id: 'midday', title: 'Routine de Midi', icon: 'sun', items: [] },
          { id: 'evening', title: 'Routine du Soir', icon: 'moon', items: [] }
        ];
      } catch {}
      
      routinesList.forEach((r: any) => {
        const typeMap: Record<string, string> = { 
          'MORNING': 'morning', 'MATIN': 'morning', 
          'MIDDAY': 'midday', 'MIDI': 'midday', 'APRÈS-MIDI': 'midday', 'AFTERNOON': 'midday',
          'EVENING': 'evening', 'SOIR': 'evening', 'SOIRÉE': 'evening' 
        };
        const rawType = (r.type || 'MORNING').toUpperCase();
        const mappedType = typeMap[rawType] || 'morning';
        
        let targetRoutine = existingRoutines.find((x: any) => x.id === mappedType);
        if (!targetRoutine) {
          targetRoutine = { id: mappedType, title: `Routine ${mappedType}`, icon: 'sun', items: [] };
          existingRoutines.push(targetRoutine);
        }
        
        if (r.tasks && Array.isArray(r.tasks)) {
          if (!targetRoutine.items) targetRoutine.items = [];
          r.tasks.forEach((t: any, idx: number) => {
            const taskTitle = t.title || t.name || t.description || t.task || t.tache || 'Nouvelle tâche';
            targetRoutine.items.push({
              id: Date.now() + Math.floor(Math.random() * 100000) + idx,
              title: taskTitle,
              time: `${t.duration || 15} min`,
              done: false
            } as never);
          });
        }
      });
      localStorage.setItem('mindset_routines', JSON.stringify(existingRoutines));
      addAiNotification('routine', `✨ ${aiName} a mis à jour tes routines pour t'aider à atteindre tes objectifs.`);
    }

    const nutritionList = planData.newNutrition || planData.nutrition;
    if (nutritionList && Array.isArray(nutritionList) && nutritionList.length > 0) {
      let existingNutrition: any[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem('mindset_nutrition') || '[]');
        existingNutrition = Array.isArray(saved) ? saved : [];
      } catch {}

      const newEntries = nutritionList.map((n: any, idx: number) => {
        const title = n.meal || n.title || 'Repas / Objectif';
        const details = n.details || n.description || 'À définir';
        return {
          id: Date.now() + Math.floor(Math.random() * 100000) + idx,
          title: title,
          details: details,
          done: false
        };
      });
      localStorage.setItem('mindset_nutrition', JSON.stringify([...existingNutrition, ...newEntries]));
      addAiNotification('nutrition', `🍏 ${aiName} a planifié ton alimentation.`);
    }
      
    const objectivesList = planData.newObjectives || planData.objectives || planData.microObjectives || planData.goals;
    if (objectivesList && Array.isArray(objectivesList) && objectivesList.length > 0) {
      let existingMicro: any[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem('mindset_micro_obj') || '[]');
        existingMicro = Array.isArray(saved) ? saved : [];
      } catch {}
      
      const newEntries = objectivesList.map((o: any, idx: number) => {
        const objTitle = o.title || o.name || o.description || o.objectif || o.objective || o.goal || 'Nouvel Objectif';
        return {
          id: Date.now() + Math.floor(Math.random() * 100000) + idx,
          title: objTitle,
          category: o.category || 'Mindset',
          progress: 0,
          total: 7,
          done: false
        };
      });
      localStorage.setItem('mindset_micro_obj', JSON.stringify([...existingMicro, ...newEntries]));
      addAiNotification('objective', `✨ ${aiName} a défini de nouveaux objectifs d'évolution pour toi.`);
    }

    const macroList = planData.newMacroObjectives || planData.macroObjectives || planData.vision;
    if (macroList && Array.isArray(macroList) && macroList.length > 0) {
      let existingMacro: any[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem('mindset_macro_obj') || '[]');
        existingMacro = Array.isArray(saved) ? saved : [];
      } catch {}
      
      const GRADIENTS = [
        'linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      ];
      const newMacros = macroList.map((m: any, idx: number) => {
        const mTitle = m.title || m.name || m.description || m.objectif || m.objective || m.goal || 'Nouvelle Vision';
        return {
          id: Date.now() + Math.floor(Math.random() * 100000) + idx,
          title: mTitle,
          category: m.category || 'Vision',
          deadline: m.deadline || m.date || 'Déc 2026',
          bgGradient: GRADIENTS[idx % GRADIENTS.length]
        };
      });
      localStorage.setItem('mindset_macro_obj', JSON.stringify([...existingMacro, ...newMacros]));
    }

      // Force API sync if needed
    window.dispatchEvent(new Event('storage'));
  };

  const handleSend = async (e?: React.FormEvent, directMessage?: string) => {
    if (e) e.preventDefault();
    
    if (!navigator.onLine) {
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: "📶 **Hors-Ligne**\nJe ne peux pas me connecter au réseau. Vérifiez votre connexion internet et réessayez.",
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      return;
    }

    const currentInput = directMessage || inputValue;
    if (!currentInput.trim()) return;

    playBloopSound();

    const newUserMsg: Message = {
      id: Date.now(),
      text: currentInput,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, newUserMsg]);
    if (!directMessage) setInputValue('');
    setIsTyping(true);

    try {
      const macroObj = localStorage.getItem('mindset_macro_obj') || '[]';
      const microObj = localStorage.getItem('mindset_micro_obj') || '[]';
      const coins = localStorage.getItem('mindset_points') || '0';
      const score = localStorage.getItem('mental_score') || '0';
      const routines = localStorage.getItem('mindset_routines') || '[]';
      const habits = localStorage.getItem('mindset_habits') || '[]';
      const nutrition = localStorage.getItem('mindset_nutrition') || '[]';
      const dailyScores = localStorage.getItem('mindset_daily_scores') || '{}';

      const userContext = {
        macroObjectives: JSON.parse(macroObj),
        microObjectives: JSON.parse(microObj),
        routines: JSON.parse(routines),
        habits: JSON.parse(habits),
        nutrition: JSON.parse(nutrition),
        dailyScores: JSON.parse(dailyScores),
        coins: parseInt(coins),
        mentalScore: parseInt(score),
        userName: localStorage.getItem('mindset_user_name') || 'Utilisateur',
        aiName: aiName,
      };

      // Système de Coins
      const currentPoints = parseInt(localStorage.getItem('mindset_points') || '0', 10);
      
      if (currentPoints < 10) {
        setIsTyping(false);
        playErrorSound();
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          text: "⚠️ **Énergie Insuffisante (Coins < 10)**\nMes systèmes requièrent de l'énergie pour fonctionner. Accomplissez vos habitudes et routines pour recharger mes circuits avant de pouvoir me consulter à nouveau.",
          sender: 'ai',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
        return;
      }

      const data = await api.post('/ai-coaching/chat', { 
        prompt: currentInput,
        context: userContext
      });

      // Déduction des Coins uniquement si le backend répond
      localStorage.setItem('mindset_points', (currentPoints - 10).toString());
      window.dispatchEvent(new Event('storage'));
      
      setIsAiAwake(true);

      let replyText = data.reply || "Erreur lors de la génération.";

      let jsonStr = "";
      
      const planMatch = replyText.match(/<PLAN>([\s\S]*?)<\/PLAN>/i);
      if (planMatch) {
        jsonStr = planMatch[1];
        replyText = replyText.replace(/<PLAN>[\s\S]*?<\/PLAN>/i, '').trim();
      } else {
        const codeBlockRegex = /```[a-zA-Z]*\s*([\s\S]*?)\s*```/g;
        
        replyText = replyText.replace(codeBlockRegex, (match, content) => {
          if (content.includes('newHabits') || content.includes('newRoutines') || content.includes('replaceNutrition') || content.includes('newNutrition') || content.includes('macroObjectives')) {
            if (!jsonStr) {
              const start = content.indexOf('{');
              const end = content.lastIndexOf('}');
              if (start !== -1 && end !== -1) {
                jsonStr = content.substring(start, end + 1);
              } else {
                jsonStr = "{" + content + "}";
              }
            }
            return '';
          }
          return match;
        });

        if (!jsonStr) {
          const firstBrace = replyText.indexOf('{');
          const lastBrace = replyText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const potentialJson = replyText.substring(firstBrace, lastBrace + 1);
            if (potentialJson.includes('newHabits') || potentialJson.includes('newRoutines') || potentialJson.includes('replaceNutrition')) {
              jsonStr = potentialJson;
              replyText = replyText.replace(potentialJson, '').trim();
            }
          }
        }
      }
      
      replyText = cleanMessageText(replyText);

      if (jsonStr) {
        try {
          // Nettoyage agressif pour rattraper un JSON mal formaté par l'IA
          jsonStr = jsonStr.trim();
          const firstBrace = jsonStr.indexOf('{');
          const lastBrace = jsonStr.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
          }
          
          const planData = JSON.parse(jsonStr);

          if (planData.planExplanation || planData.routineExplanation) {
            localStorage.setItem('mindset_pending_ai_explanation', planData.planExplanation || planData.routineExplanation);
          }
          
          const isCreation = 
            (planData.newHabits && planData.newHabits.length > 0) ||
            (planData.newRoutines && planData.newRoutines.length > 0) ||
            (planData.newNutrition && planData.newNutrition.length > 0) ||
            (planData.newMacroObjectives && planData.newMacroObjectives.length > 0) ||
            (planData.newObjectives && planData.newObjectives.length > 0) ||
            (planData.newMicroObjectives && planData.newMicroObjectives.length > 0);

          const isDeletion = 
            planData.replaceHabits || planData.replaceRoutines || planData.replaceNutrition || 
            planData.replaceMacroObjectives || planData.replaceMicroObjectives;

          if (isCreation || isDeletion) {
            applyPlanData(planData);
            if (isCreation) {
              replyText += "\n\n✅ **Plan appliqué avec succès ! L'interface a été mise à jour.**";
            } else if (isDeletion) {
              replyText += "\n\n🗑️ **Plan supprimé avec succès ! L'interface a été réinitialisée.**";
            }
          }
        } catch(e) {
          console.error("Failed to parse plan JSON", e);
        }
      }
      
      const aiResponse: Message = {
        id: Date.now() + 1,
        text: replyText,
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, aiResponse]);
    } catch (error: any) {
      console.error("AI Chat Error:", error);
      setIsAiAwake(false);
      const errorResponse: Message = {
        id: Date.now() + 1,
        text: `Désolé, je n'arrive pas à me connecter à mon cerveau externe (Erreur: ${error.message || 'Inconnue'}). S'il était inactif, patiente 50s et réessaie !`,
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsTyping(false);
    }
  };

  const startPlanWizard = () => {
    if (isTyping) return;
    handleSend(undefined, "Je souhaite générer un nouveau plan d'action complet (sport, business, habitudes). Pose-moi les questions nécessaires.");
  };

  return (
    <div className="chat-container">
      <header className="chat-header glass-panel">
        <div className="chat-header-info">
          <div className="ai-status-indicator">
            {equippedCosmetic?.type === 'icon' ? (
              <div className="status-icon-skin pulsing">{equippedCosmetic.value}</div>
            ) : (
              <div 
                className="status-dot pulsing liquid-glass-dot" 
                style={equippedCosmetic?.type === 'color' ? { background: equippedCosmetic.value } : {}}
              ></div>
            )}
          </div>
          <div>
            <h2 className="chat-title">{aiName}</h2>
            <p className="chat-subtitle">
              {isAiAwake ? "Connecté et prêt à t'assister" : "Déconnecté, réveil en cours..."}
            </p>
          </div>
        </div>
        <button 
          className="chat-action-btn" 
          onClick={startPlanWizard}
          disabled={isTyping}
          style={{ opacity: isTyping ? 0.5 : 1, cursor: isTyping ? 'not-allowed' : 'pointer' }}
        >
          <Sparkles size={18} />
          <span>Générer un plan</span>
        </button>
      </header>

      <div className="chat-messages-area">
        <div className="messages-list">
          {messages.map(msg => (
            <div key={msg.id} className={`message ${msg.sender}`}>
              {msg.sender === 'ai' && (
                <div className="message-avatar-orb-container">
                  {equippedCosmetic?.type === 'icon' ? (
                    <div className="status-icon-skin-large">{equippedCosmetic.value}</div>
                  ) : (
                    <div 
                      className="message-avatar-orb liquid-glass-orb" 
                      style={equippedCosmetic?.type === 'color' ? { background: equippedCosmetic.value } : {}}
                    ></div>
                  )}
                </div>
              )}
              <div className={`message-bubble ${msg.sender}`}>
                {msg.sender === 'ai' && (
                  <div className="message-ai-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="message-ai-name">{aiName}</div>
                    <button 
                      className="tts-play-btn" 
                      onClick={() => handlePlayVoice(msg.id, msg.text)}
                      title={isPlayingAudio === msg.id ? "Arrêter la voix" : "Écouter la voix de Jarvis"}
                    >
                      {isPlayingAudio === msg.id ? <Square size={12} /> : <Play size={12} />}
                    </button>
                  </div>
                )}
                <div className="message-content">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                <span className="message-time">{msg.timestamp}</span>
              </div>
              {msg.sender === 'user' && (
                <div className="message-avatar user">
                  <User size={20} />
                </div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="message ai">
              <div className="message-avatar-orb-container small">
                {equippedCosmetic?.type === 'icon' ? (
                  <div className="status-icon-skin-large small">{equippedCosmetic.value}</div>
                ) : (
                  <div 
                    className="message-avatar-orb small liquid-glass-orb" 
                    style={equippedCosmetic?.type === 'color' ? { background: equippedCosmetic.value } : {}}
                  ></div>
                )}
              </div>
              <div className="message-content typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="chat-input-area glass-panel">
        <form onSubmit={handleSend} className="chat-form">
          <input
            type="text"
            className="chat-input"
            placeholder="Pose-moi une question sur tes objectifs..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button type="submit" className="chat-send-btn" disabled={!inputValue.trim()}>
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
};
