import { getSecurePoints, setSecurePoints } from '../utils/secureStorage';

const API_URL = import.meta.env.VITE_API_URL || 'https://mindora-backend-haku.onrender.com'; // NestJS Backend

export const api = {
  get: async (endpoint: string) => {
    const token = localStorage.getItem('mindset_token');
    const res = await fetch(`${API_URL}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem('mindset_token');
        window.location.href = '/?auth=true';
      }
      throw new Error('API Error');
    }
    return res.json();
  },
  post: async (endpoint: string, data: any, keepalive: boolean = false) => {
    const token = localStorage.getItem('mindset_token');
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data),
      keepalive: keepalive
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401 && !endpoint.includes('/auth/')) {
          localStorage.removeItem('mindset_token');
          window.location.href = '/?auth=true';
        }
        // Le statut et le code sont conservés : le quota IA (402) doit pouvoir
        // ouvrir l'écran d'abonnement plutôt que d'afficher une erreur générique.
        const error: any = new Error(err.message || 'API Error');
        error.status = res.status;
        error.code = err.code;
        throw error;
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
        if (data.nutrition) localStorage.setItem('mindset_nutrition', JSON.stringify(data.nutrition));
        if (data.points !== undefined) setSecurePoints(data.points);
        if (data.mental_score !== undefined) localStorage.setItem('mental_score', data.mental_score.toString());
        if (data.bonus_score !== undefined) localStorage.setItem('bonus_mental_score', data.bonus_score.toString());
        if (data.daily_scores) localStorage.setItem('mindset_daily_scores', JSON.stringify(data.daily_scores));
        if (data.rewards) localStorage.setItem('mindset_rewards', JSON.stringify(data.rewards));
        if (data.inventory) localStorage.setItem('mindset_inventory_rewards', JSON.stringify(data.inventory));
        if (data.owned_cosmetics) localStorage.setItem('mindset_owned_cosmetics', JSON.stringify(data.owned_cosmetics));
        if (data.ai_skin_id) localStorage.setItem('mindset_ai_skin_id', data.ai_skin_id);
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
        nutrition: JSON.parse(localStorage.getItem('mindset_nutrition') || '[]'),
        points: getSecurePoints(),
        mental_score: parseInt(localStorage.getItem('mental_score') || '0', 10),
        bonus_score: parseInt(localStorage.getItem('bonus_mental_score') || '0', 10),
        daily_scores: JSON.parse(localStorage.getItem('mindset_daily_scores') || '{}'),
        rewards: JSON.parse(localStorage.getItem('mindset_rewards') || '[]'),
        inventory: JSON.parse(localStorage.getItem('mindset_inventory_rewards') || '[]'),
        owned_cosmetics: JSON.parse(localStorage.getItem('mindset_owned_cosmetics') || '[]'),
        ai_skin_id: localStorage.getItem('mindset_ai_skin_id') || '',
        last_routine_date: localStorage.getItem('mindset_last_routine_date') || '',
        last_habit_date: localStorage.getItem('mindset_last_habit_date') || '',
        join_date: localStorage.getItem('mindset_join_date') || '',
        settings: {
          encryption: localStorage.getItem('mindset_sec_encryption') !== 'false',
          biometric: localStorage.getItem('mindset_sec_biometric') === 'true',
          localHistory: localStorage.getItem('mindset_sec_local') !== 'false'
        }
      };
      await api.post('/sync/state', state, true);
    } catch (e) {
      console.error('Failed to sync state', e);
    }
  },

  /**
   * Crédite côté serveur les coins d'une action validée.
   *
   * Le solde qui autorise l'IA vit désormais en base : le total gardé en
   * localStorage ne sert plus qu'à l'affichage. `eventKey` doit identifier
   * l'action ET le jour, sinon cocher/décocher en boucle rapporterait à l'infini.
   * Volontairement silencieux : une action validée ne doit jamais échouer parce
   * que le réseau a hoqueté.
   */
  claimCoins: async (eventKey: string) => {
    try {
      return await api.post('/ai-coaching/coins/claim', { eventKey });
    } catch (e) {
      console.warn('Coins non crédités côté serveur:', e);
      return null;
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

    const vapidResponse = await api.get('/push/vapid-public-key');
    const convertedVapidKey = urlBase64ToUint8Array(vapidResponse.publicKey);

    // Un abonnement est scellé à la clé VAPID qui l'a créé. Si le serveur signe
    // désormais avec une autre clé, le service de push rejette tous les envois — et
    // comme getSubscription() renvoie l'ancien abonnement, on le réenregistrerait
    // indéfiniment sans jamais en créer un valide. On compare donc les clés, et on
    // se désabonne pour repartir proprement quand elles diffèrent.
    if (subscription) {
      const cleActuelle = subscription.options?.applicationServerKey;
      const identique =
        !!cleActuelle &&
        new Uint8Array(cleActuelle).length === convertedVapidKey.length &&
        new Uint8Array(cleActuelle).every((octet, i) => octet === convertedVapidKey[i]);

      if (!identique) {
        console.warn('Clé VAPID changée : recréation de l\'abonnement push.');
        await subscription.unsubscribe();
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    }

    // Identifiant stable de ce navigateur. L'endpoint push, lui, change à chaque
    // recréation de l'abonnement : sans ce repère, le serveur garde l'ancienne
    // inscription en plus de la nouvelle et l'appareil reçoit tout en double.
    let deviceId = localStorage.getItem('mindset_device_id');
    if (!deviceId) {
      deviceId = (crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem('mindset_device_id', deviceId);
    }

    await api.post('/push/subscribe', { subscription, deviceId });
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
    if (localStorage.getItem('mindset_token')) {
      if (document.visibilityState === 'hidden') {
        api.syncStateToCloud();
      } else if (document.visibilityState === 'visible') {
        // Automatically fetch latest data when opening the app/switching tabs
        api.downloadCloudState();
      }
    }
  });
} catch (e) {
  console.warn('localStorage override failed');
}
