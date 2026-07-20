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
        routines: JSON.parse(localStorage.getItem('mindset_routines') || 'null'),
        micro_objectives: JSON.parse(localStorage.getItem('mindset_micro_obj') || 'null'),
        macro_objectives: JSON.parse(localStorage.getItem('mindset_macro_obj') || 'null'),
        habits: JSON.parse(localStorage.getItem('mindset_habits') || 'null'),
        points: parseInt(localStorage.getItem('mindset_points') || '0', 10),
        mental_score: parseInt(localStorage.getItem('mental_score') || '0', 10),
        bonus_score: parseInt(localStorage.getItem('bonus_mental_score') || '0', 10),
      };
      await api.post('/sync/state', state);
    } catch (e) {
      console.error('Failed to sync state', e);
    }
  }
};

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
