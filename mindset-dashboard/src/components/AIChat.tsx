import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Sparkles, Play, Square, Loader } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { playBloopSound, playErrorSound } from '../utils/sounds';
import './AIChat.css';
import { api } from '../services/api';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
}

export const AIChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('mindset_ai_chat_history');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Erreur parsing chat history", e);
      }
    }
    return [
      {
        id: 1,
        text: `Bonjour, comment je peux t'aider aujourd'hui ?`,
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';

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
    localStorage.setItem('mindset_ai_chat_history', JSON.stringify(messages));
  }, [messages, isTyping]);

  const applyPlanData = (planData: any) => {
    if (planData.newHabits && Array.isArray(planData.newHabits)) {
      let existingHabits = [];
      try {
        const parsed = JSON.parse(localStorage.getItem('mindset_habits') || '[]');
        existingHabits = Array.isArray(parsed) ? parsed : [];
      } catch {}
      
      const newEntries = planData.newHabits.map((h: any) => {
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
    }
    
    if (planData.newRoutines && Array.isArray(planData.newRoutines)) {
      let existingRoutines = [];
      try {
        const parsed = JSON.parse(localStorage.getItem('mindset_routines_data') || '[]');
        existingRoutines = Array.isArray(parsed) ? parsed : [];
      } catch {}
      const updatedRoutines = [...existingRoutines];
      planData.newRoutines.forEach((r: any) => {
        const routineDate = new Date().toISOString().split('T')[0];
        let targetRoutine = updatedRoutines.find(x => x.type === r.type && x.date === routineDate);
        if (!targetRoutine) {
          targetRoutine = { id: Date.now().toString() + Math.random().toString(36), type: r.type, date: routineDate, tasks: [] };
          updatedRoutines.push(targetRoutine);
        }
        if (r.tasks && Array.isArray(r.tasks)) {
          r.tasks.forEach((t: any) => {
            targetRoutine.tasks.push({
              id: Date.now().toString() + Math.random().toString(36),
              title: t.title,
              duration: t.duration || 15,
              status: 'PENDING',
              priority: t.priority || 'MEDIUM'
            });
          });
        }
      });
      localStorage.setItem('mindset_routines_data', JSON.stringify(updatedRoutines));
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
      // Gather context
      const macroObj = localStorage.getItem('mindset_macro_obj') || '[]';
      const microObj = localStorage.getItem('mindset_micro_obj') || '[]';
      const coins = localStorage.getItem('mindset_points') || '0';
      const score = localStorage.getItem('mental_score') || '0';

      const userContext = {
        macroObjectives: JSON.parse(macroObj),
        microObjectives: JSON.parse(microObj),
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

      // Déduction des Coins
      localStorage.setItem('mindset_points', (currentPoints - 10).toString());
      window.dispatchEvent(new Event('storage'));

      const data = await api.post('/ai-coaching/chat', { 
        prompt: currentInput,
        history: messages.slice(1),
        context: userContext
      });
      let replyText = data.reply || "Erreur lors de la génération.";

      const jsonMatch = replyText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const planData = JSON.parse(jsonMatch[1]);
          applyPlanData(planData);
          replyText = replyText.replace(/```json\n[\s\S]*?\n```/, '').trim();
          replyText += "\n\n✅ **Plan appliqué avec succès ! Tes habitudes et routines ont été mises à jour.**";
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
    } catch (error) {
      const errorResponse: Message = {
        id: Date.now() + 1,
        text: "Impossible de contacter le serveur backend. Assure-toi qu'il tourne sur le port 3000.",
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsTyping(false);
    }
  };

  const startPlanWizard = () => {
    handleSend(undefined, "Je souhaite générer un nouveau plan d'action complet (sport, business, habitudes). Pose-moi les questions nécessaires.");
  };

  return (
    <div className="chat-container">
      <header className="chat-header glass-panel">
        <div className="chat-header-info">
          <div className="ai-status-indicator">
            <div className="status-dot pulsing"></div>
          </div>
          <div>
            <h2 className="chat-title">{aiName}</h2>
            <p className="chat-subtitle">Connecté et prêt à t'assister</p>
          </div>
        </div>
        <button className="chat-action-btn" onClick={startPlanWizard}>
          <Sparkles size={18} />
          <span>Générer un plan</span>
        </button>
      </header>

      <div className="chat-messages-area">
        <div className="messages-list">
          {messages.map(msg => (
            <div key={msg.id} className={`message ${msg.sender}`}>
              {msg.sender === 'ai' && (
                <div className="message-avatar-orb"></div>
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
              <div className="message-avatar-orb small"></div>
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
