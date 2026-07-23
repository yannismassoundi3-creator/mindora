import React, { useState, useEffect } from 'react';
import { Home, Brain, Target, Calendar, User, ShoppingBag, Coins, Backpack } from 'lucide-react';
import { playHoverSound, playClickSound } from '../utils/sounds';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
  activeView: string;
  setView: (view: string) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeView, setView }) => {
  const [points, setPoints] = useState(() => parseInt(localStorage.getItem('mindset_points') || '0', 10));

  useEffect(() => {
    const handleStorage = () => {
      setPoints(parseInt(localStorage.getItem('mindset_points') || '0', 10));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
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
          <span className="logo-dot"></span>
          <h2>mindora</h2>
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
            <span className="logo-dot"></span>
            <h2>mindora</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="coin-balance-btn" onClick={() => { playClickSound(); setView('inventory'); }} style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: '#fff', fontSize: '0.9rem', cursor: 'pointer' }}>
              <Backpack size={16} />
            </button>
            <button className="coin-balance-btn" onClick={() => { playClickSound(); setView('shop'); }} style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: '#fbbf24', fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>
              {points} <Coins size={16} />
            </button>
            <button className="user-avatar-btn" onClick={() => { playClickSound(); setView('profile'); }}>
              <div className="user-avatar">{localStorage.getItem('mindset_user_name')?.substring(0,2).toUpperCase() || 'YL'}</div>
            </button>
          </div>
        </header>
        
        <div className="content-scroll-area">
          {children}
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
