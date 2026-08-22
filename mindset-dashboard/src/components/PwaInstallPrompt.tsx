import React, { useState, useEffect, useRef } from 'react';
import './PwaInstallPrompt.css';
import { estIOS, estIPad, estInstallee, estNavigateurIntegre, lienSortieAndroid, navigateurIOS } from '../utils/plateforme';
import { EVENEMENT_PLAN, aUnPlan } from '../utils/premierPlan';

/** Un « pas maintenant » se redemande, mais pas au prochain écran. */
const CLE_REPORT = 'mindset_install_reporte_le';
const DELAI_REPORT_MS = 7 * 24 * 3600 * 1000;

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
  /*
    La même invite que `deferredPrompt`, mais lisible depuis les écouteurs.

    Ceux-ci sont posés une fois, au montage : leur fermeture garde donc la valeur du
    premier rendu, où l'invite est toujours nulle. Sans cette référence, la carte
    s'afficherait sur Android sans que son bouton ait de quoi installer quoi que ce
    soit — un bouton qui ne fait rien, ce qui est pire que pas de carte.
  */
  const invite = useRef<any>(null);
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

    // Un refus récent se respecte. Sans cette borne, la carte revenait à chaque
    // chargement de page : on ne demande pas, on harcèle.
    const reporte = Number(localStorage.getItem(CLE_REPORT) || 0);
    if (reporte > 0 && Date.now() - reporte < DELAI_REPORT_MS) return;

    /*
      On propose quand la personne a un plan, jamais avant.

      La carte partait sur une minuterie de trois secondes après l'arrivée : elle
      couvrait donc le tout premier écran d'un compte encore vide, et demandait
      d'installer une application dont on n'avait rien vu. Sur iPhone c'est
      pourtant la demande qui compte le plus — iOS ne délivre aucune notification
      web hors application posée sur l'écran d'accueil — et une demande faite trop
      tôt ne se rejoue pas : elle se refuse une fois, pour de bon.

      Deux déclencheurs, et il faut les deux : l'événement pour l'instant précis où
      le plan tombe, la lecture du stockage pour toutes les visites suivantes de
      quelqu'un qui n'a pas encore installé.
    */
    const proposer = () => {
      if (!aUnPlan()) return;
      // Sur Android, rien à proposer tant que le navigateur n'a pas remis son
      // invite : le bouton n'aurait rien à déclencher.
      if (!surIOS && !invite.current) return;
      setShowPrompt(true);
    };

    const handleBeforeInstallPrompt = (e: any) => {
      // On garde la main sur le moment. L'invite spontanée de Chrome arrive quand
      // il l'a décidé, c'est-à-dire n'importe quand.
      e.preventDefault();
      invite.current = e;
      setDeferredPrompt(e);
      proposer();
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener(EVENEMENT_PLAN, proposer);
    proposer();

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener(EVENEMENT_PLAN, proposer);
    };
  }, []);

  /** Fermer, c'est « pas maintenant » — et on s'en souvient une semaine. */
  const reporter = () => {
    localStorage.setItem(CLE_REPORT, String(Date.now()));
    setShowPrompt(false);
  };

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
        <button className="close-prompt-btn" onClick={reporter} aria-label="Pas maintenant">×</button>
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
