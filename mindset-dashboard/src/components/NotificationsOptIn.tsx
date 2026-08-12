import React, { useEffect, useState } from 'react';
import { api, diagnostiquerPush, estIOS, type EtatPush } from '../services/api';
import './NotificationsOptIn.css';

const CLE_REPORT = 'mindset_push_reporte_le';
const CLE_DERNIER_ETAT = 'mindset_push_dernier_etat';
/** Un « plus tard » se redemande. Trois jours : assez pour ne pas harceler. */
const DELAI_REPORT_MS = 3 * 24 * 3600 * 1000;

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
 */
export const NotificationsOptIn: React.FC = () => {
  const [etat, setEtat] = useState<EtatPush | 'a_demander'>(() => diagnostiquerPush());
  const [occupe, setOccupe] = useState(false);
  const [masquee, setMasquee] = useState(() => {
    const reporte = Number(localStorage.getItem(CLE_REPORT) || 0);
    return reporte > 0 && Date.now() - reporte < DELAI_REPORT_MS;
  });

  // On remonte l'état une fois par changement, jamais à chaque affichage : ce qui
  // manquait n'était pas le détail des visites mais le décompte des situations.
  useEffect(() => {
    if (etat === 'a_demander') return;
    if (localStorage.getItem(CLE_DERNIER_ETAT) === etat) return;
    localStorage.setItem(CLE_DERNIER_ETAT, etat);
    api.signalerPermissionPush(etat as EtatPush);
  }, [etat]);

  const activer = async () => {
    setOccupe(true);
    try {
      // Le clic qui déclenche cet appel est ce qui rend la demande recevable par
      // Firefox : la chaîne doit rester synchrone jusqu'à requestPermission().
      const abonne = await api.subscribeToPushNotifications(true);
      setEtat(abonne ? 'accorde' : diagnostiquerPush());
    } catch (e) {
      console.error('Abonnement aux notifications impossible', e);
      setEtat(diagnostiquerPush());
    } finally {
      setOccupe(false);
    }
  };

  const reporter = () => {
    localStorage.setItem(CLE_REPORT, String(Date.now()));
    localStorage.setItem(CLE_DERNIER_ETAT, 'reporte');
    api.signalerPermissionPush('reporte');
    setMasquee(true);
  };

  if (masquee || etat === 'accorde' || etat === 'non_supporte') return null;

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

      {etat === 'refuse' && (
        <>
          <h3>Les notifications sont bloquées</h3>
          {/* Un refus navigateur ne se rattrape pas depuis la page : requestPermission()
              rend « denied » sans rien afficher. Seuls les réglages du site le peuvent. */}
          <p>
            Ton navigateur les a refusées pour Disciplix, et seule cette page ne peut plus
            rien y faire. Touche le {estIOS() ? 'bouton « aA »' : 'cadenas'} à gauche de
            l'adresse du site, puis autorise les notifications.
          </p>
          <div className="push-optin-actions">
            <button className="push-optin-btn secondaire" onClick={reporter}>Plus tard</button>
          </div>
        </>
      )}
    </section>
  );
};
