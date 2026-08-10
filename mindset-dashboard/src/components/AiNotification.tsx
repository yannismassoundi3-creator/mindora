import React, { useEffect, useState } from 'react';
import { Sparkles, X, ChevronRight } from 'lucide-react';
import { AI_COSMETICS } from '../utils/cosmetics';
import './AiNotification.css';

interface AiNotificationProps {
  onNavigate?: (view: string) => void;
}

interface NotificationData {
  id: string;
  type: string;
  message: string;
  timestamp: string;
}

export function AiNotification({ onNavigate }: AiNotificationProps) {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [equippedSkinId, setEquippedSkinId] = useState<string | null>(() => localStorage.getItem('mindset_ai_skin_id'));

  const equippedCosmetic = AI_COSMETICS.find(c => c.id === equippedSkinId);

  const loadNotifications = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('mindset_ai_notifications') || '[]');
      // On prend toutes les notifications (on reverse pour avoir la plus récente)
      setNotifications(saved.reverse());
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
  }, []);

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

  const dismissNotification = (id: string, clearAll: boolean = false) => {
    try {
      if (clearAll) {
        localStorage.setItem('mindset_ai_notifications', '[]');
      } else {
        const saved = JSON.parse(localStorage.getItem('mindset_ai_notifications') || '[]');
        const filtered = saved.filter((n: NotificationData) => n.id !== id);
        localStorage.setItem('mindset_ai_notifications', JSON.stringify(filtered));
      }
      loadNotifications();
      // Notify other tabs
      window.dispatchEvent(new Event('storage'));
    } catch {}
  };

  const handleDismiss = (id: string, type: string, navigate: boolean) => {
    setIsHiding(true);
    if (navigate && onNavigate) {
      let targetView = 'dashboard';
      if (type === 'habit') targetView = 'habits';
      if (type === 'objective') targetView = 'objectives';
      if (type === 'routine') targetView = 'dashboard';
      if (type === 'nutrition') {
        targetView = 'dashboard';
        localStorage.setItem('mindset_dashboard_tab', 'nutrition');
      }
      onNavigate(targetView);
    }
    
    setTimeout(() => {
      dismissNotification(id, false); // Don't clear all, allow queueing
    }, 300);
  };

  if (notifications.length === 0) return null;

  const latestNotif = notifications[0];

  return (
    <div 
      className={`ai-notification-banner ${isHiding ? 'hiding' : ''}`} 
      onClick={() => handleDismiss(latestNotif.id, latestNotif.type, true)}
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
