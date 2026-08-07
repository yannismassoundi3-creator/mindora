import React from 'react';
import { Circle, Target, Shield, Hexagon, Gem, Crown } from 'lucide-react';

interface RankIconProps {
  iconName: string;
  size?: number;
  color?: string;
  className?: string;
}

export const RankIcon: React.FC<RankIconProps> = ({ iconName, size = 24, color = 'currentColor', className = '' }) => {
  switch (iconName) {
    case 'Circle': return <Circle size={size} color={color} className={className} />;
    case 'Target': return <Target size={size} color={color} className={className} />;
    case 'Shield': return <Shield size={size} color={color} className={className} />;
    case 'Hexagon': return <Hexagon size={size} color={color} className={className} />;
    case 'Gem': return <Gem size={size} color={color} className={className} />;
    case 'Crown': return <Crown size={size} color={color} className={className} />;
    default: return <Circle size={size} color={color} className={className} />;
  }
};
