import React, { useState, useEffect, useRef } from 'react';
import { Target, Plus, TrendingUp, Zap, Calendar, Sparkles, BookOpen, Dumbbell, Brain, Coffee, Pencil, Trash2, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { playLevelUpSound, playBloopSound, playClickSound } from '../utils/sounds';
import './Habits.css';

interface HabitsProps {
  onOpenChat: () => void;
}

interface Habit {
  id: string;
  title: string;
  icon: string;
  color: string;
  xp: number;
  level: number;
  history: string[]; // array of ISO date strings "YYYY-MM-DD"
}

const HABIT_COLORS = [
  { name: 'Bleu Néon', value: '#3b82f6' },
  { name: 'Rose Néon', value: '#ec4899' },
  { name: 'Violet Néon', value: '#8b5cf6' },
  { name: 'Vert Néon', value: '#10b981' },
  { name: 'Jaune Néon', value: '#fcd34d' },
  { name: 'Rouge Néon', value: '#ef4444' }
];

const HABIT_ICONS = [
  { id: 'book', icon: BookOpen },
  { id: 'sport', icon: Dumbbell },
  { id: 'mind', icon: Brain },
  { id: 'relax', icon: Coffee },
  { id: 'target', icon: Target },
  { id: 'up', icon: TrendingUp }
];

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function generateHeatmapDays(daysCount: number): string[] {
  const days: string[] = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function calculateStreak(history: string[]): number {
  let streak = 0;
  const today = getTodayKey();
  if (history.includes(today)) streak = 1;
  for (let i = 1; i <= 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (history.includes(key)) streak++;
    else break;
  }
  return streak;
}

function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

export const Habits: React.FC<HabitsProps> = ({ onOpenChat }) => {
  const [habits, setHabits] = useState<Habit[]>(() => {
    const saved = localStorage.getItem('mindset_habits');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const sanitized = parsed.map((h: any) => ({
          ...h,
          title: h.title || h.name || 'Habitude IA',
          icon: h.icon || 'target',
          color: h.color || HABIT_COLORS[0].value,
          xp: h.xp || 0,
          level: h.level || 1,
          history: Array.isArray(h.history) ? h.history : (Array.isArray(h.completed_dates) ? h.completed_dates : [])
        }));
        return sanitized;
      } catch (e) {
        console.error('Failed to parse habits', e);
      }
    }
    return [
      { id: '1', title: 'Lecture (10 pages)', icon: 'book', color: '#ec4899', xp: 120, level: 2, history: [getTodayKey()] },
      { id: '2', title: 'Méditation (10 min)', icon: 'mind', color: '#8b5cf6', xp: 450, level: 4, history: [] }
    ];
  });

  const [points, setPoints] = useState(() => parseInt(localStorage.getItem('mindset_points') || '450', 10));
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';
  const heatmapDays = generateHeatmapDays(14);

  // AI Commentary State
  const [aiMessage, setAiMessage] = useState<{text: string, visible: boolean}>({text: '', visible: false});

  // Edit Modal State
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  useEffect(() => {
    localStorage.setItem('mindset_habits', JSON.stringify(habits));
  }, [habits]);

  const showAiMessage = (msg: string) => {
    setAiMessage({ text: msg, visible: true });
    setTimeout(() => {
      setAiMessage(prev => ({ ...prev, visible: false }));
    }, 4000);
  };

  const triggerHabitCompleteEffect = (e: React.MouseEvent, color: string, isLevelUp: boolean) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = (rect.left + rect.width / 2) / window.innerWidth;
    const y = (rect.top + rect.height / 2) / window.innerHeight;
    
    if (isLevelUp) {
      playLevelUpSound();
      confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 }, colors: [color, '#fcd34d', '#ffffff'] });
    } else {
      playBloopSound();
      confetti({ particleCount: 40, spread: 50, origin: { x, y }, colors: [color, '#ffffff'] });
    }
  };

  const toggleHabitToday = (e: React.MouseEvent, habitId: string) => {
    const today = getTodayKey();
    let habitCompletedNow = false;
    let leveledUp = false;
    let currentHabitName = "";
    let currentStreak = 0;
    let habitColor = '#ffffff';

    const newHabits = habits.map(h => {
      if (h.id === habitId) {
        habitColor = h.color;
        currentHabitName = h.title;
        const isCompleted = h.history.includes(today);
        
        if (isCompleted) {
          // Revert
          const newHistory = h.history.filter(date => date !== today);
          return { ...h, history: newHistory, xp: Math.max(0, h.xp - 20) };
        } else {
          // Complete
          habitCompletedNow = true;
          const newHistory = [...h.history, today];
          currentStreak = calculateStreak(newHistory);
          const newXp = h.xp + 20;
          const newLevel = calculateLevel(newXp);
          
          if (newLevel > h.level) leveledUp = true;
          
          return { ...h, history: newHistory, xp: newXp, level: newLevel };
        }
      }
      return h;
    });

    setHabits(newHabits);

    const isSubscribed = localStorage.getItem('mindset_is_subscribed') === 'true';
    const pointsGained = isSubscribed ? 30 : 15; // Bonus x2 pour les abonnés

    if (habitCompletedNow) {
      triggerHabitCompleteEffect(e, habitColor, leveledUp);
      const newPoints = points + pointsGained;
      setPoints(newPoints);
      localStorage.setItem('mindset_points', newPoints.toString());

      // AI Commentary logic
      if (leveledUp) {
        showAiMessage(`Niveau Supérieur atteint sur ${currentHabitName}. Évolution confirmée, Monsieur.`);
      } else if (currentStreak === 3) {
        showAiMessage(`Série de 3 jours sur ${currentHabitName}. Le momentum est de votre côté.`);
      } else if (currentStreak === 7) {
        showAiMessage(`Une semaine parfaite sur ${currentHabitName}. Mode Focus de Fer activé.`);
      } else if (currentStreak > 10 && currentStreak % 5 === 0) {
        showAiMessage(`Série de ${currentStreak} jours. Impressionnant.`);
      } else if (Math.random() > 0.7) {
        const msgs = [
          "Excellente régularité.",
          "C'est noté. Continuez ainsi.",
          "Habitude validée avec succès.",
          `+${pointsGained} Coins ajoutés à vos réserves.`
        ];
        showAiMessage(msgs[Math.floor(Math.random() * msgs.length)]);
      }

    } else {
      const newPoints = Math.max(0, points - pointsGained);
      setPoints(newPoints);
      localStorage.setItem('mindset_points', newPoints.toString());
    }
  };

  const getIconComponent = (iconId: string) => {
    const match = HABIT_ICONS.find(h => h.id === iconId);
    const Icon = match ? match.icon : Target;
    return <Icon size={24} />;
  };

  // Holographic Tilt Logic
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>, streak: number) => {
    if (streak < 7) return; // Only for "Focus de Fer"
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = ((y - centerY) / centerY) * -10; // Max 10 deg
    const rotateY = ((x - centerX) / centerX) * 10;

    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
    
    const glare = card.querySelector('.hologram-glare') as HTMLElement;
    if (glare) {
      glare.style.transform = `translate(${x - rect.width}px, ${y - rect.height}px)`;
      glare.style.opacity = '0.4';
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    const glare = card.querySelector('.hologram-glare') as HTMLElement;
    if (glare) {
      glare.style.opacity = '0';
    }
  };

  // CRUD
  const saveHabit = () => {
    if (!editingHabit) return;
    if (habits.find(h => h.id === editingHabit.id)) {
      setHabits(habits.map(h => h.id === editingHabit.id ? editingHabit : h));
    } else {
      setHabits([...habits, editingHabit]);
    }
    setEditingHabit(null);
  };

  const deleteHabit = () => {
    if (editingHabit) {
      setHabits(habits.filter(h => h.id !== editingHabit.id));
      setEditingHabit(null);
    }
  };

  const openNewHabitModal = () => {
    setEditingHabit({
      id: Date.now().toString(),
      title: 'Nouvelle Habitude',
      icon: 'target',
      color: HABIT_COLORS[0].value,
      xp: 0,
      level: 1,
      history: []
    });
  };

  return (
    <div className="habits-container">
      {/* AI Commentary Notification */}
      <div className={`ai-commentary-toast glass-panel ${aiMessage.visible ? 'visible' : ''}`}>
        <div className="ai-jarvis-orb tiny pulsing-orb"></div>
        <p><strong>{aiName} :</strong> {aiMessage.text}</p>
      </div>

      <header className="dashboard-header habits-header">
        <div>
          <p className="current-date">Forger la discipline</p>
          <h1 className="greeting">Habitudes</h1>
          <p className="subtitle">La répétition crée la légende.</p>
        </div>
        
        <div className="header-actions">
          <button className="btn-primary glass-panel-interactive pulse-glow" onClick={onOpenChat}>
            <Sparkles size={18} />
            Parler à {aiName}
          </button>
        </div>
      </header>

      <div className="habits-grid">
        {habits.map(habit => {
          const isDoneToday = habit.history.includes(getTodayKey());
          const streak = calculateStreak(habit.history);
          const isSubscribed = localStorage.getItem('mindset_is_subscribed') === 'true';
          const isIronFocus = streak >= 7 && isSubscribed;
          
          return (
            <div 
              key={habit.id} 
              className={`habit-card glass-liquid ${isDoneToday ? 'done' : ''} ${isIronFocus ? 'iron-focus' : ''}`} 
              style={{ '--habit-color': habit.color } as any}
              onMouseMove={(e) => handleMouseMove(e, streak)}
              onMouseLeave={handleMouseLeave}
            >
              <div className="hologram-glare"></div>
              <div className="habit-glow-bg"></div>
              
              <div className="habit-header">
                <div className="habit-icon-wrapper" style={{ color: habit.color, borderColor: habit.color, boxShadow: `0 0 15px ${habit.color}40` }}>
                  {getIconComponent(habit.icon)}
                </div>
                <div className="habit-title-area">
                  <h3>{habit.title}</h3>
                  <div className="habit-level-bar">
                    <span className="habit-level">Lvl {habit.level}</span>
                    <div className="xp-bar-bg">
                      <div className="xp-bar-fill" style={{ width: `${(habit.xp % 50) / 50 * 100}%`, backgroundColor: habit.color }}></div>
                    </div>
                  </div>
                </div>
                <div className="habit-streak">
                  <span className="streak-num">{streak}</span>
                  <Zap size={16} className={`streak-icon ${streak > 0 ? 'active' : ''}`} style={{ color: streak > 0 ? '#fcd34d' : 'var(--secondary)' }} />
                </div>
                
                <button className="edit-habit-btn" onClick={() => setEditingHabit(habit)}>
                  <Pencil size={14} />
                </button>
              </div>

              <div className="habit-heatmap">
                {heatmapDays.map(day => {
                  const isDayDone = habit.history.includes(day);
                  const isToday = day === getTodayKey();
                  return (
                    <div 
                      key={day} 
                      className={`heatmap-cell ${isDayDone ? 'active' : ''} ${isToday ? 'today' : ''}`}
                      style={{ backgroundColor: isDayDone ? habit.color : 'rgba(255,255,255,0.05)' }}
                      title={day}
                    />
                  );
                })}
              </div>

              <div className="habit-actions">
                <button 
                  className={`btn-habit-complete ${isDoneToday ? 'completed' : ''}`}
                  onClick={(e) => toggleHabitToday(e, habit.id)}
                  style={{ 
                    backgroundColor: isDoneToday ? habit.color : 'transparent',
                    borderColor: habit.color,
                    color: isDoneToday ? '#000' : habit.color 
                  }}
                >
                  {isDoneToday ? 'Validé pour aujourd\'hui' : 'Valider'}
                </button>
              </div>
            </div>
          );
        })}

        <div className="habit-card add-habit-card glass-panel-interactive" onClick={openNewHabitModal}>
          <div className="add-habit-content">
            <div className="add-icon-wrapper">
              <Plus size={32} />
            </div>
            <h3>Nouvelle Habitude</h3>
            <p>Construis une nouvelle force</p>
          </div>
        </div>
      </div>

      {/* EDIT MODAL */}
      {editingHabit && (
        <div className="modal-backdrop" onClick={() => setEditingHabit(null)}>
          <div className="modal-content glass-panel edit-habit-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditingHabit(null)}><X size={20} /></button>
            <h2 className="modal-title">Paramètres de l'Habitude</h2>
            
            <div className="form-group">
              <label>Nom de l'habitude</label>
              <input 
                type="text" 
                value={editingHabit.title} 
                onChange={e => setEditingHabit({...editingHabit, title: e.target.value})} 
                className="routine-edit-input" 
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Icône</label>
              <div className="icon-picker">
                {HABIT_ICONS.map(ic => {
                  const IconComp = ic.icon;
                  return (
                    <button 
                      key={ic.id}
                      className={`icon-swatch ${editingHabit.icon === ic.id ? 'selected' : ''}`}
                      onClick={() => setEditingHabit({...editingHabit, icon: ic.id})}
                    >
                      <IconComp size={20} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-group">
              <label>Couleur Néon</label>
              <div className="color-picker">
                {HABIT_COLORS.map(c => (
                  <button 
                    key={c.value}
                    className={`color-swatch ${editingHabit.color === c.value ? 'selected' : ''}`}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setEditingHabit({...editingHabit, color: c.value})}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            <div className="modal-actions habit-modal-actions">
              <button className="btn-delete-full" onClick={deleteHabit}><Trash2 size={16}/> Supprimer</button>
              <button className="btn-primary" onClick={saveHabit}>Sauvegarder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
