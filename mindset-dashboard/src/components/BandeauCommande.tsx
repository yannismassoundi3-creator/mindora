import React from 'react';
import { Circle, CheckCircle2, Sparkles } from 'lucide-react';
import './BandeauCommande.css';

/*
  Le bandeau de commandement.

  Le tableau de bord répondait à « comment je vais » (un graphique, un damier de
  365 jours, des cartes de statistiques) mais jamais à « qu'est-ce que je fais
  maintenant » : sur un téléphone, la première case à cocher se trouvait à 709 px
  du haut, c'est-à-dire hors du premier écran. On ouvrait l'application pour agir
  et on tombait sur de la contemplation.

  Ce bandeau réunit les trois seules choses qui décident de la minute suivante :
  où en est la journée, depuis combien de temps la série tient, et quelle est la
  prochaine tâche — avec de quoi la cocher sur place.

  Il ne calcule rien : le Dashboard reste seul maître du score, de la série et des
  routines, et le cochage repasse par `toggleRoutine`, donc les points, le son, la
  vibration et le crédit serveur sont exactement ceux de la liste plus bas.
*/

export interface ProchaineAction {
  id: number;
  titre: string;
  duree?: string;
  creneau: string;
  indexGroupe: number;
}

interface BandeauCommandeProps {
  score: number;
  serie: number;
  faites: number;
  total: number;
  prochaine: ProchaineAction | null;
  seriePerdue: number;
  styleFlamme: React.CSSProperties;
  nomIa: string;
  onCocher: (e: React.MouseEvent, id: number) => void;
  onAller: (indexGroupe: number) => void;
  onOuvrirChat: () => void;
}

const RAYON = 17;
const CIRCONFERENCE = 2 * Math.PI * RAYON;

export const BandeauCommande: React.FC<BandeauCommandeProps> = ({
  score,
  serie,
  faites,
  total,
  prochaine,
  seriePerdue,
  styleFlamme,
  nomIa,
  onCocher,
  onAller,
  onOuvrirChat,
}) => {
  const scoreBorne = Math.min(100, Math.max(0, score));
  const journeeComplete = scoreBorne >= 100;
  const offset = CIRCONFERENCE - (scoreBorne / 100) * CIRCONFERENCE;

  return (
    <section className="bandeau-commande glass-panel">
      <div className="bandeau-etat">
        <div className="bandeau-mesure">
          <svg width="40" height="40" viewBox="0 0 40 40" className="bandeau-anneau" aria-hidden="true">
            <defs>
              <linearGradient id="bandeauArc" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={journeeComplete ? '#ff0844' : '#00f2fe'} />
                <stop offset="100%" stopColor={journeeComplete ? '#ffb199' : '#4facfe'} />
              </linearGradient>
            </defs>
            <circle cx="20" cy="20" r={RAYON} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="4" />
            <circle
              cx="20"
              cy="20"
              r={RAYON}
              fill="none"
              stroke="url(#bandeauArc)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={CIRCONFERENCE}
              strokeDashoffset={offset}
              transform="rotate(-90 20 20)"
            />
          </svg>
          <div className="bandeau-mesure-texte">
            <strong>{scoreBorne} %</strong>
            <span>{total > 0 ? `${faites}/${total} aujourd'hui` : 'aujourd’hui'}</span>
          </div>
        </div>

        <div className="bandeau-mesure">
          <span className="bandeau-flamme" style={styleFlamme} aria-hidden="true">🔥</span>
          <div className="bandeau-mesure-texte">
            <strong>{serie} j</strong>
            <span>de série</span>
          </div>
        </div>
      </div>

      <div className="bandeau-action">
        {prochaine ? (
          <>
            {/*
              Deux boutons distincts et non une ligne cliquable : au doigt, cocher
              par erreur ce qu'on voulait seulement consulter fait gagner des points
              pour une tâche non faite, et il faut décocher pour réparer.
            */}
            <button
              className="bandeau-cocher"
              onClick={(e) => onCocher(e, prochaine.id)}
              aria-label={`Marquer « ${prochaine.titre} » comme faite`}
              title="Marquer comme faite"
            >
              <Circle size={22} />
            </button>
            <button
              className="bandeau-cible"
              onClick={() => onAller(prochaine.indexGroupe)}
              title="Voir cette tâche dans la liste"
            >
              <span className="bandeau-libelle">Maintenant</span>
              <span className="bandeau-titre">{prochaine.titre}</span>
              <span className="bandeau-detail">
                {prochaine.creneau}
                {prochaine.duree ? ` · ${prochaine.duree}` : ''}
              </span>
            </button>
          </>
        ) : total > 0 ? (
          <div className="bandeau-fini">
            <CheckCircle2 size={22} />
            <div className="bandeau-cible-texte">
              <span className="bandeau-titre">Journée bouclée</span>
              <span className="bandeau-detail">
                {total} tâche{total > 1 ? 's' : ''} faite{total > 1 ? 's' : ''}. Plus rien ne t’attend.
              </span>
            </div>
          </div>
        ) : (
          /*
            Aucune tâche aujourd'hui : c'est l'état normal d'un compte neuf, et le
            geste attendu est de demander un plan. Le bandeau y mène directement,
            plutôt que de laisser une liste vide sans issue.
          */
          <button className="bandeau-vide" onClick={onOuvrirChat}>
            <Sparkles size={20} />
            <span className="bandeau-cible-texte">
              <span className="bandeau-titre">Rien de prévu aujourd’hui</span>
              <span className="bandeau-detail">Demande un plan à {nomIa}</span>
            </span>
          </button>
        )}
      </div>

      {/*
        Deux phrases et non une : la condition couvre la série tombée à zéro et
        celle qui vient de repartir à un. Dire « une tâche et elle repart » à
        quelqu'un qui en a déjà coché une aujourd'hui, c'est lui annoncer comme à
        faire ce qu'il vient de faire.
      */}
      {serie <= 1 && seriePerdue > 1 && (
        <p className="bandeau-alerte">
          {serie === 0
            ? `Série de ${seriePerdue} jours perdue — la première tâche cochée en relance une.`
            : `Série de ${seriePerdue} jours perdue. La nouvelle a démarré aujourd’hui.`}
        </p>
      )}
    </section>
  );
};
