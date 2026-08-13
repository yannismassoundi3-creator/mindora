import React, { useState, useEffect } from 'react';
import { Target, Flag, Trophy, Plus, CheckCircle2, Circle, Sparkles, Pencil, Trash2, X } from 'lucide-react';
import { playClickSound, playLevelUpSound } from '../utils/sounds';
import { AI_COSMETICS } from '../utils/cosmetics';
import { getSecurePoints, setSecurePoints } from '../utils/secureStorage';
import { api } from '../services/api';
import './Objectives.css';

interface ObjectivesProps {
  onOpenChat: () => void;
}

interface MicroObjective {
  id: number;
  title: string;
  progress: number;
  total: number;
  step?: number;
  done: boolean;
  category: string;
}

interface MacroObjective {
  id: number;
  title: string;
  category: string;
  deadline: string;
  bgGradient: string;
  done?: boolean;
}

const CATEGORIES = ["🧠 Mindset", "🏃 Sport", "💼 Business", "🎓 Apprentissage", "🧘 Santé Mentale"];

const GRADIENTS = [
  "linear-gradient(135deg, #f59e0b, #ec4899)",
  "linear-gradient(135deg, #3b82f6, #8b5cf6)",
  "linear-gradient(135deg, #10b981, #3b82f6)",
  "linear-gradient(135deg, #ef4444, #f59e0b)",
  "linear-gradient(135deg, #8b5cf6, #ec4899)"
];

export const Objectives: React.FC<ObjectivesProps> = ({ onOpenChat }) => {
  const [mentalScore, setMentalScore] = useState(parseInt(localStorage.getItem('mental_score') || '0', 10));
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';
  
  const [equippedSkin] = useState<string | null>(() => localStorage.getItem('mindset_ai_skin_id'));
  const equippedCosmetic = AI_COSMETICS.find(c => c.id === equippedSkin);

  // Aucun objectif par défaut, ni ici ni plus bas pour les visions.
  //
  // Un compte neuf arrivait avec « Indépendance Financière » et « Physique
  // d'Athlète » comme grands objectifs de vie, plus « Aller à la salle de sport »
  // à 2/4 et « Lire 50 pages » déjà cochée. Personne n'avait rien décidé de tout
  // ça : ni le but, ni la progression annoncée. Et comme l'écran réenregistre son
  // état à chaque rendu, ces exemples partaient en base à la première visite et
  // devenaient les vrais objectifs du compte, comptés dans les scores.
  //
  // Les habitudes et les routines avaient déjà été vidées pour cette raison ;
  // cette page était la dernière à distribuer un passé qu'on n'a pas vécu.
  const [microObjectives, setMicroObjectives] = useState<MicroObjective[]>(() => {
    const saved = localStorage.getItem('mindset_micro_obj');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  const [macroObjectives, setMacroObjectives] = useState<MacroObjective[]>(() => {
    const saved = localStorage.getItem('mindset_macro_obj');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  // Saving state
  useEffect(() => {
    localStorage.setItem('mindset_micro_obj', JSON.stringify(microObjectives));
  }, [microObjectives]);

  useEffect(() => {
    localStorage.setItem('mindset_macro_obj', JSON.stringify(macroObjectives));
  }, [macroObjectives]);

  // Écouter les changements venant de l'IA (storage)
  useEffect(() => {
    const handleStorage = () => {
      try {
        const savedMicro = localStorage.getItem('mindset_micro_obj');
        if (savedMicro) setMicroObjectives(JSON.parse(savedMicro));
        
        const savedMacro = localStorage.getItem('mindset_macro_obj');
        if (savedMacro) setMacroObjectives(JSON.parse(savedMacro));
      } catch (e) {}
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);



  // -- MACRO MODAL STATE --
  const [macroModalOpen, setMacroModalOpen] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroObjective | null>(null);
  const [mForm, setMForm] = useState({ title: '', category: CATEGORIES[0], deadline: '', bgGradient: GRADIENTS[0] });

  const openMacroModal = (macro?: MacroObjective) => {
    playClickSound();
    if (macro) {
      setEditingMacro(macro);
      setMForm(macro);
    } else {
      setEditingMacro(null);
      setMForm({ title: '', category: CATEGORIES[0], deadline: 'Déc 2026', bgGradient: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)] });
    }
    setMacroModalOpen(true);
  };

  const saveMacro = () => {
    playClickSound();
    if (!mForm.title.trim()) return;
    if (editingMacro) {
      setMacroObjectives(prev => prev.map(m => m.id === editingMacro.id ? { ...mForm, id: m.id } : m));
    } else {
      setMacroObjectives(prev => [...prev, { ...mForm, id: Date.now() }]);
    }
    setMacroModalOpen(false);
  };

  const deleteMacro = () => {
    playClickSound();
    if (editingMacro) {
      setMacroObjectives(prev => prev.filter(m => m.id !== editingMacro.id));
    }
    setMacroModalOpen(false);
  };

  // -- MICRO EDITING STATE --
  const [editingMicroId, setEditingMicroId] = useState<number | null>(null);
  const [microForm, setMicroForm] = useState<Partial<MicroObjective>>({});

  const startMicroEdit = (micro: MicroObjective) => {
    playClickSound();
    setEditingMicroId(micro.id);
    setMicroForm(micro);
  };

  const saveMicro = (id: number) => {
    playClickSound();
    setMicroObjectives(prev => prev.map(m => m.id === id ? { ...m, ...microForm } as MicroObjective : m));
    setEditingMicroId(null);
  };

  const deleteMicro = (id: number) => {
    playClickSound();
    setMicroObjectives(prev => prev.filter(m => m.id !== id));
    setEditingMicroId(null);
  };

  const awardCoins = (amount: number, eventKey?: string) => {
    const currentPoints = getSecurePoints();
    const newPoints = Math.max(0, currentPoints + amount);
    setSecurePoints(newPoints);
    window.dispatchEvent(new CustomEvent('pointsChanged', { detail: newPoints }));

    // Seul un gain est crédité côté serveur, et une seule fois par objectif et par
    // jour : décocher puis recocher ne doit rien rapporter de plus.
    if (amount > 0 && eventKey) {
      api.claimCoins(`${eventKey}-${new Date().toISOString().slice(0, 10)}`);
    }
  };

  const toggleMicro = (id: number) => {
    // Haptic feedback
    if ('vibrate' in navigator) navigator.vibrate([15, 10, 15]);
    
    setMicroObjectives(prev => prev.map(obj => {
      if (obj.id === id) {
        const isNowDone = !obj.done;
        
        if (isNowDone) {
          playLevelUpSound();
          window.dispatchEvent(new CustomEvent('triggerShockwave', { 
            detail: { x: window.innerWidth / 2, y: window.innerHeight / 2, color: '#3b82f6' } 
          }));
          awardCoins(5, `objectif-${id}`);
        } else {
          playClickSound();
          awardCoins(-5);
        }

        const getTodayKey = () => new Date().toISOString().slice(0, 10);

        // Cocher aujourd'hui doit compter aujourd'hui, même si l'objectif avait déjà
        // été avancé un autre jour : la condition « seulement si aucune date n'est
        // posée » gardait la date du premier avancement, si bien que terminer un
        // objectif entamé la veille ne rapportait aucun point le jour de l'effort.
        const newAwardedDate = isNowDone ? getTodayKey() : obj.awardedDate;

        // We trigger an event so Dashboard updates immediately
        setTimeout(() => window.dispatchEvent(new Event('storage')), 100);

        return { ...obj, done: isNowDone, progress: isNowDone ? obj.total : 0, awardedDate: newAwardedDate };
      }
      return obj;
    }));
  };

  const incrementMicro = (id: number, amount: number) => {
    playClickSound();
    setMicroObjectives(prev => prev.map(obj => {
      if (obj.id === id) {
        if (obj.done) return obj;
        let newProgress = (obj.progress || 0) + amount;
        let isNowDone = false;
        if (newProgress >= obj.total) {
          newProgress = obj.total;
          isNowDone = true;
          playLevelUpSound();
          window.dispatchEvent(new CustomEvent('triggerShockwave', { 
            detail: { x: window.innerWidth / 2, y: window.innerHeight / 2, color: '#3b82f6' } 
          }));
          awardCoins(5, `objectif-${id}`);
        }
        
        // On date tout avancement, et plus seulement l'achèvement : le score mental
        // compte désormais la progression au prorata, ce qui n'a de sens que si le
        // tableau de bord sait que cet objectif a bougé aujourd'hui.
        const newAwardedDate = new Date().toISOString().slice(0, 10);

        setTimeout(() => window.dispatchEvent(new Event('storage')), 100);
        return { ...obj, progress: newProgress, done: isNowDone, awardedDate: newAwardedDate };
      }
      return obj;
    }));
  };

  const addMicroObjective = () => {
    playClickSound();
    const newId = Date.now();
    const newMicro = { id: newId, title: "Nouvel Objectif", progress: 0, total: 10, step: 1, done: false, category: CATEGORIES[0] };
    setMicroObjectives([...microObjectives, newMicro]);
    startMicroEdit(newMicro);
  };

  const toggleMacro = (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Haptic feedback
    if ('vibrate' in navigator) navigator.vibrate([15, 10, 15]);

    setMacroObjectives(prev => prev.map(m => {
      if (m.id === id) {
        const isNowDone = !m.done;
        if (isNowDone) {
          playLevelUpSound();
          window.dispatchEvent(new CustomEvent('triggerShockwave', { 
            detail: { x: window.innerWidth / 2, y: window.innerHeight / 2, color: '#f59e0b' } 
          }));
          awardCoins(5, `objectif-${id}`);
        } else {
          playClickSound();
          awardCoins(-5);
        }
        return { ...m, done: isNowDone };
      }
      return m;
    }));
  };

  return (
    <div className="objectives-container">
      {/* Header (Same style as Dashboard) */}
      <header className="dashboard-header objectives-header-bar">
        <div>
          <p className="current-date">Vision Board 🎯</p>
          <h1 className="greeting">Objectifs de vie</h1>
          <p className="subtitle">Visualise la destination. Exécute le plan.</p>
        </div>
        
        <div className="header-actions">
          <div className="points-badge glass-panel">
            <span className="points-value">{mentalScore}</span>
            <span className="points-label">% Mental</span>
          </div>
          <button className="btn-primary glass-panel-interactive pulse-glow ai-header-btn" onClick={() => { playClickSound(); onOpenChat(); }}>
            {equippedCosmetic?.type === 'icon' ? (
              <div className="ai-jarvis-orb small pulsing-orb" style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
                {equippedCosmetic.value}
              </div>
            ) : (
              <div 
                className="ai-jarvis-orb small liquid-glass-orb pulsing-orb" 
                style={equippedCosmetic?.type === 'color' ? { background: equippedCosmetic.value } : {}}
              ></div>
            )}
            Parler à {aiName}
          </button>
        </div>
      </header>

      {/* AI Observer Banner */}
      <div className="ai-observer-banner glass-panel">
        {equippedCosmetic?.type === 'icon' ? (
          <div className="ai-jarvis-orb medium pulsing-orb" style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
            {equippedCosmetic.value}
          </div>
        ) : (
          <div 
            className="ai-jarvis-orb medium liquid-glass-orb pulsing-orb"
            style={equippedCosmetic?.type === 'color' ? { background: equippedCosmetic.value } : {}}
          ></div>
        )}
        <div className="banner-text">
          <strong>{aiName} analyse tes objectifs...</strong>
          <span>Complète tes actions hebdomadaires pour faire grimper ton Score du Jour ! (+10%)</span>
        </div>
      </div>

      <div className="objectives-grid">
        {/* Section MACRO (Vision Long Terme) */}
        <section className="macro-section">
          <div className="section-title-wrapper">
            <Trophy size={20} className="purple-icon" />
            <h2>Macro-Objectifs (Vision)</h2>
          </div>
          <p className="section-desc">Ton grand pourquoi. Ce qui te réveille le matin.</p>

          {macroObjectives.length === 0 && (
            <p className="section-desc" style={{ fontStyle: 'italic', marginTop: '-4px' }}>
              Rien ici pour l'instant. Une vision, c'est la destination — la première
              en dit déjà long sur toi.
            </p>
          )}

          <div className="macro-cards-container">
            {macroObjectives.map(macro => (
              <div 
                key={macro.id} 
                className={`macro-card glass-panel-interactive ${macro.done ? 'done' : ''}`} 
                style={{ opacity: macro.done ? 0.6 : 1 }}
                onClick={() => openMacroModal(macro)}
              >
                <div className="macro-content">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span className="macro-category">{macro.category}</span>
                  </div>
                  <h3 className="macro-title" style={{ textDecoration: macro.done ? 'line-through' : 'none' }}>{macro.title}</h3>
                  <div className="macro-footer">
                    <Flag size={14} />
                    <span>Objectif: {macro.deadline}</span>
                  </div>
                </div>
                <div className="edit-hint"><Pencil size={14} /> Éditer</div>
              </div>
            ))}
            <div className="macro-card add-macro-card glass-panel-interactive" onClick={() => openMacroModal()}>
              <Plus size={32} />
              <span>Ajouter une vision</span>
            </div>
            {/* Physical spacer to force scroll padding on iOS/Mobile browsers */}
            <div style={{ flex: '0 0 1px', width: '1px' }}></div>
          </div>
        </section>

        {/* Section MICRO (Action Semaine) */}
        <section className="micro-section">
          <div className="section-title-wrapper">
            <Target size={20} className="blue-icon" />
            <h2>Micro-Objectifs (Exécution)</h2>
          </div>
          <p className="section-desc">Les petites victoires qui mènent à la grande.</p>

          {microObjectives.length === 0 && (
            <p className="section-desc" style={{ fontStyle: 'italic', marginTop: '-4px' }}>
              Aucune action cette semaine. Choisis-en une, petite et datée : c'est
              elle qui fera bouger ton score.
            </p>
          )}

          <div className="micro-list">
            {microObjectives.map(micro => (
              <div key={micro.id} className={`micro-item glass-panel-interactive ${micro.done ? 'done' : ''}`}>
                {editingMicroId === micro.id ? (
                  <div className="micro-edit-form">
                    <input 
                      type="text" 
                      value={microForm.title} 
                      onChange={e => setMicroForm({...microForm, title: e.target.value})}
                      className="routine-edit-input"
                      autoFocus
                    />
                    <div className="micro-edit-row">
                      <select 
                        value={microForm.category} 
                        onChange={e => setMicroForm({...microForm, category: e.target.value})}
                        className="cat-select"
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <div className="progress-edit">
                        Objectif : 
                        <input 
                          type="number" 
                          min="1" 
                          value={microForm.total} 
                          onChange={e => setMicroForm({...microForm, total: parseInt(e.target.value) || 1})}
                          className="num-input"
                        />
                        + :
                        <input 
                          type="number" 
                          min="1" 
                          value={microForm.step || 1} 
                          onChange={e => setMicroForm({...microForm, step: parseInt(e.target.value) || 1})}
                          className="num-input"
                        />
                      </div>
                    </div>
                    <div className="micro-edit-actions">
                      <button className="btn-save" onClick={() => saveMicro(micro.id)}>OK</button>
                      <button className="btn-delete" onClick={() => deleteMicro(micro.id)}><Trash2 size={16}/></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="micro-left" onClick={() => toggleMicro(micro.id)}>
                      {micro.done ? <CheckCircle2 size={24} className="check-icon" /> : <Circle size={24} className="uncheck-icon" />}
                      <div className="micro-info">
                        <span className="micro-title">{micro.title}</span>
                        <span className="micro-cat">{micro.category}</span>
                      </div>
                    </div>
                    
                    <div className="micro-right" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1 }}>
                        <div className="progress-text">{micro.progress} / {micro.total}</div>
                        <div className="progress-bar-bg" style={{ width: '80px', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div 
                            className="progress-bar-fill" 
                            style={{ width: `${(micro.progress / micro.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', borderRadius: '3px', transition: 'width 0.4s' }}
                          ></div>
                        </div>
                      </div>
                      
                      {!micro.done && micro.total > 1 && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); incrementMicro(micro.id, micro.step || 1); }}
                          style={{ background: '#000', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '5px', padding: '4px 8px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}
                        >
                          <Plus size={12} /> {micro.step || 1}
                        </button>
                      )}

                      <button className="inline-edit-btn" onClick={(e) => { e.stopPropagation(); startMicroEdit(micro); }}>
                        <Pencil size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}

            <button className="add-micro-btn" onClick={addMicroObjective}>
              <Plus size={18} />
              Nouvel objectif de la semaine
            </button>
          </div>
        </section>
      </div>

      {/* MACRO MODAL */}
      {macroModalOpen && (
        <div className="modal-backdrop" onClick={() => { playClickSound(); setMacroModalOpen(false); }}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { playClickSound(); setMacroModalOpen(false); }}><X size={20} /></button>
            <h2 className="modal-title">{editingMacro ? 'Modifier la Vision' : 'Nouvelle Vision'}</h2>
            
            <div className="form-group">
              <label>Objectif (Titre)</label>
              <input type="text" value={mForm.title} onChange={e => setMForm({...mForm, title: e.target.value})} className="routine-edit-input" placeholder="Ex: Devenir rentier" />
            </div>

            <div className="form-group">
              <label>Catégorie</label>
              <select value={mForm.category} onChange={e => setMForm({...mForm, category: e.target.value})} className="cat-select full-width">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Échéance (Date)</label>
              <input type="text" value={mForm.deadline} onChange={e => setMForm({...mForm, deadline: e.target.value})} className="routine-edit-input" placeholder="Ex: Décembre 2026" />
            </div>

            <div className="form-group">
              <label>Couleur du fond</label>
              <div className="gradient-picker">
                {GRADIENTS.map(grad => (
                  <div 
                    key={grad} 
                    className={`gradient-swatch ${mForm.bgGradient === grad ? 'selected' : ''}`}
                    style={{ background: grad }}
                    onClick={() => setMForm({...mForm, bgGradient: grad})}
                  />
                ))}
              </div>
            </div>

            {editingMacro && (
              <div className="form-group" style={{ marginTop: '20px' }}>
                <button 
                  style={{ 
                    width: '100%', 
                    padding: '15px', 
                    borderRadius: '12px', 
                    border: 'none',
                    fontWeight: 'bold',
                    fontSize: '1.1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    background: editingMacro.done ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #10b981, #059669)',
                    color: editingMacro.done ? 'rgba(255,255,255,0.6)' : '#fff',
                    transition: 'transform 0.3s, opacity 0.3s, background-color 0.3s, border-color 0.3s, box-shadow 0.3s, color 0.3s',
                    boxShadow: editingMacro.done ? 'none' : '0 10px 20px rgba(16, 185, 129, 0.3)'
                  }}
                  onClick={() => {
                    const fakeEvent = { stopPropagation: () => {}, preventDefault: () => {} } as any;
                    toggleMacro(editingMacro.id, fakeEvent);
                    setMacroModalOpen(false);
                  }}
                >
                  {editingMacro.done ? <><X size={20}/> Annuler la validation</> : <><Trophy size={20}/> Valider la Vision !</>}
                </button>
              </div>
            )}

            <div className="modal-actions">
              {editingMacro && <button className="btn-delete-full" onClick={deleteMacro}><Trash2 size={16}/> Supprimer</button>}
              <button className="btn-primary" onClick={saveMacro}>Sauvegarder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
