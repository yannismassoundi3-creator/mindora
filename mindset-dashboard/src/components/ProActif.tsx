import React, { useEffect, useState } from 'react';
import { Crown, X } from 'lucide-react';
import type { Formule } from '../utils/paiement';
import './ProActif.css';

/**
 * L'annonce que l'abonnement est actif.
 *
 * Il n'y en avait aucune : le paiement aboutissait, l'écran de tarifs se fermait, et
 * rien ne changeait visiblement. Sans un mot, on ne sait pas si on a payé pour rien —
 * et le premier réflexe devant un doute sur un paiement est de recommencer.
 *
 * Monté dans le Layout et non dans une page, parce que l'activation peut arriver depuis
 * le Profil, l'écran de tarifs ou le rattrapage au démarrage.
 */
export const ProActif: React.FC = () => {
  const [formule, setFormule] = useState<Formule | null>(null);

  useEffect(() => {
    const surActivation = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setFormule(detail?.formule === 'lifetime' ? 'lifetime' : 'monthly');
    };
    window.addEventListener('mindset:pro-actif', surActivation);
    return () => window.removeEventListener('mindset:pro-actif', surActivation);
  }, []);

  // La disparition automatique est remise à zéro à chaque annonce : deux activations
  // rapprochées (rattrapage au démarrage puis confirmation) ne doivent pas faire
  // disparaître la seconde au bout du reliquat de la première.
  useEffect(() => {
    if (!formule) return;
    const t = setTimeout(() => setFormule(null), 7000);
    return () => clearTimeout(t);
  }, [formule]);

  if (!formule) return null;

  return (
    <div className="pro-actif" role="status">
      <Crown size={20} className="pro-actif-icone" />
      <div className="pro-actif-texte">
        <strong>Disciplix Pro est actif.</strong>
        <span>
          {formule === 'lifetime'
            ? 'Payé une fois, acquis pour toujours. Le coach est sans limite.'
            : 'Le coach est sans limite, et tu ne dépenses plus d’énergie pour lui parler.'}
        </span>
      </div>
      <button className="pro-actif-fermer" onClick={() => setFormule(null)} aria-label="Fermer">
        <X size={16} />
      </button>
    </div>
  );
};
