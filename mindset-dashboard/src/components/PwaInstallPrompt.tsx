import React, { useState, useEffect } from 'react';
import './PwaInstallPrompt.css';
import { estIOS, estIPad, estInstallee, estNavigateurIntegre, lienSortieAndroid, navigateurIOS } from '../utils/plateforme';

/*
  Faire installer l'application.

  Ce que ce composant ne peut pas faire, et ne pourra pas : déclencher
  l'installation sur iPhone. Apple n'implémente pas `beforeinstallprompt` et
  n'expose aucune API équivalente ; « Sur l'écran d'accueil » n'est atteignable que
  par le menu système, que rien dans la page ne peut ouvrir. `navigator.share()`
  ouvre bien une feuille de partage, mais pas celle-là — elle ne contient pas
  l'action d'installation. Il n'y a donc pas de bouton possible, seulement une
  consigne, et tout l'enjeu est qu'elle soit juste.

  D'où les deux distinctions faites ici, l'une et l'autre payées par des gens qui
  concluent que l'application est cassée :
  - le navigateur intégré d'Instagram ou TikTok **ne peut pas installer du tout** ;
  - Safari met Partager en bas, Chrome et Firefox le rangent en haut.
*/
export const PwaInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dansAppli, setDansAppli] = useState(false);
  const [navigateur, setNavigateur] = useState<ReturnType<typeof navigateurIOS>>('safari');
  const [sortieAndroid, setSortieAndroid] = useState<string | null>(null);

  useEffect(() => {
    const installee = estInstallee();
    setIsStandalone(installee);
    if (installee) return;

    const surIOS = estIOS();
    setIsIOS(surIOS);
    setDansAppli(estNavigateurIntegre());
    setNavigateur(navigateurIOS());
    setSortieAndroid(lienSortieAndroid());

    // Sur iOS aucun événement n'annonce la possibilité d'installer : c'est à nous
    // de proposer. Le délai laisse la personne voir l'app avant qu'on lui demande
    // quelque chose.
    if (surIOS) {
      const t = setTimeout(() => setShowPrompt(true), 3000);
      return () => clearTimeout(t);
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

  /*
    Où se trouve le bouton Partager, sur ce navigateur-ci.

    Dire « en bas » à quelqu'un sous Chrome l'envoie chercher au mauvais endroit,
    et une consigne fausse ne se lit pas comme une erreur de notre part : elle se
    lit comme une application qui ne marche pas.
  */
  const ouEstPartager =
    navigateur === 'safari'
      ? 'en bas de l’écran'
      : 'en haut, dans la barre d’adresse';

  // Un iPad se déclare comme un Mac : on ne peut pas le nommer d'après le
  // user-agent, seulement d'après la taille. Dire « iPhone » à quelqu'un sur iPad
  // est le genre de détail qui fait douter du reste.
  const appareil = estIPad() ? 'iPad' : 'iPhone';

  return (
    <div className="pwa-install-overlay fade-in">
      <div className="pwa-install-card">
        <button className="close-prompt-btn" onClick={() => setShowPrompt(false)}>×</button>
        <div className="pwa-app-icon">
          {/* /pwa-192x192.png n'a jamais existé dans public/ : la carte censée
              convaincre d'installer l'application affichait une image cassée. */}
          <img src="/icon-192.png" alt="Disciplix" />
        </div>
        <h3>Installer l'Application</h3>

        {dansAppli ? (
          /*
            Le cas le plus fréquent depuis une publicité : on arrive dans le
            navigateur d'Instagram ou de TikTok, qui n'a ni menu d'installation ni
            « Sur l'écran d'accueil ». Lui montrer les trois étapes reviendrait à
            décrire des boutons qu'il n'a pas.
          */
          <>
            <p>
              Tu es dans le navigateur de l'application où tu as cliqué. Il ne sait pas installer
              Disciplix — il faut d'abord ouvrir le site dans ton vrai navigateur.
            </p>
            {sortieAndroid ? (
              /*
                Sur Android, un seul geste suffit : le système comprend `intent://`
                même depuis ce webview. C'est la différence avec iOS, où aucune
                sortie n'est programmable et où il ne reste qu'à décrire le menu.
              */
              <a className="install-btn" href={sortieAndroid}>
                Ouvrir dans Chrome
              </a>
            ) : (
              <ol className="ios-instructions">
                <li>Touche le menu <strong>···</strong> en haut à droite.</li>
                <li>
                  Choisis <strong>Ouvrir dans {isIOS ? 'Safari' : 'Chrome'}</strong>.
                </li>
                <li>Reviens ici : la marche à suivre s'affichera.</li>
              </ol>
            )}
            <button className="install-btn outline" onClick={() => setShowPrompt(false)}>J'ai compris</button>
          </>
        ) : !isIOS ? (
          <>
            <p>Installe l'application sur ton téléphone pour une expérience plus rapide, un accès direct depuis ton écran d'accueil, et le mode hors-ligne !</p>
            <button className="install-btn" onClick={handleInstallClick}>Installer maintenant</button>
          </>
        ) : (
          <>
            <p>
              Pour avoir l'icône sur ton écran d'accueil — et recevoir les rappels de ton coach,
              qui n'arrivent sur {appareil} que depuis l'app installée :
            </p>
            <ol className="ios-instructions">
              <li>
                Appuie sur le bouton <strong>Partager</strong> <span className="share-icon">📤</span> {ouEstPartager}.
              </li>
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
