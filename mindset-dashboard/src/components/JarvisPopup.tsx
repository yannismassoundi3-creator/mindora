import React, { useEffect, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { AI_COSMETICS } from '../utils/cosmetics';
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
  const aiName = localStorage.getItem('mindset_ai_name') || 'FAYWA';
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

  const handleActionClick = () => {
    const chatMessage = `J'ai terminé : "${data.title}" (${data.itemType}). Ça s'est bien passé !`;
    setIsHiding(true);
    setTimeout(() => {
      onChatNavigate(chatMessage);
      onClose();
    }, 300);
  };

  const getMessageText = () => {
    if (data.itemType === 'routine') return `Routine "${data.title}" terminée. Un retour à faire ?`;
    if (data.itemType === 'objective') return `Objectif "${data.title}" avancé. Prêt pour la suite ?`;
    return `"${data.title}" accompli. Bien joué !`;
  };

  return (
    <div 
      className={`jarvis-popup-container ${isHiding ? 'hiding' : ''}`}
      style={{ left: `${data.x}px`, top: `${data.y}px` }}
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
      
      <div className="jarvis-popup-bubble" onClick={handleActionClick}>
        <div className="jarvis-popup-header">
          {aiName}
        </div>
        <p className="jarvis-popup-text">
          {getMessageText()}
        </p>
        <div className="jarvis-popup-action">
          <span>Ouvrir le chat</span>
          <MessageSquarePlus size={14} />
        </div>
      </div>
    </div>
  );
};
