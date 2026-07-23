import React, { useState, useEffect } from 'react';
import { Lock, Fingerprint, ScanFace } from 'lucide-react';
import { base64urlToBuffer } from '../utils/webauthn';
import './LockScreen.css';

interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [error, setError] = useState<string | null>(null);

  const attemptUnlock = async () => {
    setError(null);
    try {
      const storedIdStr = localStorage.getItem('mindset_biometric_id');
      if (!storedIdStr) {
        onUnlock(); // No lock configured
        return;
      }

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const credentialId = base64urlToBuffer(storedIdStr);

      await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: credentialId,
            type: 'public-key'
          }],
          userVerification: "required"
        }
      });

      // Si pas d'erreur, c'est réussi
      onUnlock();
    } catch (err) {
      console.error("Unlock failed", err);
      setError("Authentification échouée ou annulée.");
    }
  };

  useEffect(() => {
    // Tenter de déverrouiller automatiquement au montage si on est sur mobile
    // ou laisser l'utilisateur cliquer. On va l'encourager à cliquer pour éviter les blocages.
  }, []);

  return (
    <div className="lockscreen-container">
      <div className="lockscreen-content glass-panel">
        <div className="lock-icon-wrapper pulse-glow">
          <Lock size={48} className="lock-icon" />
        </div>
        <h1 className="lock-title">Mindora</h1>
        <p className="lock-subtitle">Application verrouillée</p>
        
        {error && <p className="lock-error">{error}</p>}

        <button className="btn-primary unlock-btn" onClick={attemptUnlock}>
          <Fingerprint size={20} />
          Déverrouiller
        </button>
      </div>
    </div>
  );
};
