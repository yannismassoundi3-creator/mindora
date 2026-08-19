import React, { useEffect, useState } from 'react';
import { EVENEMENT_VALIDATION, type Validation } from '../utils/journee';
import './AnneauValidation.css';

/*
  Ce qui se passe à l'écran quand on valide quelque chose.

  Avant : une onde blanche de 600 px de diamètre traversait la page depuis le
  point touché, avec un `backdrop-filter` qui floutait tout sur son passage. Trois
  défauts, et le troisième est le vrai :

  1. Elle partait **deux fois** pour une seule tâche cochée — une fois
     directement, une fois par `triggerDopamine` qui n'était qu'un second envoi
     du même événement.
  2. Un flou plein écran est ce qu'un téléphone dessine le plus difficilement, et
     il arrivait à l'instant précis où l'interface doit paraître instantanée.
  3. **Elle ne disait rien.** Une décoration célèbre le geste et l'oublie ; or ce
     qui donne envie de cocher la suivante, ce n'est pas l'effet, c'est de voir où
     l'on en est.

  À la place : un anneau, tracé autour du doigt, qui montre **la part de la
  journée désormais faite**. Le geste devient une mesure. Un anneau incomplet
  demande à être fermé — c'est la seule forme de récompense qui pointe vers la
  suite plutôt que vers elle-même.

  Quand la journée se ferme, l'anneau s'illumine une fois de plus. Rien de
  bruyant : la journée pleine a déjà son propre écran.

  **Il prend la couleur du thème** (`--primary`), au lieu du blanc forcé et des
  roses et bleus que les appelants passaient et que l'ancien composant ignorait
  silencieusement. En thème Matrix l'anneau est vert, en Cyberpunk cyan.

  Là où la part n'a pas de sens — un objectif atteint, un abonnement pris — seule
  l'onde brève est dessinée : un anneau vide serait un chiffre inventé.
*/

interface AnneauAffiche extends Validation {
  id: number;
}

/** Rayon et circonférence de l'anneau, en unités du `viewBox`. */
const RAYON = 26;
const CIRCONFERENCE = 2 * Math.PI * RAYON;

/** Durée totale avant retrait du DOM, animations comprises. */
const DUREE_MS = 1100;

export const AnneauValidation: React.FC = () => {
  const [anneaux, setAnneaux] = useState<AnneauAffiche[]>([]);

  useEffect(() => {
    const surValidation = (e: Event) => {
      const detail = (e as CustomEvent).detail as Validation;
      if (!detail) return;

      const anneau: AnneauAffiche = { ...detail, id: Date.now() + Math.random() };
      setAnneaux((prev) => [...prev, anneau]);

      window.setTimeout(() => {
        setAnneaux((prev) => prev.filter((a) => a.id !== anneau.id));
      }, DUREE_MS);
    };

    window.addEventListener(EVENEMENT_VALIDATION, surValidation);
    return () => window.removeEventListener(EVENEMENT_VALIDATION, surValidation);
  }, []);

  if (anneaux.length === 0) return null;

  return (
    <div className="validation-couche">
      {anneaux.map((a) => {
        // Une part connue et bornée, ou rien : afficher un arc calculé sur une
        // valeur douteuse ferait mentir la seule information de tout l'effet.
        const part =
          typeof a.part === 'number' && isFinite(a.part) ? Math.max(0, Math.min(1, a.part)) : null;
        const complet = part !== null && part >= 1;

        return (
          <div
            key={a.id}
            className={`validation-marque${complet ? ' validation-marque--complet' : ''}`}
            style={{ left: `${a.x}px`, top: `${a.y}px` }}
          >
            <span className="validation-onde" />

            {part !== null && (
              <svg className="validation-anneau" viewBox="0 0 64 64" aria-hidden="true">
                {/* La journée entière, en trait mince : l'arc n'a de sens que
                    posé sur ce qui reste à faire. */}
                <circle className="validation-piste" cx="32" cy="32" r={RAYON} />
                <circle
                  className="validation-arc"
                  cx="32"
                  cy="32"
                  r={RAYON}
                  style={
                    {
                      strokeDasharray: CIRCONFERENCE,
                      // Le trait part de zéro et s'arrête à la part faite : c'est
                      // l'animation qui raconte le gain, pas l'état final.
                      ['--depart' as any]: CIRCONFERENCE,
                      ['--arrivee' as any]: CIRCONFERENCE * (1 - part),
                    } as React.CSSProperties
                  }
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
};
