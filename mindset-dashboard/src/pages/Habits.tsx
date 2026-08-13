import React, { useState, useEffect, useRef } from 'react';
import { Trophy, TrendingUp, Calendar, Zap, AlertTriangle, Play, Edit2, Pencil, Trash2, Plus, Target, BookOpen, Dumbbell, Brain, Coffee, Sparkles, X } from 'lucide-react';
import { playLevelUpSound, playClickSound, playErrorSound, playBloopSound } from '../utils/sounds';
import { getSecurePoints, setSecurePoints } from '../utils/secureStorage';
import { annoncerGain } from '../utils/journee';
import { api } from '../services/api';
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

const INITIALES_JOURS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/*
  Les paliers d'une série, et ce qu'il reste à faire pour atteindre le prochain.

  Le nombre de jours était affiché seul, à côté d'un éclair. Un chiffre nu ne dit
  ni où il mène ni ce qu'on risque de perdre : « 3 » ne pèse rien, « encore 4 pour
  la semaine parfaite » fait revenir demain. C'est toute la différence entre un
  compteur et un enjeu.
*/
const PALIERS_SERIE = [3, 7, 14, 30, 60, 100, 365];

function prochainPalier(serie: number): { cible: number; restant: number } | null {
  const cible = PALIERS_SERIE.find((p) => p > serie);
  return cible ? { cible, restant: cible - serie } : null;
}

function nomPalier(cible: number): string {
  if (cible === 3) return 'le cap des 3 jours';
  if (cible === 7) return 'la semaine parfaite';
  if (cible === 14) return 'les deux semaines';
  if (cible === 30) return 'le mois complet';
  if (cible === 365) return "l'année entière";
  return `les ${cible} jours`;
}

// L'XP restant avant le niveau suivant, calculé à l'envers de `calculateLevel`
// pour que la barre et le nombre ne puissent pas se contredire.
function xpDuNiveau(niveau: number): number {
  return 50 * Math.pow(niveau - 1, 2);
}

function libelleJourHabitude(cle: string, fait: boolean, avantLeDebut: boolean): string {
  const date = new Date(cle).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (avantLeDebut) return `${date} — habitude pas encore commencée`;
  return fait ? `${date} — tenue` : `${date} — manquée`;
}

export const Habits: React.FC<HabitsProps> = ({ onOpenChat }) => {
  const [habits, setHabits] = useState<Habit[]>(() => {
    const saved = localStorage.getItem('mindset_habits');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) throw new Error('Not an array');
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
    // Aucune habitude par défaut.
    //
    // Un compte neuf en recevait deux, déjà créditées : « Lecture » niveau 2 avec
    // 120 XP et marquée faite aujourd'hui, « Méditation » niveau 4 avec 450 XP.
    // C'est une progression fabriquée, offerte à quelqu'un qui vient d'arriver, dans
    // une application dont le produit est justement de mesurer ce qu'on a vraiment
    // fait. Le premier score et la première série en héritaient.
    return [];
  });

  const [points, setPoints] = useState(() => getSecurePoints());
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';
  const heatmapDays = generateHeatmapDays(14);

  // AI Commentary State
  const [aiMessage, setAiMessage] = useState<{text: string, visible: boolean}>({text: '', visible: false});

  // Edit Modal State
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  // La carte qui vient de passer un niveau, le temps de son éclat.
  const [habitFetee, setHabitFetee] = useState<string | null>(null);

  // Le jour touché dans la bande des quatorze jours, et sur quelle carte : deux
  // cartes ne peuvent pas afficher une lecture en même temps.
  const [jourLu, setJourLu] = useState<{ habitId: string; jour: string } | null>(null);

  useEffect(() => {
    localStorage.setItem('mindset_habits', JSON.stringify(habits));
  }, [habits]);

  // Écouter les changements venant de l'IA (storage)
  useEffect(() => {
    const handleStorage = () => {
      try {
        const saved = localStorage.getItem('mindset_habits');
        if (saved) setHabits(JSON.parse(saved));
      } catch (e) {}
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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
    } else {
      playBloopSound();
    }

    // Trigger shockwave effect instead of confetti
    window.dispatchEvent(new CustomEvent('triggerShockwave', { 
      detail: { x, y, color } 
    }));
  };

  const toggleHabitToday = (e: React.MouseEvent, habitId: string) => {
    // Haptic feedback for satisfaction
    if ('vibrate' in navigator) {
      navigator.vibrate([15, 10, 15]);
    }

    const today = getTodayKey();
    let habitCompletedNow = false;
    let leveledUp = false;
    let nouveauNiveau = 1;
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
          nouveauNiveau = newLevel;

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
      setSecurePoints(newPoints);
      window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));

      /*
        La récompense se voyait au hasard : le « +15 Coins » ne s'affichait que
        dans le message du coach, et seulement une fois sur trois (`Math.random`).
        Le reste du temps, valider une habitude ne rapportait visiblement rien.
        Le chiffre part maintenant du bouton, à chaque fois, dans la couleur de
        l'habitude — et le passage de niveau prend la place juste après.
      */
      annoncerGain(`+${pointsGained}`, { x: e.clientX, y: e.clientY }, false, habitColor);
      if (leveledUp) {
        setHabitFetee(habitId);
        setTimeout(() => setHabitFetee((actuel) => (actuel === habitId ? null : actuel)), 1400);
        setTimeout(
          () => annoncerGain(`Niveau ${nouveauNiveau}`, { x: e.clientX, y: e.clientY - 34 }, false, habitColor),
          260,
        );
      }

      // Le solde qui autorise l'IA est tenu par le serveur ; la clé porte le jour
      // pour qu'une habitude ne rapporte qu'une fois par jour.
      api.claimCoins(`habit-${habitId}-${today}`);

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
      setSecurePoints(newPoints);
      window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));
      annoncerGain(`−${pointsGained}`, { x: e.clientX, y: e.clientY }, true);
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
    playClickSound();
    if (!editingHabit) return;
    if (habits.find(h => h.id === editingHabit.id)) {
      setHabits(habits.map(h => h.id === editingHabit.id ? editingHabit : h));
    } else {
      setHabits([...habits, editingHabit]);
    }
    setEditingHabit(null);
  };

  const deleteHabit = () => {
    playClickSound();
    if (editingHabit) {
      setHabits(habits.filter(h => h.id !== editingHabit.id));
      setEditingHabit(null);
    }
  };

  const openNewHabitModal = () => {
    playClickSound();
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
    <div className="habits-container fade-in">
      
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
          <button className="btn-primary glass-panel-interactive pulse-glow" onClick={() => { playClickSound(); onOpenChat(); }}>
            <Sparkles size={18} />
            Parler à {aiName}
          </button>
        </div>
      </header>

      {/* Les deux habitudes préremplies masquaient l'absence d'état vide : sans elles,
          la page ne montrait plus rien du tout. Ici on nomme la situation et on donne
          la seule action qui a du sens à ce moment-là — demander au coach. */}
      {habits.length === 0 && (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <h3 style={{ marginBottom: '8px' }}>Aucune habitude pour l'instant</h3>
          <p className="subtitle" style={{ marginBottom: '20px' }}>
            Une habitude tenue vaut mieux que dix commencées. Commence par une seule.
          </p>
          <button
            className="btn-primary glass-panel-interactive pulse-glow"
            onClick={() => { playClickSound(); onOpenChat(); }}
          >
            <Sparkles size={18} />
            Demander à {aiName}
          </button>
        </div>
      )}

      {/*
        Le bilan du jour.

        La page alignait des cartes sans jamais dire où en était la journée : pour
        savoir s'il restait quelque chose à tenir, il fallait descendre et lire
        chaque bouton. Une ligne suffit à répondre, et c'est elle qui donne à la
        page un début et une fin.
      */}
      {habits.length > 0 && (() => {
        const tenues = habits.filter((h) => h.history.includes(getTodayKey())).length;
        const meilleure = habits.reduce((max, h) => Math.max(max, calculateStreak(h.history)), 0);
        const part = Math.round((tenues / habits.length) * 100);
        const tout = tenues === habits.length;

        return (
          <section className={`habits-bilan glass-panel ${tout ? 'complet' : ''}`}>
            <div className="habits-bilan-tete">
              <strong>
                {tenues} / {habits.length}
              </strong>
              <span>{tout ? 'toutes tenues aujourd’hui' : 'tenues aujourd’hui'}</span>
            </div>
            <div className="habits-bilan-jauge">
              <div className="habits-bilan-remplie" style={{ width: `${part}%` }} />
            </div>
            <div className="habits-bilan-serie">
              <Zap size={15} />
              <span>
                meilleure série <strong>{meilleure} j</strong>
              </span>
            </div>
          </section>
        );
      })()}

      <div className="habits-grid">
        {habits.map(habit => {
          const isDoneToday = habit.history.includes(getTodayKey());
          const streak = calculateStreak(habit.history);
          const isSubscribed = localStorage.getItem('mindset_is_subscribed') === 'true';
          const isIronFocus = streak >= 7 && isSubscribed;
          const palier = prochainPalier(streak);
          // Avant sa première validation, l'habitude n'existait pas : ses jours ne
          // sont pas des échecs. Même distinction que sur le damier de l'année.
          const debut = habit.history.length > 0 ? [...habit.history].sort()[0] : getTodayKey();
          const xpNiveau = xpDuNiveau(habit.level);
          const xpSuivant = xpDuNiveau(habit.level + 1);
          const dansLeNiveau = Math.max(0, habit.xp - xpNiveau);
          const largeurNiveau = Math.max(1, xpSuivant - xpNiveau);
          const lecture = jourLu?.habitId === habit.id ? jourLu.jour : null;

          return (
            <div
              key={habit.id}
              className={`habit-card glass-panel-interactive glass-liquid ${isDoneToday ? 'done' : ''} ${isIronFocus ? 'iron-focus' : ''} ${habitFetee === habit.id ? 'niveau-passe' : ''}`}
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
                    <span className="habit-level">Niv. {habit.level}</span>
                    <div className="xp-bar-bg">
                      <div className="xp-bar-fill" style={{ width: `${(dansLeNiveau / largeurNiveau) * 100}%`, backgroundColor: habit.color }}></div>
                    </div>
                    {/* Le chiffre manquait : une barre seule ne dit pas si le
                        prochain niveau est à une validation ou à dix. */}
                    <span className="habit-xp">{dansLeNiveau}/{largeurNiveau} XP</span>
                  </div>
                </div>
                <div className="habit-streak">
                  <span className="streak-num">{streak}</span>
                  <Zap size={16} className={`streak-icon ${streak > 0 ? 'active' : ''}`} style={{ color: streak > 0 ? '#fcd34d' : 'var(--secondary)' }} />
                </div>

                <button className="edit-habit-btn" onClick={() => { playClickSound(); setEditingHabit(habit); }}>
                  <Pencil size={14} />
                </button>
              </div>

              <div className="habit-quinzaine">
                <div className="habit-jours">
                  {heatmapDays.map(day => {
                    const fait = habit.history.includes(day);
                    const aujourdhui = day === getTodayKey();
                    const avant = day < debut;
                    return (
                      /*
                        Un bouton, et l'initiale du jour dessous : la bande était
                        une rangée de carrés muets, sans axe et sans infobulle
                        utilisable au doigt. On ne pouvait pas dire quel carré
                        était quel jour, ni distinguer un jour manqué d'un jour
                        antérieur à l'habitude.
                      */
                      <button
                        key={day}
                        type="button"
                        className={`habit-jour ${fait ? 'tenu' : ''} ${aujourdhui ? 'aujourdhui' : ''} ${avant ? 'avant' : ''} ${lecture === day ? 'choisi' : ''}`}
                        style={fait ? { backgroundColor: habit.color, borderColor: habit.color } : undefined}
                        onClick={() => setJourLu(lecture === day ? null : { habitId: habit.id, jour: day })}
                        aria-label={libelleJourHabitude(day, fait, avant)}
                      >
                        <span className="habit-jour-initiale">{INITIALES_JOURS[new Date(day).getDay()]}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="habit-lecture">
                  {lecture
                    ? libelleJourHabitude(lecture, habit.history.includes(lecture), lecture < debut)
                    : palier
                      ? `Encore ${palier.restant} jour${palier.restant > 1 ? 's' : ''} pour ${nomPalier(palier.cible)}.`
                      : 'Série maximale atteinte.'}
                </p>
              </div>

              <div className="habit-actions">
                <button
                  className={`btn-habit-complete ${isDoneToday ? 'completed' : ''}`}
                  onClick={(e) => toggleHabitToday(e, habit.id)}
                  style={{
                    backgroundColor: '#000',
                    borderColor: isDoneToday ? habit.color : 'rgba(255,255,255,0.2)',
                    color: '#fff',
                    boxShadow: isDoneToday ? `0 0 15px ${habit.color}40` : 'none'
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
        <div className="modal-backdrop" onClick={() => { playClickSound(); setEditingHabit(null); }}>
          <div className="modal-content glass-panel edit-habit-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { playClickSound(); setEditingHabit(null); }}><X size={20} /></button>
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
                      onClick={() => { playClickSound(); setEditingHabit({...editingHabit, icon: ic.id}); }}
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
                    onClick={() => { playClickSound(); setEditingHabit({...editingHabit, color: c.value}); }}
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
