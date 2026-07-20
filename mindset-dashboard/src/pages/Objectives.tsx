import React, { useState, useEffect } from 'react';
import { Target, Flag, Trophy, Plus, CheckCircle2, Circle, Sparkles, Pencil, Trash2, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import './Objectives.css';

interface ObjectivesProps {
  onOpenChat: () => void;
}

interface MicroObjective {
  id: number;
  title: string;
  progress: number;
  total: number;
  done: boolean;
  category: string;
}

interface MacroObjective {
  id: number;
  title: string;
  category: string;
  deadline: string;
  bgGradient: string;
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

  const [microObjectives, setMicroObjectives] = useState<MicroObjective[]>(() => {
    const saved = localStorage.getItem('mindset_micro_obj');
    return saved ? JSON.parse(saved) : [
      { id: 1, title: "Aller à la salle de sport", progress: 2, total: 4, done: false, category: "🏃 Sport" },
      { id: 2, title: "Lire 50 pages", progress: 50, total: 50, done: true, category: "🧠 Mindset" },
    ];
  });

  const [macroObjectives, setMacroObjectives] = useState<MacroObjective[]>(() => {
    const saved = localStorage.getItem('mindset_macro_obj');
    return saved ? JSON.parse(saved) : [
      { id: 1, title: "Indépendance Financière", category: "💼 Business", deadline: "Déc 2026", bgGradient: GRADIENTS[0] },
      { id: 2, title: "Physique d'Athlète", category: "🏃 Sport", deadline: "Juil 2026", bgGradient: GRADIENTS[1] }
    ];
  });

  // Saving state
  useEffect(() => {
    localStorage.setItem('mindset_micro_obj', JSON.stringify(microObjectives));
  }, [microObjectives]);

  useEffect(() => {
    localStorage.setItem('mindset_macro_obj', JSON.stringify(macroObjectives));
  }, [macroObjectives]);

  // -- MACRO MODAL STATE --
  const [macroModalOpen, setMacroModalOpen] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroObjective | null>(null);
  const [mForm, setMForm] = useState({ title: '', category: CATEGORIES[0], deadline: '', bgGradient: GRADIENTS[0] });

  const openMacroModal = (macro?: MacroObjective) => {
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
    if (!mForm.title.trim()) return;
    if (editingMacro) {
      setMacroObjectives(prev => prev.map(m => m.id === editingMacro.id ? { ...mForm, id: m.id } : m));
    } else {
      setMacroObjectives(prev => [...prev, { ...mForm, id: Date.now() }]);
    }
    setMacroModalOpen(false);
  };

  const deleteMacro = () => {
    if (editingMacro) {
      setMacroObjectives(prev => prev.filter(m => m.id !== editingMacro.id));
    }
    setMacroModalOpen(false);
  };

  // -- MICRO EDITING STATE --
  const [editingMicroId, setEditingMicroId] = useState<number | null>(null);
  const [microForm, setMicroForm] = useState<Partial<MicroObjective>>({});

  const startMicroEdit = (micro: MicroObjective) => {
    setEditingMicroId(micro.id);
    setMicroForm(micro);
  };

  const saveMicro = (id: number) => {
    setMicroObjectives(prev => prev.map(m => m.id === id ? { ...m, ...microForm } as MicroObjective : m));
    setEditingMicroId(null);
  };

  const deleteMicro = (id: number) => {
    setMicroObjectives(prev => prev.filter(m => m.id !== id));
    setEditingMicroId(null);
  };

  const toggleMicro = (id: number) => {
    setMicroObjectives(prev => prev.map(obj => {
      if (obj.id === id) {
        const isNowDone = !obj.done;
        
        if (isNowDone) {
          confetti({ particleCount: 80, spread: 60, origin: { y: 0.8 }, colors: ['#3b82f6', '#ec4899', '#fcd34d'] });
        }

        const getTodayKey = () => new Date().toISOString().slice(0, 10);
        let newAwardedDate = obj.awardedDate;
        
        // Award points only once, on the first day it is checked
        if (isNowDone && !obj.awardedDate) {
          newAwardedDate = getTodayKey();
        }

        // We trigger an event so Dashboard updates immediately
        setTimeout(() => window.dispatchEvent(new Event('storage')), 100);

        return { ...obj, done: isNowDone, progress: isNowDone ? obj.total : 0, awardedDate: newAwardedDate };
      }
      return obj;
    }));
  };

  const addMicroObjective = () => {
    const newId = Date.now();
    const newMicro = { id: newId, title: "Nouvel Objectif", progress: 0, total: 1, done: false, category: CATEGORIES[0] };
    setMicroObjectives([...microObjectives, newMicro]);
    startMicroEdit(newMicro);
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
          <button className="btn-primary glass-panel-interactive pulse-glow ai-header-btn" onClick={onOpenChat}>
            <div className="ai-jarvis-orb small"></div>
            Parler à {aiName}
          </button>
        </div>
      </header>

      {/* AI Observer Banner */}
      <div className="ai-observer-banner glass-panel">
        <div className="ai-jarvis-orb medium pulsing-orb"></div>
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

          <div className="macro-cards-container">
            {macroObjectives.map(macro => (
              <div 
                key={macro.id} 
                className="macro-card glass-panel-interactive" 
                style={{ background: macro.bgGradient }}
                onClick={() => openMacroModal(macro)}
              >
                <div className="macro-overlay"></div>
                <div className="macro-content">
                  <span className="macro-category">{macro.category}</span>
                  <h3 className="macro-title">{macro.title}</h3>
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
          </div>
        </section>

        {/* Section MICRO (Action Semaine) */}
        <section className="micro-section">
          <div className="section-title-wrapper">
            <Target size={20} className="blue-icon" />
            <h2>Micro-Objectifs (Exécution)</h2>
          </div>
          <p className="section-desc">Les petites victoires qui mènent à la grande.</p>

          <div className="micro-list glass-panel">
            {microObjectives.map(micro => (
              <div key={micro.id} className={`micro-item ${micro.done ? 'done' : ''}`}>
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
                    
                    <div className="micro-right">
                      <div className="progress-text">{micro.progress} / {micro.total}</div>
                      <div className="progress-bar-bg">
                        <div 
                          className="progress-bar-fill" 
                          style={{ width: `${(micro.progress / micro.total) * 100}%` }}
                        ></div>
                      </div>
                      <button className="inline-edit-btn" onClick={() => startMicroEdit(micro)}>
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
        <div className="modal-backdrop" onClick={() => setMacroModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setMacroModalOpen(false)}><X size={20} /></button>
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
