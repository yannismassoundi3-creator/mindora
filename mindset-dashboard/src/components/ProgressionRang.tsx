import React, { useEffect, useState } from 'react';
import './ProgressionRang.css';
import { EVENEMENT_XP, lireProgression } from '../utils/progression';
import { RankIcon } from './RankIcon';

/*
  Ce qui sépare du rang suivant.

  Le badge de rang était affiché seul, et le niveau n'existait que dans le Profil :
  rien, nulle part, ne disait ce qu'il fallait pour avancer. Avec l'ancienne courbe,
  on restait « Novice » plus d'un mois — un rang lointain et muet se lit comme un
  système cassé, pas comme un objectif.

  Deux formes pour deux endroits : `compact` tient sur une ligne sous la date du
  tableau de bord, `complet` porte les chiffres dans le Profil, seul écran où l'on
  vient regarder son parcours.
*/
export const ProgressionRang: React.FC<{ variante?: 'compact' | 'complet' }> = ({
  variante = 'compact',
}) => {
  const [etat, setEtat] = useState(() => lireProgression());

  useEffect(() => {
    const relire = () => setEtat(lireProgression());
    window.addEventListener(EVENEMENT_XP, relire);
    // Une session ouverte sur un autre onglet fait bouger le même compte.
    window.addEventListener('storage', relire);
    return () => {
      window.removeEventListener(EVENEMENT_XP, relire);
      window.removeEventListener('storage', relire);
    };
  }, []);

  const { niveau, rang, rangSuivant, xpAvantRang, partRang, xp } = etat;
  const part = Math.round(partRang * 100);

  if (variante === 'compact') {
    return (
      <div
        className="progression-rang progression-rang--compact"
        style={{ '--rang-couleur': rang.color } as React.CSSProperties}
        title={`${xp} XP au total`}
      >
        <span className="progression-rang__niveau">Niv. {niveau}</span>
        <div
          className="progression-rang__piste"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={part}
          aria-label={
            rangSuivant
              ? `Progression vers le rang ${rangSuivant.name} : ${part} %`
              : `Rang maximal atteint : ${rang.name}`
          }
        >
          <div className="progression-rang__jauge" style={{ width: `${part}%` }} />
        </div>
        <span className="progression-rang__reste">
          {rangSuivant ? `${rangSuivant.name} dans ${xpAvantRang} XP` : 'Rang maximal'}
        </span>
      </div>
    );
  }

  return (
    <div
      className="progression-rang progression-rang--complet"
      style={{ '--rang-couleur': rang.color } as React.CSSProperties}
    >
      <div className="progression-rang__entete">
        <span className="progression-rang__actuel">
          <RankIcon iconName={rang.iconName} size={15} color={rang.color} /> {rang.name}
        </span>
        {rangSuivant && (
          <span className="progression-rang__cible">
            <RankIcon iconName={rangSuivant.iconName} size={15} color={rangSuivant.color} />{' '}
            {rangSuivant.name}
          </span>
        )}
      </div>
      <div
        className="progression-rang__piste"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={part}
        aria-label={
          rangSuivant
            ? `Progression vers le rang ${rangSuivant.name} : ${part} %`
            : `Rang maximal atteint : ${rang.name}`
        }
      >
        <div className="progression-rang__jauge" style={{ width: `${part}%` }} />
      </div>
      <p className="progression-rang__detail">
        {rangSuivant ? (
          <>
            <strong>{xpAvantRang} XP</strong> avant le rang {rangSuivant.name} (niveau{' '}
            {rangSuivant.minLevel}) · {xp} XP au total
          </>
        ) : (
          <>Rang maximal atteint · {xp} XP au total</>
        )}
      </p>
    </div>
  );
};
