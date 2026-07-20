import React, { useState } from 'react';
import { CheckCircle, Zap, Shield, Crown, Sparkles, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { playLevelUpSound } from '../utils/sounds';
import { api } from '../services/api';
import './PricingScreen.css';

interface PricingScreenProps {
  onSubscribe: () => void;
  onClose?: () => void;
}

export const PricingScreen: React.FC<PricingScreenProps> = ({ onSubscribe, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'lifetime'>('monthly');

  const handlePurchase = async (e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);
    playLevelUpSound();
    
    try {
      // Simulation de l'appel à Stripe + vérification backend
      const res = await api.post('/subscriptions/mock-success', {});
      if(res.success) {
        confetti({
          particleCount: 150,
          spread: 100,
          origin: { y: 0.6 },
          colors: ['#3b82f6', '#8b5cf6', '#ec4899']
        });
        onSubscribe();
      }
    } catch (error) {
      console.error('Erreur lors du paiement:', error);
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
          <p>Débloquez la puissance totale de Mindora. Accédez au suivi des habitudes et à votre Coach IA personnel 24/7.</p>
        </div>

      <div className="pricing-toggle">
        <button 
          className={selectedPlan === 'monthly' ? 'active' : ''} 
          onClick={() => setSelectedPlan('monthly')}
        >
          Mensuel
        </button>
        <button 
          className={selectedPlan === 'lifetime' ? 'active' : ''} 
          onClick={() => setSelectedPlan('lifetime')}
        >
          Plein Tarif (À vie)
        </button>
      </div>

      <div className="pricing-cards">
        <div className="pricing-card glass-panel premium-card">
          <div className="pricing-card-header">
            <h3>Mindora Pro</h3>
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
            <p className="pricing-desc">L'accès intégral à toutes les fonctionnalités premium pour transformer votre discipline.</p>
          </div>

          <div className="pricing-features">
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Accès illimité à Jarvis (Coach IA 24/7)</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Tableau de bord 3D Holographique</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Suivi avancé des habitudes et routines</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Système de niveaux et récompenses XP</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Données chiffrées de bout en bout</span>
            </div>
            <div className="feature-item">
              <CheckCircle size={20} className="feature-icon" />
              <span>Support prioritaire</span>
            </div>
          </div>

          <button className={`btn-subscribe ${loading ? 'loading' : ''}`} onClick={handlePurchase} disabled={loading}>
            {loading ? 'Connexion sécurisée (Stripe)...' : (selectedPlan === 'monthly' ? "S'abonner (9.99€/mois)" : "Acheter (99.99€)")}
          </button>
          <p className="secure-text"><Shield size={14}/> Paiement 100% sécurisé via Stripe</p>
        </div>
      </div>
    </div>
    </div>
  );
};
