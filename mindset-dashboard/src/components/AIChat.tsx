import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Sparkles, Undo2, Wrench, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { playBloopSound } from '../utils/sounds';
import { AI_COSMETICS } from '../utils/cosmetics';
import { getSecurePoints } from '../utils/secureStorage';
import { sauvegarderPlanPrecedent, planPrecedentDisponible, restaurerPlanPrecedent } from '../utils/planPrecedent';
import { normaliserJours } from '../utils/recurrence';
import { extrairePlan, reparerJson } from '../utils/extractionPlan';
import { listesIllisibles, reparerListe, type ListeIllisible } from '../utils/etatLocal';
import { composerOuverture } from '../utils/ouverture';
import { ajouterNotification } from '../utils/notifications';
import './AIChat.css';
import { api } from '../services/api';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
  /**
   * Affiche le bouton d'abonnement sous ce message.
   *
   * Manquer de coins se règle en validant une routine, et c'est ce que répond le
   * serveur — proposer l'abonnement comme seule issue serait malhonnête. Mais ne
   * proposer que la routine l'est aussi : quelqu'un qui veut simplement continuer à
   * parler se retrouvait sans autre porte. Les deux sont offertes.
   */
  offreAbonnement?: boolean;
  /**
   * Marque la phrase d'ouverture, celle que le coach dit avant qu'on lui ait rien
   * demandé. Elle est d'abord composée localement puis remplacée par celle du
   * modèle : ce drapeau est ce qui permet de ne la remplacer que si elle est
   * encore seule à l'écran, jamais au milieu d'une conversation entamée.
   */
  estOuverture?: boolean;
  /**
   * Identifiant de la copie prise juste avant que ce plan n'écrase le précédent.
   *
   * Présent uniquement quand quelque chose a réellement été remplacé : un ajout n'a
   * rien détruit et n'a donc rien à annuler. Il est porté par le message plutôt que
   * par un état global pour que le bouton d'une vieille réponse, retrouvée en
   * remontant la conversation, ne puisse pas ressusciter un plan sans rapport.
   */
  sauvegardePlan?: string;
  /**
   * Listes qu'on n'a pas su relire, et qui ont fait refuser le plan.
   *
   * Refuser protège le travail existant, mais laissait la personne enfermée : plus
   * aucun plan ne s'appliquait, sans le moindre geste pour en sortir. Ces clés
   * portent le bouton qui débloque.
   */
  listesAReparer?: ListeIllisible[];
}

export const AIChat: React.FC = () => {
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';

  const [messages, setMessages] = useState<Message[]>(() => {
    /*
      La première phrase n'est plus « Bonjour, je suis X. Comment je peux t'aider
      aujourd'hui ? ».

      C'était une chaîne écrite en dur, alors que le navigateur connaît déjà la
      journée, la série et l'objectif déclaré, et que le serveur connaît en plus
      les échanges passés et la tendance. Autrement dit : le coach avait tout ce
      qu'il fallait pour dire quelque chose que personne d'autre ne pouvait dire,
      et ouvrait sur la phrase d'accueil d'un service client. C'est la première
      impression, et c'est là qu'on comprend — ou non — pourquoi il existe.

      Celle-ci est composée localement, donc affichée immédiatement ; la version
      du modèle la remplace quelques instants plus tard si elle arrive.
    */
    const defaultMessage = {
      id: 1,
      text: composerOuverture(localStorage.getItem('mindset_user_name') || ''),
      sender: 'ai' as const,
      estOuverture: true,
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

  /*
    La version écrite par le coach lui-même.

    Elle ne remplace la phrase locale que si la conversation en est toujours à
    cette seule phrase : entre-temps, l'historique du serveur a pu arriver, ou la
    personne a pu écrire. Dans les deux cas, glisser une ouverture au milieu
    d'une conversation déjà commencée serait absurde.

    On n'envoie que les routines : c'est tout ce que le serveur lit pour situer
    la journée, et le reste du contexte se paierait en jetons pour rien.

    L'échec est silencieux et sans conséquence — la phrase locale est déjà à
    l'écran, elle reste. C'est aussi le comportement quand le quota Groq est
    épuisé, ce qui ne doit surtout pas se lire comme une panne.
  */
  useEffect(() => {
    let vivant = true;

    api
      .post('/ai-coaching/ouverture', {
        context: { routines: JSON.parse(localStorage.getItem('mindset_routines') || '[]') },
        aiName,
      })
      .then((data: any) => {
        const texte = typeof data?.texte === 'string' ? data.texte.trim() : '';
        if (!vivant || !texte) return;
        setMessages((actuels) =>
          actuels.length === 1 && (actuels[0] as any).estOuverture
            ? [{ ...actuels[0], text: texte }]
            : actuels,
        );
      })
      .catch(() => {});

    return () => {
      vivant = false;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('mindset_ai_chat_history', JSON.stringify(messages));
  }, [messages]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isAiAwake, setIsAiAwake] = useState(true);
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

  /**
   * Énergie restante, c'est-à-dire ce qui autorise à parler au coach.
   *
   * Distincte des Coins de la Boutique, qui portent le même nom dans le reste de
   * l'app et servent aux niveaux et aux skins. Elle n'était affichée nulle part :
   * on découvrait son épuisement en se voyant refuser un message, ce qui donne
   * l'impression d'une panne plutôt que d'une limite annoncée.
   */
  const [energie, setEnergie] = useState<number | null>(() => {
    const brut = localStorage.getItem('mindset_energie');
    return brut === null ? null : Number(brut);
  });

  const estAbonne = localStorage.getItem('mindset_is_subscribed') === 'true';

  /**
   * Remet le plan d'avant en place, et le dit dans la conversation.
   *
   * Le message de confirmation compte autant que la restauration : une interface qui
   * change sans un mot laisse penser que le bouton n'a rien fait, et on le reclique.
   */
  const annulerRemplacement = (identifiant: string) => {
    const restaure = restaurerPlanPrecedent(identifiant);
    setMessages(prev => [...prev, {
      id: Date.now(),
      text: restaure
        ? '↩️ **Plan précédent restauré.** Tes routines, habitudes, objectifs et repas sont revenus comme avant.'
        : "Cette sauvegarde n'est plus disponible : un plan plus récent a pris sa place.",
      sender: 'ai',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
  };

  /**
   * Repart d'une liste vide sur ce qu'on n'a pas su relire.
   *
   * La valeur illisible n'est pas détruite, seulement mise de côté : elle ne sert
   * plus à l'application, mais elle contient peut-être des mois de travail encore
   * lisibles à l'œil nu, et rien ne justifie de l'effacer.
   *
   * On ne réapplique pas le plan automatiquement dans la foulée. Il faudrait le
   * redemander au modèle — donc dépenser un message — pour un plan que la personne
   * n'a peut-être plus envie d'appliquer maintenant qu'elle sait que quelque chose
   * a cassé. On débloque, on le dit, et on la laisse décider.
   */
  const reparerEtReessayer = (listes: ListeIllisible[]) => {
    for (const { cle } of listes) reparerListe(cle);
    window.dispatchEvent(new Event('storage'));

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        text:
          `🔧 **C'est réparé.** ${listes.map((l) => l.nom).join(' et ')} ${
            listes.length > 1 ? 'repartent' : 'repart'
          } d'une liste vide — l'ancien contenu est conservé de côté, il n'a pas été supprimé. ` +
          `Redemande-moi ton plan quand tu veux.`,
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };


  /**
   * Applique le plan.
   *
   * Rend l'identifiant de la copie de sauvegarde quand le plan a remplacé
   * l'existant (`null` sinon — un simple ajout n'a rien détruit), et la liste de ce
   * qu'on n'a pas pu relire.
   */
  const applyPlanData = (rawPlanData: any): { sauvegarde: string | null; illisibles: ListeIllisible[] } => {
    if (!rawPlanData) return { sauvegarde: null, illisibles: [] };

    /*
      Rien n'est écrit tant qu'on n'a pas la certitude de pouvoir tout relire.

      Le contrôle porte sur toutes les listes, pas seulement sur celles que ce plan
      touche, et il refuse le plan entier plutôt que le bloc fautif : un plan à
      moitié appliqué est plus difficile à démêler qu'un plan pas appliqué, alors
      qu'on peut toujours le redemander. Placé ici, avant la première écriture —
      même les explications en attente ne partent pas.
    */
    const illisibles = listesIllisibles();
    if (illisibles.length > 0) return { sauvegarde: null, illisibles };

    // Si l'IA a imbriqué les données dans un objet "plan" ou "actionPlan"
    const dataObj = rawPlanData.plan || rawPlanData.actionPlan || rawPlanData;
    let planData = { ...dataObj };

    if (planData.routineExplanation) localStorage.setItem('mindset_pending_routine_explanation', planData.routineExplanation);
    if (planData.habitExplanation) localStorage.setItem('mindset_pending_habit_explanation', planData.habitExplanation);
    if (planData.objectiveExplanation) localStorage.setItem('mindset_pending_objective_explanation', planData.objectiveExplanation);
    if (planData.nutritionExplanation) localStorage.setItem('mindset_pending_nutrition_explanation', planData.nutritionExplanation);
    if (planData.planExplanation) localStorage.setItem('mindset_pending_ai_explanation', planData.planExplanation); // Fallback

    const pushedTypes = new Set<string>();
    const safeAddNotif = (type: string, msg: string, titre?: string) => {
      if (!pushedTypes.has(type)) {
        ajouterNotification(type, msg, titre);
        pushedTypes.add(type);
      }
    };

    // Un remplacement efface ce qui existait : on en garde une copie d'abord.
    //
    // C'est le seul moment où quelqu'un peut perdre du travail sans l'avoir demandé
    // explicitement — « refais-moi un plan » veut bien dire remplacer, mais pas
    // « accepte les yeux fermés ce que le modèle va produire ». La photo est prise
    // ici, avant la première ligne effacée, et son identifiant remonte à l'appelant
    // qui proposera le retour en arrière sous la réponse du coach.
    const remplace =
      planData.replaceHabits === true ||
      planData.replaceRoutines === true ||
      planData.replaceNutrition === true ||
      planData.replaceMacroObjectives === true ||
      planData.replaceMicroObjectives === true;
    const sauvegarde = remplace ? sauvegarderPlanPrecedent() : null;

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
      safeAddNotif('habit', 'Ouvre tes habitudes pour les découvrir.', `${aiName} a ajouté de nouvelles habitudes`);
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
              done: false,
              // Jours de la semaine, quand le coach en a prévu : « du sport trois
              // fois par semaine » ne veut rien dire s'il finit en tâche quotidienne.
              // Absent, la tâche reste quotidienne comme avant.
              jours: normaliserJours(t.jours ?? t.days),
            } as never);
          });
        }
      });
      localStorage.setItem('mindset_routines', JSON.stringify(existingRoutines));
      safeAddNotif('routine', 'Ta journée a été réécrite pour coller à ton objectif.', `${aiName} a mis à jour tes routines`);
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
      safeAddNotif('nutrition', 'Tes repas sont dans l\'onglet Alimentation.', `${aiName} a planifié ton alimentation`);
    }
      
    const objectivesList = planData.newMicroObjectives || planData.newObjectives || planData.objectives || planData.microObjectives || planData.goals;
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
      safeAddNotif('objective', 'Ils sont dans ton écran Objectifs.', `${aiName} a défini de nouveaux objectifs`);
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
      safeAddNotif('objective', 'Ils sont dans ton écran Objectifs.', `${aiName} a défini de nouveaux objectifs`);
    }

      // Force API sync if needed
    window.dispatchEvent(new Event('storage'));

    return { sauvegarde, illisibles: [] };
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
      const coins = getSecurePoints().toString();
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
      //
      // Le refus se décide au serveur, et nulle part ailleurs. Cet écran barrait
      // la route dès que le compteur *local* passait sous 10 — or ce compteur part
      // de zéro sur un appareil neuf, pendant que le serveur ouvre tout compte à
      // 50 coins. Un compte qui venait d'être créé se voyait donc répondre
      // « Énergie insuffisante » à son premier bonjour, avec le conseil d'aller
      // gagner des coins qu'il possédait déjà. Le serveur, lui, répond 402 avec le
      // vrai solde, et ce cas est traité plus bas.
      const data = await api.post('/ai-coaching/chat', {
        prompt: currentInput,
        context: userContext
      });

      // Deux monnaies, deux compteurs — c'est tout le problème qu'on referme ici.
      //
      // Le solde renvoyé par le serveur est celui qui autorise l'IA. Il était écrit
      // par-dessus les Coins de la Boutique, qui portent le même nom et le même icône
      // sans être la même chose : parler au coach faisait donc bouger la cagnotte des
      // skins, et un achat en Boutique semblait retirer des messages. Chacun garde
      // désormais son compteur, et celui-ci s'affiche sous le nom d'Énergie.
      if (typeof data.coins === 'number') {
        setEnergie(data.coins);
        localStorage.setItem('mindset_energie', String(data.coins));
      }
      window.dispatchEvent(new Event('storage'));
      
      setIsAiAwake(true);

      let replyText = data.reply || "Erreur lors de la génération.";

      // Identifiant de la copie prise avant un remplacement, s'il y en a eu un.
      let sauvegardePlan: string | null = null;

      // Listes qu'on n'a pas su relire, et qui portent le bouton de réparation.
      let listesAReparer: ListeIllisible[] = [];

      // Le bloc technique est retiré du message quoi qu'il arrive.
      //
      // L'extraction exigeait auparavant les deux balises intactes. Une fermeture
      // mutilée — « ; ↘'PLAN> » a été vue en production — et plus rien ne
      // correspondait : le plan n'était ni appliqué ni retiré, et quarante lignes de
      // JSON s'affichaient sous une phrase annonçant fièrement le plan.
      const extraction = extrairePlan(replyText);
      replyText = cleanMessageText(extraction.texte);
      let jsonStr = extraction.json;

      if (jsonStr) {
        try {
          // Rattrape les maladresses de format les plus courantes — virgules en
          // rafale, virgule traînante — sans jamais inventer de données.
          jsonStr = reparerJson(jsonStr);

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
            const application = applyPlanData(planData);
            sauvegardePlan = application.sauvegarde;

            if (application.illisibles.length > 0) {
              // Rien n'a été écrit, et surtout : ne rien annoncer qui laisse croire
              // le contraire. C'est le cas où l'ancienne version répondait « plan
              // appliqué » après avoir remplacé le travail de quelqu'un.
              console.error('Plan non appliqué, listes illisibles :', application.illisibles);
              listesAReparer = application.illisibles;
              replyText +=
                `\n\n⚠️ **Je n'ai rien changé.** Je n'arrive pas à relire ${application.illisibles
                  .map((l) => l.nom)
                  .join(' ni ')} sur cet appareil, et appliquer le plan par-dessus l'aurait remplacé ` +
                `au lieu de le compléter.`;
            } else if (isCreation) {
              replyText += "\n\n✅ **Plan appliqué avec succès ! L'interface a été mise à jour.**";
            } else if (isDeletion) {
              replyText += "\n\n🗑️ **Plan supprimé avec succès ! L'interface a été réinitialisée.**";
            }
          }
        } catch(e) {
          // Le plan est illisible et le restera : c'est le modèle qui l'a mal écrit.
          //
          // Se taire serait le pire choix — la réponse annonce souvent « il est temps
          // de l'appliquer », et on laisserait croire que c'est fait alors que rien
          // n'a bougé. On le dit, et on indique le geste qui débloque.
          console.error("Failed to parse plan JSON", e);
          replyText += "\n\n⚠️ **Je n'ai pas réussi à appliquer ce plan** — il est arrivé mal formé de mon côté. Redemande-le-moi, ça passe presque toujours au second essai.";
        }
      }
      
      const aiResponse: Message = {
        id: Date.now() + 1,
        text: replyText,
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sauvegardePlan: sauvegardePlan ?? undefined,
        listesAReparer: listesAReparer.length > 0 ? listesAReparer : undefined,
      };
      setMessages(prev => [...prev, aiResponse]);
    } catch (error: any) {
      console.error("AI Chat Error:", error);

      // 402 : ce n'est pas une panne. Deux causes distinctes, deux réactions —
      // manquer de coins se règle en accomplissant une routine, pas en s'abonnant,
      // donc proposer l'abonnement dans ce cas serait malhonnête.
      if (error.status === 402) {
        const manqueDeCoins = error.code === 'COINS_INSUFFISANTS';
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          text: error.message,
          sender: 'ai',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          // Le quota mensuel ouvre l'offre de lui-même ; le manque de coins se
          // contente de la proposer, sous le message, sans interrompre.
          offreAbonnement: manqueDeCoins,
        }]);
        if (!manqueDeCoins) {
          window.dispatchEvent(new Event('aiQuotaExceeded'));
        }
        return;
      }

      // 429 : l'abonné a atteint son plafond du jour. Ce n'est ni une panne ni une
      // question d'argent — il a déjà payé. Lui servir le message d'erreur générique
      // (« je n'arrive pas à me connecter à mon cerveau externe ») lui ferait croire
      // à un incident, et lui proposer l'abonnement serait absurde.
      if (error.status === 429 && error.code === 'AI_DAILY_CAP') {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          text: error.message,
          sender: 'ai',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
        return;
      }

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
              {/*
                L'état est enveloppé pour pouvoir disparaître sur téléphone : « Connecté
                et prêt à t'assister » passe sur deux lignes et fait à lui seul un tiers
                de la hauteur d'une barre qui, elle, ne quitte plus l'écran. Le point
                pulsant à gauche dit déjà la même chose sans occuper de place — et le
                cas « déconnecté », lui, reste affiché : il change quelque chose.
              */}
              <span className={`chat-statut ${isAiAwake ? '' : 'chat-statut-alerte'}`}>
                {isAiAwake ? "Connecté et prêt à t'assister" : "Déconnecté, réveil en cours..."}
              </span>
              {/*
                On n'affiche l'énergie qu'à ceux qu'elle concerne : un abonné ne la
                dépense pas, la lui montrer laisserait croire qu'il est décompté.
                Et tant que le serveur n'a rien dit, on n'invente pas de chiffre.
              */}
              {!estAbonne && energie !== null && (
                <span className="chat-energie" title="Énergie restante pour parler au coach">
                  <Zap size={12} />
                  {energie}
                </span>
              )}
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
          {/* « Générer un plan » passe sur deux lignes sous 900 px et impose sa hauteur
              à toute la barre. Le libellé court garde l'action lisible sur une ligne. */}
          <span className="chat-action-long">Générer un plan</span>
          <span className="chat-action-court">Plan</span>
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
                  <div className="message-ai-header">
                    <div className="message-ai-name">{aiName}</div>
                  </div>
                )}
                <div className="message-content">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                {msg.offreAbonnement && (
                  <button
                    onClick={() => window.dispatchEvent(new Event('openPricing'))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginTop: '10px',
                      padding: '8px 14px',
                      borderRadius: '100px',
                      border: '1px solid rgba(251, 191, 36, 0.35)',
                      background: 'rgba(251, 191, 36, 0.12)',
                      color: '#fbbf24',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    <Sparkles size={14} />
                    Ou passe Pro pour ne plus compter
                  </button>
                )}
                {/*
                  Retour en arrière après un remplacement. Le bouton disparaît dès que
                  la copie a été utilisée ou remplacée par une plus récente : proposer
                  une annulation qui ne peut plus aboutir serait pire que ne rien
                  proposer.
                */}
                {msg.sauvegardePlan && planPrecedentDisponible(msg.sauvegardePlan) && (
                  <button
                    onClick={() => annulerRemplacement(msg.sauvegardePlan!)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginTop: '10px',
                      padding: '8px 14px',
                      borderRadius: '100px',
                      border: '1px solid rgba(255, 255, 255, 0.22)',
                      background: 'rgba(255, 255, 255, 0.06)',
                      color: 'rgba(255, 255, 255, 0.85)',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    <Undo2 size={14} />
                    Revenir au plan précédent
                  </button>
                )}
                {msg.listesAReparer && msg.listesAReparer.length > 0 && (
                  <button
                    onClick={() => reparerEtReessayer(msg.listesAReparer!)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginTop: '10px',
                      padding: '8px 14px',
                      borderRadius: '100px',
                      border: '1px solid rgba(255, 255, 255, 0.22)',
                      background: 'rgba(255, 255, 255, 0.06)',
                      color: 'rgba(255, 255, 255, 0.85)',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    <Wrench size={14} />
                    Repartir à zéro sur {msg.listesAReparer.map((l) => l.nom).join(' et ')}
                  </button>
                )}
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
