import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CheckCircle2, TrendingUp, Sparkles, Pencil, Coins, Circle, ChevronLeft, ChevronRight, Plus, Trophy, Calendar, Trash2, Target, Lock } from 'lucide-react';
import { RankIcon } from '../components/RankIcon';
import { ProgressionRang } from '../components/ProgressionRang';
import { PartageSemaine } from '../components/PartageSemaine';
import { CarteObservation } from '../components/CarteObservation';
import { BilanSemaine } from '../components/BilanSemaine';
import { VictoryGlitchOverlay } from '../components/VictoryGlitchOverlay';
import { JarvisPopup } from '../components/JarvisPopup';
import { NotificationsOptIn } from '../components/NotificationsOptIn';
import { RelanceOffre } from '../components/RelanceOffre';
import type { JarvisPopupData } from '../components/JarvisPopup';
import { signalerJournee, annoncerGain, lireEtatDuJour, confirmerValidation, tachesDuJour } from '../utils/journee';
import { appliquerNouveauJour, ecrireGroupes, lireGroupes } from '../utils/jourRoutines';
import { noterTacheFaite } from '../utils/rythme';
import { PremiersPas } from '../components/PremiersPas';
import { CadrageManquant } from '../components/CadrageManquant';
import { lireObjectif, rafraichirObjectif, EVENEMENT_OBJECTIF } from '../utils/objectif';
import { api } from '../services/api';
import { getSecurePoints, setSecurePoints } from '../utils/secureStorage';
import { libelleJours } from '../utils/recurrence';
import { RANKS } from '../utils/ranks';
import { EVENEMENT_XP, ajouterXp, definirXp, lireProgression, xpDuNiveau } from '../utils/progression';
import { playClickSound, playBloopSound } from '../utils/sounds';
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

/*
  La phrase lue sous le damier quand on touche un carré, et l'étiquette
  d'accessibilité de ce même carré. Trois cas seulement, mais qui n'ont rien à
  voir : le jour n'existait pas encore, le jour a été manqué, le jour a compté.
*/
function libelleJour(cle: string, score: number, avantLeDebut: boolean): string {
  const date = new Date(cle).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  if (avantLeDebut) return `${date} — avant ton inscription`;
  if (score <= 0) return `${date} — rien de fait`;
  return `${date} — ${score} % de la journée`;
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

/*
  Ici vivaient `CustomTick` et `CustomTooltipContent`, deux composants écrits pour
  recharts. La bibliothèque n'est plus utilisée nulle part — les trois graphiques
  de cette page sont dessinés à la main, en SVG et en div —, et ces deux-là
  n'avaient plus d'appelant depuis. `recharts` reste dans `package.json` : c'est
  une dépendance à retirer à part, pas au détour d'un nettoyage de types.
*/

// --- COMPONENT ---

interface DashboardProps {
  onOpenChat: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onOpenChat }) => {
  const [currentDate, setCurrentDate] = useState('');
  /*
    L'année entière est réservée aux abonnés ; les trente derniers jours restent
    à tout le monde.

    C'est le même principe que le bilan de la semaine, juste au-dessus : un
    cadenas posé à côté de ses propres chiffres se comprend, un cadenas devant un
    écran vide ne vend rien. Trente jours suffisent à voir sa régularité du mois
    et ne suffisent pas à voir sa trajectoire — c'est exactement ce que
    l'abonnement ajoute.
  */
  const estAbonne = localStorage.getItem('mindset_is_subscribed') === 'true';
  const JOURS_LIBRES = 30;

  const heatmapRef = useRef<HTMLDivElement>(null);
  const routinesRef = useRef<HTMLElement>(null);
  // Le jour du damier que l'on vient de toucher, écrit en clair sous la grille.
  const [jourLu, setJourLu] = useState<string | null>(null);
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
    
    // On ne demande plus rien au chargement : la boîte du navigateur surgissait deux
    // secondes après l'arrivée, sans explication, et la réponse réflexe à ça est
    // « Bloquer » — définitif.
    //
    // La remise en place de l'abonnement déjà accordé — il meurt avec le service
    // worker, à chaque mise à jour ou vidage de données — a rejoint
    // `NotificationsOptIn`, monté juste en dessous : elle y est déclenchée par
    // l'état réel de la permission plutôt que par le montage de cet écran, ce qui
    // la fait aussi partir quand la permission arrive des réglages du téléphone.
  }, []);

  const [points, setPoints] = useState(() => getSecurePoints());

  /*
    Le niveau se lit sur l'expérience et non sur les points : ceux-ci sont la
    monnaie de la Boutique, et s'en servir pour le rang faisait rétrograder
    quiconque s'achetait un cosmétique. Le calcul vit dans `progression.ts`, seul
    endroit qui connaisse la courbe — il était recopié dans quatre fichiers.
  */
  const [progression, setProgression] = useState(() => lireProgression());
  useEffect(() => {
    const relire = () => setProgression(lireProgression());
    window.addEventListener(EVENEMENT_XP, relire);
    return () => window.removeEventListener(EVENEMENT_XP, relire);
  }, []);
  const { rang: rank } = progression;

  const handleRankClick = () => {
    // SECURITY: The only way to trigger this cheat is to manually type
    // localStorage.setItem('dev_mode', 'true') in the browser console.
    if (localStorage.getItem('dev_mode') !== 'true') {
      return;
    }

    const currentRankIndex = RANKS.findIndex(r => r.name === rank.name);
    const nextRank = RANKS[(currentRankIndex + 1) % RANKS.length];
    // Exactement le seuil du rang visé : l'ancien calcul y ajoutait 50 points,
    // reste d'une formule inverse qui ne correspondait plus à la directe.
    definirXp(xpDuNiveau(nextRank.minLevel));
    setProgression(lireProgression());
  };



  // --- ROUTINES (persisted) ---
  const [routineGroups, setRoutineGroups] = useState(() => {
    /*
      Le décochage quotidien vit dans `jourRoutines.ts`, et plus ici.

      Il ne se faisait qu'au montage de ce composant : l'application laissée
      ouverte au passage de minuit ne se décochait jamais, et la première écriture
      du lendemain datait d'aujourd'hui les coches de la veille. Le même geste est
      maintenant rejoué au retour dans l'app, à chaque minute et à la descente d'un
      état venu du serveur.
    */
    appliquerNouveauJour();
    const parsedGroups = lireGroupes();

    if (parsedGroups.length > 0) return parsedGroups;

    // Les trois créneaux, vides.
    //
    // Ils arrivaient remplis de neuf tâches inventées — méditation, visualisation,
    // marche digestive — que personne n'avait choisies. Dans une application de
    // discipline, un programme qu'on n'a pas décidé ne se suit pas : il se coche par
    // acquit de conscience, ou il se supprime. Et il fausse le score du premier jour.
    //
    // La structure reste pour que l'écran montre où se rangent les choses, et pour
    // que le plan produit par le coach ait des créneaux où atterrir.
    return [
      { id: 'morning', title: 'Routine Matinale', desc: 'Prépare ton esprit pour la journée', items: [] },
      { id: 'midday', title: 'Routine du Midi', desc: "Recharge tes batteries pour l'après-midi", items: [] },
      { id: 'evening', title: 'Routine du Soir', desc: 'Décompresse et prépare demain', items: [] }
    ];
  });

  useEffect(() => {
    // Les coches et leur date partent ensemble : voir `ecrireGroupes`.
    ecrireGroupes(routineGroups);
    /*
      Prévenir le bandeau, qui vit dans le Layout et lit `localStorage` de son
      côté. C'est un événement à lui, et surtout pas `storage` : celui-ci
      réveillerait l'écouteur juste au-dessus, qui rechargerait les routines,
      donc relancerait cet effet — une boucle sans fin.
    */
    signalerJournee();
  }, [routineGroups]);

  // Écouter les changements venant de l'IA (storage)
  useEffect(() => {
    const handleStorage = () => {
      /*
        Ce qui arrive ici peut venir du serveur, donc d'un autre jour. On le ramène
        à aujourd'hui avant de l'afficher : sans ça, l'effet ci-dessus redatait
        d'aujourd'hui des coches de la veille, et les renvoyait au serveur comme
        une journée déjà faite.
      */
      appliquerNouveauJour();
      if (localStorage.getItem('mindset_routines') === null) return;
      setRoutineGroups(lireGroupes());
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
    
    const updated = nutritionList.map((n: any) => {
      if (n.id === id) {
        if (!n.done) {
          const popupX = Math.min(e.clientX, window.innerWidth - 340);
          setJarvisPopup({ x: popupX, y: e.clientY, title: n.title || 'Nutrition', itemType: 'objective' });
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
  // Seules les tâches prévues aujourd'hui entrent dans le score.
  //
  const totalRoutines = Array.isArray(routineGroups) ? routineGroups.reduce((acc: number, group: any) => acc + tachesDuJour(group).length, 0) : 0;
  const doneRoutines = Array.isArray(routineGroups) ? routineGroups.reduce((acc: number, group: any) => acc + tachesDuJour(group).filter((i: any) => i.done).length, 0) : 0;

  const [bonusScore, setBonusScore] = useState(0);

  // Listen to storage events so when Objectives change, we recalculate bonus
  useEffect(() => {
    const handleStorage = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('mindset_micro_obj') || '[]');
        if (Array.isArray(saved)) {
          const todayKey = getTodayKey();

          // Le score ne bougeait qu'à l'achèvement complet. Or un objectif de la
          // semaine se compte souvent en sept fois : avancer de 0 à 6 sur 7 dans la
          // journée ne rapportait rien du tout, et la personne pouvait travailler
          // toute la soirée en regardant son score rester à zéro. Chaque objectif
          // pèse toujours 10 points, mais au prorata de ce qui a été fait.
          //
          // La date reste le garde-fou : seuls les objectifs avancés aujourd'hui
          // comptent. Sans elle, un objectif terminé lundi maintiendrait le score
          // au-dessus de zéro toute la semaine, et la série ne voudrait plus rien
          // dire puisqu'elle se lit sur ce score.
          const currentBonus = saved.reduce((acc: number, o: any) => {
            if (o?.awardedDate !== todayKey) return acc;
            const total = Number(o.total) > 0 ? Number(o.total) : 1;
            const part = o.done ? 1 : Math.min(1, Math.max(0, Number(o.progress) || 0) / total);
            return acc + part * 10;
          }, 0);
          setBonusScore(Math.round(currentBonus));
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
    // Second signal : la série du bandeau se lit sur les scores quotidiens, qui
    // viennent d'être écrits — celui de l'effet des routines est parti avant.
    signalerJournee();
  }, [mentalScore]);

  // --- STREAK & HARDCORE MODE ---
  //
  // La série n'est plus affichée ici — elle est dans le bandeau, qui la recalcule
  // de son côté. L'effet plus bas reste : c'est lui qui détecte une série brisée,
  // écrit `mindset_lost_streak`, prévient le coach et retire les 50 points.
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
        
        // La pénalité porte sur la monnaie, jamais sur l'expérience : une série
        // perdue se paie déjà par la perte de la série, elle n'a pas en plus à
        // effacer du parcours déjà accompli. Avant la séparation des deux
        // compteurs, ces 50 points pouvaient coûter un rang (4050 → 4000 faisait
        // retomber Initié à Novice).
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

    // `mindset_lost_streak` vient d'être écrite ou effacée, et c'est elle qui
    // décide de la ligne d'alerte du bandeau. Le signal envoyé par l'effet du
    // score est parti avant celui-ci : sans ce second appel, l'alerte resterait
    // affichée une manœuvre de trop.
    signalerJournee();
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

  /**
   * Nombre de jours vécus au-delà duquel le graphique et le damier valent la place
   * qu'ils prennent.
   *
   * Trois, parce que c'est le premier chiffre à partir duquel une courbe montre une
   * direction et un damier montre une régularité. En dessous, ils affichent la même
   * chose pour tout le monde : une ligne plate et une année vide.
   */
  const JOURS_AVANT_HISTORIQUE = 3;

  const aAssezDHistorique = useMemo(() => {
    const scores = loadDailyScores();
    return Object.values(scores || {}).filter((s: any) => Number(s) > 0).length >= JOURS_AVANT_HISTORIQUE;
    // `mentalScore` change à chaque case cochée : c'est ce qui fait réapparaître les
    // deux blocs le jour où le troisième s'ajoute, sans recharger la page.
  }, [mentalScore]);

  /*
    Ce que la personne a déclaré vouloir devenir.

    Lu depuis le cache local pour être affiché dès le premier rendu, puis rafraîchi
    depuis le serveur — qui fait autorité, et que relit le coach.
  */
  const [objectifDeclare, setObjectifDeclare] = useState<string | null>(() => lireObjectif());

  useEffect(() => {
    rafraichirObjectif().then(setObjectifDeclare).catch(() => {});
    const surObjectif = (e: Event) => setObjectifDeclare((e as CustomEvent).detail ?? lireObjectif());
    window.addEventListener(EVENEMENT_OBJECTIF, surObjectif);
    return () => window.removeEventListener(EVENEMENT_OBJECTIF, surObjectif);
  }, []);

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

  /*
    « Voir cette tâche dans la liste », demandé depuis le bandeau du Layout.

    Le créneau visé arrive par `localStorage` parce que le bandeau peut cliquer
    depuis une page où ce composant n'existe pas : la clé est relue au montage.
    L'événement couvre le cas inverse, celui où l'on est déjà sur le tableau de
    bord et où aucun montage ne viendra la relire. Sans ce déplacement du
    carrousel, on atterrirait sur la liste d'un autre moment de la journée.
  */
  useEffect(() => {
    const rejoindreCreneau = () => {
      const cible = localStorage.getItem('mindset_dashboard_creneau');
      if (cible === null) return;
      localStorage.removeItem('mindset_dashboard_creneau');
      const index = parseInt(cible, 10);
      if (Number.isNaN(index)) return;
      setActiveRightTab('routines');
      setCurrentRoutineIndex(index);
      routinesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    rejoindreCreneau();
    window.addEventListener('mindset:aller-creneau', rejoindreCreneau);
    return () => window.removeEventListener('mindset:aller-creneau', rejoindreCreneau);
  }, []);

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

  /**
   * La part de la journée faite, telle que l'anneau la montre.
   *
   * Comptée sur les tâches **du jour** avec la même fonction que le score
   * (`tachesDuJour`) : un anneau qui compterait les tâches du mardi un lundi
   * n'atteindrait jamais son terme, et la journée pleine ne se fermerait jamais.
   *
   * Calculée sur les groupes qu'on s'apprête à enregistrer, pas sur ceux du
   * stockage : l'écriture n'a pas encore eu lieu quand la marque part.
   */
  const partDuJour = (groupes: any[]): number | undefined => {
    let total = 0;
    let faites = 0;
    for (const groupe of Array.isArray(groupes) ? groupes : []) {
      for (const tache of tachesDuJour(groupe)) {
        total++;
        if (tache.done) faites++;
      }
    }
    return total > 0 ? faites / total : undefined;
  };

  const toggleRoutine = (e: React.MouseEvent, id: number) => {
    // Haptic feedback
    if ('vibrate' in navigator) navigator.vibrate([15, 10, 15]);

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
      // L'heure, et rien d'autre : c'est elle qui permettra au coach d'observer
      // quand cette personne travaille réellement. Voir `utils/rythme.ts`.
      noterTacheFaite();
      playBloopSound();
      // Une seule marque, et elle mesure : l'onde partait deux fois, ici et dans
      // `triggerDopamine`, pour une seule case cochée.
      confirmerValidation({ x: e.clientX, y: e.clientY }, partDuJour(newGroups));
      const newPoints = points + 5;
      setPoints(newPoints);
      setSecurePoints(newPoints);
      ajouterXp(5);
      window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));
      // Le même chiffre volant que depuis le bandeau : la récompense doit se lire
      // au doigt, pas dans un compteur situé à l'autre bout de l'écran.
      annoncerGain('+5', { x: e.clientX, y: e.clientY });

      // Le solde qui autorise l'IA est tenu par le serveur. La clé porte la tâche et
      // le jour : décocher puis recocher ne recrédite donc pas.
      if (toggledItem) {
        api.claimCoins(`routine-${toggledItem.title || 'tache'}-${new Date().toISOString().slice(0, 10)}`);
      }

      if (toggledItem) {
        const popupX = Math.min(e.clientX, window.innerWidth - 340);
        setJarvisPopup({
          x: popupX,
          y: e.clientY,
          title: toggledItem.title || 'Tâche',
          itemType: 'routine'
        });
      }
    } else {
      const newPoints = Math.max(0, points - 5);
      setPoints(newPoints);
      setSecurePoints(newPoints);
      ajouterXp(-5); // Annulation d'un gain, pas une dépense.
      window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));
      annoncerGain('−5', { x: e.clientX, y: e.clientY }, true);
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


  // `getFlameStyle` a suivi la flamme dans BandeauCommande.tsx, seul endroit qui
  // l'affiche depuis que la carte de série a été retirée.

  const aiName = localStorage.getItem('mindset_ai_name') || 'DISCIPLIX OS';

  // Les tâches d'aujourd'hui, telles que le bandeau les compte — mêmes formules,
  // un seul endroit de calcul, sinon les deux affichent des chiffres différents.
  const { faites: routineDone, total: routineTotal } = lireEtatDuJour();

  /*
    La boucle est bouclée : cap posé, plan reçu, première case cochée.

    Sans cette trace, la carte des premiers pas restait à l'écran jusqu'au troisième
    jour vécu — la seule condition qui la retirait était celle qui ramène le graphe
    et le damier. Quelqu'un qui finissait les trois étapes en dix minutes gardait
    donc pendant trois jours un tutoriel entièrement barré, sans bouton, sans rien
    à faire dessus.

    La trace est nécessaire parce que les tâches se décochent chaque nuit :
    `routineDone` retombe à zéro le lendemain, et une carte conditionnée aux seules
    étapes du jour reviendrait le matin après avoir été terminée la veille. Un
    tutoriel qui réapparaît est pire que celui qui s'attarde.
  */
  const CLE_PREMIERS_PAS = 'mindset_premiers_pas_faits';

  /*
    « Coche la première » est un jalon, pas une exigence quotidienne.

    Le mesurer sur `routineDone` seul le rendait faux dès le lendemain : les tâches
    se décochent la nuit, si bien que quelqu'un qui avait coché sa première case
    hier repassait pour « pas encore commencé » ce matin — et la trace de fin
    n'aurait jamais été écrite pour lui. On regarde donc aussi l'historique : une
    seule journée à score non nul prouve que le geste a déjà eu lieu.
  */
  const aDejaCocheUneFois = useMemo(() => {
    if (routineDone > 0) return true;
    const scores = loadDailyScores();
    return Object.values(scores || {}).some((s: any) => Number(s) > 0);
  }, [routineDone, mentalScore]);

  const tousLesPremiersPasFaits = !!objectifDeclare && routineTotal > 0 && aDejaCocheUneFois;

  useEffect(() => {
    if (tousLesPremiersPasFaits) localStorage.setItem(CLE_PREMIERS_PAS, 'true');
  }, [tousLesPremiersPasFaits]);

  /*
    Lu au montage seulement, et volontairement.

    La carte reste donc visible jusqu'à la fin de la visite où l'on coche sa dernière
    étape : on voit les trois lignes se barrer, ce qui est toute la récompense de
    l'exercice, puis elle a disparu au retour suivant. La faire s'évanouir sous le
    doigt à l'instant du clic retirerait la seule chose qu'elle avait à donner.
  */
  const [premiersPasDejaTermines] = useState(() => localStorage.getItem(CLE_PREMIERS_PAS) === 'true');

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
            {/*
              La date et le rang tiennent sur la même ligne.

              Le rang suivait le « Bonjour », et sur un téléphone le titre occupe
              toute la largeur : le badge retombait donc systématiquement à la ligne,
              coûtant une bande entière du premier écran pour une information de
              second plan. À côté de la date, il ne coûte rien — ce sont deux
              renseignements de contexte, ils vont ensemble.
            */}
            <div className="dashboard-meta">
              <p className="date-display">{currentDate.toUpperCase()}</p>
              <div
                className={`rank-badge ${rank.cssClass || ''}`}
                onClick={handleRankClick}
                style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: 'rgba(0,0,0,0.3)', padding: '3px 10px',
                borderRadius: '20px', border: `1px solid ${rank.color}60`,
                color: rank.color, boxShadow: `0 0 15px ${rank.color}40`,
                fontSize: '0.78rem', fontWeight: 600, backdropFilter: 'blur(10px)',
                cursor: 'pointer', transition: 'transform 0.3s, opacity 0.3s, background-color 0.3s, border-color 0.3s, box-shadow 0.3s, color 0.3s'
              }}>
                <RankIcon iconName={rank.iconName} size={14} /> {rank.name}
              </div>
            </div>
            {/*
              Le badge disait le rang sans jamais dire ce qui mène au suivant. Une
              ligne de 4 px suffit à transformer une étiquette en objectif.
            */}
            <ProgressionRang />
            <h1>Bonjour, {localStorage.getItem('mindset_user_name') || 'Champion'} 👋</h1>
            {/*
              « L'assistant IA est prêt. Dominons cette journée. » a été retiré.
              Cette ligne occupait la troisième position du tableau de bord sans rien
              apprendre : ni où on en est, ni quoi faire. Le bouton juste en dessous
              dit déjà que le coach est joignable, et le reste de l'écran doit parler
              de la journée de la personne, pas de l'état du logiciel.

              À sa place, la seule phrase qui explique pourquoi on coche des cases
              tous les jours. Elle est demandée à l'inscription — « quel est ton
              objectif numéro 1 ici ? » — puis elle partait en base pour n'être lue
              que par le prompt du coach, et n'était plus jamais réaffichée. Sans
              elle, l'application est un tableau de bord posé sur rien, et
              l'abonnement se vend comme un compteur épuisé plutôt que comme la
              personne qu'on essaie de devenir.

              Elle est modifiable depuis le Profil : figée sur ce qu'on a coché en
              trente secondes le jour de l'inscription, elle deviendrait un reproche.
            */}
            {objectifDeclare && (
              <p className="objectif-declare" title="Modifiable depuis ton profil">
                <Target size={14} />
                <span>
                  Tu veux <strong>{objectifDeclare.charAt(0).toLocaleLowerCase('fr-FR') + objectifDeclare.slice(1)}</strong>
                </span>
              </p>
            )}
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

      {/* Le bandeau de commandement est rendu par le Layout : il vit sur tous les
          onglets, pas seulement ici. */}

      <NotificationsOptIn />
      {/* Après la carte des notifications : les deux ne s'affichent presque jamais
          ensemble (l'une part au bout de trois jours de report, l'autre ne commence
          qu'au troisième jour), et si cela arrive, c'est l'abonnement qui cède le pas. */}
      <RelanceOffre />

      {/*
        Les comptes ouverts avant que l'inscription ne demande le temps disponible et
        le point de départ ne repasseront jamais par le questionnaire : il ne se
        rejoue que pour qui n'a aucun profil. Sans cette carte, leur coach doserait
        leurs plans au hasard indéfiniment. Elle se décide côté serveur et disparaît
        dès qu'on lui a répondu.

        Placée après la relance d'abonnement, et pas avant : les deux ne peuvent se
        croiser que rarement, et si cela arrive, une question qui améliore le produit
        passe après une offre déjà retardée de trois jours — mais avant les premiers
        pas, qu'elle conditionne.
      */}
      <CadrageManquant nomCoach={aiName} />

      {/*
        Tant qu'il n'y a pas d'historique, la place du graphique et du damier
        revient à la boucle elle-même. Ici et non dans la grille : sur téléphone,
        la colonne de gauche passe après celle de droite (voir l'ordre défini dans
        la requête média des 900 px), et ces trois lignes se retrouveraient donc
        sous les routines — après ce qu'elles sont censées expliquer.
      */}
      {!aAssezDHistorique && !premiersPasDejaTermines && (
        <PremiersPas
          objectifPose={!!objectifDeclare}
          planPose={routineTotal > 0}
          premiereTacheFaite={aDejaCocheUneFois}
          nomCoach={aiName}
          onOuvrirChat={onOpenChat}
        />
      )}

      <div className={`dashboard-grid ${aAssezDHistorique ? '' : 'dashboard-grid--sans-historique'}`}>
        {/*
          Le graphique et le damier ne s'affichent qu'à partir du moment où ils ont
          quelque chose à montrer.

          Mesuré sur un compte neuf, sur iPhone : à eux deux ils occupaient 913 px,
          soit 43 % d'une page qui en faisait 2121 — pour afficher une courbe plate
          et 365 cases vides. C'est la première impression de l'application, et
          c'était celle d'un instrument de mesure branché sur rien.

          Rien n'est supprimé : ces deux blocs réapparaissent d'eux-mêmes, et ils
          valent alors beaucoup, parce qu'ils montrent quelque chose de vécu.
        */}
        {aAssezDHistorique && (
        <div className="dashboard-left-col">
          {/* Main Chart Section */}
          <section className="glass-panel chart-section glass-panel-interactive pulse-glow" style={{ transition: 'transform 0.3s ease, opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease, color 0.3s ease', cursor: 'pointer' }}>
            <div className="section-header">
              <div>
                <h3>Évolution Mentale</h3>
                {/* « Ton niveau d'énergie et de focus » : le mot Énergie est celui
                    du solde qui autorise à parler au coach. Ici on parle du score
                    de la journée, c'est-à-dire d'autre chose. */}
                <p className="section-desc">Ton score jour après jour</p>
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
                      {/*
                        Cette jauge affichait « ÉNERGIE », et le chat affiche aussi
                        une « Énergie » — qui est le solde autorisant à parler au
                        coach. Deux choses sans rapport sous le même mot, dans la
                        même application : ici c'est le score mental du jour, et
                        c'est ce que dit déjà le titre de la carte.
                      */}
                      <span className="gauge-label">MENTAL</span>
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
              {/*
                Cet onglet répondait « Données insuffisantes » à tout le monde, pour
                toujours : le message était écrit en dur, et `trendData` — six mois de
                moyennes calculées juste au-dessus à partir des scores réels — n'était
                affiché nulle part. Quelqu'un avec six mois d'historique lisait donc
                qu'il n'avait pas assez de données.

                Le message reste, mais pour ce qu'il dit : quand aucun mois n'a de
                score, il n'y a effectivement rien à tracer. Mêmes barres que l'onglet
                Semaine, faute de quoi ce serait un second graphique à entretenir.
              */}
              {activeChartTab === 'trend' && (
                trendData.some((m) => m.score > 0) ? (
                  <div className="chart-bars">
                    {trendData.map((data, i) => {
                      const estMoisCourant = i === trendData.length - 1;
                      return (
                        <div key={data.name + i} className={`bar-col ${estMoisCourant ? 'active' : ''}`}>
                          <div className="bar-track glass-panel">
                            <div className="bar-tooltip">{data.score}%</div>
                            {/* Un mois sans aucune donnée reste vide : lui donner la
                                hauteur plancher de l'onglet Semaine inventerait une
                                activité là où il n'y en a pas eu. */}
                            <div
                              className="bar-fill"
                              style={{
                                height: `${data.score > 0 ? Math.max(data.score, 5) : 0}%`,
                                background: estMoisCourant ? 'linear-gradient(to top, #3b82f6, #60a5fa)' : 'var(--accent-purple)',
                              }}
                            ></div>
                          </div>
                          <span className="bar-label">{data.name}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="trend-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--secondary)' }}>
                    <TrendingUp size={48} opacity={0.2} />
                    <span style={{ marginLeft: '15px' }}>Pas encore de quoi tracer une tendance mensuelle.</span>
                  </div>
                )
              )}
            </div>
          </section>

          {/*
            Juste sous le graphique de la semaine : c'est là qu'on vient regarder
            ce qu'on a fait, donc là qu'on peut avoir envie de le montrer. Le
            composant ne rend rien tant que la semaine n'a pas de quoi être
            montrée — proposer de publier une semaine vide serait demander à
            quelqu'un d'afficher son échec.
          */}
          <PartageSemaine />

          {/*
            Ce que le coach a remarqué, juste après le graphique de la semaine.

            C'est l'endroit où l'on vient regarder ses chiffres : c'est donc là
            qu'une phrase qui les interprète a le plus de sens. La carte ne rend
            rien tant qu'aucun motif ne tient — il faut de l'historique et des
            seuils franchis — et c'est voulu : une remarque servie à tout le monde
            tous les jours n'est plus une remarque.
          */}
          <CarteObservation onOuvrirChat={onOpenChat} />

          {/*
            Le bilan de la semaine, juste après.

            Les chiffres sont à tout le monde ; la lecture qu'en fait le coach est
            l'avantage de l'abonnement, et c'est ici qu'on peut le montrer sans le
            donner : un cadenas posé à côté de ses propres chiffres se comprend,
            un cadenas devant un écran vide ne vend rien.
          */}
          <BilanSemaine />

          {/* Heatmap Section */}
          <section className="heatmap-section glass-panel glass-panel-interactive pulse-glow fade-in delay-2" style={{ transition: 'transform 0.3s ease, opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease, color 0.3s ease', cursor: 'pointer' }}>
            <div className="section-header-flex" style={{ marginBottom: '6px' }}>
              <h3 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
                <Calendar size={18} /> {estAbonne ? 'Ton année' : `Tes ${JOURS_LIBRES} derniers jours`}
              </h3>
            </div>
            <p className="heatmap-intro">
              Un carré par jour, de gauche à droite jusqu’à aujourd’hui. Plus il est vif, plus la journée a compté.
            </p>
            {/*
              Le verrou nomme ce qui manque, pas ce qu'on perd : « ton année
              entière » est une chose qu'on peut se représenter, « fonction
              premium » n'en est pas une.
            */}
            {!estAbonne && (
              <p className="heatmap-verrou">
                <Lock size={12} /> Ton année entière, mois par mois, est réservée aux abonnés.{' '}
                <button
                  type="button"
                  className="heatmap-verrou__action"
                  onClick={() => window.dispatchEvent(new Event('openPricing'))}
                >
                  Voir l’offre
                </button>
              </p>
            )}
            {(() => {
              /*
                Les 365 derniers jours, **dans l'ordre**.

                Le tableau était retourné par un `.reverse()` : aujourd'hui se
                trouvait à gauche et l'année s'écoulait vers la droite, à rebours
                de toute lecture — et comme le conteneur se positionne à droite au
                chargement, on arrivait sur le jour le plus vieux. C'est ce qui
                rendait ce graphique illisible.
              */
              const jours = getLastNDays(estAbonne ? 365 : JOURS_LIBRES);
              const scores = loadDailyScores();
              const aujourdhui = getTodayKey();

              // Avant la première journée enregistrée, il n'y a pas « zéro », il n'y
              // a rien : le compte n'existait pas. Sans cette distinction, quelqu'un
              // qui vient de s'inscrire ouvre son tableau de bord sur trois cent
              // soixante carrés éteints, c'est-à-dire sur une année d'échecs qu'il
              // n'a pas vécue.
              const joursConnus = Object.keys(scores).sort();
              const debut = joursConnus.length > 0 ? joursConnus[0] : aujourdhui;

              const suivis = jours.filter((j) => j >= debut);
              const actifs = suivis.filter((j) => (scores[j] || 0) > 0).length;
              const presence = suivis.length > 0 ? Math.round((actifs / suivis.length) * 100) : 0;

              let record = 0;
              let courante = 0;
              for (const j of jours) {
                if ((scores[j] || 0) > 0) {
                  courante++;
                  if (courante > record) record = courante;
                } else {
                  courante = 0;
                }
              }

              const premierJour = new Date(jours[0]);
              const casesVides = premierJour.getDay() === 0 ? 6 : premierJour.getDay() - 1;

              const moisAffiches: { mois: string; colonne: number }[] = [];
              let moisCourant = -1;
              let rang = casesVides;
              jours.forEach((j) => {
                const d = new Date(j);
                if (d.getMonth() !== moisCourant) {
                  moisCourant = d.getMonth();
                  const court = d.toLocaleDateString('fr-FR', { month: 'short' });
                  moisAffiches.push({
                    /*
                      La majuscule est posée ici, et non par le `text-transform:
                      capitalize` de la feuille de style.

                      Mesuré dans l'app : la règle CSS était bien calculée sur les
                      treize libellés, mais n'était réellement appliquée que sur neuf.
                      « sept. », « avr. », « juin » et « juil. » restaient en
                      minuscule au milieu de « Oct. », « Nov. » et « Déc. » — une
                      bande de mois dont un tiers ne s'écrit pas comme les autres.
                      Vérifié par la largeur rendue, pas à l'œil : celle des quatre
                      était identique à `text-transform: none`.

                      Une majuscule décidée en JavaScript ne dépend d'aucune cascade
                      et donne le même résultat partout.
                    */
                    mois: court.charAt(0).toUpperCase() + court.slice(1),
                    colonne: Math.floor(rang / 7),
                  });
                }
                rang++;
              });

              const niveau = (score: number) => {
                if (score >= 100) return 'level-4';
                if (score >= 50) return 'level-3';
                if (score >= 20) return 'level-2';
                if (score > 0) return 'level-1';
                return 'level-0';
              };

              return (
                <>
                  <div className="heatmap-chiffres">
                    <div className="heatmap-chiffre">
                      <strong>{actifs}</strong>
                      <span>jour{actifs > 1 ? 's' : ''} actif{actifs > 1 ? 's' : ''}</span>
                    </div>
                    <div className="heatmap-chiffre">
                      <strong>{record} j</strong>
                      <span>meilleure série</span>
                    </div>
                    <div className="heatmap-chiffre">
                      <strong>{presence} %</strong>
                      <span>{estAbonne ? 'depuis le début' : 'sur la période'}</span>
                    </div>
                  </div>

                  <div className="heatmap-container" ref={heatmapRef}>
                    <div style={{ padding: '0 10px' }}>
                      <div className="heatmap-months-row">
                        {moisAffiches.map((lbl, i) => (
                          <span key={i} style={{ left: `calc(28px + ${lbl.colonne} * 19px)` }}>{lbl.mois}</span>
                        ))}
                      </div>
                      <div className="heatmap-body">
                        <div className="heatmap-days-col">
                          <span style={{ gridRow: 2 }}>Lun</span>
                          <span style={{ gridRow: 4 }}>Mer</span>
                          <span style={{ gridRow: 6 }}>Ven</span>
                        </div>
                        <div className="heatmap-grid">
                          {Array.from({ length: casesVides }).map((_, i) => (
                            <div key={`vide-${i}`} className="heatmap-cell hors-suivi" />
                          ))}
                          {jours.map((j) => {
                            const score = scores[j] || 0;
                            const avantLeDebut = j < debut;
                            return (
                              /*
                                Un bouton et non une case morte : l'infobulle native
                                (`title`) n'existe pas au doigt, donc sur téléphone
                                la moitié de l'information n'était accessible à
                                personne. Le jour choisi s'écrit en toutes lettres
                                sous la grille.
                              */
                              <button
                                key={j}
                                type="button"
                                className={`heatmap-cell ${avantLeDebut ? 'hors-suivi' : niveau(score)} ${j === aujourdhui ? 'aujourdhui' : ''} ${j === jourLu ? 'choisi' : ''}`}
                                onClick={() => setJourLu(j === jourLu ? null : j)}
                                aria-label={libelleJour(j, score, avantLeDebut)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="heatmap-pied">
                    <div className="heatmap-legend">
                      <span>Rien</span>
                      <div className="heatmap-cell level-0"></div>
                      <div className="heatmap-cell level-1"></div>
                      <div className="heatmap-cell level-2"></div>
                      <div className="heatmap-cell level-3"></div>
                      <div className="heatmap-cell level-4"></div>
                      <span>Journée pleine</span>
                    </div>
                    <p className="heatmap-lecture">
                      {jourLu
                        ? libelleJour(jourLu, scores[jourLu] || 0, jourLu < debut)
                        : 'Touche un carré pour lire la journée.'}
                    </p>
                  </div>
                </>
              );
            })()}
          </section>
        </div>
        )}

        <div className="dashboard-right-col">
          {/*
            La carte « Série de focus » a été retirée d'ici : la série est passée
            dans le bandeau du haut, où elle est vue à l'ouverture. La garder aurait
            affiché deux fois le même nombre sur le même écran — et cette carte
            coûtait 125 px de la hauteur du premier écran sur téléphone.

            Son message d'encouragement (`getStreakMessage`) est parti avec elle : il
            commentait la série sans rien apprendre. L'avertissement de série perdue,
            lui, a suivi la série dans le bandeau.
          */}
          {/*
            « Objectifs atteints : 0/0 terminés » ne dit rien à quelqu'un qui n'a
            pas encore d'objectifs — c'est une case d'un tableau de bord qui compte
            ce qui n'existe pas. Elle revient dès qu'il y a quelque chose à compter.
          */}
          {microTotal > 0 && (
          <div className="stats-row">
            <div className="glass-panel stat-card glass-panel-interactive">
              <div className="stat-icon blue"><Trophy size={22} /></div>
              <div className="stat-info">
                <span className="stat-label">Objectifs atteints</span>
                <span className="stat-value">{microDone}/{microTotal} terminés</span>
                <div className="obj-progress-bar">
                  <div className="obj-progress-fill" style={{ width: `${(microDone / microTotal) * 100}%` }}></div>
                </div>
              </div>
            </div>
          </div>
          )}

          <section ref={routinesRef} className="glass-panel routines-section" style={{ display: 'flex', flexDirection: 'column' }}>
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
                  {/*
                    Le décompte se lit en français, y compris quand il n'y a plus
                    rien : « 0 tâche(s) restante(s) » était la seule phrase de
                    l'écran écrite en formulaire administratif — et le cas zéro,
                    qui est le bon moment de la journée, méritait mieux qu'un
                    zéro suivi d'une parenthèse.
                  */}
                  <span className="time-est glass-badge mb-3" style={{ alignSelf: 'center', display: 'flex', margin: '0 auto', width: 'fit-content' }}>
                    {(() => {
                      const restantes = tachesDuJour(currentGroup).filter((r: any) => !r.done).length;
                      if (restantes === 0) return 'Tout est fait';
                      return `${restantes} tâche${restantes > 1 ? 's' : ''} restante${restantes > 1 ? 's' : ''}`;
                    })()}
                  </span>

                  {tachesDuJour(currentGroup).map((routine: any) => (
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
                            {/*
                              Les jours d'une tâche non quotidienne. Sans cette
                              mention, une tâche présente aujourd'hui et absente
                              demain passerait pour une disparition — alors que
                              c'est exactement ce qu'on a demandé au coach.
                            */}
                            {libelleJours(routine) && (
                              <span className="routine-jours">{libelleJours(routine)}</span>
                            )}
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
