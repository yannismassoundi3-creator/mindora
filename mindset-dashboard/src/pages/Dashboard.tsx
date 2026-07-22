import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Area, AreaChart } from 'recharts';
import { Play, CheckCircle2, TrendingUp, Zap, Sparkles, Pencil, Coins, Circle, ChevronLeft, ChevronRight, Plus, Trophy } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api';
import { playClickSound, playBloopSound, playLevelUpSound } from '../utils/sounds';
import './Dashboard.css';

// --- HELPERS ---

const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDayName(dateStr: string): string {
  const d = new Date(dateStr);
  return DAY_NAMES[d.getDay()];
}

function getLastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function loadDailyScores(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('mindset_daily_scores') || '{}');
  } catch { return {}; }
}

function saveDailyScore(dateKey: string, score: number) {
  const scores = loadDailyScores();
  scores[dateKey] = score;
  localStorage.setItem('mindset_daily_scores', JSON.stringify(scores));
}

function calculateStreak(): number {
  const scores = loadDailyScores();
  let streak = 0;
  const today = getTodayKey();
  let consecutiveMisses = 0;
  
  if (!scores[today] || scores[today] === 0) {
    consecutiveMisses++;
  } else {
    streak++;
  }
  
  for (let i = 1; i <= 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    
    if (scores[key] && scores[key] > 0) {
      streak++;
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
      if (consecutiveMisses >= 2) {
        break;
      }
    }
  }
  return streak;
}

// --- CUSTOM CHART COMPONENTS ---

const CustomTick = ({ x, y, payload }: any) => {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-18} y={8} width={36} height={26} rx={8} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      <text x={0} y={25} textAnchor="middle" fill="var(--secondary)" fontSize={12} fontWeight={600} fontFamily="var(--font-main)">
        {payload.value}
      </text>
    </g>
  );
};

const CustomTooltipContent = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: 'rgba(20,20,20,0.9)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '12px',
        padding: '10px 14px',
        backdropFilter: 'blur(10px)',
      }}>
        <p style={{ color: '#ec4899', fontWeight: 700, fontSize: '0.85rem', margin: 0 }}>{label}</p>
        <p style={{ color: 'white', fontWeight: 800, fontSize: '1.1rem', margin: '4px 0 0' }}>
          {payload[0].value}%
        </p>
      </div>
    );
  }
  return null;
};

// --- COMPONENT ---

interface DashboardProps {
  onOpenChat: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onOpenChat }) => {
  const [currentDate, setCurrentDate] = useState('');
  useEffect(() => {
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    setCurrentDate(new Date().toLocaleDateString('fr-FR', options));
    
    // Demander la permission push au chargement du dashboard
    setTimeout(() => {
      api.subscribeToPushNotifications().catch(console.error);
    }, 2000);
  }, []);

  const [points, setPoints] = useState(() => parseInt(localStorage.getItem('mindset_points') || '0', 10));



  // --- ROUTINES (persisted) ---
  const [routineGroups, setRoutineGroups] = useState(() => {
    const saved = localStorage.getItem('mindset_routines');
    const lastDate = localStorage.getItem('mindset_last_routine_date');
    const today = getTodayKey();
    
    let parsedGroups = null;
    if (saved) {
      try { parsedGroups = JSON.parse(saved); } catch {}
    }

    // Si c'est un nouveau jour, on décoche toutes les routines
    if (Array.isArray(parsedGroups) && lastDate !== today) {
      parsedGroups = parsedGroups.map((group: any) => ({
        ...group,
        items: Array.isArray(group.items) ? group.items.map((item: any) => ({ ...item, done: false })) : []
      }));
    }

    if (Array.isArray(parsedGroups) && parsedGroups.length > 0) return parsedGroups;

    return [
      {
        id: 'morning',
        title: 'Routine Matinale',
        desc: 'Prépare ton esprit pour la journée',
        items: [
          { id: 1, title: 'Méditation Express', time: '5 min', done: false },
          { id: 2, title: 'Visualisation des objectifs', time: '10 min', done: false },
          { id: 3, title: 'Lecture inspirante', time: '15 min', done: false }
        ]
      },
      {
        id: 'midday',
        title: 'Routine du Midi',
        desc: "Recharge tes batteries pour l'après-midi",
        items: [
          { id: 4, title: 'Marche digestive', time: '10 min', done: false },
          { id: 5, title: 'Lecture ou Podcast', time: '15 min', done: false },
          { id: 6, title: 'Planification après-midi', time: '5 min', done: false }
        ]
      },
      {
        id: 'evening',
        title: 'Routine du Soir',
        desc: 'Décompresse et prépare demain',
        items: [
          { id: 7, title: 'Bilan de la journée', time: '5 min', done: false },
          { id: 8, title: 'Déconnexion des écrans', time: '30 min', done: false },
          { id: 9, title: 'Étirements légers', time: '10 min', done: false }
        ]
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem('mindset_routines', JSON.stringify(routineGroups));
    localStorage.setItem('mindset_last_routine_date', getTodayKey());
  }, [routineGroups]);

  // --- SCORE CALCULATION ---
  const totalRoutines = Array.isArray(routineGroups) ? routineGroups.reduce((acc: number, group: any) => acc + (Array.isArray(group.items) ? group.items.length : 0), 0) : 0;
  const doneRoutines = Array.isArray(routineGroups) ? routineGroups.reduce((acc: number, group: any) => acc + (Array.isArray(group.items) ? group.items.filter((i: any) => i.done).length : 0), 0) : 0;

  const [bonusScore, setBonusScore] = useState(0);

  // Listen to storage events so when Objectives change, we recalculate bonus
  useEffect(() => {
    const handleStorage = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('mindset_micro_obj') || '[]');
        if (Array.isArray(saved)) {
          const todayKey = getTodayKey();
          const currentBonus = saved.filter((o: any) => o.done && o.awardedDate === todayKey).length * 10;
          setBonusScore(currentBonus);
        } else {
          setBonusScore(0);
        }
      } catch {}
    };
    window.addEventListener('storage', handleStorage);
    handleStorage(); // initial calc
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const baseScore = Math.round((doneRoutines / (totalRoutines || 1)) * 100);
  const mentalScore = Math.min(100, baseScore + bonusScore);

  useEffect(() => {
    localStorage.setItem('mental_score', mentalScore.toString());
    saveDailyScore(getTodayKey(), mentalScore);
  }, [mentalScore]);

  // --- STREAK & HARDCORE MODE ---
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    const currentStreak = calculateStreak();
    setStreak(currentStreak);

    const savedPreviousStreak = parseInt(localStorage.getItem('mindset_previous_streak') || '0', 10);
    
    if (currentStreak === 0 && savedPreviousStreak > 0) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('streakBroken', { detail: { lostStreak: savedPreviousStreak } }));
        
        const currentPoints = parseInt(localStorage.getItem('mindset_points') || '0', 10);
        const newPoints = Math.max(0, currentPoints - 50);
        setPoints(newPoints);
        localStorage.setItem('mindset_points', newPoints.toString());
        window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));
      }, 500); // 500ms delay to ensure all components are mounted
      
      localStorage.setItem('mindset_previous_streak', '0');
    } else if (currentStreak > 0) {
      localStorage.setItem('mindset_previous_streak', currentStreak.toString());
    }
  }, [mentalScore]);

  // --- MICRO OBJECTIVES (read from Objectives page via localStorage) ---
  const [microObjectives, setMicroObjectives] = useState<any[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mindset_micro_obj') || '[]');
      setMicroObjectives(Array.isArray(saved) ? saved : []);
    } catch {
      setMicroObjectives([]);
    }
  }, []);
  
  const microDone = Array.isArray(microObjectives) ? microObjectives.filter((o: any) => o.done).length : 0;
  const microTotal = Array.isArray(microObjectives) ? microObjectives.length : 0;

  // --- WEEKLY DATA (real) ---
  const weeklyData = getLastNDays(7).map(dateStr => {
    const scores = loadDailyScores();
    const todayKey = getTodayKey();
    return {
      name: getDayName(dateStr),
      score: dateStr === todayKey ? mentalScore : (scores[dateStr] || 0),
      isToday: dateStr === todayKey,
    };
  });

  // --- TREND DATA (real, last 8 weeks) ---
  const trendData = (() => {
    const scores = loadDailyScores();
    const weeks: { name: string; score: number }[] = [];
    for (let w = 7; w >= 0; w--) {
      let sum = 0;
      let count = 0;
      for (let d = 0; d < 7; d++) {
        const date = new Date();
        date.setDate(date.getDate() - (w * 7 + d));
        const key = date.toISOString().slice(0, 10);
        if (scores[key]) {
          sum += scores[key];
          count++;
        }
      }
      weeks.push({ name: `S${8 - w}`, score: count > 0 ? Math.round(sum / count) : 0 });
    }
    return weeks;
  })();

  // --- CAROUSEL ---
  const [currentRoutineIndex, setCurrentRoutineIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState('none');
  const [activeChartTab, setActiveChartTab] = useState('today');
  const currentGroup = routineGroups[currentRoutineIndex] || { title: 'Aucune routine', desc: 'Créez vos routines', items: [] };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const nextRoutine = () => {
    playClickSound();
    setSlideDirection('slide-left');
    setTimeout(() => {
      setCurrentRoutineIndex((prev) => (prev + 1) % routineGroups.length);
      setSlideDirection('slide-in-right');
      setTimeout(() => setSlideDirection('none'), 300);
    }, 300);
  };

  const prevRoutine = () => {
    playClickSound();
    setSlideDirection('slide-right');
    setTimeout(() => {
      setCurrentRoutineIndex((prev) => (prev === 0 ? routineGroups.length - 1 : prev - 1));
      setSlideDirection('slide-in-left');
      setTimeout(() => setSlideDirection('none'), 300);
    }, 300);
  };

  const triggerDopamine = (e?: React.MouseEvent) => {
    let x = 0.5;
    let y = 0.5;
    if (e) {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      x = (rect.left + rect.width / 2) / window.innerWidth;
      y = (rect.top + rect.height / 2) / window.innerHeight;
    }
    confetti({
      particleCount: 80,
      spread: 80,
      origin: { x, y },
      colors: ['#ec4899', '#3b82f6', '#8b5cf6', '#fcd34d']
    });
  };

  const toggleRoutine = (e: React.MouseEvent, id: number) => {
    let itemWasDone = false;
    let newlyDoneCount = 0;

    const newGroups = (Array.isArray(routineGroups) ? routineGroups : []).map((group: any) => {
      const newItems = (Array.isArray(group.items) ? group.items : []).map((item: any) => {
        if (item.id === id) {
          itemWasDone = item.done;
          if (!itemWasDone) newlyDoneCount++;
          return { ...item, done: !item.done };
        }
        if (item.done) newlyDoneCount++;
        return item;
      });
      return { ...group, items: newItems };
    });

    if (!itemWasDone) {
      playBloopSound();
      triggerDopamine(e);
      const newPoints = points + 5;
      setPoints(newPoints);
      localStorage.setItem('mindset_points', newPoints.toString());
      window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));

      if (newlyDoneCount === totalRoutines) {
        playLevelUpSound();
        setTimeout(() => triggerDopamine(), 500);
        setTimeout(() => triggerDopamine(), 1000);
      }
    } else {
      const newPoints = Math.max(0, points - 5);
      setPoints(newPoints);
      localStorage.setItem('mindset_points', newPoints.toString());
      window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));
    }

    setRoutineGroups(newGroups);
  };

  const startEditing = (routine: any) => {
    setEditingId(routine.id);
    setEditTitle(routine.title);
  };

  const saveEditing = (id: number) => {
    const newGroups = (Array.isArray(routineGroups) ? routineGroups : []).map((group: any) => {
      const newItems = (Array.isArray(group.items) ? group.items : []).map((item: any) => {
        if (item.id === id) return { ...item, title: editTitle };
        return item;
      });
      return { ...group, items: newItems };
    });
    setRoutineGroups(newGroups);
    setEditingId(null);
  };

  const addNewRoutine = () => {
    playClickSound();
    let newGroups = [...routineGroups];
    if (newGroups.length === 0) {
      newGroups = [{ id: 'custom', title: 'Mes routines', desc: '', items: [] }];
    }
    const newId = Math.max(...newGroups.flatMap((g: any) => (g.items || []).map((i: any) => i.id)), 0) + 1;
    if (!newGroups[currentRoutineIndex]) {
      newGroups[0].items.push({ id: newId, title: 'Nouvelle tâche', time: '10 min', done: false });
    } else {
      newGroups[currentRoutineIndex].items.push({ id: newId, title: 'Nouvelle tâche', time: '10 min', done: false });
    }
    setRoutineGroups(newGroups);
    setEditingId(newId);
    setEditTitle('Nouvelle tâche');
  };

  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (mentalScore / 100) * circumference;

  const getStreakMessage = () => {
    if (streak === 0) return "Commence ta première routine pour lancer ta série !";
    if (streak < 3) return "Bon début ! Continue pour construire l'habitude.";
    if (streak < 7) return "Belle régularité ! Tu construis ta discipline.";
    if (streak < 14) return "Impressionnant ! Tu es en mode champion.";
    if (streak < 30) return "Incroyable ! Très peu de gens tiennent aussi longtemps.";
    return "Légendaire ! Tu es un vrai warrior du mindset.";
  };

  const userName = localStorage.getItem('mindset_user_name') || 'Utilisateur';
  const aiName = localStorage.getItem('mindset_ai_name') || 'MINDORA OS';

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <p className="current-date">{currentDate}</p>
          <h1 className="greeting">Bonjour, {userName} 👋</h1>
          <p className="subtitle">L'assistant IA est prêt. Dominons cette journée.</p>
        </div>
        
        <div className="header-actions">
          <div className="points-badge glass-panel">
            <Coins size={18} className="points-icon" />
            <span className="points-value">{points}</span>
            <span className="points-label">Coins</span>
          </div>
          <button className="btn-primary glass-panel-interactive pulse-glow" onClick={() => { playClickSound(); onOpenChat(); }}>
            <Sparkles size={18} />
            Parler à {aiName}
          </button>
        </div>
      </header>

      <div className="dashboard-grid">
        {/* Main Chart Section */}
        <section className="glass-panel chart-section">
          <div className="section-header">
            <div>
              <h3>Évolution Mentale</h3>
              <p className="section-desc">Ton niveau d'énergie et de focus</p>
            </div>
            
            <div className="chart-tabs">
              <button className={`chart-tab ${activeChartTab === 'today' ? 'active' : ''}`} onClick={() => { playClickSound(); setActiveChartTab('today'); }}>Aujourd'hui</button>
              <button className={`chart-tab ${activeChartTab === 'week' ? 'active' : ''}`} onClick={() => { playClickSound(); setActiveChartTab('week'); }}>Semaine</button>
              <button className={`chart-tab ${activeChartTab === 'trend' ? 'active' : ''}`} onClick={() => { playClickSound(); setActiveChartTab('trend'); }}>Tendance</button>
            </div>
          </div>

          <div className="chart-container">
            {activeChartTab === 'today' && (
              <div className="today-score-view">
                <div className="circular-progress-container glass-liquid">
                  <svg width="180" height="180" viewBox="0 0 160 160">
                    <defs>
                      <linearGradient id="scoreGradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                    </defs>
                    <circle cx="80" cy="80" r={radius} fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                    <circle 
                      cx="80" cy="80" r={radius} 
                      fill="transparent" 
                      stroke="url(#scoreGradient)" 
                      strokeWidth="12" 
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                      transform="rotate(-90 80 80)"
                    />
                  </svg>
                  <div className="circular-score-content">
                    <span className="score-number">{mentalScore}</span>
                  </div>
                </div>
                <div className="today-score-text">
                  {mentalScore >= 100 ? (
                    <div className="victory-message">
                      <h4 className="gradient-text">Bravo Champion 🏆</h4>
                      <p>Tu as accompli toutes tes routines. Repose-toi bien.</p>
                    </div>
                  ) : (
                    <>
                      <h4>Score Actuel</h4>
                      <p>Complète tes routines pour atteindre 100%.</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeChartTab === 'week' && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <defs>
                    <linearGradient id="blueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.2}/>
                    </linearGradient>
                    <linearGradient id="pinkGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity={1}/>
                      <stop offset="100%" stopColor="#ec4899" stopOpacity={0.4}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={<CustomTick />} dy={10} />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip content={<CustomTooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                  <Bar dataKey="score" radius={[12, 12, 12, 12]} barSize={34}>
                    {weeklyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.isToday ? 'url(#pinkGradient)' : 'url(#blueGradient)'} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {activeChartTab === 'trend' && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <defs>
                    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity={0.3}/>
                      <stop offset="100%" stopColor="#ec4899" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="lineColor" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={<CustomTick />} dy={10} />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip content={<CustomTooltipContent />} />
                  <Area 
                    type="monotone" 
                    dataKey="score" 
                    stroke="url(#lineColor)" 
                    strokeWidth={3} 
                    fill="url(#areaFill)"
                    dot={{ r: 5, fill: '#141414', strokeWidth: 3, stroke: '#ec4899' }} 
                    activeDot={{ r: 7, stroke: '#ec4899', strokeWidth: 2, fill: '#ec4899' }} 
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Stats Row */}
        <div className="stats-row">
          <div className="glass-panel stat-card streak-card glass-panel-interactive">
            <div className="streak-glow"></div>
            <div className="stat-icon purple"><Zap size={28} /></div>
            <div className="stat-info">
              <span className="stat-label">Série de focus</span>
              <span className="stat-value highlight-streak">
                {streak} Jour{streak > 1 ? 's' : ''} <span className="fire-emoji animated">🔥</span>
              </span>
              <span className="streak-hint">{getStreakMessage()}</span>
            </div>
          </div>
          <div className="glass-panel stat-card glass-panel-interactive">
            <div className="stat-icon blue"><Trophy size={22} /></div>
            <div className="stat-info">
              <span className="stat-label">Objectifs atteints</span>
              <span className="stat-value">{microDone}/{microTotal} terminés</span>
              {microTotal > 0 && (
                <div className="obj-progress-bar">
                  <div className="obj-progress-fill" style={{ width: `${(microDone / microTotal) * 100}%` }}></div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Routines Carousel */}
        <section className="glass-panel routines-section">
          <div className="section-header routine-carousel-header">
            <button className="carousel-nav-btn" onClick={prevRoutine}><ChevronLeft size={24} /></button>
            <div className="routine-title-container">
              <h3 className={slideDirection}>{currentGroup.title}</h3>
              <p className={`section-desc ${slideDirection}`}>{currentGroup.desc}</p>
            </div>
            <button className="carousel-nav-btn" onClick={nextRoutine}><ChevronRight size={24} /></button>
          </div>
          
          <div className={`routine-list ${slideDirection}`}>
            <span className="time-est glass-badge mb-3">
              {Array.isArray(currentGroup.items) ? currentGroup.items.filter((r: any) => !r.done).length : 0} tâche(s) restante(s)
            </span>
            
            {Array.isArray(currentGroup.items) && currentGroup.items.map((routine: any) => (
              <div key={routine.id} className={`routine-item ${routine.done ? 'done' : ''} glass-panel-interactive`}>
                <div className="routine-checkbox" onClick={(e) => toggleRoutine(e, routine.id)}>
                  {routine.done ? <CheckCircle2 size={18} /> : <Circle size={18} color="rgba(255,255,255,0.4)" />}
                </div>
                <div className="routine-content">
                  {editingId === routine.id ? (
                    <input 
                      type="text" 
                      className="routine-edit-input" 
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={() => saveEditing(routine.id)}
                      onKeyDown={e => e.key === 'Enter' && saveEditing(routine.id)}
                      autoFocus
                    />
                  ) : (
                    <span className="routine-title">{routine.title}</span>
                  )}
                  <span className="routine-time">{routine.time}</span>
                </div>
                <button className="routine-edit-btn" onClick={() => startEditing(routine)}>
                  <Pencil size={14} />
                </button>
              </div>
            ))}

            <button className="add-routine-btn" onClick={addNewRoutine}>
              <Plus size={18} />
              Ajouter une routine
            </button>
          </div>
          
          <div className="carousel-dots">
            {routineGroups.map((_: any, idx: number) => (
              <span 
                key={idx} 
                className={`carousel-dot ${idx === currentRoutineIndex ? 'active' : ''}`}
                onClick={() => {
                  if (idx !== currentRoutineIndex) {
                    setSlideDirection(idx > currentRoutineIndex ? 'slide-left' : 'slide-right');
                    setTimeout(() => {
                      setCurrentRoutineIndex(idx);
                      setSlideDirection(idx > currentRoutineIndex ? 'slide-in-right' : 'slide-in-left');
                      setTimeout(() => setSlideDirection('none'), 300);
                    }, 300);
                  }
                }}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
