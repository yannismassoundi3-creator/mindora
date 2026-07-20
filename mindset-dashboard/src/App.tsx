import React, { useState, useEffect } from 'react';
import { api } from './services/api';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Onboarding } from './components/Onboarding';
import { AIChat } from './components/AIChat';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthScreen } from './components/AuthScreen';
import { Objectives } from './pages/Objectives';
import { Habits } from './pages/Habits';
import { Profile } from './pages/Profile';
import { PricingScreen } from './pages/PricingScreen';
import './styles/global.css';

function App() {
  const hasCompletedOnboarding = localStorage.getItem('hasCompletedOnboarding') === 'true';
  const hasToken = !!localStorage.getItem('mindset_token');
  
  const [currentView, setCurrentView] = useState<'auth' | 'onboarding' | 'welcome' | 'dashboard' | 'chat' | 'objectives' | 'habits' | 'profile'>('welcome');

  const [isSubscribed, setIsSubscribed] = useState(() => localStorage.getItem('mindset_is_subscribed') === 'true');
  const [showPricingModal, setShowPricingModal] = useState(false);

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
        }
      } catch (e) {
        console.error('Failed to initialize app', e);
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
  };

  const handleSubscribe = () => {
    localStorage.setItem('mindset_is_subscribed', 'true');
    setIsSubscribed(true);
    setShowPricingModal(false);
  };

  const tryOpenChat = () => {
    if (isSubscribed) {
      setCurrentView('chat');
    } else {
      setShowPricingModal(true);
    }
  };

  if (currentView === 'welcome') {
    return <WelcomeScreen onComplete={() => setCurrentView(!hasToken ? 'auth' : (hasCompletedOnboarding ? 'dashboard' : 'onboarding'))} />;
  }

  if (currentView === 'auth') {
    return <AuthScreen onComplete={() => setCurrentView(hasCompletedOnboarding ? 'dashboard' : 'onboarding')} />;
  }

  if (currentView === 'onboarding') {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }



  return (
    <Layout 
      activeView={currentView} 
      setView={(v) => {
        if ((v === 'chat' || v === 'objectives' || v === 'habits') && !isSubscribed) {
          setShowPricingModal(true);
        } else {
          setCurrentView(v as any);
        }
      }}
    >
      {currentView === 'dashboard' && <Dashboard onOpenChat={tryOpenChat} />}
      {currentView === 'chat' && <AIChat />}
      {currentView === 'objectives' && <Objectives onOpenChat={tryOpenChat} />}
      {currentView === 'habits' && <Habits onOpenChat={tryOpenChat} />}
      {currentView === 'profile' && <Profile onNameChange={() => window.location.reload()} />}
      
      {showPricingModal && (
        <PricingScreen 
          onSubscribe={handleSubscribe} 
          onClose={() => setShowPricingModal(false)} 
        />
      )}
    </Layout>
  );
}

export default App;
