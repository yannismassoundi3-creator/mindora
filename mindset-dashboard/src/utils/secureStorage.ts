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

/**
 * La valeur en cours d'écriture, le temps que sa signature la rejoigne.
 *
 * Un solde tient en **deux** entrées de stockage, écrites l'une après l'autre. Entre
 * les deux instructions, la paire est incohérente : la nouvelle valeur porte encore
 * l'ancienne signature. Cet intervalle n'a longtemps existé pour personne — jusqu'à
 * ce que la surcharge de `localStorage.setItem` (`services/api.ts`) se mette à
 * reconstruire tout l'état local à chaque écriture pour en calculer l'empreinte. Ce
 * calcul relit les soldes, donc il tombe **exactement** dans l'intervalle, y trouve
 * une signature qui ne correspond pas, et déclenche l'anti-triche contre
 * l'application elle-même.
 *
 * Mesuré avant correction : valider une habitude faisait passer un compte de 500
 * coins et 500 XP à **zéro**, en émettant près de six mille alertes d'anti-triche —
 * puis le zéro remontait au serveur et redescendait sur les autres appareils.
 *
 * Tant qu'une écriture est en cours, la lecture rend donc la valeur qu'on est en
 * train de poser, sans consulter une signature qu'on sait périmée. L'anti-triche
 * garde tout son mordant : il ne juge plus que les valeurs venues d'ailleurs, ce qui
 * est précisément ce qu'il devait surveiller.
 */
let ecritureEnCours: number | null = null;

export const getSecurePoints = (): number => {
  if (ecritureEnCours !== null) return ecritureEnCours;

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
  // `finally` et non une simple remise à zéro : si une écriture lève — stockage
  // plein, mode privé —, laisser le drapeau posé ferait rendre à toutes les
  // lectures suivantes une valeur qui n'a jamais été enregistrée.
  ecritureEnCours = points;
  try {
    localStorage.setItem('mindset_points', points.toString());
    localStorage.setItem('mindset_points_signature', generateSignature(points));
  } finally {
    ecritureEnCours = null;
  }

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
