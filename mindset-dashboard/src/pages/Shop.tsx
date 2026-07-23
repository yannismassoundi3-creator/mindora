import React, { useState, useEffect } from 'react';
import { Gift, Coins, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { playClickSound, playLevelUpSound, playHoverSound } from '../utils/sounds';
import { api } from '../services/api';
import './Shop.css';

interface Reward {
  id: string;
  title: string;
  cost: number;
  icon: string;
}

const DEFAULT_REWARDS: Reward[] = [
  { id: 'r1', title: '1h de jeu vidéo', cost: 100, icon: '🎮' },
  { id: 'r2', title: 'Fast Food', cost: 300, icon: '🍔' },
  { id: 'r3', title: 'Grignotage', cost: 50, icon: '🍫' }
];

export const Shop: React.FC = () => {
  const [points, setPoints] = useState(() => parseInt(localStorage.getItem('mindset_points') || '0', 10));

  useEffect(() => {
    const handleStorage = () => {
      setPoints(parseInt(localStorage.getItem('mindset_points') || '0', 10));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handlePointsUpdate = (newPoints: number) => {
    localStorage.setItem('mindset_points', newPoints.toString());
    window.dispatchEvent(new Event('storage'));
  };

  const [rewards, setRewards] = useState<Reward[]>(() => {
    const saved = localStorage.getItem('mindset_rewards');
    return saved ? JSON.parse(saved) : DEFAULT_REWARDS;
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newIcon, setNewIcon] = useState('🎁');
  
  const [purchasedId, setPurchasedId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('mindset_rewards', JSON.stringify(rewards));
    api.syncStateToCloud();
  }, [rewards]);

  const handleBuy = (reward: Reward) => {
    playClickSound();
    if (points >= reward.cost) {
      const remaining = points - reward.cost;
      handlePointsUpdate(remaining);
      setPurchasedId(reward.id);
      playLevelUpSound(); // Use a celebratory sound
      setTimeout(() => setPurchasedId(null), 2000);
    } else {
      // Not enough points - could trigger an error shake animation here
      const el = document.getElementById(`reward-${reward.id}`);
      if (el) {
        el.classList.add('shake-error');
        setTimeout(() => el.classList.remove('shake-error'), 500);
      }
    }
  };

  const handleDelete = (id: string) => {
    playClickSound();
    setRewards(rewards.filter(r => r.id !== id));
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newCost) return;
    
    playClickSound();
    const newReward: Reward = {
      id: Date.now().toString(),
      title: newTitle,
      cost: parseInt(newCost, 10),
      icon: newIcon || '🎁'
    };
    
    setRewards([...rewards, newReward]);
    setShowAddForm(false);
    setNewTitle('');
    setNewCost('');
  };

  return (
    <div className="shop-container fade-in">
      <div className="shop-header">
        <h1 className="page-title"><Gift className="title-icon" /> Boutique</h1>
        <p className="page-subtitle">Dépense tes pièces durement gagnées en te récompensant !</p>
      </div>

      <div className="balance-card glass-panel pulse-glow">
        <div className="balance-info">
          <span>Solde Actuel</span>
          <h2>{points} <Coins color="#fbbf24" size={24} /></h2>
        </div>
      </div>

      <div className="rewards-grid">
        {rewards.map(reward => (
          <div key={reward.id} id={`reward-${reward.id}`} className="reward-card glass-panel">
            <button className="reward-delete-btn" onClick={() => handleDelete(reward.id)}>
              <Trash2 size={16} />
            </button>
            <div className="reward-icon-large">{reward.icon}</div>
            <h3 className="reward-title">{reward.title}</h3>
            
            <button 
              className={`buy-btn ${points >= reward.cost ? 'affordable' : 'expensive'} ${purchasedId === reward.id ? 'purchased' : ''}`}
              onClick={() => handleBuy(reward)}
              onMouseEnter={playHoverSound}
            >
              {purchasedId === reward.id ? (
                <><CheckCircle2 size={18} /> Acheté !</>
              ) : (
                <>{reward.cost} <Coins size={16} /></>
              )}
            </button>
          </div>
        ))}

        <div 
          className="reward-card add-reward-card glass-panel" 
          onClick={() => { playClickSound(); setShowAddForm(true); }}
          onMouseEnter={playHoverSound}
        >
          <div className="add-icon-wrapper"><Plus size={32} /></div>
          <h3>Créer une récompense</h3>
        </div>
      </div>

      {showAddForm && (
        <div className="modal-overlay fade-in" onClick={() => setShowAddForm(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <h2>Nouvelle Récompense</h2>
            <form onSubmit={handleAddSubmit} className="add-reward-form">
              <div className="form-group">
                <label>Titre (ex: Sortie Cinéma)</label>
                <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Titre" autoFocus required />
              </div>
              <div className="form-group">
                <label>Prix (en pièces 🪙)</label>
                <input type="number" value={newCost} onChange={e => setNewCost(e.target.value)} placeholder="Prix" min="1" required />
              </div>
              <div className="form-group">
                <label>Emoji (Optionnel)</label>
                <input type="text" value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="🍿" maxLength={2} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddForm(false)}>Annuler</button>
                <button type="submit" className="btn-primary">Ajouter</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
