import React, { useEffect, useState } from 'react';
import { Sparkles, X, ChevronRight } from 'lucide-react';
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
    const handleStorage = () => loadNotifications();
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [type]);

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

  if (notifications.length === 0) return null;

  // On affiche uniquement la plus récente pour ne pas encombrer
  const latestNotif = notifications[0];

  return (
    <div className="ai-notification-banner glass-panel fade-in">
      <div className="ai-notification-icon pulse-glow">
        <Sparkles size={16} />
      </div>
      <div className="ai-notification-content">
        <p>{latestNotif.message}</p>
        <div className="ai-notification-action-btn" onClick={() => dismissNotification(latestNotif.id)}>
          <span>Compris</span>
          <ChevronRight size={14} />
        </div>
      </div>
      <button className="ai-notification-close" onClick={() => dismissNotification(latestNotif.id)}>
        <X size={14} />
      </button>
    </div>
  );
}
