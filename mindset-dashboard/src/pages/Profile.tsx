import React, { useState, useEffect } from 'react';
import { User, Shield, Lock, HardDrive, AlertTriangle, Save, CheckCircle, Database, Palette, FileText, X, Crown, LogOut, Sparkles } from 'lucide-react';
import { PricingScreen } from './PricingScreen';
import { playHoverSound, playClickSound, playToggleSound, playLevelUpSound } from '../utils/sounds';
import { api } from '../services/api';
import { RankIcon } from '../components/RankIcon';
import { ProgressionRang } from '../components/ProgressionRang';
import { lireProgression } from '../utils/progression';
import { getSecurePoints, removeSecurePoints } from '../utils/secureStorage';
import { bufferToBase64url } from '../utils/webauthn';
import { activerPro, formuleActuelle, type Formule } from '../utils/paiement';
import { oublierLaSession } from '../utils/session';
import './Profile.css';

interface ProfileProps {
  onNameChange?: () => void;
}

const TEXT_COLORS = [
  { id: 'default', name: 'Par Défaut (Thème)', value: 'default' },
  { id: 'white', name: 'Blanc Pur', value: '#ffffff' },
  { id: 'blue', name: 'Bleu Néon', value: '#3b82f6' },
  { id: 'purple', name: 'Violet Néon', value: '#8b5cf6' },
  { id: 'pink', name: 'Rose Néon', value: '#ec4899' },
  { id: 'green', name: 'Vert Émeraude', value: '#10b981' },
  { id: 'orange', name: 'Orange Vif', value: '#f97316' },
  { id: 'silver', name: 'Argent', value: '#e2e8f0' }
];

export const Profile: React.FC<ProfileProps> = ({ onNameChange }) => {
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(() => localStorage.getItem('mindset_is_subscribed') === 'true');
  // Un achat à vie n'a rien à acheter de plus : c'est la seule chose qui décide si le
  // passage à vie doit être proposé ici, seul endroit de l'app où l'offre subsiste
  // pour quelqu'un qui paie déjà.
  const [formule, setFormule] = useState<Formule | null>(() => formuleActuelle());

  // Écrit au démarrage par la réponse de `/auth/me` (voir `App.tsx`). N'ouvre aucun
  // droit : il ne décide que de l'affichage d'un raccourci.
  const estAdmin = localStorage.getItem('mindset_role') === 'ADMIN';

  // Identity
  const [userName, setUserName] = useState(() => localStorage.getItem('mindset_user_name') || 'Yannis');
  const [aiName, setAiName] = useState(() => localStorage.getItem('mindset_ai_name') || 'Coach IA');
  
  // Text Color
  const [textColor, setTextColor] = useState(() => localStorage.getItem('mindset_text_color') || 'default');

  // Security (Persistent)
  const [encryption, setEncryption] = useState(() => localStorage.getItem('mindset_sec_encryption') !== 'false');
  const [biometric, setBiometric] = useState(() => localStorage.getItem('mindset_sec_biometric') === 'true');
  const [localHistory, setLocalHistory] = useState(() => localStorage.getItem('mindset_sec_local') !== 'false');
  
  // Visual
  const [particlesEnabled, setParticlesEnabled] = useState(() => localStorage.getItem('mindset_particles') !== 'false');

  const [savedStatus, setSavedStatus] = useState(false);
  const [legalModal, setLegalModal] = useState<'legal' | 'cgu' | 'privacy' | null>(null);

  const points = getSecurePoints();
  // Le niveau se lit sur l'expérience, pas sur les Coins : ceux-ci se dépensent.
  const { niveau: level, rang: rank } = lireProgression();
  const joinDate = localStorage.getItem('mindset_join_date') || new Date().toLocaleDateString('fr-FR');

  useEffect(() => {
    if (!localStorage.getItem('mindset_join_date')) {
      localStorage.setItem('mindset_join_date', joinDate);
    }
  }, []);

  const handleBiometricToggle = async () => {
    const newValue = !biometric;
    if (newValue) {
      if (!window.PublicKeyCredential) {
        alert("Ton appareil ne supporte pas la biométrie (WebAuthn).");
        return;
      }
      try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        
        const credential = await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: "Disciplix", id: window.location.hostname },
            user: {
              id: new Uint8Array(16),
              name: userName,
              displayName: userName
            },
            pubKeyCredParams: [
              { type: "public-key", alg: -7 }, // ES256
              { type: "public-key", alg: -257 } // RS256
            ],
            authenticatorSelection: {
              userVerification: "required"
            },
            timeout: 60000,
            attestation: "none"
          }
        });
        
        if (credential && (credential as PublicKeyCredential).rawId) {
          const rawId = (credential as PublicKeyCredential).rawId;
          localStorage.setItem('mindset_biometric_id', bufferToBase64url(rawId));
          setBiometric(true);
          playLevelUpSound();
          alert("Verrouillage biométrique activé avec succès !");
        }
      } catch (err) {
        console.error("Biometric registration failed", err);
        alert("Activation annulée ou échouée.");
        setBiometric(false);
      }
    } else {
      localStorage.removeItem('mindset_biometric_id');
      setBiometric(false);
      playToggleSound(false);
    }
  };

  const handleParticlesToggle = () => {
    const newVal = !particlesEnabled;
    setParticlesEnabled(newVal);
    localStorage.setItem('mindset_particles', newVal.toString());
    window.dispatchEvent(new Event('particlesChanged'));
    playToggleSound(newVal);
  };

  const handleSave = async () => {
    localStorage.setItem('mindset_user_name', userName);
    localStorage.setItem('mindset_ai_name', aiName);
    localStorage.setItem('mindset_text_color', textColor);
    localStorage.setItem('mindset_sec_encryption', encryption.toString());
    localStorage.setItem('mindset_sec_biometric', biometric.toString());
    localStorage.setItem('mindset_sec_local', localHistory.toString());
    
    // Apply text color globally to body
    if (textColor && textColor !== 'default') {
      document.body.style.setProperty('--primary', textColor);
      document.body.style.setProperty('--secondary', textColor);
    } else {
      document.body.style.removeProperty('--primary');
      document.body.style.removeProperty('--secondary');
    }

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
      removeSecurePoints();
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
            <p><strong>Propriété intellectuelle :</strong> Disciplix et tous ses éléments (code, interface, charte graphique, algorithmes locaux) sont la propriété exclusive de son éditeur. Toute reproduction, modification ou distribution est interdite.</p>
          </>
        );
      case 'cgu':
        return (
          <>
            <h2 className="modal-title">Conditions Générales d'Utilisation et de Vente (CGU/CGV)</h2>
            <p><strong>1. Objet :</strong> Les présentes CGU/CGV encadrent l'accès à l'application Disciplix, outil de productivité et de coaching par IA.</p>
            <p><strong>2. Ce qui est gratuit, ce qui est payant :</strong> le suivi des objectifs et des habitudes, le calendrier, les séries, les niveaux et les badges sont gratuits sans limite de durée ; un compte gratuit dispose de dix messages par mois avec le coach IA. L'abonnement <strong>Disciplix Pro</strong> lève cette limite — mensuel à 9,99 € après sept jours d'essai, ou paiement unique de 99,99 €, les deux ouvrant exactement les mêmes fonctions. Le paiement est géré par Stripe, qui reçoit seul les données bancaires. <em>Conformément à l'Article L221-28 du Code de la consommation, le droit de rétractation ne peut être exercé pour la fourniture d'un contenu numérique non fourni sur un support matériel dont l'exécution a commencé après accord préalable exprès du consommateur.</em> Le détail complet est publié sur <a href="/legal.html" target="_blank" rel="noopener">la page légale du site</a>.</p>
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
            <div className="profile-avatar-large" style={{ background: `linear-gradient(135deg, var(--primary), var(--accent-purple))` }}>
              {userName.substring(0, 2).toUpperCase()}
            </div>
            <h2 className="profile-name-display">{userName}</h2>
            <p className="profile-status" style={{ color: 'var(--primary)' }}>Opérateur Principal</p>

            <div className="profile-stats-row">
              <div className="stat-box">
                <span className="stat-value">Lvl {level}</span>
                <span className="stat-label">Niveau Global</span>
                <div style={{ marginTop: '8px', fontSize: '0.9rem', color: rank.color, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                  <RankIcon iconName={rank.iconName} size={16} /> {rank.name}
                </div>
              </div>
              <div className="stat-box">
                <span className="stat-value">{points}</span>
                <span className="stat-label">Coins 🪙</span>
              </div>
            </div>
            {/*
              Le niveau était affiché nu, sans rien indiquer de la suite. C'est
              pourtant l'écran où l'on vient regarder son parcours — et les Coins
              juste à côté descendent à chaque achat, ce qui rendait leur voisinage
              trompeur tant que les deux compteurs n'en faisaient qu'un.
            */}
            <ProgressionRang variante="complet" />
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

            <h3 className="card-title" style={{ marginTop: '24px' }}><Palette size={18}/> Couleur du Texte</h3>
            <div className="theme-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '12px' }}>
              {TEXT_COLORS.map(t => (
                <button 
                  key={t.id}
                  className={`theme-swatch ${textColor === t.value ? 'selected' : ''}`}
                  style={{ 
                    backgroundColor: t.value === 'default' ? 'var(--primary)' : t.value,
                    border: t.value === '#ffffff' ? '1px solid rgba(255,255,255,0.2)' : 'none',
                    position: 'relative'
                  }}
                  onClick={() => { playClickSound(); setTextColor(t.value); }}
                  onMouseEnter={() => playHoverSound()}
                  title={t.name}
                >
                  {t.value === 'default' && <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '10px', color: 'var(--bg-dark)' }}>Auto</span>}
                </button>
              ))}
            </div>

            <div style={{ marginTop: '24px' }}>
              <div className="setting-item" style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="setting-info" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div className="setting-title" style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}><Sparkles size={16} color="var(--accent-blue)"/> Particules d'ambiance</div>
                  <div className="setting-desc" style={{ fontSize: '0.8rem', color: 'var(--secondary)' }}>Désactive pour économiser la batterie.</div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={particlesEnabled} onChange={handleParticlesToggle} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>

            <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 className="card-title" style={{ fontSize: '1rem', color: 'var(--primary)', marginBottom: '16px' }}>
                <Crown size={18} /> Abonnement & Statut
              </h3>
              
              {isSubscribed ? (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <p style={{ color: '#10b981', fontWeight: 600, marginBottom: '8px' }}>
                    ✓ Disciplix Pro actif{formule === 'lifetime' ? ' — à vie' : formule === 'monthly' ? ' — formule mensuelle' : ''}
                  </p>
                  {/*
                    Cette phrase vendait « le Dashboard holographique », qui est ouvert à
                    tout le monde. Le même mensonge avait été retiré de l'écran de
                    tarifs et oublié ici, c'est-à-dire au seul endroit que relit
                    quelqu'un qui paie déjà. Le bonus de Coins, lui, est réel : 30 au
                    lieu de 15 par habitude (Habits.tsx), tout comme le mode Iron Focus
                    au-delà de sept jours de série.
                  */}
                  <p style={{ fontSize: '0.85rem', color: 'var(--secondary)', marginBottom: '16px' }}>
                    {aiName} répond sans compteur et sans dépenser d'énergie, les Coins par habitude sont doublés,
                    et le mode Iron Focus s'ouvre au-delà de sept jours de série.
                  </p>

                  {/*
                    Seule entrée vers l'offre qui subsiste pour un abonné, et seulement
                    s'il reste quelque chose à lui vendre. Un achat à vie ne doit rien
                    voir : lui proposer d'acheter ce qu'il possède déjà est la meilleure
                    façon de faire douter de ce qu'il a payé.
                  */}
                  {formule === 'monthly' && (
                    <button
                      onClick={() => { playClickSound(); setShowPricingModal(true); }}
                      onMouseEnter={() => playHoverSound()}
                      style={{ display: 'block', marginBottom: '12px', background: 'rgba(251, 191, 36, 0.12)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.35)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                    >
                      Passer à vie (99.99€, une seule fois)
                    </button>
                  )}

                  <button
                    onClick={async () => {
                      try {
                        // Même raison que sur l'écran de tarifs : l'adresse de retour ne
                        // doit pas dépendre de FRONTEND_URL, qui a déjà ramené les
                        // acheteurs sur un domaine mort.
                        const res = await api.post('/subscriptions/portal', { origine: window.location.origin });
                        if (res.portalUrl) {
                          window.location.href = res.portalUrl;
                        }
                      } catch (e) {
                        console.error('Failed to open portal', e);
                        alert("Le portail n'est pas encore disponible pour votre compte de test.");
                      }
                    }}
                    style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Gérer / Annuler l'abonnement
                  </button>
                </div>
              ) : (
                <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                  <p style={{ color: 'var(--primary)', fontWeight: 600, marginBottom: '8px' }}>Statut : Formule Gratuite</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--secondary)', marginBottom: '16px' }}>
                    Débloquez {aiName} 24/7 et la Gamification holographique avec Disciplix Pro.
                  </p>
                  {/* Le libellé était écrit en var(--primary) sur un dégradé qui part
                      de var(--primary) : blanc sur blanc dans le thème monochrome —
                      le bouton avait l'air vide et mort. Un texte posé sur un aplat
                      d'accent doit prendre la couleur du fond de l'app, qui contraste
                      avec l'accent dans chacun des thèmes. */}
                  <button
                    onClick={() => { playClickSound(); setShowPricingModal(true); }}
                    onMouseEnter={() => playHoverSound()}
                    style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent-purple))', color: 'var(--bg-dark)', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}
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
                  <div className="setting-title"><User size={16}/> Connexion Biométrique</div>
                  <div className="setting-desc">Utiliser Windows Hello / Touch ID / Face ID au lancement.</div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={biometric} onChange={() => handleBiometricToggle()} />
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

          {/*
            Le menu latéral porte déjà l'entrée « Admin », mais il est masqué sous
            900 px : sans ce relais, le panneau reste inatteignable depuis un
            téléphone, qui est justement d'où l'application est le plus consultée.
            Comme dans le menu, ce test ne protège rien — les routes `/admin/*`
            sont gardées côté serveur par `@Roles('ADMIN')`.
          */}
          {estAdmin && (
            <div className="profile-card glass-panel">
              <h3 className="card-title"><Shield size={18} color="#00f2fe"/> Administration</h3>
              <p className="setting-desc" style={{ marginBottom: '14px' }}>
                Inscrits, abonnements et rétention.
              </p>
              <a
                href="?admin=true"
                className="btn-admin-acces"
                onClick={() => playClickSound()}
              >
                <Shield size={16}/> Ouvrir le panneau
              </a>
            </div>
          )}

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
              style={{ marginTop: '12px', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--primary)', border: '1px solid rgba(255, 255, 255, 0.2)' }} 
              onClick={async () => {
                // L'appel part avant le ménage : c'est lui qui révoque la session
                // côté serveur, et il a besoin des jetons qu'on s'apprête à effacer.
                try {
                  await api.post('/auth/logout', {});
                } catch(e) {}
                // Tout ce qui appartient au compte s'en va, y compris ce qui sera
                // ajouté plus tard. Voir `utils/session.ts` : la liste manuelle qui
                // tenait ici laissait derrière elle la conversation avec le coach,
                // les objectifs, le score mental, la série, l'XP et l'énergie.
                oublierLaSession();
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
          // Un abonné qui ouvre cet écran vient forcément du bouton « Passer à vie » :
          // il n'a plus à choisir entre deux formules, et surtout pas à se voir
          // reproposer le mensuel qu'il paie déjà.
          dejaAbonne={isSubscribed}
          planInitial={isSubscribed ? 'lifetime' : 'monthly'}
          onSubscribe={(formuleAchetee) => {
            // Le rechargement de page a disparu : il faisait tout perdre du contexte
            // et donnait à l'activation l'air d'un incident. L'annonce visible est
            // portée par `activerPro`, que tous les chemins d'activation partagent.
            activerPro(formuleAchetee);
            setIsSubscribed(true);
            setFormule(formuleAchetee);
            setShowPricingModal(false);
          }}
          onClose={() => setShowPricingModal(false)}
        />
      )}
    </div>
  );
};
