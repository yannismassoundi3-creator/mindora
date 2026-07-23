import React, { useState, useEffect } from 'react';
import { Gift, Coins, Plus, Trash2, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { playClickSound, playLevelUpSound, playHoverSound, playBloopSound } from '../utils/sounds';
import { api } from '../services/api';
import { getDailyShopItems } from '../utils/cosmetics';
import type { Cosmetic } from '../utils/cosmetics';
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
  const [ownedCosmetics, setOwnedCosmetics] = useState<string[]>(() => JSON.parse(localStorage.getItem('mindset_owned_cosmetics') || '[]'));
  const [equippedSkin, setEquippedSkin] = useState<string | null>(() => localStorage.getItem('mindset_ai_skin_id'));
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const handleStorage = () => {
      setPoints(parseInt(localStorage.getItem('mindset_points') || '0', 10));
      setOwnedCosmetics(JSON.parse(localStorage.getItem('mindset_owned_cosmetics') || '[]'));
      setEquippedSkin(localStorage.getItem('mindset_ai_skin_id'));
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

  // Daily Shop Timer
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setHours(24, 0, 0, 0);
      const diff = tomorrow.getTime() - now.getTime();
      
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem('mindset_rewards', JSON.stringify(rewards));
    api.syncStateToCloud(); // Sync changes
  }, [rewards]);

  const handleBuyReward = (reward: Reward) => {
    playClickSound();
    if (points >= reward.cost) {
      const remaining = points - reward.cost;
      handlePointsUpdate(remaining);
      setPurchasedId(reward.id);
      playLevelUpSound();
      setTimeout(() => setPurchasedId(null), 2000);
    } else {
      triggerShake(`reward-${reward.id}`);
    }
  };

  const handleBuyCosmetic = (cosmetic: Cosmetic) => {
    playClickSound();
    if (ownedCosmetics.includes(cosmetic.id)) {
      // Equip
      playBloopSound();
      localStorage.setItem('mindset_ai_skin_id', cosmetic.id);
      setEquippedSkin(cosmetic.id);
      window.dispatchEvent(new Event('storage'));
    } else if (points >= cosmetic.cost) {
      // Buy
      const remaining = points - cosmetic.cost;
      handlePointsUpdate(remaining);
      const updatedOwned = [...ownedCosmetics, cosmetic.id];
      setOwnedCosmetics(updatedOwned);
      localStorage.setItem('mindset_owned_cosmetics', JSON.stringify(updatedOwned));
      setPurchasedId(cosmetic.id);
      playLevelUpSound();
      
      // Auto-equip
      localStorage.setItem('mindset_ai_skin_id', cosmetic.id);
      setEquippedSkin(cosmetic.id);
      window.dispatchEvent(new Event('storage'));
      
      setTimeout(() => setPurchasedId(null), 2000);
    } else {
      triggerShake(`cosmetic-${cosmetic.id}`);
    }
  };

  const triggerShake = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('shake-error');
      setTimeout(() => el.classList.remove('shake-error'), 500);
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

  const dailyItems = getDailyShopItems();

  return (
    <div className="shop-container fade-in">
      <div className="shop-header">
        <h1 className="page-title"><Gift className="title-icon" /> Boutique</h1>
        <p className="page-subtitle">Dépense tes pièces durement gagnées !</p>
      </div>

      <div className="balance-card glass-panel pulse-glow">
        <div className="balance-info">
          <span>Solde Actuel</span>
          <h2>{points} <Coins color="#fbbf24" size={24} /></h2>
        </div>
      </div>

      {/* DAILY SHOP */}
      <section className="shop-section">
        <div className="section-header-flex">
          <h2><Sparkles size={20} color="#c4b5fd" /> Boutique du Jour (Skins IA)</h2>
          <div className="daily-timer">
            <Clock size={14} /> Renouvellement dans {timeLeft}
          </div>
        </div>
        
        <div className="rewards-grid">
          {dailyItems.map(item => {
            const isOwned = ownedCosmetics.includes(item.id);
            const isEquipped = equippedSkin === item.id;
            
            return (
              <div key={item.id} id={`cosmetic-${item.id}`} className={`reward-card glass-panel cosmetic-card ${item.rarity}`}>
                <div className="rarity-badge">{item.rarity}</div>
                <div className="reward-icon-large" style={item.type === 'color' ? { background: item.value, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } : {}}>
                  {item.type === 'color' ? '🔮' : item.value}
                </div>
                <h3 className="reward-title">{item.title}</h3>
                <p className="cosmetic-desc">{item.description}</p>
                
                <button 
                  className={`buy-btn ${isEquipped ? 'equipped' : isOwned ? 'owned' : points >= item.cost ? 'affordable' : 'expensive'} ${purchasedId === item.id ? 'purchased' : ''}`}
                  onClick={() => handleBuyCosmetic(item)}
                  onMouseEnter={playHoverSound}
                >
                  {isEquipped ? (
                    <><CheckCircle2 size={18} /> Équipé</>
                  ) : isOwned ? (
                    'Équiper'
                  ) : purchasedId === item.id ? (
                    <><CheckCircle2 size={18} /> Acheté !</>
                  ) : (
                    <>{item.cost} <Coins size={16} /></>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* CUSTOM REWARDS */}
      <section className="shop-section">
        <div className="section-header-flex">
          <h2><Gift size={20} color="#10b981" /> Tes Récompenses Persos</h2>
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
                onClick={() => handleBuyReward(reward)}
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
      </section>

      {showAddForm && (
        <div className="modal-overlay fade-in" onClick={() => setShowAddForm(false)}>
          <div className="modal-content glass-panel bounce-in" onClick={e => e.stopPropagation()}>
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
