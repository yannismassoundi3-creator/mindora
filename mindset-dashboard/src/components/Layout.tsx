import React, { useState, useEffect } from 'react';
import { Home, Brain, Target, Calendar, User, ShoppingBag, Coins, Backpack, Sparkles } from 'lucide-react';
import { playHoverSound, playClickSound } from '../utils/sounds';
import './Layout.css';

import { getSecurePoints } from '../utils/secureStorage';

interface LayoutProps {
  children: React.ReactNode;
  activeView: string;
  setView: (view: string) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeView, setView }) => {
  const [points, setPoints] = useState(() => getSecurePoints());

  /**
   * L'offre n'avait aucune porte d'entrée permanente.
   *
   * Elle ne s'ouvrait que sur épuisement du quota mensuel, or le premier mur que
   * rencontre un compte gratuit est celui des coins — et ce cas-là ne propose
   * volontairement pas de s'abonner, puisqu'il suffit de valider une routine. Restait
   * donc un seul chemin, au fond de la page Profil. Ce bouton est le premier endroit
   * où quelqu'un qui veut payer peut le faire sans chercher.
   */
  const [estAbonne, setEstAbonne] = useState(
    () => localStorage.getItem('mindset_is_subscribed') === 'true',
  );

  const ouvrirOffre = (e: React.MouseEvent) => {
    e.preventDefault();
    playClickSound();
    window.dispatchEvent(new Event('openPricing'));
  };

  useEffect(() => {
    // Global Points Sync
    const handleStorage = () => {
      setPoints(getSecurePoints());
      setEstAbonne(localStorage.getItem('mindset_is_subscribed') === 'true');
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('mindset_points_updated', handleStorage);

    // Weekly Reset Logic (Micro Objectives)
    const getWeekNumber = (d: Date) => {
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    };
    
    const currentWeekStr = `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
    const lastResetWeek = localStorage.getItem('mindset_last_reset_week');

    if (lastResetWeek !== currentWeekStr) {
      const savedMicro = localStorage.getItem('mindset_micro_obj');
      if (savedMicro) {
        try {
          const parsed = JSON.parse(savedMicro);
          if (Array.isArray(parsed)) {
            const reset = parsed.map((m: any) => ({ ...m, progress: 0, done: false, awardedDate: undefined }));
            localStorage.setItem('mindset_micro_obj', JSON.stringify(reset));
            setTimeout(() => window.dispatchEvent(new Event('storage')), 100);
          }
        } catch (e) {}
      }
      localStorage.setItem('mindset_last_reset_week', currentWeekStr);
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('mindset_points_updated', handleStorage);
    };
  }, []);

  const handleNavClick = (e: React.MouseEvent, viewId: string) => {
    e.preventDefault();
    playClickSound();
    setView(viewId);
  };

  return (
    <div className="layout-container">
      {/* Background Effects */}
      <div className="bg-glow-effect"></div>
      <div className="bg-glow-effect-right"></div>

      {/* Sidebar (Desktop) */}
      <aside className="sidebar glass-panel">
        <div className="sidebar-logo">
          <img src="/disciplix_tiktok_pp.jpg" alt="Logo Disciplix" className="app-logo-img" />
          <h2>disciplix</h2>
        </div>
        
        <nav className="sidebar-nav">
          <a href="#" className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`} 
             onClick={(e) => handleNavClick(e, 'dashboard')}
             onMouseEnter={() => playHoverSound()}>
            <Home size={20} />
            <span>Dashboard</span>
          </a>
          <a href="#" className={`nav-item ${activeView === 'chat' ? 'active' : ''}`} 
             onClick={(e) => handleNavClick(e, 'chat')}
             onMouseEnter={() => playHoverSound()}>
            <Brain size={20} />
            <span>Coaching IA</span>
          </a>
          <a href="#" className={`nav-item ${activeView === 'objectives' ? 'active' : ''}`} 
             onClick={(e) => handleNavClick(e, 'objectives')}
             onMouseEnter={() => playHoverSound()}>
            <Target size={20} />
            <span>Objectifs</span>
          </a>
          <a href="#" className={`nav-item ${activeView === 'habits' ? 'active' : ''}`} 
             onClick={(e) => handleNavClick(e, 'habits')}
             onMouseEnter={() => playHoverSound()}>
            <Calendar size={20} />
            <span>Habitudes</span>
          </a>

          <a href="#" className={`nav-item ${activeView === 'inventory' ? 'active' : ''}`} 
             onClick={(e) => handleNavClick(e, 'inventory')}
             onMouseEnter={() => playHoverSound()}>
            <Backpack size={20} />
            <span>Inventaire</span>
          </a>
          <a href="#" className={`nav-item ${activeView === 'shop' ? 'active' : ''}`} 
             onClick={(e) => handleNavClick(e, 'shop')}
             onMouseEnter={() => playHoverSound()}>
            <ShoppingBag size={20} />
            <span>Boutique</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          {!estAbonne && (
            <a
              href="#"
              className="nav-item"
              onClick={ouvrirOffre}
              onMouseEnter={() => playHoverSound()}
              style={{ color: '#fbbf24' }}
            >
              <Sparkles size={20} />
              <span>Passer Pro</span>
            </a>
          )}
          <a href="#" className={`nav-item ${activeView === 'profile' ? 'active' : ''}`}
             onClick={(e) => handleNavClick(e, 'profile')}
             onMouseEnter={() => playHoverSound()}>
            <User size={20} />
            <span>Profil</span>
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="mobile-header glass-panel">
          <div className="sidebar-logo">
            <img src="/disciplix_tiktok_pp.jpg" alt="Logo Disciplix" className="app-logo-img" />
            <h2>disciplix</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* Sur mobile la barre du bas est pleine : l'offre passe par l'en-tête. */}
            {!estAbonne && (
              <button
                className="coin-balance-btn glass-panel-interactive"
                onClick={ouvrirOffre}
                style={{ background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.35)', padding: '4px 8px', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '4px', color: '#fbbf24', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                <Sparkles size={14} color="#fbbf24" />
                Pro
              </button>
            )}
            <button className="coin-balance-btn glass-panel-interactive pulse-glow" onClick={() => { playClickSound(); setView('inventory'); }} style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', padding: '4px 8px', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--primary)', cursor: 'pointer' }}>
              <div className="liquid-glass-orb" style={{ width: '12px', height: '12px', background: 'var(--primary)' }}></div>
              <span className="hide-on-mobile" style={{ fontSize: '0.8rem' }}>Mes Objets</span>
            </button>
            <button className="coin-balance-btn glass-panel-interactive pulse-glow" onClick={() => { playClickSound(); setView('shop'); }} style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', padding: '4px 8px', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '4px', color: '#fbbf24', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}>
              <Coins size={14} color="#fbbf24" />
              {points}
            </button>
            <button className="user-avatar-btn" onClick={() => { playClickSound(); setView('profile'); }}>
              <div className="user-avatar">{localStorage.getItem('mindset_user_name')?.substring(0,2).toUpperCase() || 'YL'}</div>
            </button>
          </div>
        </header>
        
        <div className="content-scroll-area">
          {children}
          {activeView !== 'chat' && (
            <div style={{ height: '160px', width: '100%', flexShrink: 0 }}></div>
          )}
        </div>
      </main>

      {/* Bottom Nav (Mobile) */}
      <nav className="bottom-nav glass-panel">
        <a href="#" className={`bottom-nav-item ${activeView === 'dashboard' ? 'active' : ''}`} onClick={(e) => handleNavClick(e, 'dashboard')}>
          <Home size={24} />
          <span>Accueil</span>
        </a>
        <a href="#" className={`bottom-nav-item ${activeView === 'objectives' ? 'active' : ''}`} onClick={(e) => handleNavClick(e, 'objectives')}>
          <Target size={24} />
          <span>Objectifs</span>
        </a>
        <div className="bottom-nav-spacer"></div>
        <a href="#" className={`bottom-nav-item ${activeView === 'habits' ? 'active' : ''}`} onClick={(e) => handleNavClick(e, 'habits')}>
          <Calendar size={24} />
          <span>Suivi</span>
        </a>
        <a href="#" className={`bottom-nav-item ${activeView === 'profile' ? 'active' : ''}`} onClick={(e) => handleNavClick(e, 'profile')}>
          <User size={24} />
          <span>Profil</span>
        </a>
        <a href="#" className="ai-btn-wrapper" onClick={(e) => handleNavClick(e, 'chat')}>
          <div className="ai-fab">
            <Brain size={28} color="#fff" />
          </div>
        </a>
      </nav>
    </div>
  );
};
