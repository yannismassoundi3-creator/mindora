import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { AI_COSMETICS } from '../utils/cosmetics';
import {
  EVENEMENT_NOTIFICATION,
  lireNotifications,
  retirerNotification,
  type NotificationApp,
} from '../utils/notifications';
import './AiNotification.css';

interface AiNotificationProps {
  onNavigate?: (view: string) => void;
}

/** Le temps qu'une bannière reste à l'écran quand personne ne la touche. */
const DUREE_MS = 5500;

/** Durée de la sortie. Doit rester alignée sur l'animation `banniere-remonte`. */
const SORTIE_MS = 280;

/** Au-delà, le doigt écarte la bannière ; en deçà, il faisait défiler la page. */
const SEUIL_BALAYAGE = 40;

/**
 * La bannière du coach, en haut de l'écran.
 *
 * Elle descend, elle se lit, elle repart — et elle emmène quelque part si on
 * l'appuie. Trois choses la tiennent, et chacune répare un défaut constaté :
 *
 * 1. **Elle occupe le créneau de l'en-tête**, à la même hauteur et à la même
 *    largeur, au lieu de flotter seize pixels plus haut. Sur téléphone, elle se
 *    posait sur l'en-tête sans le couvrir tout à fait : deux barres arrondies
 *    décalées, dont l'une passait sous la barre d'état de l'iPhone faute de tenir
 *    compte de la zone sûre. Alignée, elle remplace l'en-tête le temps de se
 *    montrer, et c'est lisible comme un choix.
 * 2. **Elle est opaque.** Le flou d'arrière-plan se recompose à chaque image de
 *    défilement et décroche sur iPhone — le même piège que sur les barres collantes
 *    de l'application. Une bannière qui tressaute pendant qu'on fait défiler, c'est
 *    exactement le « ça bugue » qu'on nous a rapporté.
 * 3. **Elle s'écarte au doigt.** Vers le haut, comme sur iOS. Le geste manquait, et
 *    la seule échappatoire était d'attendre ou de se laisser emmener ailleurs.
 */
export function AiNotification({ onNavigate }: AiNotificationProps) {
  const [notifications, setNotifications] = useState<NotificationApp[]>(() => lireNotifications());
  const [equippedSkinId, setEquippedSkinId] = useState<string | null>(() => localStorage.getItem('mindset_ai_skin_id'));
  const [sortie, setSortie] = useState(false);
  /** Décalage vertical du doigt, en pixels. Négatif : vers le haut. */
  const [glissement, setGlissement] = useState(0);

  const equippedCosmetic = AI_COSMETICS.find((c) => c.id === equippedSkinId);
  const notifAffichee = notifications[0];

  const recharger = useCallback(() => setNotifications(lireNotifications()), []);

  useEffect(() => {
    const surSkin = () => setEquippedSkinId(localStorage.getItem('mindset_ai_skin_id'));
    /*
      Deux écouteurs, deux rôles distincts.

      `mindset:notification` est notre événement : il ne réveille que ce composant.
      `storage`, lui, n'est conservé que pour les **autres onglets** — le natif ne
      se déclenche jamais dans celui qui écrit. C'est aussi lui qui porte le
      changement de cosmétique.
    */
    window.addEventListener(EVENEMENT_NOTIFICATION, recharger);
    window.addEventListener('storage', recharger);
    window.addEventListener('storage', surSkin);
    return () => {
      window.removeEventListener(EVENEMENT_NOTIFICATION, recharger);
      window.removeEventListener('storage', recharger);
      window.removeEventListener('storage', surSkin);
    };
  }, [recharger]);

  /**
   * Écarte la bannière affichée, et emmène si on le lui demande.
   *
   * L'effacement attend la fin de l'animation de sortie : le retirer tout de suite
   * ferait disparaître la bannière d'un coup, et la suivante prendrait sa place sans
   * transition.
   */
  const ecarter = useCallback(
    (notif: NotificationApp, naviguer: boolean) => {
      setSortie(true);
      setGlissement(0);

      /*
        `info` n'emmène nulle part, et c'est volontaire.

        Ce sont les félicitations du coach quand une habitude franchit un cap : la
        personne est déjà sur l'écran concerné, elle vient d'y appuyer. L'y renvoyer
        serait un aller-retour pour rien — et si elle appuie sur la bannière, c'est
        pour l'écarter.
      */
      if (naviguer && onNavigate && notif.type !== 'info') {
        let destination = 'dashboard';
        if (notif.type === 'habit') destination = 'habits';
        if (notif.type === 'objective') destination = 'objectives';
        // Le mot d'accueil mène à la conversation : c'est là qu'on peut lui répondre.
        if (notif.type === 'coach') {
          destination = 'chat';

          /*
            La conversation démarre toute seule quand la bannière porte une invite.

            Sans elle, appuyer sur « tu lâches le samedi, trois fois de suite »
            ouvrait un chat vide : on venait de lire une remarque précise, et il
            fallait la reformuler soi-même pour en parler. Peu de gens le font —
            et l'observation la plus juste ne sert alors à rien.

            La clé est celle que l'inscription utilise déjà pour le premier plan ;
            `AIChat` la consomme à son montage et envoie le message. Rien de neuf
            n'est introduit ici, on se raccroche au chemin existant.
          */
          if (notif.invite) {
            localStorage.setItem('mindset_pending_chat_msg', notif.invite);
          }
        }

        /*
          Le tableau de bord garde en mémoire l'onglet ouvert la dernière fois.

          Seule l'alimentation le choisissait ; les routines s'en remettaient à ce
          qui traînait. Après avoir suivi une notification d'alimentation, celle des
          routines ramenait donc au tableau de bord… toujours sur l'alimentation. Un
          raccourci qui n'emmène pas où son texte l'annonce vaut moins que pas de
          raccourci du tout : chaque destination nomme désormais son onglet.
        */
        if (notif.type === 'routine' || notif.type === 'nutrition') {
          destination = 'dashboard';
          localStorage.setItem('mindset_dashboard_tab', notif.type === 'nutrition' ? 'nutrition' : 'routines');
          window.dispatchEvent(new Event('storage'));
        }

        // L'explication détaillée du plan n'existe que pour les plans. Le mot
        // d'accueil n'en a pas, et poser le drapeau ferait chercher dans le vide.
        //
        // L'événement qui suit n'est pas décoratif : `AiExplanationModal` ne voyait
        // ce drapeau qu'à son sondage d'une seconde, sauf pour les routines et
        // l'alimentation qui, elles, en émettaient un. L'explication arrivait donc
        // une seconde après l'écran pour les habitudes et les objectifs — assez pour
        // qu'on ait commencé à lire, et que la modale coupe la lecture.
        if (notif.type !== 'coach') {
          localStorage.setItem('mindset_trigger_explanation', notif.type);
          window.dispatchEvent(new Event('storage'));
        }

        onNavigate(destination);
      }

      setTimeout(() => {
        setSortie(false);
        retirerNotification(notif.id);
      }, SORTIE_MS);
    },
    [onNavigate],
  );

  /*
    Le compte à rebours suit la bannière affichée, pas le tableau.

    La liste est reconstruite à chaque événement, et l'application en émet à tout
    bout de champ — une routine cochée, une remontée au serveur. Dépendre du tableau
    relançait le délai à chaque fois : la bannière restait collée à l'écran tant que
    la personne se servait de l'app, c'est-à-dire précisément quand elle gêne.

    Le doigt posé dessus suspend le compte : personne ne doit voir disparaître ce
    qu'il est en train de lire ou de saisir.
  */
  const doigtPose = glissement !== 0;
  useEffect(() => {
    if (!notifAffichee || doigtPose) return;
    setSortie(false);
    const minuteur = setTimeout(() => {
      // Une disparition au bout de quelques secondes ne doit surtout pas emmener la
      // personne ailleurs : elle n'a rien demandé.
      ecarter(notifAffichee, false);
    }, DUREE_MS);
    return () => clearTimeout(minuteur);
  }, [notifAffichee?.id, doigtPose, ecarter]);

  /*
    Le balayage.

    `onPointerDown` seul partait au premier contact du doigt, avant de savoir si le
    geste était un appui ou le début d'un défilement — et la bannière occupant le
    haut de l'écran, faire défiler la page en la touchant suffisait à se retrouver
    projeté ailleurs. On mesure donc le déplacement, et c'est lui qui tranche :
    au-delà du seuil vers le haut, on écarte ; sinon `onClick` fait son travail
    normal, clavier compris.
  */
  const depart = useRef<number | null>(null);
  const aGlisse = useRef(false);
  /*
    Le déplacement vit dans une référence **en plus** de l'état.

    L'état sert à dessiner ; il ne peut pas servir à décider. React ne le met à jour
    qu'au rendu suivant, si bien qu'un doigt rapide — dernier mouvement et
    relâchement dans la même image — faisait lire au relâchement une valeur encore à
    zéro : le balayage était purement et simplement ignoré, d'autant plus souvent
    que le geste était franc. La référence, elle, est juste à l'instant même.
  */
  const deplacement = useRef(0);
  /** La bannière affichée, lisible depuis un écouteur posé une seule fois. */
  const notifRef = useRef<NotificationApp | undefined>(notifAffichee);
  notifRef.current = notifAffichee;

  /*
    Le geste se suit sur `window`, et non sur la bannière.

    C'est la seule façon d'être sûr d'apprendre qu'il est fini. La bannière fait
    soixante pixels de haut : un doigt qui la tire vers le haut en sort forcément
    avant de se lever. Tant que le relâchement était écouté sur l'élément, il partait
    alors ailleurs, la fin du geste n'était jamais vue — et la bannière restait
    décalée **avec son compte à rebours suspendu**. Plus rien ne la faisait
    disparaître, ni le temps, ni le doigt. Vérifié : elle tenait indéfiniment.

    `setPointerCapture` aurait suffi dans un navigateur ordinaire, mais il repose sur
    une seule mécanique, et le prix de son échec est une bannière collée à l'écran
    pour le reste de la session.
  */
  const terminerGeste = useCallback(() => {
    if (depart.current === null) return;
    const delta = deplacement.current;
    depart.current = null;
    deplacement.current = 0;
    window.removeEventListener('pointermove', suivreGeste);
    window.removeEventListener('pointerup', terminerGeste);
    window.removeEventListener('pointercancel', terminerGeste);

    const notif = notifRef.current;
    if (delta < -SEUIL_BALAYAGE && notif) {
      ecarter(notif, false);
      return;
    }
    setGlissement(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecarter]);

  const suivreGeste = useCallback((e: PointerEvent) => {
    if (depart.current === null) return;
    const delta = e.clientY - depart.current;
    if (Math.abs(delta) > 6) aGlisse.current = true;
    // Vers le bas, la bannière résiste : il n'y a rien à révéler dessous, et un
    // élément qu'on peut tirer sans effet donne l'impression d'un ratage.
    deplacement.current = delta < 0 ? delta : delta * 0.15;
    setGlissement(deplacement.current);
  }, []);

  const surPointerDown = (e: React.PointerEvent) => {
    depart.current = e.clientY;
    aGlisse.current = false;
    deplacement.current = 0;
    window.addEventListener('pointermove', suivreGeste);
    window.addEventListener('pointerup', terminerGeste);
    window.addEventListener('pointercancel', terminerGeste);
  };

  // Un démontage pendant le geste — la bannière écartée par ailleurs, l'écran qui
  // change — laisserait trois écouteurs sur `window` et un état figé.
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', suivreGeste);
      window.removeEventListener('pointerup', terminerGeste);
      window.removeEventListener('pointercancel', terminerGeste);
    },
    [suivreGeste, terminerGeste],
  );

  if (!notifAffichee) return null;

  const titre = notifAffichee.titre;

  /*
    Deux éléments plutôt qu'un, et ce n'est pas de la décoration.

    L'entrée, la sortie et le suivi du doigt écrivent tous les trois la même
    propriété `transform`. Or une animation CSS l'emporte sur un style en ligne :
    la bannière serait restée sourde au doigt, et le relâchement aurait rejoué son
    arrivée. Le cadre porte donc le mouvement d'entrée et de sortie, la carte porte
    le déplacement du doigt, et plus rien ne se dispute la même propriété.
  */
  return (
    <div className={`ai-notification-slot${sortie ? ' hiding' : ''}`}>
    <div
      className={`ai-notification-banner${glissement ? ' banniere-tiree' : ''}`}
      role="button"
      tabIndex={0}
      style={glissement ? { transform: `translateY(${glissement}px)` } : undefined}
      onPointerDown={surPointerDown}
      onClick={() => {
        if (aGlisse.current) return;
        ecarter(notifAffichee, true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') ecarter(notifAffichee, true);
        if (e.key === 'Escape') ecarter(notifAffichee, false);
      }}
    >
      <div className="ai-notification-icon-container">
        {equippedCosmetic?.type === 'icon' ? (
          <div className="ai-notification-icon status-icon-skin-large">{equippedCosmetic.value}</div>
        ) : (
          <div
            className="ai-notification-icon liquid-glass-orb"
            style={equippedCosmetic?.type === 'color' ? { background: equippedCosmetic.value } : undefined}
          >
            {!equippedCosmetic && <Sparkles size={15} />}
          </div>
        )}
      </div>

      <div className="ai-notification-content">
        {titre && <p className="ai-notification-titre">{titre}</p>}
        <p className="ai-notification-texte">{notifAffichee.message}</p>
      </div>

      {/*
        Écarter sans être emmené ailleurs doit rester à portée de pouce, même pour
        qui ne connaît pas le balayage. L'arrêt de la propagation est indispensable :
        sans lui, le clic serait aussi celui de la bannière.
      */}
      <button
        type="button"
        className="ai-notification-close"
        aria-label="Fermer la notification"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          ecarter(notifAffichee, false);
        }}
      >
        <X size={15} />
      </button>

      {/* Le temps qui reste, sans chiffre ni cercle : un trait qui se vide. Il rend
          la disparition prévisible au lieu de brutale. */}
      {!doigtPose && !sortie && (
        <span
          key={notifAffichee.id}
          className="ai-notification-jauge"
          style={{ animationDuration: `${DUREE_MS}ms` }}
          aria-hidden="true"
        />
      )}
    </div>
    </div>
  );
}
