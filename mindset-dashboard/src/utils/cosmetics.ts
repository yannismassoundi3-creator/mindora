export interface Cosmetic {
  id: string;
  title: string;
  description: string;
  cost: number;
  type: 'color' | 'icon';
  value: string; // CSS color or Icon name/Emoji
  rarity: 'commun' | 'rare' | 'epique' | 'legendaire';
}

export const AI_COSMETICS: Cosmetic[] = [
  // Couleurs
  { id: 'c_gold', title: 'Aura Dorée', description: 'Une prestance royale pour ton IA.', cost: 500, type: 'color', value: 'linear-gradient(135deg, #fbbf24, #d97706)', rarity: 'rare' },
  { id: 'c_sith', title: 'Énergie Sith', description: 'La puissance du côté obscur.', cost: 600, type: 'color', value: 'linear-gradient(135deg, #ef4444, #991b1b)', rarity: 'rare' },
  { id: 'c_dark', title: 'Matière Noire', description: 'Une IA sombre et minimaliste.', cost: 800, type: 'color', value: 'linear-gradient(135deg, #1f2937, #030712)', rarity: 'epique' },
  { id: 'c_cyber', title: 'Cyberpunk', description: 'Néon rose et bleu.', cost: 1000, type: 'color', value: 'linear-gradient(135deg, #ec4899, #8b5cf6)', rarity: 'epique' },
  { id: 'c_emerald', title: 'Émeraude', description: 'La sagesse de la nature.', cost: 400, type: 'color', value: 'linear-gradient(135deg, #10b981, #047857)', rarity: 'commun' },
  
  // Icônes (Emojis pour commencer, faciles à rendre)
  { id: 'i_robot', title: 'Mecha-Jarvis', description: 'Un visage robotique classique.', cost: 1500, type: 'icon', value: '🤖', rarity: 'epique' },
  { id: 'i_ghost', title: 'Spectre', description: 'Une IA fantomatique.', cost: 1200, type: 'icon', value: '👻', rarity: 'rare' },
  { id: 'i_ninja', title: 'Sensei', description: 'L\'art de la discipline.', cost: 2000, type: 'icon', value: '🥷', rarity: 'legendaire' },
  { id: 'i_alien', title: 'Visiteur', description: 'Une intelligence venue d\'ailleurs.', cost: 1800, type: 'icon', value: '👽', rarity: 'epique' },
  { id: 'i_brain', title: 'Cerveau Galactique', description: 'La pureté intellectuelle.', cost: 2500, type: 'icon', value: '🧠', rarity: 'legendaire' },
  { id: 'i_fire', title: 'Démon du Feu', description: 'Une motivation brûlante.', cost: 3000, type: 'icon', value: '🔥', rarity: 'legendaire' }
];

// Helper to get today's shop items based on the date seed
export function getDailyShopItems(): Cosmetic[] {
  const today = new Date().toDateString(); // e.g. "Thu Jul 23 2026"
  
  // Create a simple deterministic random seed based on today's date string
  let seed = 0;
  for (let i = 0; i < today.length; i++) {
    seed += today.charCodeAt(i);
  }
  
  const shuffled = [...AI_COSMETICS].sort((a, b) => {
    // Deterministic shuffle
    const aHash = (seed * a.id.charCodeAt(0)) % 100;
    const bHash = (seed * b.id.charCodeAt(0)) % 100;
    return aHash - bHash;
  });

  // Return 4 items for the daily shop
  return shuffled.slice(0, 4);
}
