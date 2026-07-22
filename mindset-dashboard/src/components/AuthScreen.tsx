import React, { useState } from 'react';
import { api } from '../services/api';
import './AuthScreen.css';
import { Brain, ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';

export const AuthScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // 2FA State
  const [is2FAPending, setIs2FAPending] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  
  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (is2FAPending) {
        const res = await api.post('/auth/verify-2fa', { email, code: verificationCode });
        localStorage.setItem('mindset_token', res.access_token);
        localStorage.setItem('mindset_user_name', res.user?.first_name || 'User');
        await api.downloadCloudState();
        localStorage.setItem('hasCompletedOnboarding', 'true');
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
        // Fallback pour ancien backend
        if (res.access_token) {
          localStorage.setItem('mindset_token', res.access_token);
          localStorage.setItem('mindset_user_name', res.user?.first_name || 'User');
          await api.downloadCloudState();
          localStorage.setItem('hasCompletedOnboarding', 'true');
          onComplete();
        }
      } else {
        await api.post('/auth/register', { 
          email, 
          password, 
          first_name: firstName, 
          last_name: lastName, 
          phone_number: phone 
        });
        
        // Auto login after register
        const res = await api.post('/auth/login', { email, password });
        if (res.requires2FA) {
          setIs2FAPending(true);
          setLoading(false);
          return;
        }
        if (res.access_token) {
          localStorage.setItem('mindset_token', res.access_token);
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
        <h1>mindora</h1>
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
        
        {!isLogin && (
          <input 
            type="tel" 
            placeholder="Téléphone (ex: +33612345678)" 
            required 
            value={phone} 
            onChange={e => setPhone(e.target.value)} 
          />
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
