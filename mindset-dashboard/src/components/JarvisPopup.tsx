import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { AI_COSMETICS } from '../utils/cosmetics';
import { lireEtatDuJour } from '../utils/journee';
import './JarvisPopup.css';

export interface JarvisPopupData {
  x: number;
  y: number;
  title: string;
  itemType: 'routine' | 'objective' | 'habit';
}

interface JarvisPopupProps {
  data: JarvisPopupData;
  onClose: () => void;
  onChatNavigate: (message: string) => void;
}

export const JarvisPopup: React.FC<JarvisPopupProps> = ({ data, onClose, onChatNavigate }) => {
  const [isHiding, setIsHiding] = useState(false);
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';
  const [equippedSkinId, setEquippedSkinId] = useState<string | null>(() => localStorage.getItem('mindset_ai_skin_id'));
  
  useEffect(() => {
    const handleStorage = () => {
      setEquippedSkinId(localStorage.getItem('mindset_ai_skin_id'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const equippedCosmetic = AI_COSMETICS.find(c => c.id === equippedSkinId);

  useEffect(() => {
    // Auto-hide after 5 seconds
    const timer = setTimeout(() => {
      setIsHiding(true);
      setTimeout(onClose, 300); // Wait for exit animation
    }, 5000);

    return () => clearTimeout(timer);
  }, [onClose]);

  const handleActionClick = (e: React.MouseEvent, status: 'good' | 'bad') => {
    e.stopPropagation();
    const chatMessage = status === 'good'
      ? `J'ai terminé : "${data.title}" (${data.itemType}). Ça s'est bien passé !`
      : `J'ai terminé : "${data.title}" (${data.itemType}). C'était très difficile / Ça s'est mal passé.`;
      
    setIsHiding(true);
    setTimeout(() => {
      onChatNavigate(chatMessage);
      onClose();
    }, 300);
  };

  /*
    L'avancée du jour, lue au moment où la bulle apparaît.

    La bulle annonçait la tâche et enchaînait aussitôt sur une question, sans
    jamais dire où l'on en était. C'est pourtant le seul instant où la réponse
    intéresse vraiment : on vient de cocher, on veut savoir ce qu'il reste. Le
    `useMemo` fige la valeur à l'ouverture — recalculée, la jauge repartirait
    en arrière au prochain rendu.
  */
  const journee = useMemo(() => lireEtatDuJour(), []);
  const avancee = journee.total > 0 ? Math.round((journee.faites / journee.total) * 100) : 0;
  const restantes = Math.max(0, journee.total - journee.faites);

  /*
    Ce compteur mesure les routines, et rien d'autre.

    La bulle s'ouvre aussi sur un repas (`Dashboard.tsx`, itemType 'objective') :
    elle affichait alors l'avancement des routines juste sous le nom du plat, un
    chiffre sans le moindre rapport avec ce qu'on venait de cocher — et qui ne
    bougeait pas d'un cran quand on en cochait un second. Mieux vaut ne rien dire
    que répondre à côté.
  */
  const montrerAvancee = data.itemType === 'routine' && journee.total > 0;

  // « Journée bouclée » se lit sur les mêmes routines : l'annoncer après un repas
  // serait la même erreur, avec une phrase à la place d'un chiffre.
  const question =
    montrerAvancee && restantes === 0
      ? 'Journée bouclée. Ça s’est passé comment ?'
      : 'Ça s’est passé comment ?';

  return createPortal(
    <div
      className={`jarvis-popup-container ${isHiding ? 'hiding' : ''}`}
    >
      <div className="jarvis-popup-orb-container">
        {equippedCosmetic?.type === 'icon' ? (
          <div className="status-icon-skin-large" style={{ fontSize: '20px' }}>{equippedCosmetic.value}</div>
        ) : (
          <div
            className="jarvis-popup-orb liquid-glass-orb"
            style={equippedCosmetic?.type === 'color' ? { background: equippedCosmetic.value } : {}}
          ></div>
        )}
      </div>

      <div className="jarvis-popup-bubble">
        <div className="jarvis-popup-header">
          {aiName}
          <span className="jarvis-gain">+5</span>
        </div>

        <div className="jarvis-fait">
          <Check size={14} strokeWidth={3} />
          <span className="jarvis-fait-titre">{data.title}</span>
        </div>

        {montrerAvancee && (
          <div className="jarvis-avancee">
            {/*
              Le libellé n'est pas décoratif : sans lui, ce compteur change de sujet
              en silence. La ligne du dessus parle de la tâche qu'on vient de cocher,
              celle-ci parle de la journée entière, et rien ne le disait — « 3/6 »
              apparaissait juste sous « Course à pied » et se lisait comme une
              progression de cette tâche-là.
            */}
            <div className="jarvis-avancee-ligne">
              <span className="jarvis-avancee-libelle">Routines du jour</span>
              <span className="jarvis-avancee-texte">
                {restantes === 0
                  ? `${journee.total} / ${journee.total}`
                  : `${journee.faites} / ${journee.total} · ${restantes} restante${restantes > 1 ? 's' : ''}`}
              </span>
            </div>
            <div className="jarvis-jauge">
              <div className="jarvis-jauge-remplie" style={{ width: `${avancee}%` }} />
            </div>
          </div>
        )}

        <p className="jarvis-popup-text">{question}</p>
        <div className="jarvis-popup-actions-row">
          <button className="jarvis-popup-btn success" onClick={(e) => handleActionClick(e, 'good')}>
            👍 Facile
          </button>
          <button className="jarvis-popup-btn failure" onClick={(e) => handleActionClick(e, 'bad')}>
            👎 Difficile
          </button>
        </div>

        {/* Le temps qu'il reste avant que la bulle s'en aille d'elle-même. Sans
            cette barre, sa disparition passe pour un raté d'affichage. */}
        <span className="jarvis-minuteur" />
      </div>
    </div>,
    document.body
  );
};
