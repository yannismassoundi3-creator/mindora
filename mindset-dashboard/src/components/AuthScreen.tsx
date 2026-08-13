import React, { useState, useEffect } from 'react';
import { api, memoriserSession } from '../services/api';
import './AuthScreen.css';
import { Brain, ArrowRight, Eye, EyeOff, ShieldCheck, KeyRound } from 'lucide-react';

/**
 * Note le questionnaire d'inscription comme fait, ou pas, d'après le serveur.
 *
 * Ce drapeau était posé à « true » à chaque connexion, sans rien demander à
 * personne. Or l'inscription passe par le 2FA : on créait le compte, le code
 * arrivait par e-mail, et la validation du code marquait l'onboarding comme
 * terminé — donc plus jamais de questions. Le coach possède tout un mécanisme
 * pour relire ce profil à chaque message ; il lisait une table vide.
 *
 * `has_ai_profile` vient de la base : c'est le seul juge de « est-ce qu'on lui a
 * déjà posé les questions ». Absent d'une réponse (vieux backend), on ne touche à
 * rien : App.tsx corrigera au premier /auth/me.
 */
function memoriserOnboarding(aUnProfil: boolean | undefined) {
  if (aUnProfil === undefined) return;
  if (aUnProfil) localStorage.setItem('hasCompletedOnboarding', 'true');
  else localStorage.removeItem('hasCompletedOnboarding');
}

export const AuthScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 2FA State
  const [is2FAPending, setIs2FAPending] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');

  // Forgot / Reset password state
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset_token');
    if (token) {
      setResetToken(token);
      setShowReset(true);
    }
  }, []);

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      setForgotSubmitted(true);
    } catch (err: any) {
      // Message générique dans tous les cas (le backend ne révèle jamais si l'email existe)
      setForgotSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token: resetToken, newPassword });
      setResetSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Lien invalide ou expiré. Redemande un e-mail de réinitialisation.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (is2FAPending) {
        const res = await api.post('/auth/verify-2fa', { email, code: verificationCode });
        memoriserSession(res);
        localStorage.setItem('mindset_user_name', res.user?.first_name || 'User');
        await api.downloadCloudState();
        memoriserOnboarding(res.has_ai_profile);
        onComplete();
        return;
      }

      if (isLogin) {
        const res = await api.post('/auth/login', { email, password });
        if (res.requires2FA) {
          setIs2FAPending(true);
          setLoading(false);
          return;
        }
        // Chemin sans 2FA (dev, ou compte dont le second facteur est désactivé)
        if (res.access_token) {
          memoriserSession(res);
          localStorage.setItem('mindset_user_name', res.user?.first_name || 'User');
          await api.downloadCloudState();
          memoriserOnboarding(res.has_ai_profile);
          onComplete();
        }
      } else {
        await api.post('/auth/register', { 
          email, 
          password, 
          first_name: firstName, 
          last_name: lastName
        });
        
        // Auto login after register
        const res = await api.post('/auth/login', { email, password });
        if (res.requires2FA) {
          setIs2FAPending(true);
          setLoading(false);
          return;
        }
        if (res.access_token) {
          memoriserSession(res);
          localStorage.setItem('mindset_user_name', firstName);
          localStorage.removeItem('hasCompletedOnboarding');
          await api.downloadCloudState();
          onComplete();
        }
      }
    } catch (err: any) {
      // Custom friendly error messages
      let msg = err.message || 'Une erreur est survenue';
      if (msg.includes('Identifiants')) msg = "Adresse e-mail ou mot de passe incorrect.";
      if (msg.includes('déjà utilisé')) msg = "Cette adresse e-mail ou ce numéro est déjà utilisé.";
      if (msg.includes('2FA invalide')) msg = "Code de sécurité incorrect ou expiré.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (showReset) {
    if (resetSuccess) {
      return (
        <div className="auth-container glass-panel">
          <div className="auth-logo">
            <ShieldCheck size={48} className="text-primary pulse" />
            <h1>C'est fait !</h1>
          </div>
          <p className="auth-subtitle">Ton mot de passe a été réinitialisé. Tu peux maintenant te connecter.</p>
          <button
            className="auth-submit-btn"
            style={{ marginTop: '20px' }}
            onClick={() => {
              window.history.replaceState({}, '', window.location.pathname);
              setShowReset(false);
              setResetSuccess(false);
              setResetToken('');
            }}
          >
            Retour à la connexion
            <ArrowRight size={20} />
          </button>
        </div>
      );
    }

    return (
      <div className="auth-container glass-panel">
        <div className="auth-logo">
          <KeyRound size={48} className="text-primary pulse" />
          <h1>Nouveau mot de passe</h1>
        </div>
        <p className="auth-subtitle">Choisis un nouveau mot de passe pour ton compte.</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleResetSubmit} className="auth-form" style={{ marginTop: '20px' }}>
          <input
            type="password"
            placeholder="Nouveau mot de passe"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
          <input
            type="password"
            placeholder="Confirmer le mot de passe"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
          <button type="submit" className="auth-submit-btn" disabled={loading} style={{ marginTop: '20px' }}>
            {loading ? 'Réinitialisation...' : 'Valider le nouveau mot de passe'}
            <ArrowRight size={20} />
          </button>
        </form>

        <button
          className="auth-switch-btn"
          onClick={() => {
            window.history.replaceState({}, '', window.location.pathname);
            setShowReset(false);
            setError('');
          }}
        >
          Annuler et retourner à la connexion
        </button>
      </div>
    );
  }

  if (showForgot) {
    if (forgotSubmitted) {
      return (
        <div className="auth-container glass-panel">
          <div className="auth-logo">
            <KeyRound size={48} className="text-primary pulse" />
            <h1>E-mail envoyé</h1>
          </div>
          <p className="auth-subtitle">
            Si un compte existe avec l'adresse <strong>{forgotEmail}</strong>, un lien de réinitialisation vient de lui être envoyé. Vérifie ta boîte mail (et tes spams).
          </p>
          <button
            className="auth-submit-btn"
            style={{ marginTop: '20px' }}
            onClick={() => { setShowForgot(false); setForgotSubmitted(false); setForgotEmail(''); }}
          >
            Retour à la connexion
            <ArrowRight size={20} />
          </button>
        </div>
      );
    }

    return (
      <div className="auth-container glass-panel">
        <div className="auth-logo">
          <KeyRound size={48} className="text-primary pulse" />
          <h1>Mot de passe oublié</h1>
        </div>
        <p className="auth-subtitle">Entre ton e-mail, on t'envoie un lien pour le réinitialiser.</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleForgotSubmit} className="auth-form" style={{ marginTop: '20px' }}>
          <input
            type="email"
            placeholder="Adresse e-mail"
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
            required
          />
          <button type="submit" className="auth-submit-btn" disabled={loading} style={{ marginTop: '20px' }}>
            {loading ? 'Envoi...' : 'Envoyer le lien'}
            <ArrowRight size={20} />
          </button>
        </form>

        <button className="auth-switch-btn" onClick={() => { setShowForgot(false); setError(''); }}>
          Annuler et retourner à la connexion
        </button>
      </div>
    );
  }

  if (is2FAPending) {
    return (
      <div className="auth-container glass-panel" style={{ animation: 'slideInRight 0.4s ease' }}>
        <div className="auth-logo">
          <ShieldCheck size={48} className="text-primary pulse" />
          <h1>Sécurité</h1>
        </div>
        
        <h2>Vérification 2FA</h2>
        <p className="auth-subtitle">
          Un code de sécurité à 6 chiffres a été envoyé à <strong>{email}</strong>.
        </p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form" style={{ marginTop: '20px' }}>
          <input
            type="text"
            placeholder="Code à 6 chiffres"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            required
            maxLength={6}
            style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '8px', fontWeight: 'bold' }}
          />

          <button type="submit" className="auth-submit-btn" disabled={loading} style={{ marginTop: '20px' }}>
            {loading ? 'Vérification...' : 'Valider le code'}
            <ArrowRight size={20} />
          </button>
        </form>

        <button className="auth-switch-btn" onClick={() => { setIs2FAPending(false); setVerificationCode(''); setError(''); }}>
          Annuler et retourner à la connexion
        </button>
      </div>
    );
  }

  return (
    <div className="auth-container glass-panel">
      <div className="auth-logo">
        <Brain size={48} className="text-primary pulse" />
        <h1>disciplix</h1>
      </div>
      
      <h2>{isLogin ? 'Bon retour !' : 'Créer un compte'}</h2>
      <p className="auth-subtitle">
        {isLogin ? 'Connecte-toi pour retrouver ta progression.' : "Commence ta transformation dès aujourd'hui."}
      </p>

      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={handleSubmit} className="auth-form">
        {!isLogin && (
          <div className="form-row">
            <input 
              type="text" 
              placeholder="Prénom" 
              required 
              value={firstName} 
              onChange={e => setFirstName(e.target.value)} 
            />
            <input 
              type="text" 
              placeholder="Nom" 
              required 
              value={lastName} 
              onChange={e => setLastName(e.target.value)} 
            />
          </div>
        )}

          <input
            type="email"
            placeholder="Adresse e-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {isLogin && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'left', marginTop: '-10px', marginLeft: '5px' }}>
              * Attention aux majuscules dans votre email
            </p>
          )}<div className="password-wrapper">
          <input 
            type={showPassword ? "text" : "password"}
            placeholder="Mot de passe" 
            required 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
          />
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>

        {isLogin && (
          <button
            type="button"
            className="auth-switch-btn"
            style={{ textAlign: 'right', alignSelf: 'flex-end', padding: 0, marginTop: '-8px' }}
            onClick={() => { setShowForgot(true); setForgotEmail(email); setError(''); }}
          >
            Mot de passe oublié ?
          </button>
        )}

        <button type="submit" className="auth-submit-btn" disabled={loading}>
          {loading ? 'Chargement...' : (isLogin ? 'Se Connecter' : 'Créer mon compte')}
          <ArrowRight size={20} />
        </button>
      </form>

      <button className="auth-switch-btn" onClick={() => setIsLogin(!isLogin)}>
        {isLogin ? "Pas encore de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
      </button>
    </div>
  );
};
