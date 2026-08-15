export interface Cosmetic {
  id: string;
  title: string;
  description: string;
  cost: number;
  type: 'color' | 'icon' | 'app_theme';
  value: string; // CSS color, Icon name, or CSS class name
  rarity: Rarete;
}

export type Rarete = 'commun' | 'rare' | 'epique' | 'legendaire';

/**
 * Le nom de la rareté tel qu'on l'écrit à l'écran.
 *
 * La valeur de `rarity` faisait les deux métiers à la fois : classe CSS de la carte
 * (`.cosmetic-card.epique`) **et** texte du badge. Elle ne pouvait donc pas porter
 * d'accent, et la Boutique affichait « EPIQUE » et « LEGENDAIRE » à côté de titres
 * soignés comme « Émeraude » ou « Énergie Sith ». Le slug reste le slug, le libellé
 * devient une donnée à part.
 */
export const RARETE_LISIBLE: Record<Rarete, string> = {
  commun: 'Commun',
  rare: 'Rare',
  epique: 'Épique',
  legendaire: 'Légendaire',
};

export const AI_COSMETICS: Cosmetic[] = [
  // Couleurs
  { id: 'c_gold', title: 'Aura Dorée', description: 'Une prestance royale pour ton IA.', cost: 500, type: 'color', value: 'linear-gradient(135deg, #fbbf24, #d97706)', rarity: 'rare' },
  { id: 'c_sith', title: 'Énergie Sith', description: 'La puissance du côté obscur.', cost: 600, type: 'color', value: 'linear-gradient(135deg, #ef4444, #991b1b)', rarity: 'rare' },
  { id: 'c_dark', title: 'Matière Noire', description: 'Une IA sombre et minimaliste.', cost: 800, type: 'color', value: 'linear-gradient(135deg, #1f2937, #030712)', rarity: 'epique' },
  { id: 'c_cyber', title: 'Cyberpunk', description: 'Néon rose et bleu.', cost: 1000, type: 'color', value: 'linear-gradient(135deg, #ec4899, #8b5cf6)', rarity: 'epique' },
  { id: 'c_emerald', title: 'Émeraude', description: 'La sagesse de la nature.', cost: 400, type: 'color', value: 'linear-gradient(135deg, #10b981, #047857)', rarity: 'commun' },
  
  // Icônes
  { id: 'i_robot', title: 'Mecha-Jarvis', description: 'Un visage robotique classique.', cost: 1500, type: 'icon', value: '🤖', rarity: 'epique' },
  { id: 'i_ghost', title: 'Spectre', description: 'Une IA fantomatique.', cost: 1200, type: 'icon', value: '👻', rarity: 'rare' },
  { id: 'i_ninja', title: 'Sensei', description: 'L\'art de la discipline.', cost: 2000, type: 'icon', value: '🥷', rarity: 'legendaire' },
  { id: 'i_alien', title: 'Visiteur', description: 'Une intelligence venue d\'ailleurs.', cost: 1800, type: 'icon', value: '👽', rarity: 'epique' },
  { id: 'i_brain', title: 'Cerveau Galactique', description: 'La pureté intellectuelle.', cost: 2500, type: 'icon', value: '🧠', rarity: 'legendaire' },
  { id: 'i_fire', title: 'Démon du Feu', description: 'Une motivation brûlante.', cost: 3000, type: 'icon', value: '🔥', rarity: 'legendaire' },
  { id: 'i_princess', title: 'Princesse IA', description: 'Royauté numérique.', cost: 2200, type: 'icon', value: '👸', rarity: 'epique' },
  { id: 'i_king', title: 'Roi des Algorithmes', description: 'Pour dominer tes objectifs.', cost: 2800, type: 'icon', value: '🤴', rarity: 'legendaire' },
  { id: 'i_knight', title: 'Chevalier Noir', description: 'Protège tes habitudes.', cost: 1600, type: 'icon', value: '🛡️', rarity: 'rare' },
  { id: 'i_hacker', title: 'Cyber-Hacker', description: 'Accès non autorisé.', cost: 1900, type: 'icon', value: '💻', rarity: 'epique' },
  { id: 'i_mage', title: 'Grand Mage', description: 'Maîtrise les arcanes du code.', cost: 2400, type: 'icon', value: '🧙', rarity: 'legendaire' },
  { id: 'i_demon', title: 'Oni', description: 'La fureur d\'atteindre tes buts.', cost: 2600, type: 'icon', value: '👹', rarity: 'legendaire' },

  // Thèmes d'application
  { id: 't_cyberpunk', title: 'Thème Cyberpunk', description: 'Bleu Néon et Noir Absolu.', cost: 1500, type: 'app_theme', value: 'theme-cyberpunk', rarity: 'epique' },
  { id: 't_matrix', title: 'Thème Matrix', description: 'Vert Code et Hacker.', cost: 1200, type: 'app_theme', value: 'theme-matrix', rarity: 'rare' },
  { id: 't_synthwave', title: 'Thème Synthwave', description: 'Violet Rétro et Coucher de Soleil.', cost: 1800, type: 'app_theme', value: 'theme-synthwave', rarity: 'epique' },
  { id: 't_deepspace', title: 'Thème Deep Space', description: 'Bleu Nuit Profond et Argent.', cost: 2000, type: 'app_theme', value: 'theme-deepspace', rarity: 'legendaire' },
  { id: 't_monolight', title: 'Monochrome Light', description: 'Blanc pur, écriture noire.', cost: 1200, type: 'app_theme', value: 'theme-monochrome-light', rarity: 'rare' },
  { id: 't_monodark', title: 'Monochrome Dark', description: 'Noir absolu, écriture blanche.', cost: 1200, type: 'app_theme', value: 'theme-monochrome-dark', rarity: 'rare' },
  { id: 't_gold', title: 'Prestige Or', description: 'Onyx et éclats dorés.', cost: 2500, type: 'app_theme', value: 'theme-gold', rarity: 'legendaire' },
  { id: 't_inferno', title: 'Inferno', description: 'Magma, Lave et Noir Profond.', cost: 2500, type: 'app_theme', value: 'theme-inferno', rarity: 'legendaire' }
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

  // Return 6 items for the daily shop
  return shuffled.slice(0, 6);
}
