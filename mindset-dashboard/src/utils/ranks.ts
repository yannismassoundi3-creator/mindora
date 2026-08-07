export interface Rank {
  name: string;
  color: string;
  icon: string;
  minLevel: number;
  cssClass?: string;
}

export const RANKS: Rank[] = [
  { name: 'Novice', color: '#94a3b8', icon: '⚪', minLevel: 1, cssClass: 'rank-novice' },
  { name: 'Initié', color: '#cd7f32', icon: '🥉', minLevel: 10, cssClass: 'rank-initie' },
  { name: 'Discipliné', color: '#e2e8f0', icon: '🥈', minLevel: 20, cssClass: 'rank-discipline' },
  { name: 'Élite', color: '#fbbf24', icon: '🥇', minLevel: 30, cssClass: 'rank-elite' },
  { name: 'Maître', color: '#3b82f6', icon: '💎', minLevel: 50, cssClass: 'rank-maitre' },
  { name: 'Légende', color: '#8b5cf6', icon: '👑', minLevel: 100, cssClass: 'rank-legende' },
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
