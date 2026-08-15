import React, { useEffect, useState } from 'react';
import { CloudOff, RotateCw, History } from 'lucide-react';
import { api, lireEtatSynchro, signalerEtatSynchro, type EtatSynchro } from '../services/api';
import { copieDeConflit, oublierCopieDeConflit, restaurerCopieDeConflit } from '../utils/synchro';
import './EtatSauvegarde.css';

/**
 * Ce que la sauvegarde a à dire, et seulement quand elle a quelque chose à dire.
 *
 * Le garde-fou de synchro protège désormais le travail local : quand la remontée
 * échoue, on refuse d'écraser avec la version du serveur. Correct, mais muet — la
 * personne n'avait aucun moyen de savoir que son appareil s'était mis en retrait,
 * et la seule trace était une ligne de console que personne ne lit. On avait donc
 * remplacé une perte silencieuse par une divergence silencieuse.
 *
 * D'où cette pastille. Trois règles pour qu'elle reste supportable :
 *
 * 1. **Elle n'apparaît pas quand tout va bien.** Un indicateur permanent devient un
 *    élément de décor qu'on ne lit plus, et il ferait douter de quelque chose qui
 *    fonctionne. Rien à signaler, rien à l'écran.
 * 2. **Elle laisse passer les quelques secondes normales.** Toute écriture est en
 *    attente pendant la demi-seconde de temporisation puis le temps de l'aller-retour :
 *    afficher tout de suite ferait clignoter un avertissement à chaque case cochée.
 * 3. **Elle propose toujours un geste**, jamais un simple constat. Réessayer, ou
 *    récupérer la version mise de côté.
 */

/**
 * Délai avant de considérer qu'une attente n'est plus normale.
 *
 * Une remontée saine prend une demi-seconde de temporisation plus un aller-retour
 * réseau. Huit secondes laissent passer largement cela, y compris sur une connexion
 * mobile médiocre, sans laisser quelqu'un ignorer longtemps que son travail n'est
 * pas parti.
 */
const DELAI_AVANT_ALERTE_MS = 8000;

export const EtatSauvegarde: React.FC = () => {
  const [etat, setEtat] = useState<EtatSynchro>(() => lireEtatSynchro());
  const [assezLongtemps, setAssezLongtemps] = useState(false);
  const [reprise, setReprise] = useState(false);
  const [conflitOuvert, setConflitOuvert] = useState(false);

  useEffect(() => {
    const surEtat = (e: Event) => setEtat((e as CustomEvent).detail ?? lireEtatSynchro());
    const surConflit = () => {
      setEtat(lireEtatSynchro());
      setConflitOuvert(true);
    };

    window.addEventListener('synchroEtat', surEtat);
    window.addEventListener('synchroConflit', surConflit);

    // Un filet : certaines écritures passent par des chemins qui ne signalent rien,
    // et la pastille ne doit pas rester affichée après coup sur un état résolu.
    const minuteur = setInterval(() => setEtat(lireEtatSynchro()), 15000);

    return () => {
      window.removeEventListener('synchroEtat', surEtat);
      window.removeEventListener('synchroConflit', surConflit);
      clearInterval(minuteur);
    };
  }, []);

  /*
    Le compte à rebours redémarre à chaque fois que l'attente commence, et s'annule
    dès qu'elle se termine. Sans cette remise à zéro, la pastille apparaîtrait au
    bout de huit secondes d'utilisation quel que soit l'état réel de la sauvegarde.
  */
  useEffect(() => {
    if (!etat.enAttente) {
      setAssezLongtemps(false);
      return;
    }
    const minuteur = setTimeout(() => setAssezLongtemps(true), DELAI_AVANT_ALERTE_MS);
    return () => clearTimeout(minuteur);
  }, [etat.enAttente]);

  const reessayer = async () => {
    setReprise(true);
    await api.syncStateToCloud();
    setEtat(lireEtatSynchro());
    setReprise(false);
  };

  const recuperer = () => {
    restaurerCopieDeConflit();
    setConflitOuvert(false);
    signalerEtatSynchro();
  };

  const ignorerConflit = () => {
    oublierCopieDeConflit();
    setConflitOuvert(false);
    signalerEtatSynchro();
  };

  const copie = etat.conflit ? copieDeConflit() : null;

  /*
    Le conflit prime sur l'attente : c'est le seul des deux qui demande une décision,
    et il porte un risque que la personne n'a pas choisi — son travail a été rangé
    ailleurs sans qu'elle le demande.
  */
  if (copie && conflitOuvert) {
    const quand = new Date(copie.date).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <div className="sauvegarde-conflit" role="alertdialog" aria-label="Deux versions de tes données">
        <div className="sauvegarde-conflit-titre">
          <History size={16} />
          <span>Tes données ont changé ailleurs</span>
        </div>
        <p className="sauvegarde-conflit-texte">
          Un autre appareil avait enregistré des modifications plus récentes. Tu vois maintenant
          sa version. Celle qui était ici, du {quand}, a été mise de côté — rien n'est perdu.
        </p>
        <div className="sauvegarde-conflit-actions">
          <button className="sauvegarde-btn-principal" onClick={recuperer}>
            Récupérer ma version
          </button>
          <button className="sauvegarde-btn-discret" onClick={ignorerConflit}>
            Garder celle-ci
          </button>
        </div>
      </div>
    );
  }

  // Une version mise de côté et non tranchée reste accessible, mais discrètement :
  // le bandeau a déjà été vu, le redéployer à chaque écran serait du harcèlement.
  if (copie && !conflitOuvert) {
    return (
      <button
        className="sauvegarde-pastille sauvegarde-pastille-memoire"
        onClick={() => setConflitOuvert(true)}
        title="Une version de tes données a été mise de côté"
      >
        <History size={13} />
        <span>Version mise de côté</span>
      </button>
    );
  }

  if (!etat.enAttente || !assezLongtemps) return null;

  return (
    <div className="sauvegarde-pastille" role="status">
      {etat.horsLigne ? <CloudOff size={13} /> : <RotateCw size={13} className={reprise ? 'sauvegarde-tourne' : ''} />}
      <span>{etat.horsLigne ? 'Hors ligne — sauvegarde en attente' : 'Pas encore sauvegardé'}</span>
      {!etat.horsLigne && (
        <button className="sauvegarde-reessayer" onClick={reessayer} disabled={reprise}>
          {reprise ? '…' : 'Réessayer'}
        </button>
      )}
    </div>
  );
};
