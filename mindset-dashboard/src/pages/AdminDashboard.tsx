import React, { useState, useEffect } from 'react';
import { Shield, Users, CreditCard, Activity } from 'lucide-react';
import { api } from '../services/api';
import { TableauJour } from '../components/TableauJour';
import { TableauRetention } from '../components/TableauRetention';
import { EtatSecours } from '../components/EtatSecours';
import './AdminDashboard.css';

interface AdminStats {
  totalUsers: number;
  totalSubscribers: number;
  activeUsersToday: number;
}

export const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [secretKey, setSecretKey] = useState('');
  const [claimStatus, setClaimStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/stats');
      setStats(res);
      setError(null);
    } catch (err: any) {
      if (err.response?.status === 403 || err.response?.status === 401) {
        setError('Accès refusé. Vous n\'êtes pas administrateur.');
      } else {
        setError('Erreur lors du chargement des statistiques.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClaimAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimStatus('loading');
    try {
      await api.post('/auth/claim-admin', { secretKey });
      setClaimStatus('success');
      setTimeout(() => {
        fetchStats();
      }, 1000);
    } catch (err: any) {
      setClaimStatus('error');
      alert(err.response?.data?.message || 'Clé invalide');
    }
  };

  if (loading) {
    return <div className="admin-dashboard"><p>Chargement sécurisé...</p></div>;
  }

  if (error && !stats) {
    return (
      <div className="admin-dashboard">
        <div className="admin-error glass-panel">
          <Shield size={64} className="text-danger" />
          <h2>{error}</h2>
          {/*
            C'est ici qu'atterrit un compte non administrateur — l'écran le plus
            susceptible d'être une impasse, puisqu'il ne charge rien. Le retour
            doit donc y figurer avant tout.
          */}
          <a className="admin-retour admin-retour--seul" href="/">
            ← Retour à l'app
          </a>

          <div style={{ marginTop: '20px', width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
            <p style={{ textAlign: 'center', marginBottom: '15px' }}>Devenir Administrateur (Clé Secrète)</p>
            <form className="claim-form" onSubmit={handleClaimAdmin}>
              <input 
                type="password" 
                className="claim-input" 
                placeholder="Clé secrète"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={claimStatus === 'loading'}>
                {claimStatus === 'loading' ? 'Vérification...' : 'Débloquer'}
              </button>
              {claimStatus === 'success' && <p className="text-success" style={{textAlign: 'center'}}>Succès ! Rechargement...</p>}
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <Shield size={32} color="#00f2fe" />
        <h1>Panneau d'Administration</h1>
        {/*
          Cette page se substitue à toute l'application : elle est rendue avant le
          Layout, donc sans menu ni barre du bas. Sans ce lien, le seul moyen de
          revenir est de retirer le paramètre de l'adresse à la main.
        */}
        <a className="admin-retour" href="/">
          ← Retour à l'app
        </a>
      </div>

      <div className="stats-grid">
        <div className="stat-card glass-panel">
          <Users size={32} color="#00f2fe" />
          <div className="stat-value">{stats?.totalUsers || 0}</div>
          <div className="stat-label">Inscrits Totaux</div>
        </div>

        <div className="stat-card glass-panel">
          <CreditCard size={32} color="#fbc531" />
          <div className="stat-value">{stats?.totalSubscribers || 0}</div>
          <div className="stat-label">Abonnements Actifs</div>
        </div>

        <div className="stat-card glass-panel">
          <Activity size={32} color="#44bd32" />
          <div className="stat-value">{stats?.activeUsersToday || 0}</div>
          <div className="stat-label">Actifs Aujourd'hui</div>
        </div>
      </div>

      {/*
        Les trois cartes ci-dessus sont des totaux depuis le début : elles ne
        bougent presque plus une fois qu'il y a du monde. La journée en cours vient
        donc avant la rétention — c'est ce qu'on regarde le jour où l'on pousse
        l'application quelque part.
      */}
      <TableauJour />

      {/*
        Et ci-dessous, ce que les arrivées deviennent : la seule question qui
        décide s'il faut faire connaître l'application ou d'abord la corriger.
      */}
      <TableauRetention />

      {/*
        En dernier, et c'est voulu : ce n'est pas une mesure du produit mais un
        contrôle d'installation. On vient le chercher quand on doute, on ne le
        croise pas en lisant ses chiffres.
      */}
      <EtatSecours />
    </div>
  );
};
