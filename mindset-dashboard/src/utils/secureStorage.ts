/**
 * secureStorage.ts
 * Implements a simple HMAC-like signature to prevent users from manually modifying points in localStorage.
 */

// A simple hash function for strings
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

const SALT = 'm1nd53t_s3cr3t_2026';

function generateSignature(value: number): string {
  return simpleHash(`${value}_${SALT}`);
}

export const getSecurePoints = (): number => {
  const storedPoints = localStorage.getItem('mindset_points');
  const storedSignature = localStorage.getItem('mindset_points_signature');
  
  if (!storedPoints) return 0; // Default points

  const parsedPoints = parseInt(storedPoints, 10);
  if (isNaN(parsedPoints)) return 0;

  const expectedSignature = generateSignature(parsedPoints);

  // If there's no signature (old users transitioning to the new system)
  // or if the signature is valid, accept it. But if there's a signature and it's invalid, punish!
  if (storedSignature && storedSignature !== expectedSignature) {
    console.warn('⚠️ Anti-Cheat Triggered: Invalid points signature detected! Resetting points to 0.');
    setSecurePoints(0);
    return 0;
  }

  // If there's no signature at all, we sign their current points to migrate them smoothly
  if (!storedSignature) {
    setSecurePoints(parsedPoints);
  }

  return parsedPoints;
};

export const setSecurePoints = (points: number): void => {
  localStorage.setItem('mindset_points', points.toString());
  localStorage.setItem('mindset_points_signature', generateSignature(points));
  
  // Dispatch a custom event so other components (like Layout) can update immediately
  window.dispatchEvent(new Event('mindset_points_updated'));
};

export const addSecurePoints = (amount: number): number => {
  const current = getSecurePoints();
  const newPoints = current + amount;
  setSecurePoints(newPoints);
  return newPoints;
};

export const removeSecurePoints = (): void => {
  localStorage.removeItem('mindset_points');
  localStorage.removeItem('mindset_points_signature');
  window.dispatchEvent(new Event('mindset_points_updated'));
};
