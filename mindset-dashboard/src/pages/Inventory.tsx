import React, { useState, useEffect } from 'react';
import { Backpack, CheckCircle2, Sparkles, CheckSquare } from 'lucide-react';
import { playClickSound, playLevelUpSound, playBloopSound } from '../utils/sounds';
import { api } from '../services/api';
import { AI_COSMETICS } from '../utils/cosmetics';
import type { Cosmetic } from '../utils/cosmetics';
import './Inventory.css';

interface InventoryItem {
  id: string; // unique instance id
  rewardId: string;
  title: string;
  icon: string;
  purchasedAt: string;
}

export const Inventory: React.FC = () => {
  const [inventory, setInventory] = useState<InventoryItem[]>(() => {
    return JSON.parse(localStorage.getItem('mindset_inventory_rewards') || '[]');
  });
  const [ownedCosmetics, setOwnedCosmetics] = useState<string[]>(() => {
    return JSON.parse(localStorage.getItem('mindset_owned_cosmetics') || '[]');
  });
  const [equippedSkin, setEquippedSkin] = useState<string | null>(() => {
    return localStorage.getItem('mindset_ai_skin_id');
  });

  const [activeTab, setActiveTab] = useState<'privileges' | 'dressing'>('privileges');
  const [animatingItemId, setAnimatingItemId] = useState<string | null>(null);

  useEffect(() => {
    const handleStorage = () => {
      setInventory(JSON.parse(localStorage.getItem('mindset_inventory_rewards') || '[]'));
      setOwnedCosmetics(JSON.parse(localStorage.getItem('mindset_owned_cosmetics') || '[]'));
      setEquippedSkin(localStorage.getItem('mindset_ai_skin_id'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    localStorage.setItem('mindset_inventory_rewards', JSON.stringify(inventory));
    api.syncStateToCloud();
  }, [inventory]);

  const handleConsume = (item: InventoryItem) => {
    playClickSound();
    setAnimatingItemId(item.id);
    
    // Give 5 XP
    let currentExp = parseInt(localStorage.getItem('mindset_points') || '0', 10);
    localStorage.setItem('mindset_points', (currentExp + 5).toString());
    window.dispatchEvent(new Event('storage'));

    setTimeout(() => {
      playLevelUpSound();
      setInventory(prev => prev.filter(i => i.id !== item.id));
      setAnimatingItemId(null);
    }, 600);
  };

  const handleEquip = (cosmeticId: string) => {
    playBloopSound();
    localStorage.setItem('mindset_ai_skin_id', cosmeticId);
    setEquippedSkin(cosmeticId);
    window.dispatchEvent(new Event('storage'));
  };

  const myCosmetics = AI_COSMETICS.filter(c => ownedCosmetics.includes(c.id));

  return (
    <div className="inventory-container fade-in">
      <div className="inventory-header">
        <h1 className="page-title"><Backpack className="title-icon" /> Mon Inventaire</h1>
        <p className="page-subtitle">Gère tes privilèges et ton dressing IA</p>
      </div>

      <div className="inventory-tabs glass-panel">
        <button 
          className={`tab-btn ${activeTab === 'privileges' ? 'active' : ''}`}
          onClick={() => { playClickSound(); setActiveTab('privileges'); }}
        >
          🎁 Mes Privilèges ({inventory.length})
        </button>
        <button 
          className={`tab-btn ${activeTab === 'dressing' ? 'active' : ''}`}
          onClick={() => { playClickSound(); setActiveTab('dressing'); }}
        >
          👕 Dressing IA ({myCosmetics.length})
        </button>
      </div>

      <div className="inventory-content">
        {activeTab === 'privileges' && (
          <div className="privileges-section fade-in">
            {inventory.length === 0 ? (
              <div className="empty-state glass-panel">
                <div className="empty-icon">🎒</div>
                <h3>Ton sac est vide !</h3>
                <p>Achète des privilèges dans la Boutique pour les utiliser ici.</p>
              </div>
            ) : (
              <div className="privileges-grid">
                {inventory.map(item => (
                  <div 
                    key={item.id} 
                    className={`privilege-card glass-panel ${animatingItemId === item.id ? 'consuming-anim' : ''}`}
                  >
                    <div className="privilege-icon">{item.icon}</div>
                    <div className="privilege-info">
                      <h3>{item.title}</h3>
                      <span>Acheté le {new Date(item.purchasedAt).toLocaleDateString()}</span>
                    </div>
                    <button 
                      className="consume-btn" 
                      onClick={() => handleConsume(item)}
                      disabled={animatingItemId === item.id}
                    >
                      {animatingItemId === item.id ? <CheckCircle2 size={20} /> : <CheckSquare size={20} />}
                      <span>Consommer</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'dressing' && (
          <div className="dressing-section fade-in">
            {myCosmetics.length === 0 ? (
              <div className="empty-state glass-panel">
                <div className="empty-icon">👕</div>
                <h3>Dressing vide !</h3>
                <p>Achète des skins IA dans la Boutique du Jour.</p>
              </div>
            ) : (
              <div className="dressing-grid">
                {myCosmetics.map(item => (
                  <div key={item.id} className={`dressing-card glass-panel ${equippedSkin === item.id ? 'equipped-card' : ''}`}>
                    <div className="dressing-icon-large" style={item.type === 'color' ? { background: item.value, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } : {}}>
                      {item.type === 'color' ? '🔮' : item.value}
                    </div>
                    <h3 className="dressing-title">{item.title}</h3>
                    <p className="dressing-desc">{item.description}</p>
                    
                    <button 
                      className={`equip-btn ${equippedSkin === item.id ? 'equipped' : ''}`}
                      onClick={() => handleEquip(item.id)}
                    >
                      {equippedSkin === item.id ? (
                        <><CheckCircle2 size={16} /> Équipé</>
                      ) : (
                        <><Sparkles size={16} /> Équiper</>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
