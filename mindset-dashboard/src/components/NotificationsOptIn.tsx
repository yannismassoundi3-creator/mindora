import React, { useEffect, useRef, useState } from 'react';
import {
  api,
  cheminDeReautorisation,
  diagnostiquerPush,
  estIOS,
  surveillerPermissionPush,
  type EtatPush,
} from '../services/api';
import './NotificationsOptIn.css';

const CLE_REPORT = 'mindset_push_reporte_le';
const CLE_DERNIER_ETAT = 'mindset_push_dernier_etat';
/** Un « plus tard » se redemande. Trois jours : assez pour ne pas harceler. */
const DELAI_REPORT_MS = 3 * 24 * 3600 * 1000;

/** Ce que la carte affiche : l'état de l'appareil, plus deux issues de notre côté. */
type EtatCarte = EtatPush | 'a_demander' | 'echec';

/**
 * Demande les notifications au bon moment, et de la bonne façon.
 *
 * Avant, `Notification.requestPermission()` partait sur une minuterie de deux
 * secondes après l'arrivée sur le dashboard. Trois conséquences : la réponse réflexe
 * à une boîte de dialogue surgie de nulle part est « Bloquer », et un blocage est
 * définitif — le navigateur ne repose plus jamais la question ; Firefox ignore
 * purement et simplement une demande sans geste utilisateur, donc ces utilisateurs
 * n'étaient jamais sollicités ; et sur iPhone hors app installée, le push n'existe
 * pas, si bien que la fonction sortait sur un avertissement console.
 *
 * On demande donc nous-mêmes d'abord, dans notre propre carte. La personne a déjà dit
 * oui une fois quand le navigateur pose sa question, et le clic satisfait Firefox.
 *
 * **Le blocage n'est plus un cul-de-sac.** Il l'était : la carte affichait « le
 * navigateur a tranché », renvoyait vers une barre d'adresse qui n'existe pas dans
 * une application installée, et n'avait aucun moyen de s'apercevoir qu'on venait de
 * la réautoriser. Trois choses ont changé — le bouton repart toujours sur une vraie
 * demande, la marche à suivre décrit l'appareil qu'on a en main
 * (`cheminDeReautorisation`), et la permission est surveillée pendant qu'on est
 * parti la changer.
 */
export const NotificationsOptIn: React.FC = () => {
  const [etat, setEtat] = useState<EtatCarte>(() => diagnostiquerPush());
  /** Marche à suivre du cas « bloquées », repliée par défaut. */
  const [detailOuvert, setDetailOuvert] = useState(false);
  const [occupe, setOccupe] = useState(false);
  /** Affiché quelques secondes après un accord : sinon la carte disparaît sans un mot. */
  const [confirme, setConfirme] = useState(false);
  const [masquee, setMasquee] = useState(() => {
    const reporte = Number(localStorage.getItem(CLE_REPORT) || 0);
    return reporte > 0 && Date.now() - reporte < DELAI_REPORT_MS;
  });

  // On remonte l'état une fois par changement, jamais à chaque affichage : ce qui
  // manquait n'était pas le détail des visites mais le décompte des situations.
  useEffect(() => {
    if (etat === 'a_demander' || etat === 'echec') return;
    if (localStorage.getItem(CLE_DERNIER_ETAT) === etat) return;
    localStorage.setItem(CLE_DERNIER_ETAT, etat);
    api.signalerPermissionPush(etat as EtatPush);
  }, [etat]);

  /*
    Ce qui se passe pendant qu'on est ailleurs.

    Réautoriser se fait dans les réglages du système, donc en quittant l'app. Au
    retour, la carte doit avoir compris toute seule — sans quoi elle redemande de
    faire ce qui vient d'être fait, et c'est là qu'on abandonne. Le
    `diagnostiquerPush()` d'un état déjà accordé enclenche l'effet suivant, qui pose
    l'abonnement sans rien demander de plus.
  */
  useEffect(() => surveillerPermissionPush(() => setEtat(diagnostiquerPush())), []);

  /*
    Permission accordée ne veut pas dire abonné.

    L'abonnement au service de push est une seconde étape, qui a ses propres façons
    d'échouer : clé VAPID injoignable, serveur muet, service de push qui refuse.
    Quand la permission arrive d'ailleurs — des réglages du téléphone, d'un autre
    onglet — personne ne la franchit, et l'appareil reste inconnu du serveur tout en
    ayant l'air en règle. On la franchit ici, une fois.
  */
  const abonnementTente = useRef(false);
  useEffect(() => {
    if (etat !== 'accorde' || abonnementTente.current) return;
    abonnementTente.current = true;
    api
      .subscribeToPushNotifications(false)
      .then((resultat) => {
        if (resultat !== 'accorde') setEtat(resultat === 'a_demander' ? diagnostiquerPush() : resultat);
      })
      .catch(() => setEtat('echec'));
  }, [etat]);

  const activer = async () => {
    setOccupe(true);
    try {
      // Le clic qui déclenche cet appel est ce qui rend la demande recevable par
      // Firefox : la chaîne doit rester synchrone jusqu'à requestPermission().
      const resultat = await api.subscribeToPushNotifications(true);
      abonnementTente.current = resultat === 'accorde';
      setEtat(resultat === 'a_demander' ? diagnostiquerPush() : resultat);

      if (resultat === 'accorde') {
        setConfirme(true);
        setDetailOuvert(false);
      } else if (resultat === 'refuse') {
        // La demande n'a rien affiché : le navigateur avait déjà bloqué l'origine.
        // Dérouler la marche à suivre est le seul geste qui reste, et l'ouvrir
        // nous-mêmes évite d'exiger un second clic pour l'apprendre.
        setDetailOuvert(true);
      }
    } catch (e) {
      console.error('Abonnement aux notifications impossible', e);
      setEtat('echec');
    } finally {
      setOccupe(false);
    }
  };

  // La confirmation s'efface d'elle-même. Elle existe pour que l'accord se voie,
  // pas pour occuper le haut du tableau de bord jusqu'au prochain rechargement.
  useEffect(() => {
    if (!confirme) return;
    const minuteur = setTimeout(() => setConfirme(false), 4000);
    return () => clearTimeout(minuteur);
  }, [confirme]);

  const reporter = () => {
    localStorage.setItem(CLE_REPORT, String(Date.now()));
    localStorage.setItem(CLE_DERNIER_ETAT, 'reporte');
    api.signalerPermissionPush('reporte');
    setMasquee(true);
  };

  if (confirme) {
    return (
      <section className="push-optin-ligne push-optin-ligne-ok glass-panel fade-in" role="status">
        <div className="push-optin-ligne-tete">
          <span aria-hidden="true">🔔</span>
          <p>C'est activé. Ton brief du matin arrive demain à 10h.</p>
        </div>
      </section>
    );
  }

  if (masquee || etat === 'accorde' || etat === 'non_supporte' || etat === 'reporte') return null;

  /*
    Le refus tient sur une ligne, pas sur une carte.

    Une carte pleine se justifie quand elle propose un geste : « Activer », ou les
    étapes d'installation sur iPhone. Ici il n'y en a aucun — le navigateur a
    tranché et seule sa propre interface peut revenir dessus. Ces 237 pixels
    d'explications étaient les premiers du tableau de bord, avant la série, avant
    les tâches du jour : le premier écran parlait d'un réglage de navigateur plutôt
    que de la journée de la personne. La marche à suivre reste à un doigt, repliée.

    Le bouton, lui, repart toujours sur une vraie demande d'autorisation : le seul
    cas où elle ne s'affiche pas est celui où le navigateur a définitivement bloqué
    l'origine, et c'est alors seulement que la marche à suivre se déroule.
  */
  if (etat === 'refuse' || etat === 'echec') {
    const bloque = etat === 'refuse';
    return (
      <section className="push-optin-ligne glass-panel fade-in">
        <div className="push-optin-ligne-tete">
          <span aria-hidden="true">🔔</span>
          <p>
            {bloque
              ? 'Notifications bloquées — tu ne recevras pas ton brief du matin.'
              : "Notifications autorisées, mais l'abonnement n'a pas abouti."}
          </p>
          <button className="push-optin-btn secondaire" onClick={activer} disabled={occupe}>
            {occupe ? '…' : bloque ? 'Réactiver' : 'Réessayer'}
          </button>
          <button className="push-optin-fermer" onClick={reporter} aria-label="Masquer">
            ×
          </button>
        </div>
        {bloque && detailOuvert && (
          <p className="push-optin-ligne-detail">
            {cheminDeReautorisation()} Tu n'as rien d'autre à faire ensuite : l'app s'en aperçoit
            toute seule en revenant.
          </p>
        )}
        {!bloque && (
          <p className="push-optin-ligne-detail">
            Rien n'est perdu : réessaie dans un instant, ou depuis une meilleure connexion.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="push-optin glass-panel fade-in">
      <div className="push-optin-icone" aria-hidden="true">🔔</div>

      {etat === 'a_demander' && (
        <>
          <h3>Ton brief du matin, chaque jour à 10h</h3>
          <p>
            Ton coach t'écrit un message personnalisé à partir de ta série en cours et
            de ce qu'il te reste à faire. Sans notification, tu ne le recevras jamais.
          </p>
          <div className="push-optin-actions">
            {/* btn-primary plutôt qu'un style maison : les thèmes redéfinissent
                --accent-purple en voile translucide, si bien qu'un bouton peint avec
                cette variable devenait indiscernable du bouton secondaire. */}
            <button className="btn-primary" onClick={activer} disabled={occupe}>
              {occupe ? 'Activation…' : 'Activer les notifications'}
            </button>
            <button className="push-optin-btn secondaire" onClick={reporter} disabled={occupe}>
              Plus tard
            </button>
          </div>
          <p className="push-optin-note">
            {estIOS() ? 'iOS' : 'Ton navigateur'} va te demander de confirmer juste après.
          </p>
        </>
      )}

      {etat === 'ios_a_installer' && (
        <>
          <h3>Sur iPhone, installe l'app pour recevoir tes rappels</h3>
          {/* Ce n'est pas un choix de notre part : iOS ne délivre les notifications
              web qu'aux applications ajoutées à l'écran d'accueil. */}
          <ol className="push-optin-etapes">
            <li>Appuie sur <strong>Partager</strong> 📤 en bas de l'écran.</li>
            <li>Choisis <strong>Sur l'écran d'accueil</strong> ➕.</li>
            <li>Rouvre Disciplix depuis ta nouvelle icône.</li>
          </ol>
          <div className="push-optin-actions">
            <button className="push-optin-btn secondaire" onClick={reporter}>J'ai compris</button>
          </div>
        </>
      )}

    </section>
  );
};
