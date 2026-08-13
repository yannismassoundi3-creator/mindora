import React, { useState } from 'react';
import { CheckCircle, Zap, Shield, Crown, Sparkles, X } from 'lucide-react';
import { playLevelUpSound } from '../utils/sounds';
import { api } from '../services/api';
import './PricingScreen.css';

interface PricingScreenProps {
  onSubscribe: () => void;
  onClose?: () => void;
  /** Formule déjà choisie ailleurs — sur la page d'accueil, notamment. */
  planInitial?: 'monthly' | 'lifetime';
}

export const PricingScreen: React.FC<PricingScreenProps> = ({ onSubscribe, onClose, planInitial = 'monthly' }) => {
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState('');
  // Quelqu'un qui a cliqué « Passer à vie » sur la page d'accueil ne doit pas avoir
  // à le rechoisir : on lui reproposerait le mensuel après qu'il a tranché.
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'lifetime'>(planInitial);
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';

  const handlePurchase = async (e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);
    setErreur('');
    playLevelUpSound();

    try {
      const res = await api.post('/subscriptions/checkout', { planType: selectedPlan });
      if (res.checkoutUrl) {
        if (res.checkoutUrl.includes('mock=true')) {
          window.dispatchEvent(new CustomEvent('triggerShockwave', {
            detail: { x: window.innerWidth / 2, y: window.innerHeight / 2, color: '#8b5cf6' }
          }));
          onSubscribe();
        } else {
          // Redirection vers la vraie page Stripe
          window.location.href = res.checkoutUrl;
        }
      } else {
        setErreur("Le paiement n'a pas pu être ouvert. Réessaie dans un moment.");
      }
    } catch (error: any) {
      // Une alerte du navigateur disparaît d'un clic et ne laisse aucune trace : la
      // personne se retrouve devant le même bouton, sans savoir si elle a payé. Le
      // message reste donc sous le bouton, avec celui du serveur quand il en donne un.
      //
      // Mais on ne recopie que les messages dont on répond : ceux du serveur, écrits
      // en français, et celui de la couche réseau. Tout le reste vient du navigateur
      // — « Failed to fetch », « API Error » — et n'apprend rien à qui s'apprête à
      // payer. C'est exactement ce qui s'affichait sous le bouton quand le serveur
      // ne répondait pas.
      console.error('Erreur lors du paiement:', error);
      const notre = error?.reseau || typeof error?.status === 'number';
      const message = notre && error?.message && error.message !== 'API Error' ? error.message : '';
      setErreur(message || "Le paiement n'a pas pu être ouvert. Réessaie dans un moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={onClose ? "pricing-overlay" : ""}>
      <div className={`pricing-container ${onClose ? "modal-mode" : ""}`}>
        {onClose && (
          <button className="pricing-close-btn" onClick={onClose}>
            <X size={24} />
          </button>
        )}
        <div className="pricing-header">
          <Sparkles className="pricing-sparkle" size={48} />
          <h1>Passez au niveau supérieur</h1>
          <p>Tes objectifs et tes habitudes restent gratuits. Passe Pro pour parler à {aiName} sans limite.</p>
        </div>

      <div className="pricing-toggle">
        <button
          className={selectedPlan === 'monthly' ? 'active' : ''}
          onClick={() => setSelectedPlan('monthly')}
        >
          Mensuel
        </button>
        {/* « Plein Tarif » se lisait comme un tarif plus cher pour la même chose. Les
            deux formules ouvrent le même Pro : seule la façon de payer change. */}
        <button
          className={selectedPlan === 'lifetime' ? 'active' : ''}
          onClick={() => setSelectedPlan('lifetime')}
        >
          À vie
        </button>
      </div>

      <div className="pricing-cards">
        <div className="pricing-card glass-panel premium-card">
          <div className="pricing-card-header">
            <h3>Disciplix Pro</h3>
            <div className="pricing-price">
              {selectedPlan === 'monthly' ? (
                <>
                  <span className="amount">9.99€</span>
                  <span className="period">/ mois</span>
                </>
              ) : (
                <>
                  <span className="amount">99.99€</span>
                  <span className="period">/ à vie</span>
                </>
              )}
            </div>
            <p className="pricing-desc">
              {selectedPlan === 'monthly'
                ? "Le coach IA sans compteur, résiliable en un clic."
                : "Le même Pro, payé une seule fois. Rentable au bout de dix mois."}
            </p>
          </div>

          {/*
            Cette liste ne promet plus que ce que le serveur tient réellement.
            Trois lignes en sont parties : « Tableau de bord 3D Holographique » et
            « Système de niveaux et récompenses XP » sont ouverts à tout le monde —
            les vendre laissait croire qu'on les retirait aux comptes gratuits —, et
            « Données chiffrées de bout en bout » était faux : les données de suivi
            sont lisibles par le serveur, c'est ce qui permet à l'IA de s'en servir.
            Sur un écran de paiement, une promesse invérifiable coûte plus qu'elle
            ne rapporte.
          */}
          <div className="pricing-features">
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>{aiName} sans limite, 24/7</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Génération de routines par l'IA, sans compteur</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Plus besoin de gagner des coins pour lui parler</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Objectifs, habitudes et niveaux toujours inclus</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Réponse prioritaire par e-mail</span>
            </div>
          </div>

          <button className={`btn-subscribe ${loading ? 'loading' : ''}`} onClick={handlePurchase} disabled={loading}>
            {loading ? 'Connexion sécurisée (Stripe)...' : (selectedPlan === 'monthly' ? "Essai gratuit 7 jours (puis 9.99€/mois)" : "Acheter à vie (99.99€)")}
          </button>
          {erreur && (
            <p className="secure-text" style={{ color: '#f87171', fontWeight: 600 }} role="alert">
              {erreur}
            </p>
          )}
          {selectedPlan === 'monthly' ? (
            <p className="secure-text" style={{ color: '#10b981', fontWeight: 600 }}>
              <Shield size={14} style={{ marginRight: '4px' }}/> 7 jours 100% gratuits. Annulable à tout moment.
            </p>
          ) : (
            <p className="secure-text"><Shield size={14} style={{ marginRight: '4px' }}/> Paiement unique sécurisé via Stripe</p>
          )}
        </div>
      </div>
    </div>
    </div>
  );
};
