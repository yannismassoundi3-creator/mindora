import React, { useState, useEffect } from 'react';
import { Home, Brain, Target, Calendar, User, ShoppingBag, Coins, Backpack, Sparkles, Shield } from 'lucide-react';
import { playHoverSound, playClickSound } from '../utils/sounds';
import { BandeauCommande } from './BandeauCommande';
import { JarvisPopup } from './JarvisPopup';
import type { JarvisPopupData } from './JarvisPopup';
import { EVENEMENT_TACHE_FAITE } from '../utils/journee';
import { ProActif } from './ProActif';
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

  // Renseigné au démarrage par la réponse de `/auth/me`. Voir la note du lien
  // « Admin » plus bas : ce drapeau n'ouvre aucun droit.
  const [estAdmin, setEstAdmin] = useState(() => localStorage.getItem('mindset_role') === 'ADMIN');

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
      // `/auth/me` répond après le premier rendu : sans cette relecture, le lien
      // n'apparaîtrait qu'au rechargement suivant.
      setEstAdmin(localStorage.getItem('mindset_role') === 'ADMIN');
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

  /*
    La bulle du coach après une tâche cochée depuis le bandeau.

    Elle était rendue par le Dashboard, qui n'est plus le seul endroit d'où l'on
    peut cocher : le bandeau vit sur toutes les pages. Le module de calcul émet un
    événement, le Layout l'affiche — le Dashboard garde la sienne pour les cases
    de sa propre liste, il n'y a donc jamais deux bulles pour un seul clic.
  */
  const [bulleCoach, setBulleCoach] = useState<JarvisPopupData | null>(null);

  useEffect(() => {
    const surTacheFaite = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setBulleCoach({
        x: Math.min(detail.x ?? window.innerWidth / 2, window.innerWidth - 340),
        y: detail.y ?? window.innerHeight / 2,
        title: detail.titre || 'Tâche',
        itemType: 'routine',
      });
    };
    window.addEventListener(EVENEMENT_TACHE_FAITE, surTacheFaite);
    return () => window.removeEventListener(EVENEMENT_TACHE_FAITE, surTacheFaite);
  }, []);

  /*
    « Voir cette tâche dans la liste » depuis le bandeau.

    La cible est le carrousel de routines du Dashboard, qui peut ne pas être
    monté. Le créneau visé passe donc par `localStorage` — lu à l'arrivée par le
    Dashboard — et l'événement ne sert qu'au cas où l'on y est déjà, où aucun
    montage ne viendra relire la clé.
  */
  const allerAuCreneau = (indexGroupe: number) => {
    playClickSound();
    // Seul le créneau est écrit : c'est le Dashboard qui bascule sur l'onglet des
    // routines en le lisant. Poser aussi `mindset_dashboard_tab` laisserait une
    // clé non consommée quand on est déjà sur le tableau de bord.
    localStorage.setItem('mindset_dashboard_creneau', String(indexGroupe));
    if (activeView !== 'dashboard') {
      setView('dashboard');
    } else {
      window.dispatchEvent(new Event('mindset:aller-creneau'));
    }
  };

  return (
    <div className="layout-container">
      {/* L'annonce de l'abonnement actif se monte ici et non dans une page :
          l'activation peut venir du Profil, de l'écran de tarifs, ou du rattrapage
          de paiement au démarrage. */}
      <ProActif />

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
          {/*
            Le panneau d'administration n'était atteignable que par « ?admin=true »,
            un paramètre qu'aucun écran ne mentionnait : la page existait sans que
            rien n'y mène. Il n'apparaît que pour un compte ADMIN — et ce n'est pas
            ce test qui protège quoi que ce soit, les routes `/admin/*` étant
            gardées côté serveur.
          */}
          {estAdmin && (
            <a
              href="?admin=true"
              className="nav-item"
              onMouseEnter={() => playHoverSound()}
              style={{ color: '#00f2fe' }}
            >
              <Shield size={20} />
              <span>Admin</span>
            </a>
          )}
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
        
        {/*
          Le chat réserve moins de place en haut et en bas que les autres onglets.

          Ailleurs, ces marges empêchent le dernier bouton d'une page de finir sous la
          barre de navigation. Sur le chat, la barre de saisie est collée juste au-dessus
          d'elle et la prolonge : la marge générique n'y protégeait plus rien et laissait
          56 px de vide entre les deux, sur le seul écran qu'on lit en continu.
        */}
        <div className={`content-scroll-area${activeView === 'chat' ? ' zone-chat' : ''}`}>
          {/*
            Le bandeau est ici et non dans le Dashboard : il doit rester sous les
            yeux quel que soit l'onglet. Il est exclu du chat, qui occupe l'écran
            entier avec son propre en-tête et où la question « quoi faire
            maintenant » se pose justement au coach.
          */}
          {activeView !== 'chat' && (
            <BandeauCommande
              nomIa={localStorage.getItem('mindset_ai_name') || 'DISCIPLIX OS'}
              onOuvrirChat={() => { playClickSound(); setView('chat'); }}
              onAllerAuCreneau={allerAuCreneau}
            />
          )}
          {children}
          {activeView !== 'chat' && (
            <div style={{ height: '160px', width: '100%', flexShrink: 0 }}></div>
          )}
        </div>
      </main>

      {bulleCoach && (
        <JarvisPopup
          data={bulleCoach}
          onClose={() => setBulleCoach(null)}
          onChatNavigate={(msg) => {
            localStorage.setItem('mindset_pending_chat_msg', msg);
            window.dispatchEvent(new CustomEvent('mindset_pending_chat_msg', { detail: msg }));
            setView('chat');
          }}
        />
      )}

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
