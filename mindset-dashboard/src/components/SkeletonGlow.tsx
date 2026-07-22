import React from 'react';
import './SkeletonGlow.css';

export const SkeletonGlow: React.FC<{ rows?: number }> = ({ rows = 3 }) => {
  return (
    <div className="skeleton-container">
      <div className="skeleton-header"></div>
      <div className="skeleton-card skeleton-main"></div>
      <div className="skeleton-list">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton-item"></div>
        ))}
      </div>
    </div>
  );
};
