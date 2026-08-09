import React, { useEffect, useState } from 'react';
import { Sparkles, X, ChevronRight } from 'lucide-react';
import { AI_COSMETICS } from '../utils/cosmetics';
import './AiNotification.css';

interface AiNotificationProps {
  type: 'routine' | 'habit' | 'objective';
}

interface NotificationData {
  id: string;
  type: string;
  message: string;
  timestamp: string;
}

export function AiNotification({ type }: AiNotificationProps) {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [equippedSkinId, setEquippedSkinId] = useState<string | null>(() => localStorage.getItem('mindset_ai_skin_id'));

  const equippedCosmetic = AI_COSMETICS.find(c => c.id === equippedSkinId);

  const loadNotifications = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('mindset_ai_notifications') || '[]');
      // Filtrer par type et prendre la plus récente
      const relevantNotifs = saved.filter((n: NotificationData) => n.type === type).reverse();
      setNotifications(relevantNotifs);
    } catch {
      setNotifications([]);
    }
  };

  useEffect(() => {
    loadNotifications();
    const handleStorage = () => {
      loadNotifications();
      setEquippedSkinId(localStorage.getItem('mindset_ai_skin_id'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [type]);

  const [isHiding, setIsHiding] = useState(false);

  useEffect(() => {
    if (notifications.length > 0) {
      setIsHiding(false);
      const timer = setTimeout(() => {
        handleDismiss(notifications[0].id);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [notifications]);

  const dismissNotification = (id: string) => {
    try {
      const saved = JSON.parse(localStorage.getItem('mindset_ai_notifications') || '[]');
      const filtered = saved.filter((n: NotificationData) => n.id !== id);
      localStorage.setItem('mindset_ai_notifications', JSON.stringify(filtered));
      loadNotifications();
      // Notify other tabs
      window.dispatchEvent(new Event('storage'));
    } catch {}
  };

  const handleDismiss = (id: string) => {
    setIsHiding(true);
    setTimeout(() => {
      dismissNotification(id);
    }, 300);
  };

  if (notifications.length === 0) return null;

  const latestNotif = notifications[0];

  return (
    <div 
      className={`ai-notification-banner ${isHiding ? 'hiding' : ''}`} 
      onClick={() => handleDismiss(latestNotif.id)}
    >
      <div className="ai-notification-icon-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {equippedCosmetic?.type === 'icon' ? (
          <div className="status-icon-skin-large" style={{ fontSize: '18px' }}>{equippedCosmetic.value}</div>
        ) : (
          <div 
            className="ai-notification-icon pulse-glow liquid-glass-orb"
            style={equippedCosmetic?.type === 'color' ? { background: equippedCosmetic.value, width: '24px', height: '24px', borderRadius: '50%' } : {}}
          >
            {!equippedCosmetic && <Sparkles size={16} />}
          </div>
        )}
      </div>
      <div className="ai-notification-content">
        <p>{latestNotif.message}</p>
        <div className="ai-notification-action-btn">
          <span>Ouvrir</span>
          <ChevronRight size={14} />
        </div>
      </div>
    </div>
  );
}
