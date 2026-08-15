import React, { useState } from 'react';
import { CheckCircle, Zap, Shield, Crown, Sparkles, X } from 'lucide-react';
import { playLevelUpSound } from '../utils/sounds';
import { api } from '../services/api';
import { marquerPaiementLance, verifierAbonnement, type Formule } from '../utils/paiement';
import './PricingScreen.css';

interface PricingScreenProps {
  onSubscribe: (formule: Formule) => void;
  onClose?: () => void;
  /** Formule déjà choisie ailleurs — sur la page d'accueil, notamment. */
  planInitial?: 'monthly' | 'lifetime';
  /**
   * L'écran s'adresse à quelqu'un qui paie déjà.
   *
   * Il n'arrive ici que par « Passer à vie » : lui remontrer le choix des formules
   * reviendrait à lui proposer d'acheter une seconde fois ce qu'il a déjà, et à laisser
   * croire que son abonnement n'a pas été pris en compte.
   */
  dejaAbonne?: boolean;
}

export const PricingScreen: React.FC<PricingScreenProps> = ({ onSubscribe, onClose, planInitial = 'monthly', dejaAbonne = false }) => {
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState('');
  // Quelqu'un qui a cliqué « Passer à vie » sur la page d'accueil ne doit pas avoir
  // à le rechoisir : on lui reproposerait le mensuel après qu'il a tranché.
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'lifetime'>(planInitial);
  const [verification, setVerification] = useState(false);
  const [resultat, setResultat] = useState<{ ok: boolean; texte: string } | null>(null);
  const aiName = localStorage.getItem('mindset_ai_name') || 'Coach IA';

  /**
   * Va lire chez Stripe si un paiement existe, et ouvre l'accès le cas échéant.
   *
   * `onSubscribe()` fait exactement ce que ferait un achat réussi : il n'y a donc
   * qu'un seul chemin d'ouverture du Pro dans l'app, quel que soit le maillon qui
   * avait échoué.
   */
  const verifierDejaPaye = async () => {
    setVerification(true);
    setResultat(null);
    const { ok, abonne, formule } = await verifierAbonnement();
    setVerification(false);
    if (!ok) {
      // « Aucun paiement trouvé » serait un mensonge : on n'a pas pu demander.
      setResultat({ ok: false, texte: "La vérification n'a pas abouti. Vérifie ta connexion et réessaie." });
    } else if (abonne) {
      setResultat({ ok: true, texte: 'Paiement retrouvé — ton accès Pro est ouvert.' });
      playLevelUpSound();
      onSubscribe(formule);
    } else {
      setResultat({
        ok: false,
        texte: "Aucun paiement trouvé pour ton adresse e-mail. Si tu viens de payer, attends une minute et réessaie.",
      });
    }
  };

  const handlePurchase = async (e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);
    setErreur('');
    playLevelUpSound();

    try {
      // On dit au serveur où nous ramener. Il vérifie l'adresse contre sa propre liste
      // blanche avant de s'en servir — sans quoi ce serait une redirection ouverte.
      // Sans ça, l'adresse de retour vient de FRONTEND_URL, qui pointait sur un domaine
      // mort : tous les acheteurs atterrissaient sur « Not Found ».
      const res = await api.post('/subscriptions/checkout', {
        planType: selectedPlan,
        origine: window.location.origin,
      });
      if (res.checkoutUrl) {
        if (res.checkoutUrl.includes('mock=true')) {
          window.dispatchEvent(new CustomEvent('triggerShockwave', {
            detail: { x: window.innerWidth / 2, y: window.innerHeight / 2, color: '#8b5cf6' }
          }));
          onSubscribe(selectedPlan);
        } else {
          // On note qu'un paiement part, pour aller en vérifier l'issue au prochain
          // démarrage. Le retour de Stripe n'est pas un chemin sur lequel on peut
          // compter : il dépend de FRONTEND_URL côté serveur, et le 13 août 2026 il a
          // renvoyé sur un domaine mort — personne n'est jamais revenu dans l'app.
          // Cette marque, elle, survit à n'importe quel atterrissage.
          marquerPaiementLance();
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
          <h1>{dejaAbonne ? 'Payer une seule fois' : 'Passez au niveau supérieur'}</h1>
          <p>
            {dejaAbonne
              ? `Tu es déjà Pro. Le passage à vie garde exactement les mêmes fonctions, mais met fin au prélèvement mensuel.`
              : `Tes objectifs et tes habitudes restent gratuits. Passe Pro pour parler à ${aiName} sans limite.`}
          </p>
        </div>

      {/* La bascule disparaît pour un abonné : le mensuel n'est plus une option, il
          l'a déjà, et le lui remontrer donnerait à croire qu'il pourrait le reprendre. */}
      <div className="pricing-toggle" style={dejaAbonne ? { display: 'none' } : undefined}>
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

          {/*
            Le plafond est dit ici, avant le bouton, et pas seulement dans les
            conditions. Cinquante messages par jour, c'est un toutes les six minutes
            pendant quinze heures : personne ne l'atteint de bonne foi, et c'est
            précisément pourquoi le taire ne rapporterait rien — alors que le
            découvrir après avoir payé coûterait la confiance de quelqu'un qui vient
            de sortir sa carte.
          */}
          <p className="pricing-plafond">
            « Sans compteur » veut dire sans quota mensuel et sans énergie à dépenser. Un
            plafond de 50 messages par jour protège le service ; il se remet à zéro chaque nuit.
          </p>

          <button className={`btn-subscribe ${loading ? 'loading' : ''}`} onClick={handlePurchase} disabled={loading}>
            {loading
              ? 'Connexion sécurisée (Stripe)...'
              : selectedPlan === 'lifetime'
                ? 'Acheter à vie (99.99€)'
                : 'Essai gratuit 7 jours (puis 9.99€/mois)'}
          </button>
          {/* Dit ce qui arrive au prélèvement en cours. Sans cette phrase, la question
              « et mon mensuel, il continue ? » n'a aucune réponse à l'écran, et c'est
              la première qu'on se pose devant un second paiement. */}
          {dejaAbonne && (
            <p className="secure-text" style={{ marginTop: '10px' }}>
              Ton abonnement mensuel est résilié automatiquement dès que le paiement à vie aboutit.
            </p>
          )}
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

          {/*
            Rattrapage manuel. Quelqu'un qui a payé mais n'a pas reçu son accès revient
            forcément ici : c'est l'écran derrière le bouton « Passer Pro », le seul
            qu'on lui montre encore. Sans cette porte, sa seule issue apparente est de
            payer une seconde fois.
          */}
          {!dejaAbonne && (
            <button className="pricing-deja-paye" onClick={verifierDejaPaye} disabled={verification}>
              {verification ? 'Vérification auprès de Stripe...' : "J'ai déjà payé — vérifier mon accès"}
            </button>
          )}
          {resultat && (
            <p className="secure-text" style={{ color: resultat.ok ? '#10b981' : '#f87171', fontWeight: 600 }} role="status">
              {resultat.texte}
            </p>
          )}
        </div>
      </div>
    </div>
    </div>
  );
};
