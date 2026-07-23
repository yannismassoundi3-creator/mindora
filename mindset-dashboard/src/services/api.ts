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
      body: JSON.stringify(data),
      keepalive: true
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
        if (data.daily_scores) localStorage.setItem('mindset_daily_scores', JSON.stringify(data.daily_scores));
        if (data.last_routine_date) localStorage.setItem('mindset_last_routine_date', data.last_routine_date);
        if (data.last_habit_date) localStorage.setItem('mindset_last_habit_date', data.last_habit_date);
        if (data.join_date) localStorage.setItem('mindset_join_date', data.join_date);
        if (data.settings) {
          if (data.settings.encryption !== undefined) localStorage.setItem('mindset_sec_encryption', data.settings.encryption.toString());
          if (data.settings.biometric !== undefined) localStorage.setItem('mindset_sec_biometric', data.settings.biometric.toString());
          if (data.settings.localHistory !== undefined) localStorage.setItem('mindset_sec_local', data.settings.localHistory.toString());
        }
        
        // Force React components to re-render with new data
        window.dispatchEvent(new Event('storage'));
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
        daily_scores: JSON.parse(localStorage.getItem('mindset_daily_scores') || '{}'),
        last_routine_date: localStorage.getItem('mindset_last_routine_date') || '',
        last_habit_date: localStorage.getItem('mindset_last_habit_date') || '',
        join_date: localStorage.getItem('mindset_join_date') || '',
        settings: {
          encryption: localStorage.getItem('mindset_sec_encryption') !== 'false',
          biometric: localStorage.getItem('mindset_sec_biometric') === 'true',
          localHistory: localStorage.getItem('mindset_sec_local') !== 'false'
        }
      };
      await api.post('/sync/state', state);
    } catch (e) {
      console.error('Failed to sync state', e);
    }
  },

  subscribeToPushNotifications: async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Notifications_Not_Supported');
      return false;
    }
    
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    
    if (permission !== 'granted') {
      console.warn('Permission_Denied');
      return false;
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
let isSyncing = false;

try {
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    originalSetItem.apply(this, [key, value]);
    
    // Ignore updates that are just downloading from cloud to prevent feedback loops
    if (isSyncing) return;

    if (key.startsWith('mindset_') || key.includes('mental_score')) {
      clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        try {
          if (localStorage.getItem('mindset_token')) {
            api.syncStateToCloud();
          }
        } catch (e) {}
      }, 500); // 500ms debounce
    }
  };

  // Wrap downloadCloudState to prevent feedback loops
  const originalDownload = api.downloadCloudState;
  api.downloadCloudState = async () => {
    isSyncing = true;
    await originalDownload();
    isSyncing = false;
  };

  // Force sync when page is hidden/closed to prevent data loss
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && localStorage.getItem('mindset_token')) {
      api.syncStateToCloud();
    }
  });
} catch (e) {
  console.warn('localStorage override failed');
}
