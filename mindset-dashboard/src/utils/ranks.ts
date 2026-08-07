export interface Rank {
  name: string;
  color: string;
  icon: string;
  minLevel: number;
}

export const RANKS: Rank[] = [
  { name: 'Novice', color: '#94a3b8', icon: '⚪', minLevel: 1 },
  { name: 'Initié', color: '#cd7f32', icon: '🥉', minLevel: 10 },
  { name: 'Discipliné', color: '#e2e8f0', icon: '🥈', minLevel: 20 },
  { name: 'Élite', color: '#fbbf24', icon: '🥇', minLevel: 30 },
  { name: 'Maître', color: '#3b82f6', icon: '💎', minLevel: 50 },
  { name: 'Légende', color: '#8b5cf6', icon: '👑', minLevel: 100 },
];

export function getRankForLevel(level: number): Rank {
  let currentRank = RANKS[0];
  for (const rank of RANKS) {
    if (level >= rank.minLevel) {
      currentRank = rank;
    } else {
      break;
    }
  }
  return currentRank;
}
