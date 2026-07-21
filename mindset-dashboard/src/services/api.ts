const API_URL = import.meta.env.VITE_API_URL || 'https://mindora-backend-haku.onrender.com'; // NestJS Backend

export const api = {
  get: async (endpoint: string) => {
    const token = localStorage.getItem('mindset_token');
    const res = await fetch(`${API_URL}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) throw new Error('API Error');
    return res.json();
  },
  post: async (endpoint: string, data: any) => {
    const token = localStorage.getItem('mindset_token');
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'API Error');
    }
    return res.json();
  },
  
  downloadCloudState: async () => {
    try {
      const data = await api.get('/sync/state');
      if (data) {
        if (data.routines) localStorage.setItem('mindset_routines', JSON.stringify(data.routines));
        if (data.micro_objectives) localStorage.setItem('mindset_micro_obj', JSON.stringify(data.micro_objectives));
        if (data.macro_objectives) localStorage.setItem('mindset_macro_obj', JSON.stringify(data.macro_objectives));
        if (data.habits) localStorage.setItem('mindset_habits', JSON.stringify(data.habits));
        if (data.points !== undefined) localStorage.setItem('mindset_points', data.points.toString());
        if (data.mental_score !== undefined) localStorage.setItem('mental_score', data.mental_score.toString());
        if (data.bonus_score !== undefined) localStorage.setItem('bonus_mental_score', data.bonus_score.toString());
      }
    } catch (e) {
      console.error('Failed to download state', e);
    }
  },

  syncStateToCloud: async () => {
    try {
      const state = {
        routines: JSON.parse(localStorage.getItem('mindset_routines') || '[]'),
        micro_objectives: JSON.parse(localStorage.getItem('mindset_micro_obj') || '[]'),
        macro_objectives: JSON.parse(localStorage.getItem('mindset_macro_obj') || '[]'),
        habits: JSON.parse(localStorage.getItem('mindset_habits') || '[]'),
        points: parseInt(localStorage.getItem('mindset_points') || '0', 10),
        mental_score: parseInt(localStorage.getItem('mental_score') || '0', 10),
        bonus_score: parseInt(localStorage.getItem('bonus_mental_score') || '0', 10),
      };
      await api.post('/sync/state', state);
    } catch (e) {
      console.error('Failed to sync state', e);
    }
  },

  subscribeToPushNotifications: async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('Notifications_Not_Supported');
    }
    
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    
    if (permission !== 'granted') {
      throw new Error('Permission_Denied');
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const vapidResponse = await api.get('/push/vapid-public-key');
      const publicKey = vapidResponse.publicKey;
      
      const convertedVapidKey = urlBase64ToUint8Array(publicKey);
      
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    }

    await api.post('/push/subscribe', subscription);
    return true;
  }
};

// Utility function for VAPID key conversion
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Global debounced auto-sync hook
let syncTimeout: any;
const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
  originalSetItem.apply(this, [key, value]);
  if (key.startsWith('mindset_') || key.includes('mental_score')) {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      if (localStorage.getItem('mindset_token')) {
        api.syncStateToCloud();
      }
    }, 2000); // 2 seconds debounce
  }
};
