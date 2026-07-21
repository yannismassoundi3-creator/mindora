import React, { useState } from 'react';
import { api } from '../services/api';
import './AuthScreen.css';
import { Brain, ArrowRight, Eye, EyeOff } from 'lucide-react';

export const AuthScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
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
      if (isLogin) {
        const res = await api.post('/auth/login', { email, password });
        localStorage.setItem('mindset_token', res.access_token);
        localStorage.setItem('mindset_user_name', res.user?.first_name || 'User');
        if (res.has_ai_profile) {
          localStorage.setItem('hasCompletedOnboarding', 'true');
        } else {
          localStorage.removeItem('hasCompletedOnboarding');
        }
        await api.downloadCloudState();
        onComplete();
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
        localStorage.setItem('mindset_token', res.access_token);
        localStorage.setItem('mindset_user_name', firstName);
        localStorage.removeItem('hasCompletedOnboarding');
        await api.downloadCloudState();
        onComplete();
      }
    } catch (err: any) {
      // Custom friendly error messages
      let msg = err.message || 'Une erreur est survenue';
      if (msg.includes('Identifiants')) msg = "Adresse e-mail ou mot de passe incorrect.";
      if (msg.includes('déjà utilisé')) msg = "Cette adresse e-mail ou ce numéro est déjà utilisé.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

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
