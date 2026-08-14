import React, { useEffect, useState } from 'react';
import { Clock, Gauge, Check } from 'lucide-react';
import { api } from '../services/api';
import { playClickSound } from '../utils/sounds';
import './CadrageManquant.css';

/*
  Rattrape les deux réponses qui bornent le plan, pour les comptes ouverts avant
  qu'on ne les demande.

  Le questionnaire d'inscription ne se rejoue que si le serveur ne connaît pas du
  tout la personne (`has_ai_profile`). Les comptes existants ont déjà un profil :
  ils ne repasseront donc jamais par l'inscription, et les questions ajoutées après
  coup resteraient sans réponse à vie. Leur coach continuerait à composer des plans
  sans savoir de combien de temps ils disposent ni d'où ils partent — c'est-à-dire
  exactement le défaut qu'on venait de corriger, mais réservé aux plus anciens.

  Ce n'est pas un écran de réglages, délibérément : personne n'ouvre les réglages.
  La carte vient à la personne, sur le tableau de bord, et disparaît dès qu'elle a
  répondu. Deux questions, jamais reposées.
*/

const TEMPS = [
  { minutes: 15, libelle: '15 min' },
  { minutes: 30, libelle: '30 min' },
  { minutes: 60, libelle: '1 heure' },
  { minutes: 120, libelle: '2 h ou +' },
];

const NIVEAUX = [
  { cle: 'sedentaire', titre: 'Sédentaire', detail: 'Aucun sport en ce moment.' },
  { cle: 'reprise', titre: 'En reprise', detail: "J'en ai fait, j'ai arrêté, je m'y remets." },
  { cle: 'regulier', titre: 'Irrégulier', detail: 'J\'en fais, mais sans rythme fixe.' },
  { cle: 'confirme', titre: 'Confirmé', detail: 'Je m\'entraîne sérieusement.' },
];

interface Props {
  nomCoach: string;
}

export const CadrageManquant: React.FC<Props> = ({ nomCoach }) => {
  const [visible, setVisible] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [niveau, setNiveau] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [termine, setTermine] = useState(false);

  useEffect(() => {
    let vivant = true;
    api
      .get('/ai-coaching/profil')
      .then((p) => {
        if (vivant && p?.cadrageManquant) setVisible(true);
      })
      // Un profil illisible ne doit pas faire apparaître la carte : mieux vaut ne
      // rien demander que redemander à quelqu'un qui a déjà répondu.
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, []);

  if (!visible) return null;

  const valider = async () => {
    if (!minutes || !niveau || envoi) return;
    playClickSound();
    setEnvoi(true);
    try {
      await api.patch('/ai-coaching/profil/cadrage', { minutesParJour: minutes, niveau });
      setTermine(true);
      // On laisse la confirmation à l'écran avant de retirer la carte : la voir
      // disparaître d'un coup ne dit pas si la réponse est partie.
      setTimeout(() => setVisible(false), 1800);
    } catch {
      // La carte reste, les choix aussi : la personne peut réessayer sans
      // recommencer. Elle réapparaîtra de toute façon au prochain chargement.
      setEnvoi(false);
    }
  };

  if (termine) {
    return (
      <section className="cadrage-manquant glass-panel cadrage-termine">
        <Check size={20} />
        <p>C'est noté. {nomCoach} en tiendra compte dès ton prochain plan.</p>
      </section>
    );
  }

  return (
    <section className="cadrage-manquant glass-panel">
      <div className="cadrage-intro">
        <h3>{nomCoach} ne sait pas encore doser tes plans</h3>
        <p>
          Deux questions, trente secondes. Sans elles, ton plan est calibré au hasard —
          avec, il tient dans tes journées et part d'où tu en es vraiment.
        </p>
      </div>

      <div className="cadrage-bloc">
        <span className="cadrage-label">
          <Clock size={15} /> Combien de temps par jour, vraiment ?
        </span>
        <div className="cadrage-choix">
          {TEMPS.map((t) => (
            <button
              key={t.minutes}
              className={`cadrage-option ${minutes === t.minutes ? 'choisie' : ''}`}
              onClick={() => setMinutes(t.minutes)}
              disabled={envoi}
            >
              {t.libelle}
            </button>
          ))}
        </div>
      </div>

      <div className="cadrage-bloc">
        <span className="cadrage-label">
          <Gauge size={15} /> Où en es-tu physiquement ?
        </span>
        <div className="cadrage-choix cadrage-choix-liste">
          {NIVEAUX.map((n) => (
            <button
              key={n.cle}
              className={`cadrage-option cadrage-option-large ${niveau === n.cle ? 'choisie' : ''}`}
              onClick={() => setNiveau(n.cle)}
              disabled={envoi}
            >
              <strong>{n.titre}</strong>
              <span>{n.detail}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        className="cadrage-valider"
        onClick={valider}
        disabled={!minutes || !niveau || envoi}
      >
        {envoi ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </section>
  );
};
