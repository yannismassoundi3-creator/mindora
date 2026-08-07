import React, { useState, useEffect } from 'react';
import { api } from './services/api';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Onboarding } from './components/Onboarding';
import { AIChat } from './components/AIChat';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthScreen } from './components/AuthScreen';
import { Shop } from './pages/Shop';
import { Objectives } from './pages/Objectives';
import { Habits } from './pages/Habits';
import { Profile } from './pages/Profile';
import { Inventory } from './pages/Inventory';
import { PricingScreen } from './pages/PricingScreen';
import { LevelUpOverlay } from './components/LevelUpOverlay';
import { RankUpOverlay } from './components/RankUpOverlay';
import { StreakBrokenOverlay } from './components/StreakBrokenOverlay';
import { LockScreen } from './components/LockScreen';
import { SkeletonGlow } from './components/SkeletonGlow';
import { ParticlesBackground } from './components/ParticlesBackground';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerSW } from 'virtual:pwa-register';
import './styles/global.css';
import './index.css';

const APP_VERSION = '1.0.5'; // Change this string to force a global cache clear
const currentVersion = localStorage.getItem('mindset_app_version');
if (currentVersion !== APP_VERSION) {
  if ('caches' in window) {
    caches.keys().then((names) => {
      for (const name of names) {
        caches.delete(name);
      }
    });
  }
  localStorage.setItem('mindset_app_version', APP_VERSION);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
      for(let registration of registrations) {
        registration.unregister();
      }
    });
  }
  setTimeout(() => {
    window.location.reload();
  }, 100);
}

// Enregistrement du Service Worker avec mise à jour forcée pour éviter le cache bloqué
const updateSW = registerSW({
  onNeedRefresh() {
    console.log("Nouvelle version détectée, mise à jour...");
    updateSW(true);
  },
  onOfflineReady() {
    console.log("App prête pour le mode hors ligne");
  },
});


function App() {
  const IS_BETA_TEST_PHASE = false; // Activer la phase de test gratuite
  const hasToken = !!localStorage.getItem('mindset_token');
  const [isAuthenticated, setIsAuthenticated] = useState(hasToken);
  const [particlesEnabled, setParticlesEnabled] = useState(() => localStorage.getItem('mindset_particles') !== 'false');

  // App Theme Management
  useEffect(() => {
    const applyTheme = () => {
      let themeId = localStorage.getItem('mindset_app_theme_id');
      if (themeId === null) {
        themeId = 'theme-monochrome-dark';
        localStorage.setItem('mindset_app_theme_id', themeId);
      }
      document.body.className = themeId || '';
    };

    // Appliquer la couleur de texte personnalisée
    const applyTextColor = () => {
      const textColor = localStorage.getItem('mindset_text_color');
      if (textColor && textColor !== 'default') {
        document.body.style.setProperty('--primary', textColor);
        document.body.style.setProperty('--secondary', textColor); // On écrase aussi le secondary pour que les dégradés deviennent solides
      } else {
        document.body.style.removeProperty('--primary');
        document.body.style.removeProperty('--secondary');
      }
    };
    
    applyTheme();
    applyTextColor();

    // Listen for changes from other tabs or components
    window.addEventListener('storage', applyTheme);
    // Custom event for internal app changes
    window.addEventListener('themeChanged', applyTheme);
    
    return () => {
      window.removeEventListener('storage', applyTheme);
      window.removeEventListener('themeChanged', applyTheme);
    };
  }, []);

  useEffect(() => {
    const handleParticles = () => {
      setParticlesEnabled(localStorage.getItem('mindset_particles') !== 'false');
    };
    window.addEventListener('storage', handleParticles);
    window.addEventListener('particlesChanged', handleParticles);
    return () => {
      window.removeEventListener('storage', handleParticles);
      window.removeEventListener('particlesChanged', handleParticles);
    };
  }, []);

  const urlParams = new URLSearchParams(window.location.search);
  const isAuthIntent = urlParams.get('auth') === 'true';
  const hasCompletedOnboarding = localStorage.getItem('hasCompletedOnboarding') === 'true';

  const [currentView, setCurrentView] = useState<'auth' | 'onboarding' | 'welcome' | 'dashboard' | 'chat' | 'objectives' | 'habits' | 'profile' | 'shop' | 'inventory'>(
    (isAuthIntent && !hasToken) ? 'auth' : (hasToken && hasCompletedOnboarding ? 'dashboard' : 'welcome')
  );

  const [isLocked, setIsLocked] = useState(() => !!localStorage.getItem('mindset_biometric_id'));

  const [isSubscribed, setIsSubscribed] = useState(() => localStorage.getItem('mindset_is_subscribed') === 'true');

  const VIEW_ORDER = ['dashboard', 'objectives', 'chat', 'habits', 'profile', 'shop', 'inventory'];
  const [slideDirection, setSlideDirection] = useState<'right' | 'left' | 'none'>('none');

  const [showPricingModal, setShowPricingModal] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        if (hasToken) {
          // Download the latest data from the Cloud DB to localStorage
          await api.downloadCloudState();
          
          const user = await api.get('/auth/me');
          const subscribed = user.subscription?.status === 'ACTIVE';
          setIsSubscribed(subscribed);
          localStorage.setItem('mindset_is_subscribed', subscribed ? 'true' : 'false');

          if (urlParams.get('success') === 'true') {
            import('canvas-confetti').then((confetti) => {
              confetti.default({
                particleCount: 150,
                spread: 100,
                origin: { y: 0.6 },
                colors: ['#3b82f6', '#8b5cf6', '#ec4899']
              });
            });
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }
      } catch (e) {
        console.error('Failed to initialize app', e);
      } finally {
        // Ajouter un très léger délai pour apprécier l'animation skeleton si la co est très rapide
        setTimeout(() => setIsInitializing(false), 800);
      }
    };
    initializeApp();
  }, [hasToken]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('mindset_theme');
    if (savedTheme) {
      document.documentElement.style.setProperty('--primary', savedTheme);
    }
  }, []);

  const handleOnboardingComplete = () => {
    localStorage.setItem('hasCompletedOnboarding', 'true');
    setCurrentView('dashboard');
    if (!isSubscribed && !IS_BETA_TEST_PHASE) {
      setShowPricingModal(true);
    }
  };

  const handleSubscribe = () => {
    localStorage.setItem('mindset_is_subscribed', 'true');
    setIsSubscribed(true);
    setShowPricingModal(false);
  };

  const tryOpenChat = () => {
    if (isSubscribed || IS_BETA_TEST_PHASE) {
      setCurrentView('chat');
    } else {
      setShowPricingModal(true);
    }
  };

  if (currentView === 'welcome') {
    if (!hasToken) {
      window.location.href = '/landing.html';
      return null;
    } else {
      const isCompleted = localStorage.getItem('hasCompletedOnboarding') === 'true';
      return <WelcomeScreen onComplete={() => setCurrentView(isCompleted ? 'dashboard' : 'onboarding')} />;
    }
  }

  if (currentView === 'auth') {
    return <AuthScreen onComplete={() => {
      const isCompleted = localStorage.getItem('hasCompletedOnboarding') === 'true';
      setCurrentView(isCompleted ? 'dashboard' : 'onboarding');
    }} />;
  }

  if (currentView === 'onboarding') {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }



  const handleSetView = (v: string) => {
    const prevIdx = VIEW_ORDER.indexOf(currentView);
    const newIdx = VIEW_ORDER.indexOf(v);
    
    if (newIdx !== -1 && prevIdx !== -1 && newIdx !== prevIdx) {
      setSlideDirection(newIdx > prevIdx ? 'right' : 'left');
    }
    
    if ((v === 'chat' || v === 'objectives' || v === 'habits') && !isSubscribed && !IS_BETA_TEST_PHASE) {
      setShowPricingModal(true);
    } else {
      setCurrentView(v as any);
    }
  };

  if (isLocked) {
    return (
      <LockScreen onUnlock={() => setIsLocked(false)} />
    );
  }

  return (
    <ErrorBoundary>
      {particlesEnabled && <ParticlesBackground />}
      <Layout 
        activeView={currentView} 
        setView={handleSetView}
      >
        <div key={currentView} className={`view-transition-wrapper slide-${slideDirection}`}>
          {isInitializing && currentView !== 'welcome' && currentView !== 'auth' && currentView !== 'onboarding' ? (
            <div style={{ padding: '20px' }}>
              <SkeletonGlow rows={4} />
            </div>
          ) : (
            <>
              {currentView === 'dashboard' && <Dashboard onOpenChat={tryOpenChat} />}
              {currentView === 'chat' && <AIChat />}
              {currentView === 'objectives' && <Objectives onOpenChat={tryOpenChat} />}
              {currentView === 'habits' && <Habits onOpenChat={tryOpenChat} />}
              {currentView === 'profile' && <Profile onNameChange={() => window.location.reload()} />}
              {currentView === 'shop' && <Shop />}
              {currentView === 'inventory' && <Inventory />}
            </>
          )}
        </div>
        
        {showPricingModal && (
          <PricingScreen 
            onSubscribe={handleSubscribe} 
            onClose={() => setShowPricingModal(false)} 
          />
        )}
        <LevelUpOverlay />
        <RankUpOverlay />
        <StreakBrokenOverlay />
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
