import React, { useState, useEffect } from 'react';
import { api, renvoyerProfilEnAttente } from './services/api';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Onboarding } from './components/Onboarding';
import { AIChat } from './components/AIChat';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthScreen } from './components/AuthScreen';
import { LevelUpOverlay } from './components/LevelUpOverlay';
import { RankUpOverlay } from './components/RankUpOverlay';
import { LockScreen } from './components/LockScreen';
import { SkeletonGlow } from './components/SkeletonGlow';
import { ParticlesBackground } from './components/ParticlesBackground';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { ShockwaveOverlay } from './components/ShockwaveOverlay';
import { AiNotification } from './components/AiNotification';
import { AiExplanationModal } from './components/AiExplanationModal';
import { getSecurePoints, setSecurePoints } from './utils/secureStorage';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './styles/global.css';
import './index.css';

// Lazy load heavy pages for code-splitting
const Shop = React.lazy(() => import('./pages/Shop').then(module => ({ default: module.Shop })));
const Objectives = React.lazy(() => import('./pages/Objectives').then(module => ({ default: module.Objectives })));
const Habits = React.lazy(() => import('./pages/Habits').then(module => ({ default: module.Habits })));
const Profile = React.lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Inventory = React.lazy(() => import('./pages/Inventory').then(module => ({ default: module.Inventory })));
const PricingScreen = React.lazy(() => import('./pages/PricingScreen').then(module => ({ default: module.PricingScreen })));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard').then(module => ({ default: module.AdminDashboard })));

const APP_VERSION = '1.1.0'; // Change this string to force a global cache clear
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
  // Le service worker n'est plus désinscrit ici. Un abonnement aux notifications
  // appartient au service worker qui l'a créé : le désinscrire le détruit avec lui.
  // Chaque changement de version faisait donc fondre la base d'abonnés, et
  // l'abonnement ne revenait que si la personne repassait par le dashboard.
  //
  // Vider les caches suffit à récupérer les fichiers à jour, et le mode autoUpdate de
  // vite-plugin-pwa remplace déjà le service worker tout seul dès qu'il en existe un
  // nouveau — c'était de toute façon la ceinture par-dessus les bretelles.
  setTimeout(() => {
    window.location.reload();
  }, 100);
}

function App() {
  // En mode autoUpdate, le service worker s'installe et prend la main tout seul :
  // il n'y a plus de mise à jour en attente à proposer à l'utilisateur.
  useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

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
      
      // Unlock the black theme as a gift for all users
      try {
        const ownedStr = localStorage.getItem('mindset_owned_cosmetics') || '[]';
        const owned = JSON.parse(ownedStr);
        if (!owned.includes('t_monodark')) {
          owned.push('t_monodark');
          localStorage.setItem('mindset_owned_cosmetics', JSON.stringify(owned));
        }
      } catch (e) {}

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

  /**
   * Formule choisie sur la page d'accueil, mise de côté le temps de l'inscription.
   *
   * Les trois boutons de la grille de tarifs menaient tous à la même inscription, et
   * personne ne reparlait jamais du plan à la sortie : quelqu'un qui avait cliqué
   * « Passer à vie » se retrouvait dans l'app gratuite. Le trajet passe par le 2FA
   * et un rechargement complet, donc l'adresse ne survit pas : c'est localStorage
   * qui porte l'intention jusqu'au dashboard, et elle est effacée dès qu'on l'a
   * honorée — sinon l'offre se rouvrirait à chaque visite.
   */
  const PLANS = ['monthly', 'lifetime'];
  const planUrl = urlParams.get('plan');
  if (planUrl && PLANS.includes(planUrl)) localStorage.setItem('mindset_plan_voulu', planUrl);

  /**
   * Écran demandé par le lien d'arrivée, s'il en désigne un qui existe.
   *
   * Les notifications promettent un endroit précis — « Ouvre le Chat IA pour
   * réduire la difficulté de tes objectifs » — mais l'app n'avait aucune façon
   * d'être ouverte ailleurs que sur le dashboard : toutes menaient au même écran,
   * et la promesse tombait à plat.
   */
  const VUES_OUVRABLES = ['dashboard', 'chat', 'objectives', 'habits', 'profile', 'shop', 'inventory'] as const;
  const vueDemandee = VUES_OUVRABLES.find((v) => v === urlParams.get('vue'));

  const [currentView, setCurrentView] = useState<'auth' | 'onboarding' | 'welcome' | 'dashboard' | 'chat' | 'objectives' | 'habits' | 'profile' | 'shop' | 'inventory'>(
    (isAuthIntent && !hasToken) ? 'auth' : (hasToken && hasCompletedOnboarding ? (vueDemandee ?? 'dashboard') : 'welcome')
  );

  const [isLocked, setIsLocked] = useState(() => !!localStorage.getItem('mindset_biometric_id'));

  // L'état d'abonnement n'est plus un verrou côté client : il ne sert qu'à rafraîchir
  // localStorage, que les autres écrans lisent pour leur affichage.
  const [, setIsSubscribed] = useState(() => localStorage.getItem('mindset_is_subscribed') === 'true');

  const VIEW_ORDER = ['dashboard', 'objectives', 'chat', 'habits', 'profile', 'shop', 'inventory'];
  const [slideDirection, setSlideDirection] = useState<'right' | 'left' | 'none'>('none');

  const [showPricingModal, setShowPricingModal] = useState(false);
  const [planInitial, setPlanInitial] = useState<'monthly' | 'lifetime'>('monthly');
  const [isInitializing, setIsInitializing] = useState(true);

  // L'offre venue de la page d'accueil attend d'avoir un dashboard sous elle : la
  // rouvrir pendant le questionnaire d'inscription couperait la parole au seul
  // moment où l'on demande quelque chose à la personne.
  useEffect(() => {
    if (isInitializing || currentView !== 'dashboard') return;
    const voulu = localStorage.getItem('mindset_plan_voulu');
    if (!voulu) return;
    localStorage.removeItem('mindset_plan_voulu');
    if (localStorage.getItem('mindset_is_subscribed') === 'true') return;
    setPlanInitial(voulu === 'lifetime' ? 'lifetime' : 'monthly');
    setShowPricingModal(true);
  }, [isInitializing, currentView]);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        if (hasToken) {
          // Download the latest data from the Cloud DB to localStorage
          await api.downloadCloudState();

          const user = await api.get('/auth/me');
          // TRIALING compte comme abonné : c'est l'essai de 7 jours du forfait mensuel.
          // Le serveur ouvre le coach dans les deux cas (AiQuotaService.PAID_STATUSES) ;
          // ne garder qu'ACTIVE ici afficherait « Passer Pro » à quelqu'un qui vient de
          // souscrire, et lui retirerait le bonus de points des abonnés.
          const subscribed = ['ACTIVE', 'TRIALING'].includes(user.subscription?.status);
          setIsSubscribed(subscribed);
          localStorage.setItem('mindset_is_subscribed', subscribed ? 'true' : 'false');
          // Le menu lit ce drapeau pour masquer « Passer Pro ». L'événement « storage »
          // ne se déclenche qu'entre onglets : sans ce rappel, un abonné continuerait
          // de voir un bouton l'invitant à payer ce qu'il a déjà payé.
          window.dispatchEvent(new Event('storage'));

          // Le questionnaire d'inscription est réclamé par la base, pas par un
          // drapeau local : c'est le serveur qui sait si le coach a de quoi nous
          // connaître. Un appareil neuf, un vidage de cache ou une session posée
          // par un autre chemin ne doivent ni le reposer, ni le sauter.
          if (user.has_ai_profile === false) {
            // Avant de reposer les questions, on vérifie qu'on ne les a pas déjà.
            // L'enregistrement du questionnaire pouvait échouer sans bruit — un jeton
            // expiré suffisait — et comme le serveur décide d'après la table des
            // profils, la personne se voyait redemander à chaque connexion ce qu'elle
            // avait déjà répondu. Les réponses sont conservées et renvoyées ici.
            const rattrape = await renvoyerProfilEnAttente();
            if (rattrape) {
              localStorage.setItem('hasCompletedOnboarding', 'true');
            } else {
              localStorage.removeItem('hasCompletedOnboarding');
              setCurrentView((vue) => (vue === 'auth' ? vue : 'onboarding'));
            }
          } else if (user.has_ai_profile === true) {
            localStorage.setItem('hasCompletedOnboarding', 'true');
          }

          // Le solde qui autorise l'IA vit en base, et un compte neuf l'ouvre à 50.
          // Le compteur affiché, lui, part de zéro côté navigateur : on annonçait
          // donc « 0 coin » à quelqu'un qui en avait cinquante, sur le même écran
          // qui lui conseille d'aller en gagner.
          //
          // On ne recopie le solde du serveur que si le compteur local est à zéro :
          // dans ce cas il n'y a rien à écraser, et rien à réalimenter par accident
          // (la Boutique, elle, ne dépense que le compteur local).
          if (getSecurePoints() === 0) {
            try {
              const { coins } = await api.get('/ai-coaching/quota');
              if (typeof coins === 'number' && coins > 0) setSecurePoints(coins);
            } catch (e) {
              console.warn('Solde initial non récupéré', e);
            }
          }

          if (urlParams.get('success') === 'true') {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('triggerShockwave', { 
                detail: { x: window.innerWidth / 2, y: window.innerHeight / 2, color: '#3b82f6' } 
              }));
            }, 500); // Small delay to let the app render
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
    // Plus de mur de paiement dès la fin de l'inscription : on laisse la personne
    // se servir de l'app. L'offre arrive quand elle a épuisé ses messages IA,
    // c'est-à-dire quand elle sait ce qu'elle achèterait.
  };

  const handleSubscribe = () => {
    localStorage.setItem('mindset_is_subscribed', 'true');
    setIsSubscribed(true);
    setShowPricingModal(false);
  };

  const tryOpenChat = () => setCurrentView('chat');

  // Le serveur est seul juge du quota (402) ; il nous prévient par cet événement.
  // « openPricing » est l'autre entrée : le bouton permanent du menu, et celui que le
  // chat propose quand il manque des coins. Les deux ouvrent le même écran.
  useEffect(() => {
    const ouvrirOffre = () => setShowPricingModal(true);
    window.addEventListener('aiQuotaExceeded', ouvrirOffre);
    window.addEventListener('openPricing', ouvrirOffre);
    return () => {
      window.removeEventListener('aiQuotaExceeded', ouvrirOffre);
      window.removeEventListener('openPricing', ouvrirOffre);
    };
  }, []);

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

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('admin') === 'true') {
    return (
      <React.Suspense fallback={<SkeletonGlow />}>
        <AdminDashboard />
      </React.Suspense>
    );
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
    
    // Objectifs et Habitudes ne coûtent rien à servir et sont ce qui crée
    // l'habitude quotidienne : ils restent ouverts. Seule l'IA est facturée,
    // et c'est le serveur qui le fait respecter.
    setCurrentView(v as any);
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
        <AiNotification onNavigate={handleSetView} />
        <AiExplanationModal />
        
        <div key={currentView} className={`view-transition-wrapper slide-${slideDirection}`}>
          {isInitializing && currentView !== 'welcome' && currentView !== 'auth' && currentView !== 'onboarding' ? (
            <div style={{ padding: '20px' }}>
              <SkeletonGlow rows={4} />
            </div>
          ) : (
            <React.Suspense fallback={<div style={{ padding: '20px' }}><SkeletonGlow rows={4} /></div>}>
              {currentView === 'dashboard' && <Dashboard onOpenChat={tryOpenChat} />}
              {currentView === 'chat' && <AIChat />}
              {currentView === 'objectives' && <Objectives onOpenChat={tryOpenChat} />}
              {currentView === 'habits' && <Habits onOpenChat={tryOpenChat} />}
              {currentView === 'profile' && <Profile onNameChange={() => window.location.reload()} />}
              {currentView === 'shop' && <Shop />}
              {currentView === 'inventory' && <Inventory />}
            </React.Suspense>
          )}
        </div>
        
        {showPricingModal && (
          <PricingScreen
            onSubscribe={handleSubscribe}
            onClose={() => setShowPricingModal(false)}
            planInitial={planInitial}
          />
        )}
        <LevelUpOverlay />
        <RankUpOverlay />
        <ShockwaveOverlay />
        <PwaInstallPrompt />
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
