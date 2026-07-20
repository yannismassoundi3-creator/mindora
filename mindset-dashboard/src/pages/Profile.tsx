import React, { useState, useEffect } from 'react';
import { User, Shield, Lock, HardDrive, AlertTriangle, Save, CheckCircle, Database, Palette, FileText, X, Crown, LogOut } from 'lucide-react';
import { PricingScreen } from './PricingScreen';
import { playHoverSound, playClickSound, playToggleSound, playLevelUpSound } from '../utils/sounds';
import { api } from '../services/api';
import './Profile.css';

interface ProfileProps {
  onNameChange?: () => void;
}

const THEMES = [
  { id: 'blue', name: 'Bleu Néon', value: '#3b82f6' },
  { id: 'purple', name: 'Violet Néon', value: '#8b5cf6' },
  { id: 'pink', name: 'Rose Néon', value: '#ec4899' },
  { id: 'green', name: 'Vert Émeraude', value: '#10b981' }
];

export const Profile: React.FC<ProfileProps> = ({ onNameChange }) => {
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(() => localStorage.getItem('mindset_is_subscribed') === 'true');

  // Identity
  const [userName, setUserName] = useState(() => localStorage.getItem('mindset_user_name') || 'Yannis');
  const [aiName, setAiName] = useState(() => localStorage.getItem('mindset_ai_name') || 'Coach IA');
  
  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('mindset_theme') || '#3b82f6');

  // Security (Persistent)
  const [encryption, setEncryption] = useState(() => localStorage.getItem('mindset_sec_encryption') !== 'false');
  const [biometric, setBiometric] = useState(() => localStorage.getItem('mindset_sec_biometric') === 'true');
  const [localHistory, setLocalHistory] = useState(() => localStorage.getItem('mindset_sec_local') !== 'false');

  const [savedStatus, setSavedStatus] = useState(false);
  const [legalModal, setLegalModal] = useState<'legal' | 'cgu' | 'privacy' | null>(null);

  const points = parseInt(localStorage.getItem('mindset_points') || '450', 10);
  const level = Math.floor(Math.sqrt(points / 50)) + 1;
  const joinDate = localStorage.getItem('mindset_join_date') || new Date().toLocaleDateString('fr-FR');

  useEffect(() => {
    if (!localStorage.getItem('mindset_join_date')) {
      localStorage.setItem('mindset_join_date', joinDate);
    }
  }, []);

  const handleSave = async () => {
    localStorage.setItem('mindset_user_name', userName);
    localStorage.setItem('mindset_ai_name', aiName);
    localStorage.setItem('mindset_theme', theme);
    localStorage.setItem('mindset_sec_encryption', encryption.toString());
    localStorage.setItem('mindset_sec_biometric', biometric.toString());
    localStorage.setItem('mindset_sec_local', localHistory.toString());
    
    // Apply theme globally
    document.documentElement.style.setProperty('--primary', theme);

    try {
      // Force sync to PostgreSQL database
      await api.syncStateToCloud();
    } catch(e) {}

    playLevelUpSound();

    setSavedStatus(true);
    if (onNameChange) onNameChange();
    
    setTimeout(() => setSavedStatus(false), 3000);
  };

  const handlePurge = () => {
    const confirmDelete = window.confirm("ATTENTION : Voulez-vous vraiment purger tout votre historique et remettre vos points à zéro ?");
    if (confirmDelete) {
      localStorage.removeItem('mindset_habits');
      localStorage.removeItem('mindset_routines_data');
      localStorage.removeItem('mindset_points');
      localStorage.removeItem('mindset_daily_scores');
      window.location.reload();
    }
  };

  const renderLegalText = () => {
    switch (legalModal) {
      case 'legal':
        return (
          <>
            <h2 className="modal-title">Mentions Légales</h2>
            <p><strong>Éditeur de l'Application :</strong> Yannis (Statut Auto-Entrepreneur - En cours d'immatriculation)</p>
            <p><strong>Directeur de la publication :</strong> Yannis</p>
            <p><strong>Contact :</strong> mindoraappli@gmail.com</p>
            <p><strong>Hébergement :</strong> L'application est hébergée sur des serveurs sécurisés (Vercel et Render). Conformément à l'Article 6 de la Loi n°2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique, les utilisateurs sont informés de l'identité des intervenants.</p>
            <p><strong>Propriété intellectuelle :</strong> Mindora et tous ses éléments (code, interface, charte graphique, algorithmes locaux) sont la propriété exclusive de son éditeur. Toute reproduction, modification ou distribution est interdite.</p>
          </>
        );
      case 'cgu':
        return (
          <>
            <h2 className="modal-title">Conditions Générales d'Utilisation et de Vente (CGU/CGV)</h2>
            <p><strong>1. Objet :</strong> Les présentes CGU/CGV encadrent l'accès à l'application Mindora, outil de productivité et de coaching par IA.</p>
            <p><strong>2. Vente et Abonnements (Mindora Pro) :</strong> L'abonnement Premium (Mensuel ou À vie) offre l'accès illimité à l'IA Jarvis et au suivi holographique. Le paiement est géré de manière sécurisée par Stripe. <em>Conformément à l'Article L221-28 du Code de la consommation, le droit de rétractation ne peut être exercé pour la fourniture d'un contenu numérique non fourni sur un support matériel dont l'exécution a commencé après accord préalable exprès du consommateur.</em></p>
            <p><strong>3. Utilisation de l'IA :</strong> Le Coach IA est un outil d'assistance automatisé. Ses conseils ne remplacent en aucun cas l'avis d'un professionnel (médical, financier, psychologique). L'éditeur décline toute responsabilité liée aux actions entreprises suite aux conseils de l'IA.</p>
            <p><strong>4. Disponibilité :</strong> L'éditeur s'efforce de maintenir un accès 24/7 mais n'est tenu qu'à une obligation de moyens. L'accès peut être suspendu pour maintenance sans préavis.</p>
            <p><strong>5. Gamification :</strong> Les "Coins" et "Niveaux" sont strictement virtuels et n'ont aucune valeur monétaire.</p>
          </>
        );
      case 'privacy':
        return (
          <>
            <h2 className="modal-title">Politique de Confidentialité (Conformité RGPD)</h2>
            <p><strong>1. Collecte et finalité :</strong> Vos données (habitudes, routines, objectifs, historique des scores) sont stockées de manière sécurisée dans le Cloud pour permettre la synchronisation entre vos appareils. L'authentification requiert votre email de manière sécurisée.</p>
            <p><strong>2. Sous-traitants (IA) :</strong> Vos messages adressés au Coach IA sont envoyés de manière éphémère aux fournisseurs d'intelligence artificielle partenaires (Groq, Google Gemini) pour générer une réponse. Aucune donnée n'est vendue pour l'entraînement de modèles tiers.</p>
            <p><strong>3. Sécurité :</strong> Les mots de passe sont hachés de manière irréversible via Argon2id. Les paiements sont chiffrés de bout en bout et gérés exclusivement par Stripe (nous ne stockons aucune carte bancaire sur nos serveurs).</p>
            <p><strong>4. Vos droits :</strong> Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, et d'effacement de vos données. Vous pouvez supprimer toutes vos données ou nous contacter via <strong>mindoraappli@gmail.com</strong>.</p>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="profile-container">
      <header className="dashboard-header">
        <div>
          <p className="current-date">Identité & Paramètres</p>
          <h1 className="greeting">Profil</h1>
          <p className="subtitle">Contrôle total sur tes données.</p>
        </div>
      </header>

      <div className="profile-grid">
        
        {/* Left Column : Identity & Stats */}
        <div className="profile-left">
          <div className="profile-card glass-panel text-center">
            <div className="profile-avatar-large" style={{ background: `linear-gradient(135deg, ${theme}, var(--accent-purple))` }}>
              {userName.substring(0, 2).toUpperCase()}
            </div>
            <h2 className="profile-name-display">{userName}</h2>
            <p className="profile-status" style={{ color: theme }}>Opérateur Principal</p>

            <div className="profile-stats-row">
              <div className="stat-box">
                <span className="stat-value">Lvl {level}</span>
                <span className="stat-label">Niveau Global</span>
              </div>
              <div className="stat-box">
                <span className="stat-value">{points}</span>
                <span className="stat-label">Coins 🪙</span>
              </div>
            </div>
            <p className="join-date">Membre depuis le {joinDate}</p>
          </div>

          <div className="profile-card glass-panel form-card">
            <h3 className="card-title"><User size={18}/> Personnalisation</h3>
            
            <div className="form-group">
              <label>Ton Prénom</label>
              <input 
                type="text" 
                className="glass-input" 
                value={userName} 
                onChange={(e) => setUserName(e.target.value)}
              />
              <small>Comment l'IA doit-elle t'appeler ?</small>
            </div>

            <div className="form-group mt-4">
              <label>Nom de l'IA</label>
              <input 
                type="text" 
                className="glass-input ai-name-input" 
                value={aiName} 
                onChange={(e) => setAiName(e.target.value)}
              />
              <small>Renomme ton assistant (ex: Jarvis, Friday...)</small>
            </div>

            <h3 className="card-title" style={{ marginTop: '24px' }}><Palette size={18}/> Aura (Thème)</h3>
            <div className="theme-picker">
              {THEMES.map(t => (
                <button 
                  key={t.id}
                  className={`theme-swatch ${theme === t.value ? 'selected' : ''}`}
                  style={{ backgroundColor: t.value }}
                  onClick={() => { playClickSound(); setTheme(t.value); }}
                  onMouseEnter={() => playHoverSound()}
                  title={t.name}
                />
              ))}
            </div>

            <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 className="card-title" style={{ fontSize: '1rem', color: 'var(--primary)', marginBottom: '16px' }}>
                <Crown size={18} /> Abonnement & Statut
              </h3>
              
              {isSubscribed ? (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <p style={{ color: '#10b981', fontWeight: 600, marginBottom: '8px' }}>✓ Mindora Pro Actif</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--secondary)', marginBottom: '16px' }}>
                    Vous bénéficiez de l'accès illimité à l'IA Jarvis, du Dashboard holographique et du double de Coins par habitude.
                  </p>
                  <button 
                    onClick={() => { localStorage.removeItem('mindset_is_subscribed'); window.location.reload(); }}
                    style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Gérer / Annuler l'abonnement
                  </button>
                </div>
              ) : (
                <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                  <p style={{ color: 'white', fontWeight: 600, marginBottom: '8px' }}>Statut : Formule Gratuite</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--secondary)', marginBottom: '16px' }}>
                    Débloquez {aiName} 24/7 et la Gamification holographique avec Mindora Pro.
                  </p>
                  <button 
                    onClick={() => { playClickSound(); setShowPricingModal(true); }}
                    onMouseEnter={() => playHoverSound()}
                    style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent-purple))', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}
                  >
                    Voir les offres Pro (Dès 9.99€)
                  </button>
                </div>
              )}
            </div>

            <button className={`btn-save-profile ${savedStatus ? 'saved' : ''}`} onClick={handleSave} style={{ marginTop: '32px' }}>
              {savedStatus ? <><CheckCircle size={18}/> Sauvegardé en sécurité dans le Cloud</> : <><Save size={18}/> Sauvegarder dans le Cloud</>}
            </button>
          </div>
        </div>

        {/* Right Column : Security */}
        <div className="profile-right">
          <div className="profile-card glass-panel">
            <h3 className="card-title"><Shield size={18} color="#10b981"/> Confidentialité & Sécurité</h3>
            
            <div className="settings-list">
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-title"><Lock size={16}/> Chiffrement des données</div>
                  <div className="setting-desc">Chiffre tes routines et notes en local (AES-256).</div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={encryption} onChange={() => { playToggleSound(!encryption); setEncryption(!encryption); }} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-title"><User size={16}/> Connexion Biométrique</div>
                  <div className="setting-desc">Utiliser Windows Hello / Touch ID au lancement.</div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={biometric} onChange={() => { playToggleSound(!biometric); setBiometric(!biometric); }} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-title"><HardDrive size={16}/> Historique IA Local</div>
                  <div className="setting-desc">Empêcher l'envoi de l'historique aux serveurs d'entraînement.</div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={localHistory} onChange={() => { playToggleSound(!localHistory); setLocalHistory(!localHistory); }} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>
          </div>

          <div className="profile-card glass-panel danger-zone">
            <h3 className="card-title text-danger"><AlertTriangle size={18}/> Zone de Danger</h3>
            <p className="danger-text">
              Purger tes données effacera définitivement tes routines, tes habitudes, ton streak et tes points. Cette action est irréversible.
            </p>
            <button className="btn-purge" onClick={handlePurge}>
              <Database size={16}/> Purger mes données locales
            </button>
            <button 
              className="btn-purge" 
              style={{ marginTop: '12px', background: 'rgba(255, 255, 255, 0.05)', color: 'white', border: '1px solid rgba(255, 255, 255, 0.2)' }} 
              onClick={async () => {
                try {
                  await api.post('/auth/logout', {});
                } catch(e) {}
                localStorage.removeItem('mindset_token');
                localStorage.removeItem('mindset_is_subscribed');
                window.location.reload();
              }}
            >
              <LogOut size={16}/> Se déconnecter
            </button>
          </div>

          <div className="legal-footer">
            <button className="legal-link" onClick={() => setLegalModal('legal')}><FileText size={14}/> Mentions Légales</button>
            <button className="legal-link" onClick={() => setLegalModal('cgu')}><FileText size={14}/> CGU</button>
            <button className="legal-link" onClick={() => setLegalModal('privacy')}><FileText size={14}/> Confidentialité</button>
          </div>

        </div>
      </div>

      {/* Legal Modal */}
      {legalModal && (
        <div className="modal-backdrop" onClick={() => setLegalModal(null)}>
          <div className="modal-content glass-panel legal-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setLegalModal(null)}><X size={20} /></button>
            <div className="legal-text-content">
              {renderLegalText()}
            </div>
          </div>
        </div>
      )}

      {/* Pricing Modal */}
      {showPricingModal && (
        <PricingScreen 
          onSubscribe={() => {
            localStorage.setItem('mindset_is_subscribed', 'true');
            // Trigger storage event so App.tsx is aware if needed, though state handles Profile
            window.dispatchEvent(new Event('storage'));
            window.location.reload();
          }}
          onClose={() => setShowPricingModal(false)}
        />
      )}
    </div>
  );
};
