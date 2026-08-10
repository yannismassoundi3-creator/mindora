import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Area, AreaChart } from 'recharts';
import { Play, CheckCircle2, TrendingUp, Zap, Sparkles, Pencil, Coins, Circle, ChevronLeft, ChevronRight, Plus, Trophy, Calendar, Trash2, X } from 'lucide-react';
import { AiNotification } from '../components/AiNotification';
import { RankIcon } from '../components/RankIcon';
import { VictoryGlitchOverlay } from '../components/VictoryGlitchOverlay';
import { JarvisPopup } from '../components/JarvisPopup';
import type { JarvisPopupData } from '../components/JarvisPopup';
import { api } from '../services/api';
import { getSecurePoints, setSecurePoints } from '../utils/secureStorage';
import { RANKS, getRankForLevel } from '../utils/ranks';
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
  
  // Use local time for dates to avoid UTC mismatches
  const today = new Date();
  const getLocalKey = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  // Count past streak from yesterday backwards
  const checkingDate = new Date(today);
  checkingDate.setDate(checkingDate.getDate() - 1);
  
  for (let i = 0; i < 365; i++) {
    const key = getLocalKey(checkingDate);
    if (scores[key] && scores[key] > 0) {
      streak++;
      checkingDate.setDate(checkingDate.getDate() - 1);
    } else {
      break; // Streak is only broken if a PAST day was missed
    }
  }

  // Add today if completed
  const todayKey = getLocalKey(today);
  if (scores[todayKey] && scores[todayKey] > 0) {
    streak++;
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
        <p style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '1.1rem', margin: '4px 0 0' }}>
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
  const heatmapRef = useRef<HTMLDivElement>(null);
  const [isSubscribed, setIsSubscribed] = useState(() => localStorage.getItem('mindset_is_subscribed') === 'true');
  const [showRankGlitch, setShowRankGlitch] = useState(false);
  const [jarvisPopup, setJarvisPopup] = useState<JarvisPopupData | null>(null);

  // --- STREAK & HARDCORE MODE ---
  
  useEffect(() => {
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    setCurrentDate(new Date().toLocaleDateString('fr-FR', options));
    
    setTimeout(() => {
      if (heatmapRef.current) {
        heatmapRef.current.scrollLeft = heatmapRef.current.scrollWidth;
      }
    }, 100);
    
    // Demander la permission push au chargement du dashboard
    setTimeout(() => {
      api.subscribeToPushNotifications().catch(console.error);
    }, 2000);
  }, []);

  const [points, setPoints] = useState(() => getSecurePoints());
  const level = Math.floor(Math.sqrt(points / 50)) + 1;
  const rank = getRankForLevel(level);

  const handleRankClick = () => {
    // SECURITY: The only way to trigger this cheat is to manually type 
    // localStorage.setItem('dev_mode', 'true') in the browser console.
    if (localStorage.getItem('dev_mode') !== 'true') {
      return; 
    }

    const currentRankIndex = RANKS.findIndex(r => r.name === rank.name);
    const nextRank = RANKS[(currentRankIndex + 1) % RANKS.length];
    const targetLevel = nextRank.minLevel;
    const pointsNeeded = 50 * Math.pow(targetLevel - 1, 2) + 50;
    setPoints(pointsNeeded);
    setSecurePoints(pointsNeeded);
    window.dispatchEvent(new CustomEvent('pointsChanged', { detail: pointsNeeded }));
  };



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

  // Écouter les changements venant de l'IA (storage)
  useEffect(() => {
    const handleStorage = () => {
      const saved = localStorage.getItem('mindset_routines');
      if (saved) {
        try {
          setRoutineGroups(JSON.parse(saved));
        } catch (e) {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // --- NUTRITION ---
  const [nutritionList, setNutritionList] = useState<any[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mindset_nutrition') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const handleStorage = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('mindset_nutrition') || '[]');
        if (Array.isArray(saved)) setNutritionList(saved);
      } catch {}
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggleNutrition = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    // Haptic feedback
    if ('vibrate' in navigator) navigator.vibrate([15, 10, 15]);
    
    playClickSound();
    
    // Shockwave effect
    window.dispatchEvent(new CustomEvent('triggerShockwave', { 
      detail: { x: e.clientX, y: e.clientY, color: '#ffffff' } 
    }));

    const updated = nutritionList.map((n: any) => {
      if (n.id === id) {
        if (!n.done) {
          setJarvisPopup({ x: e.clientX, y: e.clientY, title: n.title || 'Nutrition', itemType: 'objective' });
        }
        return { ...n, done: !n.done };
      }
      return n;
    });
    setNutritionList(updated);
    localStorage.setItem('mindset_nutrition', JSON.stringify(updated));
  };

  const saveNutritionEditing = (id: number) => {
    const updated = nutritionList.map((n: any) => n.id === id ? { ...n, title: editTitle, details: editTime } : n);
    setNutritionList(updated);
    localStorage.setItem('mindset_nutrition', JSON.stringify(updated));
    setEditingId(null);
  };

  const deleteNutrition = (id: number) => {
    const updated = nutritionList.filter((n: any) => n.id !== id);
    setNutritionList(updated);
    localStorage.setItem('mindset_nutrition', JSON.stringify(updated));
  };

  const addNewNutrition = () => {
    const newId = Date.now();
    const newItem = { id: newId, title: 'Nouveau Repas', details: 'Détails caloriques', done: false };
    const updated = [...nutritionList, newItem];
    setNutritionList(updated);
    localStorage.setItem('mindset_nutrition', JSON.stringify(updated));
    setEditingId(newId);
    setEditTitle('Nouveau Repas');
    setEditTime('Détails caloriques');
  };

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

  const [showVictoryOverlay, setShowVictoryOverlay] = useState(false);
  const prevMentalScore = useRef(mentalScore);

  useEffect(() => {
    if (prevMentalScore.current < 100 && mentalScore >= 100) {
      setShowVictoryOverlay(true);
    }
    prevMentalScore.current = mentalScore;
  }, [mentalScore]);

  useEffect(() => {
    localStorage.setItem('mental_score', mentalScore.toString());
    saveDailyScore(getTodayKey(), mentalScore);
  }, [mentalScore]);

  // --- STREAK & HARDCORE MODE ---
  const [streak, setStreak] = useState(0);
  const [activeRightTab, setActiveRightTab] = useState<'routines' | 'nutrition'>(() => {
    const saved = localStorage.getItem('mindset_dashboard_tab');
    if (saved) {
      localStorage.removeItem('mindset_dashboard_tab');
      return saved as 'routines' | 'nutrition';
    }
    return 'routines';
  });

  useEffect(() => {
    const handleTabSwitch = (e: any) => {
      if (e.detail === 'nutrition' || e.detail === 'routines') {
        setActiveRightTab(e.detail);
      }
    };
    
    const handleStorageSwitch = () => {
      const saved = localStorage.getItem('mindset_dashboard_tab');
      if (saved === 'nutrition' || saved === 'routines') {
        setActiveRightTab(saved);
        localStorage.removeItem('mindset_dashboard_tab');
      }
    };
    
    window.addEventListener('switch_dashboard_tab', handleTabSwitch);
    window.addEventListener('storage', handleStorageSwitch);
    // Call once to catch any missed updates
    handleStorageSwitch();
    
    return () => {
      window.removeEventListener('switch_dashboard_tab', handleTabSwitch);
      window.removeEventListener('storage', handleStorageSwitch);
    };
  }, []);

  useEffect(() => {
    const currentStreak = calculateStreak();
    setStreak(currentStreak);

    const savedPreviousStreak = parseInt(localStorage.getItem('mindset_previous_streak') || '0', 10);
    
    // Vérifier si la série a vraiment été brisée (c'est-à-dire qu'hier a été raté)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yYear = yesterday.getFullYear();
    const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
    const yDay = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayKey = `${yYear}-${yMonth}-${yDay}`;
    const scores = loadDailyScores();
    const missedYesterday = !scores[yesterdayKey] || scores[yesterdayKey] === 0;
    
    if (currentStreak <= 1 && savedPreviousStreak > 1 && missedYesterday) {
      localStorage.setItem('mindset_lost_streak', savedPreviousStreak.toString());
      
      setTimeout(() => {
        const aiName = localStorage.getItem('mindset_ai_name') || 'FAYWA';
        const savedHistory = localStorage.getItem('mindset_ai_chat_history');
        let parsed = [];
        try { parsed = savedHistory ? JSON.parse(savedHistory) : []; } catch {}
        
        parsed.push({
          id: Date.now(),
          text: `⚠️ **Alerte Discipline** : J'ai remarqué que tu as brisé ta série de ${savedPreviousStreak} jours hier. \n\nL'échec fait partie du processus d'apprentissage. Ne te décourage pas, on s'y remet dès aujourd'hui !`,
          sender: 'ai',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        localStorage.setItem('mindset_ai_chat_history', JSON.stringify(parsed));
        window.dispatchEvent(new Event('storage'));
        
        const currentPoints = getSecurePoints();
        const newPoints = Math.max(0, currentPoints - 50);
        setPoints(newPoints);
        setSecurePoints(newPoints);
        window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));
      }, 500); // 500ms delay to ensure all components are mounted
      
      localStorage.setItem('mindset_previous_streak', currentStreak.toString());
    } else if (currentStreak > 1) {
      localStorage.setItem('mindset_previous_streak', currentStreak.toString());
      localStorage.removeItem('mindset_lost_streak'); // Clean up when streak is back on track
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

  // --- TREND DATA (real, last 6 months) ---
  const trendData = (() => {
    const scores = loadDailyScores();
    const months = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
    const result: { name: string; score: number }[] = [];
    
    const today = new Date();
    for (let m = 5; m >= 0; m--) {
      const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const monthStr = d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0');
      const monthName = months[d.getMonth()];
      
      let sum = 0;
      let count = 0;
      
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${monthStr}-${day.toString().padStart(2, '0')}`;
        
        let scoreToUse = scores[dateStr];
        if (dateStr === getTodayKey()) {
          scoreToUse = mentalScore; // Use live score for today
        }
        
        if (scoreToUse) {
          sum += scoreToUse;
          count++;
        }
      }
      
      result.push({ name: monthName, score: count > 0 ? Math.round(sum / count) : 0 });
    }
    return result;
  })();

  // --- CAROUSEL ---
  const [currentRoutineIndex, setCurrentRoutineIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState('none');
  const [isAnimating, setIsAnimating] = useState(false);
  const [activeChartTab, setActiveChartTab] = useState('today');
  const currentGroup = routineGroups[currentRoutineIndex] || { title: 'Aucune routine', desc: 'Créez vos routines', items: [] };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTime, setEditTime] = useState('');

  const nextRoutine = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    playClickSound();
    
    // Switch immediately, only play ONE animation (slide-in)
    setCurrentRoutineIndex((prev) => (prev + 1) % routineGroups.length);
    setSlideDirection('slide-in-right');
    
    setTimeout(() => {
      setSlideDirection('none');
      setIsAnimating(false);
    }, 300);
  };

  const prevRoutine = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    playClickSound();
    
    // Switch immediately, only play ONE animation (slide-in)
    setCurrentRoutineIndex((prev) => (prev === 0 ? routineGroups.length - 1 : prev - 1));
    setSlideDirection('slide-in-left');
    
    setTimeout(() => {
      setSlideDirection('none');
      setIsAnimating(false);
    }, 300);
  };

  const triggerDopamine = (e?: React.MouseEvent) => {
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (e) {
      x = e.clientX;
      y = e.clientY;
    }
    window.dispatchEvent(new CustomEvent('triggerShockwave', { 
      detail: { x, y, color: '#ec4899' } 
    }));
  };

  const toggleRoutine = (e: React.MouseEvent, id: number) => {
    // Haptic feedback
    if ('vibrate' in navigator) navigator.vibrate([15, 10, 15]);

    // Shockwave effect
    window.dispatchEvent(new CustomEvent('triggerShockwave', { 
      detail: { x: e.clientX, y: e.clientY, color: '#ffffff' } 
    }));

    let itemWasDone = false;
    let newlyDoneCount = 0;
    let toggledItem: any = null;

    const newGroups = (Array.isArray(routineGroups) ? routineGroups : []).map((group: any) => {
      const newItems = (Array.isArray(group.items) ? group.items : []).map((item: any) => {
        if (item.id === id) {
          itemWasDone = item.done;
          if (!itemWasDone) newlyDoneCount++;
          toggledItem = item;
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
      setSecurePoints(newPoints);
      window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));
      
      if (toggledItem) {
        setJarvisPopup({
          x: e.clientX,
          y: e.clientY,
          title: toggledItem.title || 'Tâche',
          itemType: 'routine'
        });
      }
    } else {
      const newPoints = Math.max(0, points - 5);
      setPoints(newPoints);
      setSecurePoints(newPoints);
      window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));
    }

    setRoutineGroups(newGroups);
  };

  const startEditing = (routine: any) => {
    setEditingId(routine.id);
    setEditTitle(routine.title);
    setEditTime(routine.time || '10 min');
  };

  const saveEditing = (id: number) => {
    const newGroups = (Array.isArray(routineGroups) ? routineGroups : []).map((group: any) => {
      const newItems = (Array.isArray(group.items) ? group.items : []).map((item: any) => {
        if (item.id === id) return { ...item, title: editTitle, time: editTime };
        return item;
      });
      return { ...group, items: newItems };
    });
    setRoutineGroups(newGroups);
    setEditingId(null);
  };

  const deleteRoutine = (id: number) => {
    const newGroups = (Array.isArray(routineGroups) ? routineGroups : []).map((group: any) => {
      const newItems = (Array.isArray(group.items) ? group.items : []).filter((item: any) => item.id !== id);
      return { ...group, items: newItems };
    });
    setRoutineGroups(newGroups);
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

  const getFlameStyle = (streakValue: number): React.CSSProperties => {
    if (streakValue <= 1) {
      return { filter: 'grayscale(100%)', opacity: 0.3, animation: 'none' };
    }
    if (streakValue >= 365) {
      return { filter: 'grayscale(100%) brightness(0) drop-shadow(0 0 8px rgba(255,255,255,0.8))' };
    }
    if (streakValue >= 100) {
      return { filter: 'hue-rotate(240deg) saturate(2) brightness(1.2)' };
    }
    
    // Entre le jour 2 et le jour 100
    const progress = (streakValue - 2) / 98; // 0 à 1
    
    // Transition douce du gris vers la couleur (sur les 30 premiers jours)
    let grayScale = 0;
    let currentOpacity = 1;
    if (streakValue < 30) {
      const earlyProgress = (streakValue - 2) / 28; // 0 à 1
      grayScale = 80 - (80 * earlyProgress); // Commence à 80% gris, descend à 0%
      currentOpacity = 0.5 + (0.5 * earlyProgress); // Commence à 50% opaque, monte à 100%
    }
    
    const hueShift = -45 * progress;
    const saturate = 1 + progress;
    
    return { 
      filter: `grayscale(${grayScale}%) hue-rotate(${hueShift}deg) saturate(${saturate})`,
      opacity: currentOpacity
    };
  };

  const userName = localStorage.getItem('mindset_user_name') || 'Utilisateur';
  const aiName = localStorage.getItem('mindset_ai_name') || 'DISCIPLIX OS';

  return (
    <div className="dashboard-container">
      {jarvisPopup && (
        <JarvisPopup 
          data={jarvisPopup} 
          onClose={() => setJarvisPopup(null)} 
          onChatNavigate={(msg) => {
            localStorage.setItem('mindset_pending_chat_msg', msg);
            window.dispatchEvent(new CustomEvent('mindset_pending_chat_msg', { detail: msg }));
            onOpenChat();
          }} 
        />
      )}
      {showVictoryOverlay && <VictoryGlitchOverlay onClose={() => setShowVictoryOverlay(false)} />}
      <header className="dashboard-header">
          <div>
            <p className="date-display">{currentDate.toUpperCase()}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h1>Bonjour, {localStorage.getItem('mindset_user_name') || 'Champion'} 👋</h1>
              <div 
                className={`rank-badge ${rank.cssClass || ''}`}
                onClick={handleRankClick}
                style={{ 
                display: 'inline-flex', alignItems: 'center', gap: '6px', 
                background: 'rgba(0,0,0,0.3)', padding: '4px 12px', 
                borderRadius: '20px', border: `1px solid ${rank.color}60`, 
                color: rank.color, boxShadow: `0 0 15px ${rank.color}40`, 
                fontSize: '0.85rem', fontWeight: 600, backdropFilter: 'blur(10px)',
                cursor: 'pointer', transition: 'all 0.3s'
              }}>
                <RankIcon iconName={rank.iconName} size={16} /> Rang {rank.name}
              </div>
            </div>
            <p style={{ marginTop: '8px' }}>L'assistant IA est prêt. Dominons cette journée.</p>
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
        <div className="dashboard-left-col">
          {/* Main Chart Section */}
          <section className="glass-panel chart-section glass-panel-interactive pulse-glow" style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}>
            <div className="section-header">
              <div>
                <h3>Évolution Mentale</h3>
                <p className="section-desc">Ton niveau d'énergie et de focus</p>
              </div>
              
              <div className="chart-tabs">
                <button className={`chart-tab ${activeChartTab === 'today' ? 'active' : ''}`} onClick={() => { playClickSound(); setActiveChartTab('today'); }}>Aujourd'hui</button>
                <button className={`chart-tab ${activeChartTab === 'week' ? 'active' : ''}`} onClick={() => { playClickSound(); setActiveChartTab('week'); }}>Semaine</button>
                <button className={`chart-tab ${activeChartTab === 'trend' ? 'active' : ''}`} onClick={() => { playClickSound(); setActiveChartTab('trend'); }}>Mois</button>
              </div>
            </div>
  
            <div className="chart-container">
              {activeChartTab === 'today' && (
                <div className="today-score-view">
                  <div className="segmented-gauge-container">
                    <svg width="220" height="220" viewBox="0 0 200 200" className="gauge-svg">
                      <defs>
                        <linearGradient id="activeTick" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor={mentalScore >= 100 ? "#ff0844" : "#00f2fe"} />
                          <stop offset="100%" stopColor={mentalScore >= 100 ? "#ffb199" : "#4facfe"} />
                        </linearGradient>
                      </defs>
                      
                      {/* Background inner dark circle */}
                      <circle cx="100" cy="100" r="75" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
                      
                      {/* Segments (40 bars) */}
                      <g>
                        {[...Array(40)].map((_, i) => {
                          const isFilled = i < (mentalScore / 100) * 40;
                          return (
                            <rect 
                              key={i}
                              x="97" y="10" width="6" height="18" rx="3"
                              fill={isFilled ? 'url(#activeTick)' : 'rgba(255,255,255,0.05)'}
                              transform={`rotate(${(i * 360) / 40} 100 100)`}
                              style={{ 
                                transition: `fill 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${(i * 0.015)}s, filter 0.4s`,
                                filter: isFilled ? `drop-shadow(0 0 8px ${mentalScore >= 100 ? 'rgba(255,8,68,0.8)' : 'rgba(0,242,254,0.8)'})` : 'none' 
                              }}
                            />
                          );
                        })}
                      </g>

                      {/* Inner tech ring */}
                      <circle cx="100" cy="100" r="62" fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="3 8" className="spin-slow" />
                      <circle cx="100" cy="100" r="54" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                    </svg>
                    
                    <div className="gauge-center-content">
                      <span className="gauge-score" style={{ 
                        color: mentalScore >= 100 ? '#ffb199' : '#ffffff',
                        textShadow: mentalScore >= 100 ? '0 0 20px rgba(255,8,68,0.8)' : '0 0 10px rgba(255,255,255,0.2)'
                      }}>{mentalScore}</span>
                      <span className="gauge-label">ÉNERGIE</span>
                    </div>

                  </div>
                  <div className="today-score-text">
                    {mentalScore >= 100 && (
                      <div className="victory-message">
                        <h4 className="gradient-text">Bravo Champion 🔥</h4>
                        <p>Tu as accompli toutes tes routines. Repose-toi bien.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {activeChartTab === 'week' && (
                <div className="chart-bars">
                  {[...weeklyData].reverse().map((data, i) => {
                    const height = Math.max(data.score, 5); // At least 5% to be visible
                    const isToday = data.isToday;
                    return (
                      <div key={data.name + i} className={`bar-col ${isToday ? 'active' : ''}`}>
                        <div className="bar-track glass-panel">
                          <div className="bar-tooltip">{data.score}%</div>
                          <div className="bar-fill" style={{ height: `${height}%`, background: isToday ? 'linear-gradient(to top, #3b82f6, #60a5fa)' : 'var(--accent-purple)' }}></div>
                        </div>
                        <span className="bar-label">{data.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {activeChartTab === 'trend' && (
                <div className="trend-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--secondary)' }}>
                  <TrendingUp size={48} opacity={0.2} />
                  <span style={{ marginLeft: '15px' }}>Données insuffisantes pour la tendance mensuelle.</span>
                </div>
              )}
            </div>
          </section>

          {/* Heatmap Section */}
          <section className="heatmap-section glass-panel glass-panel-interactive pulse-glow fade-in delay-2" style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}>
            <div className="section-header-flex" style={{ marginBottom: '8px' }}>
              <h3 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
                <Calendar size={18} /> Ton Année (Régularité)
              </h3>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--secondary)', marginBottom: '24px', lineHeight: 1.4 }}>
              Ce graphique montre ta régularité sur l'année. Fais défiler horizontalement pour voir tes 365 derniers jours ! Chaque carré représente un jour. Plus tu complètes tes routines, plus le carré brille fort. L'objectif : <strong style={{color: '#10b981'}}>ne jamais briser la chaîne lumineuse !</strong>
            </p>
            <div className="heatmap-container" ref={heatmapRef}>
              {(() => {
                const heatmapDays = getLastNDays(365).reverse();
                const firstDate = new Date(heatmapDays[0]);
                const emptyCellsCount = firstDate.getDay() === 0 ? 6 : firstDate.getDay() - 1;
                
                const monthLabels: { month: string, colIndex: number }[] = [];
                let currentMonth = -1;
                let totalCells = emptyCellsCount;
                
                heatmapDays.forEach((dateStr) => {
                  const d = new Date(dateStr);
                  const m = d.getMonth();
                  if (m !== currentMonth) {
                    if (currentMonth !== -1) {
                      monthLabels.push({ month: d.toLocaleDateString('fr-FR', { month: 'short' }), colIndex: Math.floor(totalCells / 7) });
                    }
                    currentMonth = m;
                  }
                  totalCells++;
                });

                const scores = loadDailyScores();

                return (
                  <div style={{ padding: '0 10px' }}>
                    <div className="heatmap-months-row" style={{ position: 'relative', height: '20px', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--secondary)' }}>
                      {monthLabels.map((lbl, i) => (
                        <span key={i} style={{ position: 'absolute', left: `calc(28px + ${lbl.colIndex} * 19px)`, textTransform: 'capitalize' }}>
                          {lbl.month}
                        </span>
                      ))}
                    </div>
                    <div className="heatmap-body" style={{ display: 'flex', gap: '8px' }}>
                      <div className="heatmap-days-col" style={{ display: 'grid', gridTemplateRows: 'repeat(7, 1fr)', fontSize: '0.7rem', color: 'var(--secondary)', textAlign: 'right', gap: '5px' }}>
                        <span style={{ gridRow: 2, transform: 'translateY(-2px)' }}>Lun</span>
                        <span style={{ gridRow: 4, transform: 'translateY(-2px)' }}>Mer</span>
                        <span style={{ gridRow: 6, transform: 'translateY(-2px)' }}>Ven</span>
                      </div>
                      <div className="heatmap-grid">
                        {Array.from({ length: emptyCellsCount }).map((_, i) => (
                          <div key={`empty-${i}`} className="heatmap-cell" style={{ background: 'transparent' }} />
                        ))}
                        {heatmapDays.map((dateStr, i) => {
                          const score = scores[dateStr] || 0;
                          let levelClass = 'level-0';
                          if (score >= 100) levelClass = 'level-4';
                          else if (score >= 50) levelClass = 'level-3';
                          else if (score >= 20) levelClass = 'level-2';
                          else if (score > 0) levelClass = 'level-1';
                          
                          return (
                            <div 
                              key={i} 
                              className={`heatmap-cell ${levelClass}`}
                              title={`${dateStr}: ${score} pts`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="heatmap-legend">
              <span>Moins</span>
              <div className="heatmap-cell level-0"></div>
              <div className="heatmap-cell level-1"></div>
              <div className="heatmap-cell level-2"></div>
              <div className="heatmap-cell level-3"></div>
              <div className="heatmap-cell level-4"></div>
              <span>Plus</span>
            </div>
          </section>
        </div>
        
        <div className="dashboard-right-col">
          {/* Stats Row */}
          <div className="stats-row">
            <div className="glass-panel stat-card streak-card glass-panel-interactive" style={{ position: 'relative', overflow: 'visible' }}>
              <div className="streak-glow"></div>
              <div className="stat-icon purple"><Zap size={28} /></div>
              <div className="stat-info">
                <span className="stat-label">Série de focus</span>
                <div className="stat-value highlight-streak">
                  <span className="streak-text">
                    {streak} Jour{streak > 1 ? 's' : ''}
                  </span>
                  <span className={streak > 1 ? 'animated' : ''}>
                    <span className="fire-emoji" style={getFlameStyle(streak)}>🔥</span>
                  </span>
                </div>
                <span className="streak-hint">{getStreakMessage()}</span>
              </div>

              {streak <= 1 && parseInt(localStorage.getItem('mindset_lost_streak') || '0', 10) > 1 && (
                <div className="ai-streak-warning">
                  <div className="ai-warning-bubble">
                    <strong>Coach IA</strong> : Tu as perdu ta série de {localStorage.getItem('mindset_lost_streak')} jours. Reprends-toi en main, on reconstruit ça dès aujourd'hui !
                  </div>
                </div>
              )}
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
  
          <section className="glass-panel routines-section" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="section-header" style={{ marginBottom: '20px' }}>
              <div className="chart-tabs" style={{ width: '100%', display: 'flex' }}>
                <button 
                  className={`chart-tab ${activeRightTab === 'routines' ? 'active' : ''}`} 
                  onClick={() => { playClickSound(); setActiveRightTab('routines'); }} 
                  style={{ flex: 1, textAlign: 'center', fontSize: '0.95rem' }}>
                  ⚡ Routines
                </button>
                <button 
                  className={`chart-tab ${activeRightTab === 'nutrition' ? 'active' : ''}`} 
                  onClick={() => { playClickSound(); setActiveRightTab('nutrition'); }} 
                  style={{ flex: 1, textAlign: 'center', fontSize: '0.95rem' }}>
                  🍏 Alimentation
                </button>
              </div>
            </div>

            <div style={{ display: activeRightTab === 'routines' ? 'flex' : 'none', flexDirection: 'column' }}>
              <div className="section-header routine-carousel-header" style={{ flexShrink: 0 }}>
                <button className="carousel-nav-btn" onClick={prevRoutine} disabled={isAnimating}><ChevronLeft size={24} /></button>
                <div className="routine-title-container">
                  <h3 className={slideDirection}>{currentGroup.title}</h3>
                </div>
                <button className="carousel-nav-btn" onClick={nextRoutine} disabled={isAnimating}><ChevronRight size={24} /></button>
              </div>
              
              <div className={`routine-transition-wrapper ${slideDirection}`} style={{ display: 'flex', flexDirection: 'column' }}>
                <p className="section-desc mb-3" style={{ textAlign: 'center', width: '100%', flexShrink: 0 }}>{currentGroup.desc}</p>
                <div className="routine-list" style={{ paddingRight: '4px', paddingBottom: '10px' }}>
                  <span className="time-est glass-badge mb-3" style={{ alignSelf: 'center', display: 'flex', margin: '0 auto', width: 'fit-content' }}>
                    {Array.isArray(currentGroup.items) ? currentGroup.items.filter((r: any) => !r.done).length : 0} tâche(s) restante(s)
                  </span>
                  
                  {Array.isArray(currentGroup.items) && currentGroup.items.map((routine: any) => (
                    <div key={routine.id} className={`routine-item ${routine.done ? 'done' : ''} glass-panel-interactive`}>
                      <div className="routine-checkbox" onClick={(e) => toggleRoutine(e, routine.id)}>
                        {routine.done ? <CheckCircle2 size={18} /> : <Circle size={18} color="rgba(255,255,255,0.4)" />}
                      </div>
                      <div className="routine-content" style={{ display: 'flex', flex: 1, gap: '10px', alignItems: 'center' }}>
                        {editingId === routine.id ? (
                          <>
                            <input 
                              type="text" 
                              className="routine-edit-input" 
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveEditing(routine.id)}
                              autoFocus
                              style={{ flex: 1 }}
                            />
                            <input 
                              type="text" 
                              className="routine-edit-input" 
                              value={editTime}
                              onChange={e => setEditTime(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveEditing(routine.id)}
                              style={{ width: '70px', textAlign: 'center' }}
                            />
                          </>
                        ) : (
                          <>
                            <span className="routine-title">{routine.title}</span>
                            <span className="routine-time">{routine.time}</span>
                          </>
                        )}
                      </div>
                      {editingId === routine.id ? (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="routine-edit-btn" onClick={() => saveEditing(routine.id)}>
                            <CheckCircle2 size={14} color="#3b82f6" />
                          </button>
                          <button className="routine-edit-btn" onClick={() => deleteRoutine(routine.id)}>
                            <Trash2 size={14} color="#ef4444" />
                          </button>
                        </div>
                      ) : (
                        <button className="routine-edit-btn" onClick={() => startEditing(routine)}>
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  ))}

                  <button className="add-routine-btn" onClick={addNewRoutine}>
                    <Plus size={16} /> Ajouter une tâche
                  </button>
                </div>
              </div>

              <div className="carousel-dots" style={{ flexShrink: 0, marginTop: 'auto', paddingTop: '15px' }}>
                {routineGroups.map((_, idx) => (
                  <div 
                    key={idx} 
                    className={`carousel-dot ${idx === currentRoutineIndex ? 'active' : ''}`}
                    onClick={() => {
                      if (idx !== currentRoutineIndex && !isAnimating) {
                        setIsAnimating(true);
                        setCurrentRoutineIndex(idx);
                        setSlideDirection(idx > currentRoutineIndex ? 'slide-in-right' : 'slide-in-left');
                        
                        setTimeout(() => {
                          setSlideDirection('none');
                          setIsAnimating(false);
                        }, 300);
                      }
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: activeRightTab === 'nutrition' ? 'flex' : 'none', flexDirection: 'column' }}>
              <div className="routine-list" style={{ paddingRight: '4px', paddingBottom: '10px' }}>
                {nutritionList.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--secondary)' }}>
                    <p style={{ fontSize: '0.9rem', textAlign: 'center', margin: '20px 0' }}>
                      Aucun plan nutritionnel défini.<br/>Demande à {aiName} !
                    </p>
                  </div>
                ) : (
                  nutritionList.map((item: any) => (
                    <div key={item.id} className={`routine-item ${item.done ? 'done' : ''} glass-panel-interactive`} style={{ minHeight: '65px' }}>
                      <div className="routine-checkbox" onClick={(e) => toggleNutrition(e, item.id)}>
                        {item.done ? <CheckCircle2 size={18} /> : <Circle size={18} color="rgba(255,255,255,0.4)" />}
                      </div>
                      <div className="routine-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '6px' }}>
                        {editingId === item.id ? (
                          <>
                            <input 
                              type="text" 
                              className="routine-edit-input" 
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveNutritionEditing(item.id)}
                              autoFocus
                              style={{ width: '100%', marginBottom: '4px' }}
                              placeholder="Titre du repas"
                            />
                            <input 
                              type="text" 
                              className="routine-edit-input" 
                              value={editTime}
                              onChange={e => setEditTime(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveNutritionEditing(item.id)}
                              style={{ width: '100%', fontSize: '0.8rem', color: 'var(--secondary)' }}
                              placeholder="Détails (ex: 500 kcal, 40g prot)"
                            />
                          </>
                        ) : (
                          <>
                            <span className="routine-title" style={{ fontSize: '1rem', fontWeight: 600 }}>{item.title}</span>
                            <span className="routine-time" style={{ fontSize: '0.85rem', color: 'var(--secondary)' }}>{item.details}</span>
                          </>
                        )}
                      </div>
                      {editingId === item.id ? (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="routine-edit-btn" onClick={() => saveNutritionEditing(item.id)}>
                            <CheckCircle2 size={14} color="#3b82f6" />
                          </button>
                          <button className="routine-edit-btn" onClick={() => deleteNutrition(item.id)}>
                            <Trash2 size={14} color="#ef4444" />
                          </button>
                        </div>
                      ) : (
                        <button className="routine-edit-btn" onClick={() => { setEditingId(item.id); setEditTitle(item.title); setEditTime(item.details); }}>
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  ))
                )}
                <button className="add-routine-btn" onClick={addNewNutrition} style={{ marginTop: '10px' }}>
                  <Plus size={16} /> Ajouter un repas
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
      
    </div>
  );
};
