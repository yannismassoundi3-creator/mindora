import React, { useState, useEffect, useRef } from 'react';
import { api, renvoyerProfilEnAttente, estInstallee } from './services/api';
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
import { GainFlottant } from './components/GainFlottant';
import { AiNotification } from './components/AiNotification';
import { AiExplanationModal } from './components/AiExplanationModal';
import { EtatSauvegarde } from './components/EtatSauvegarde';
import { purgerScoresAnciens } from './utils/etatLocal';
import { ajouterNotification, notificationEnAttente } from './utils/notifications';
import { motDuCoachDuMoment } from './utils/motDuCoach';
import { observationPourBanniere } from './utils/observation';
import { getSecurePoints, setSecurePoints } from './utils/secureStorage';
import { suivreLesVenues } from './utils/venue';
import { reconcilierPaiement, controlerAbonnement, activerPro, retenirFormule, type Formule } from './utils/paiement';
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

/*
  Une première ouverture n'est pas un changement de version.

  Ce bloc purge les caches puis recharge la page. La condition `!== APP_VERSION`
  était vraie pour une version périmée — ce qu'on visait — **mais aussi pour une
  version absente**, c'est-à-dire pour un stockage vierge. Or une application
  installée sur l'écran d'accueil d'un iPhone reçoit son propre stockage, vide même
  si l'on vient de s'inscrire dans Safari : le premier lancement depuis l'icône
  tombait donc systématiquement ici.

  Et ce qu'il y trouvait est le pire enchaînement possible pour une application qui
  démarre : elle **efface le cache du service worker par lequel elle vient d'être
  servie**, puis se recharge cent millisecondes plus tard — sur un réseau de
  téléphone, sans plus rien en réserve. Écran noir au lancement, pour tout le monde,
  à chaque installation. C'est ce que Yannis nous a rapporté de son ami.

  Un stockage vide n'a par définition rien de périmé à jeter. On enregistre la
  version et on laisse démarrer. La purge reste entière pour ce à quoi elle sert :
  passer d'une version connue à une autre.
*/
if (currentVersion === null) {
  localStorage.setItem('mindset_app_version', APP_VERSION);
} else if (currentVersion !== APP_VERSION) {
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
    onRegistered(r: ServiceWorkerRegistration | undefined) {
      console.log('SW Registered: ' + r);
    },
    onRegisterError(error: unknown) {
      console.log('SW registration error', error);
    },
  });

  const hasToken = !!localStorage.getItem('mindset_token');
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

  /*
    Combien de fois l'application est ouverte.

    C'est la seule mesure d'usage qui ne dépende pas d'une action : jusqu'ici,
    quelqu'un qui ouvrait l'app, regardait sa journée et refermait ne laissait
    aucune trace — il était compté exactement comme quelqu'un qui n'était jamais
    venu. L'écart entre « ouvre » et « fait quelque chose » est précisément ce
    qu'on ne pouvait pas voir.

    Monté ici et pas dans le Layout : la page d'administration se substitue à
    toute l'application et ne monte aucun Layout, et une session ouverte reste
    une session ouverte.
  */
  useEffect(() => {
    if (!hasToken) return;
    return suivreLesVenues();
  }, [hasToken]);

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
   *
   * Cette lecture se faisait dans le corps du composant, donc **à chaque rendu**,
   * alors que le paramètre, lui, restait dans la barre d'adresse. L'intention était
   * donc réécrite juste après avoir été honorée, et l'écran de tarifs se rouvrait à
   * chaque retour sur le dashboard, indéfiniment. On la relève une fois au montage
   * et on retire le paramètre de l'adresse, comme on le fait déjà pour « success ».
   */
  useEffect(() => {
    const voulu = new URLSearchParams(window.location.search).get('plan');
    if (!voulu || !['monthly', 'lifetime'].includes(voulu)) return;
    localStorage.setItem('mindset_plan_voulu', voulu);
    const url = new URL(window.location.href);
    url.searchParams.delete('plan');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }, []);

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
          /*
            Les scores trop anciens partent avant la première synchro de la session.

            `mindset_daily_scores` gagnait une entrée par jour sans jamais rien
            perdre : c'est cette croissance qui finissait par franchir le plafond de
            64 Ko au-delà duquel la sauvegarde de fermeture d'onglet échoue. Purger
            ici, avant la descente, évite de renvoyer au serveur des années de
            scores que plus aucun écran n'affiche.
          */
          const purges = purgerScoresAnciens();
          if (purges > 0) console.log(`[synchro] ${purges} score(s) trop ancien(s) oublié(s)`);

          // Download the latest data from the Cloud DB to localStorage
          await api.downloadCloudState();

          await reconcilierPaiement();
          // Et dans l'autre sens : un abonné a pu résilier, ou sa carte expirer. Sans
          // ce contrôle, seul le webhook pourrait nous l'apprendre — et il s'est déjà
          // tu une fois, sans que rien ne le signale.
          await controlerAbonnement();

          const user = await api.get('/auth/me');
          /*
            Le rôle, retenu pour que le menu puisse proposer le panneau
            d'administration. Il n'ouvre aucun droit : les routes `/admin/*` sont
            gardées côté serveur par `@Roles('ADMIN')`. Quelqu'un qui écrirait
            « ADMIN » ici s'afficherait une entrée de menu menant à une page qui
            lui refuse toute donnée.
          */
          localStorage.setItem('mindset_role', user.role === 'ADMIN' ? 'ADMIN' : 'USER');

          /*
            La date d'inscription vient du serveur, qui est le seul à la connaître.

            Le Profil affichait « Membre depuis le … » d'après `mindset_join_date`,
            une clé que **seul le Profil écrivait**, avec la date du jour, la
            première fois qu'on ouvrait cet écran. Quelqu'un inscrit en juin qui
            ouvrait son profil en août lisait donc « Membre depuis le 15/08/2026 » —
            et cette date fausse repartait au serveur par la synchro, puis
            redescendait sur ses autres appareils. Sur un écran dont le sujet est
            l'ancienneté et la régularité, c'est la seule ligne qui pouvait mentir.

            Écrit seulement s'il change : la clé est synchronisée, et une écriture
            identique à chaque démarrage programmerait une remontée pour rien.
          */
          if (user.created_at) {
            const inscription = new Date(user.created_at);
            if (!Number.isNaN(inscription.getTime())) {
              const lisible = inscription.toLocaleDateString('fr-FR');
              if (localStorage.getItem('mindset_join_date') !== lisible) {
                localStorage.setItem('mindset_join_date', lisible);
              }
            }
          }

          // TRIALING compte comme abonné : c'est l'essai de 7 jours du forfait mensuel.
          // Le serveur ouvre le coach dans les deux cas (AiQuotaService.PAID_STATUSES) ;
          // ne garder qu'ACTIVE ici afficherait « Passer Pro » à quelqu'un qui vient de
          // souscrire, et lui retirerait le bonus de points des abonnés.
          const subscribed = ['ACTIVE', 'TRIALING'].includes(user.subscription?.status);
          setIsSubscribed(subscribed);
          localStorage.setItem('mindset_is_subscribed', subscribed ? 'true' : 'false');
          // Un achat à vie n'a pas d'abonnement Stripe : c'est ce qui le distingue du
          // mensuel, et donc ce qui décide si on peut encore proposer le passage à vie.
          retenirFormule(subscribed ? user.subscription : null);
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
    // On atterrit dans la conversation et non sur le tableau de bord : le
    // questionnaire vient de poser six questions, la première chose qui doit
    // arriver ensuite est une réponse. Le message d'ouverture a été déposé par
    // `Onboarding` dans `mindset_pending_chat_msg` ; le chat le trouve en se
    // montant et l'envoie. Voir le commentaire qui l'accompagne là-bas.
    setCurrentView('chat');
    // Plus de mur de paiement dès la fin de l'inscription : on laisse la personne
    // se servir de l'app. L'offre arrive quand elle a épuisé ses messages IA,
    // c'est-à-dire quand elle sait ce qu'elle achèterait.
  };

  const handleSubscribe = (formule: Formule = 'monthly') => {
    activerPro(formule);
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

  /*
    Le mot du coach à l'arrivée.

    L'application s'ouvrait sur des chiffres justes et personne pour les lire. Le
    coach, lui, ne parlait que si on allait le chercher — alors que le moment où
    quelqu'un ouvre l'app est précisément celui où une phrase peut changer la suite
    de sa journée.

    Quatre conditions, et chacune évite un travers précis :

    - **Une fois par chargement** (`motDejaDit`). Le tableau de bord est démonté et
      remonté à chaque aller-retour dans le menu ; sans ce verrou, revenir d'un
      écran ferait réapparaître l'accueil.
    - **Pas par-dessus une notification de plan.** Quelqu'un qui vient de faire
      appliquer un plan doit voir ce plan annoncé, pas un bonjour posé devant.
    - **Rien à dire, rien à l'écran.** `motDuCoachDuMoment` rend `null` quand la
      journée ne se prête à aucune observation, ou quand on a déjà parlé récemment.
    - **Un délai avant d'apparaître.** L'arrivée dans l'app est chargée — descente
      de l'état, montée de niveau éventuelle, transition d'écran. Une bannière au
      milieu de tout ça se lit comme du bruit.
  */
  const motDejaDit = useRef(false);
  useEffect(() => {
    if (isInitializing || motDejaDit.current) return;
    if (currentView !== 'dashboard') return;
    motDejaDit.current = true;

    const minuteur = setTimeout(async () => {
      if (notificationEnAttente()) return;

      /*
        L'observation passe avant le mot ordinaire, quand il y en a une.

        Le mot du coach parle de la journée : ce qu'il reste à faire, où en est la
        série. C'est utile, et c'est ce que n'importe quelle application peut
        dire. L'observation, elle, parle de la personne — « sur 4 samedis, 3 sont
        à zéro » — et c'est la seule chose ici qu'un carnet ne sait pas faire.
        Elle est rare (une tous les trois jours au plus, et seulement si le motif
        tient), donc la faire passer devant ne coûte presque jamais le mot
        ordinaire.

        Elle porte une invite : appuyer sur la bannière envoie le message au coach
        et la conversation démarre sur ce constat, au lieu d'ouvrir un chat vide.
      */
      const observation = await observationPourBanniere().catch(() => null);
      if (observation) {
        // Une notification a pu arriver pendant l'appel réseau ; on ne se pose
        // pas par-dessus un plan qui vient d'être appliqué.
        if (notificationEnAttente()) return;
        ajouterNotification('coach', observation.fait, observation.titre, observation.invite);
        return;
      }

      const mot = motDuCoachDuMoment(localStorage.getItem('mindset_user_name') || '');
      if (mot) ajouterNotification('coach', mot.message, mot.titre);
    }, 1800);

    return () => clearTimeout(minuteur);
  }, [isInitializing, currentView]);

  if (currentView === 'welcome') {
    if (!hasToken) {
      /*
        Une application installée ne renvoie jamais vers la page de vente.

        Sans session, on partait vers `landing.html`. Dans un onglet c'est la bonne
        réponse — on ne connaît pas cette personne, on lui présente le produit. Dans
        une application posée sur l'écran d'accueil, c'est absurde deux fois : elle a
        déjà choisi le produit puisqu'elle l'a installé, et sa session ne s'y trouve
        pas parce qu'iOS y range un stockage séparé de celui de Safari — s'inscrire
        puis installer donne donc une application « déconnectée » dès le premier
        lancement.

        Techniquement, c'était aussi une navigation hors de la coquille précachée,
        vers le seul document que le service worker ait ordre de ne pas servir
        (`globIgnores` et `navigateFallbackDenylist`, tous deux volontaires : une
        page de vente ne doit pas se figer). Une application installée quittait donc
        son cache pour aller chercher au réseau une page qu'elle n'a pas — d'où
        l'attente sur fond noir, plutôt qu'une page de vente qui s'affiche.

        On ouvre sur la connexion, qui est ce que cette personne est venue faire.
      */
      if (estInstallee()) {
        return <AuthScreen onComplete={() => {
          const isCompleted = localStorage.getItem('hasCompletedOnboarding') === 'true';
          setCurrentView(isCompleted ? 'dashboard' : 'onboarding');
        }} />;
      }

      window.location.href = '/landing.html';
      // Le temps que la navigation parte, on montre qu'il se passe quelque chose :
      // rendre `null` laissait un écran noir, indiscernable d'une application morte.
      return <SkeletonGlow rows={3} />;
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
          {/* Les trois vues d'entrée — accueil, connexion, questionnaire — sortent
              plus haut par un `return` : à ce point du rendu, `currentView` ne peut
              plus valoir aucune des trois. Les comparaisons étaient donc toujours
              vraies, et TypeScript le disait dès qu'on l'écoutait. */}
          {isInitializing ? (
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
        <GainFlottant />
        <PwaInstallPrompt />
        <EtatSauvegarde />
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
