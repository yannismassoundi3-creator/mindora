import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { playBloopSound, playErrorSound } from '../utils/sounds';
import './AIChat.css';

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
        text: "Salut ! Je suis ton Coach IA, connecté à ton Dashboard. Je vois que tu as une série de 12 jours, c'est excellent ! Comment puis-je t'aider aujourd'hui ?",
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    localStorage.setItem('mindset_ai_chat_history', JSON.stringify(messages));
  }, [messages, isTyping]);

  const applyPlanData = (planData: any) => {
    if (planData.newHabits && Array.isArray(planData.newHabits)) {
      const existingHabits = JSON.parse(localStorage.getItem('mindset_habits') || '[]');
      const updatedHabits = [...existingHabits];
      planData.newHabits.forEach((h: any) => {
        const colors = ['#3b82f6', '#ec4899', '#8b5cf6', '#10b981', '#fcd34d', '#ef4444'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        updatedHabits.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: h.name || h.title || 'Nouvelle Habitude',
          icon: 'target',
          color: randomColor,
          xp: 0,
          level: 1,
          history: []
        });
      });
      localStorage.setItem('mindset_habits', JSON.stringify(updatedHabits));
    }
    
    if (planData.newRoutines && Array.isArray(planData.newRoutines)) {
      const existingRoutines = JSON.parse(localStorage.getItem('mindset_routines_data') || '[]');
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

      const response = await fetch('http://localhost:3000/ai-coaching/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: currentInput,
          history: messages.slice(1),
          context: userContext
        })
      });
      
      const data = await response.json();
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
                {msg.sender === 'ai' && <div className="message-ai-name">{aiName}</div>}
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
