import React, { useEffect, useState } from 'react';
import { Eye, ArrowRight } from 'lucide-react';
import { chargerObservation, type Observation } from '../utils/observation';
import './CarteObservation.css';

/*
  « Ce que ton coach a remarqué ».

  La bannière d'arrivée passe et disparaît — c'est sa nature, et c'est bien. Mais
  une remarque qui a demandé quatre semaines d'historique mérite de rester
  quelque part où l'on peut y revenir. D'où cette carte, sur le tableau de bord.

  Ce qu'elle affiche n'est jamais deviné : le motif est calculé côté serveur à
  partir des scores jour par jour, avec un nombre minimum d'occurrences et un
  écart minimum (`ObservationService`). Quand rien ne tient, la carte n'existe
  pas — elle ne se montre pas vide, et elle ne montre pas de platitude.

  Le bouton ne mène pas au chat : il **envoie le message**. Quelqu'un qui vient de
  lire « sur 4 samedis, 3 sont à zéro » ne devrait pas avoir à reformuler ce
  constat pour en parler. C'est la marche qui perdait tout le monde.
*/

interface CarteObservationProps {
  /** Ouvre la conversation. Même fonction que le bouton du coach du tableau de bord. */
  onOuvrirChat: () => void;
}

export const CarteObservation: React.FC<CarteObservationProps> = ({ onOuvrirChat }) => {
  const [observation, setObservation] = useState<Observation | null>(null);

  useEffect(() => {
    let annule = false;
    chargerObservation()
      .then((o) => {
        if (!annule) setObservation(o);
      })
      // Un échec réseau ne montre rien : c'est un bonus d'affichage, pas une
      // donnée dont dépend l'écran. Signaler une panne ici parlerait d'un
      // problème à quelqu'un qui n'a rien demandé.
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  if (!observation) return null;

  const enParler = () => {
    // Même chemin que la bannière et que la fin du questionnaire : `AIChat`
    // consomme cette clé à son montage et envoie le message tout seul.
    localStorage.setItem('mindset_pending_chat_msg', observation.invite);
    onOuvrirChat();
  };

  return (
    <section className="observation-carte glass-panel">
      <p className="observation-carte__entete">
        <Eye size={14} /> Ce que ton coach a remarqué
      </p>

      <h3 className="observation-carte__titre">{observation.titre}</h3>
      <p className="observation-carte__fait">{observation.fait}</p>

      <button type="button" className="observation-carte__action" onClick={enParler}>
        En parler avec ton coach
        <ArrowRight size={15} />
      </button>
    </section>
  );
};
