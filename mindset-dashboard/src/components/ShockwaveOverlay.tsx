import React, { useState, useEffect } from 'react';
import './ShockwaveOverlay.css';

interface Shockwave {
  id: number;
  x: number;
  y: number;
  color: string;
}

export const ShockwaveOverlay: React.FC = () => {
  const [shockwaves, setShockwaves] = useState<Shockwave[]>([]);

  useEffect(() => {
    const handleShockwave = (e: CustomEvent) => {
      const newShockwave: Shockwave = {
        id: Date.now() + Math.random(),
        x: e.detail.x,
        y: e.detail.y,
        color: e.detail.color || 'var(--accent-purple)'
      };
      
      setShockwaves(prev => [...prev, newShockwave]);
      
      // Remove it after the animation completes (600ms)
      setTimeout(() => {
        setShockwaves(prev => prev.filter(s => s.id !== newShockwave.id));
      }, 600);
    };

    window.addEventListener('triggerShockwave', handleShockwave as EventListener);
    return () => window.removeEventListener('triggerShockwave', handleShockwave as EventListener);
  }, []);

  if (shockwaves.length === 0) return null;

  return (
    <div className="shockwave-overlay">
      {shockwaves.map(wave => (
        <div 
          key={wave.id} 
          className="shockwave"
          style={{
            left: `${wave.x}px`,
            top: `${wave.y}px`,
            color: wave.color
          }}
        />
      ))}
    </div>
  );
};
