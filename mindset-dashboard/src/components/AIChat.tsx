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
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      text: `Bonjour, je suis ${aiName}. Comment je peux t'aider aujourd'hui ?`,
      sender: 'ai',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isAiAwake, setIsAiAwake] = useState(true);
  const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<number | null>(null);

  const [equippedSkinId, setEquippedSkinId] = useState<string | null>(() => localStorage.getItem('mindset_ai_skin_id'));
  
  useEffect(() => {
    const handleStorage = () => {
      setEquippedSkinId(localStorage.getItem('mindset_ai_skin_id'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const equippedCosmetic = AI_COSMETICS.find(c => c.id === equippedSkinId);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const playTTS = async (msg: Message) => {
    if (playingAudioId === msg.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingAudioId(null);
      return;
    }
    
    setLoadingAudioId(msg.id);
    try {
      const textToSpeak = msg.text.replace(/[*#]/g, '');
      const data = await api.post('/ai-coaching/tts', { text: textToSpeak }); 
      if (data.audioBase64) {
        if (audioRef.current) {
           audioRef.current.pause();
        }
        const audio = new Audio(`data:audio/mp3;base64,${data.audioBase64}`);
        audio.onended = () => setPlayingAudioId(null);
        audioRef.current = audio;
        audio.play();
        setPlayingAudioId(msg.id);
      }
    } catch (e) {
      console.error('Failed to play TTS from backend, falling back to browser TTS', e);
      // Fallback: Browser native TTS
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Stop any ongoing speech
        const utterance = new SpeechSynthesisUtterance(msg.text.replace(/[*#]/g, ''));
        utterance.lang = 'fr-FR';
        utterance.rate = 1.0;
        
        utterance.onend = () => setPlayingAudioId(null);
        utterance.onerror = () => setPlayingAudioId(null);
        
        window.speechSynthesis.speak(utterance);
        setPlayingAudioId(msg.id);
      }
    } finally {
      setLoadingAudioId(null);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

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
    const planData = rawPlanData.plan || rawPlanData.actionPlan || rawPlanData;
    
    // REPLACE = effacer l'ancien (défaut), APPEND = garder l'ancien et rajouter
    const action = planData.action === 'APPEND' ? 'APPEND' : 'REPLACE';
    
    if (action === 'REPLACE') {
      localStorage.setItem('mindset_habits', '[]');
      localStorage.setItem('mindset_micro_obj', '[]');
      localStorage.setItem('mindset_macro_obj', '[]');
      localStorage.setItem('mindset_routines', JSON.stringify([
        { id: 'morning', title: 'Routine Matinale', icon: 'sun', items: [] },
        { id: 'midday', title: 'Routine de Midi', icon: 'sun', items: [] },
        { id: 'evening', title: 'Routine du Soir', icon: 'moon', items: [] }
      ]));
      localStorage.setItem('mindset_nutrition', '[]');
    }

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
      addAiNotification('objective', `🍏 ${aiName} a planifié ton alimentation.`);
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

  const handleSend = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const currentInput = customText || inputValue;
    if (!currentInput.trim()) return;

    playBloopSound();

    const newUserMsg: Message = {
      id: Date.now(),
      text: currentInput,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, newUserMsg]);
    if (!customText) setInputValue('');
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
        history: messages.slice(-4), // Prevent Payload Too Large by only sending recent context
        context: userContext
      });

      // Déduction des Coins uniquement si le backend répond
      localStorage.setItem('mindset_points', (currentPoints - 10).toString());
      window.dispatchEvent(new Event('storage'));
      
      setIsAiAwake(true);

      let replyText = data.reply || "Erreur lors de la génération.";

      // Try robust JSON extraction (with or without backticks)
      let jsonStr = "";
      const jsonMatch = replyText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
        // Remove the backticks block from the reply text
        replyText = replyText.replace(/```(?:json)?\s*[\s\S]*?\s*```/, '').trim();
      } else {
        // Fallback: look for raw JSON object if AI forgot backticks
        const firstBrace = replyText.indexOf('{');
        const lastBrace = replyText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            jsonStr = replyText.substring(firstBrace, lastBrace + 1);
            // Test if it's valid JSON
            JSON.parse(jsonStr);
            // If valid, remove it from the reply text and also remove "Voici le plan..." strings
            replyText = replyText.replace(jsonStr, '').trim();
            replyText = replyText.replace(/Voici le plan.*?JSON.*?:/ig, '').trim();
          } catch {
            jsonStr = ""; // Invalid JSON, reset
          }
        }
      }

      if (jsonStr) {
        try {
          const planData = JSON.parse(jsonStr);
          applyPlanData(planData);
          replyText += "\n\n✅ **Plan appliqué avec succès ! L'interface a été mise à jour.**";
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
                    <button className="tts-play-btn" onClick={() => playTTS(msg)} title="Écouter">
                       {loadingAudioId === msg.id ? <Loader size={14} className="spin" /> : 
                        playingAudioId === msg.id ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
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
