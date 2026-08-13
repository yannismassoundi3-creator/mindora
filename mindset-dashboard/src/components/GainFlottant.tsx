import React, { useEffect, useState } from 'react';
import { EVENEMENT_GAIN } from '../utils/journee';
import './GainFlottant.css';

/*
  Le gain qui s'envole du doigt.

  Cocher une tâche créditait cinq points en silence : le compteur de l'en-tête
  changeait, mais il est à l'autre bout de l'écran et rien ne reliait le geste à
  sa récompense. L'onde de choc disait « quelque chose s'est passé » sans jamais
  dire quoi.

  Le chiffre part exactement d'où l'on a appuyé et monte en s'effaçant : c'est le
  seul retour qui répond à la question « qu'est-ce que je viens de gagner ».
*/

interface Gain {
  id: number;
  x: number;
  y: number;
  texte: string;
  negatif: boolean;
}

export const GainFlottant: React.FC = () => {
  const [gains, setGains] = useState<Gain[]>([]);

  useEffect(() => {
    const surGain = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const gain: Gain = {
        id: Date.now() + Math.random(),
        // Bridé aux bords : un appui près du bord droit projetait le texte hors
        // de l'écran, où il s'animait sans que personne ne le voie.
        x: Math.min(Math.max(detail.x ?? window.innerWidth / 2, 46), window.innerWidth - 46),
        y: Math.min(Math.max(detail.y ?? window.innerHeight / 2, 60), window.innerHeight - 40),
        texte: detail.texte || '',
        negatif: !!detail.negatif,
      };
      setGains((prev) => [...prev, gain]);
      setTimeout(() => setGains((prev) => prev.filter((g) => g.id !== gain.id)), 1100);
    };

    window.addEventListener(EVENEMENT_GAIN, surGain);
    return () => window.removeEventListener(EVENEMENT_GAIN, surGain);
  }, []);

  if (gains.length === 0) return null;

  return (
    <div className="gain-flottant-couche">
      {gains.map((g) => (
        <span
          key={g.id}
          className={`gain-flottant ${g.negatif ? 'negatif' : ''}`}
          style={{ left: `${g.x}px`, top: `${g.y}px` }}
        >
          {g.texte}
        </span>
      ))}
    </div>
  );
};
