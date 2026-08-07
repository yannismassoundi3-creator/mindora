import React, { useState, useEffect } from 'react';
import './PwaInstallPrompt.css';

export const PwaInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed / standalone
    const isAppStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(!!isAppStandalone);

    if (isAppStandalone) return;

    // Check if iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    // If iOS and not standalone, show prompt after a short delay
    if (isIOSDevice) {
      setTimeout(() => setShowPrompt(true), 3000);
    }

    // Android / Chrome
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault(); // Prevent automatic prompt
      setDeferredPrompt(e);
      setShowPrompt(true); // Show our custom prompt
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    }
  };

  if (!showPrompt || isStandalone) return null;

  return (
    <div className="pwa-install-overlay fade-in">
      <div className="pwa-install-card">
        <button className="close-prompt-btn" onClick={() => setShowPrompt(false)}>×</button>
        <div className="pwa-app-icon">
          <img src="/pwa-192x192.png" alt="Mindset App" />
        </div>
        <h3>Installer l'Application</h3>
        
        {!isIOS ? (
          <>
            <p>Installe l'application sur ton téléphone pour une expérience plus rapide, un accès direct depuis ton écran d'accueil, et le mode hors-ligne !</p>
            <button className="install-btn" onClick={handleInstallClick}>Installer maintenant</button>
          </>
        ) : (
          <>
            <p>Pour installer l'application sur ton iPhone et avoir l'icône sur ton écran d'accueil :</p>
            <ol className="ios-instructions">
              <li>Appuie sur le bouton <strong>Partager</strong> <span className="share-icon">📤</span> en bas.</li>
              <li>Fais défiler et sélectionne <strong>Sur l'écran d'accueil</strong> <span className="add-icon">➕</span>.</li>
              <li>Appuie sur <strong>Ajouter</strong>.</li>
            </ol>
            <button className="install-btn outline" onClick={() => setShowPrompt(false)}>J'ai compris</button>
          </>
        )}
      </div>
    </div>
  );
};
