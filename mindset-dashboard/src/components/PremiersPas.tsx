import React from 'react';
import { Check, Target, Sparkles, CheckSquare } from 'lucide-react';
import { playClickSound } from '../utils/sounds';
import './PremiersPas.css';

/*
  Ce que voit quelqu'un qui vient d'arriver.

  Mesuré avant d'écrire ce composant, sur un compte neuf ouvert depuis un iPhone :
  le tableau de bord faisait 2121 px — deux écrans et demi — dont 913 px, soit
  43 % de la page, occupés par un graphique plat et un damier de 365 cases vides.
  Un compte neuf ouvrait donc le tableau de bord d'une vie qu'il n'avait pas
  encore vécue : rien à lire, rien à faire, et aucune raison de revenir demain.

  Ces deux blocs ne disparaissent pas — ils attendent d'avoir quelque chose à
  dire (voir `JOURS_AVANT_HISTORIQUE` dans Dashboard.tsx). En attendant, la place
  revient à la seule chose qui compte le premier jour : la boucle, en trois pas,
  et le moyen de faire le premier tout de suite.

  Aucun de ces pas n'est cochable à la main. Ils se cochent en étant faits, ce
  qui est la démonstration en miniature de ce que l'application demande.
*/

export interface EtapesPremiersPas {
  /** Il a dit ce qu'il veut devenir : l'objectif déclaré existe. */
  objectifPose: boolean;
  /** Il a un plan : au moins une tâche existe pour aujourd'hui. */
  planPose: boolean;
  /** Il a coché au moins une chose aujourd'hui. */
  premiereTacheFaite: boolean;
}

interface Props extends EtapesPremiersPas {
  nomCoach: string;
  onOuvrirChat: () => void;
}

export const PremiersPas: React.FC<Props> = ({
  objectifPose,
  planPose,
  premiereTacheFaite,
  nomCoach,
  onOuvrirChat,
}) => {
  const etapes = [
    {
      faite: objectifPose,
      icone: <Target size={18} />,
      titre: 'Dis qui tu veux devenir',
      detail: `${nomCoach} s'en sert pour tout le reste.`,
    },
    {
      faite: planPose,
      icone: <Sparkles size={18} />,
      titre: 'Reçois ton plan',
      detail: 'Des tâches concrètes, pour aujourd\'hui.',
    },
    {
      faite: premiereTacheFaite,
      icone: <CheckSquare size={18} />,
      titre: 'Coche la première',
      detail: 'C\'est là que la série commence.',
    },
  ];

  // La première non faite : c'est elle que le bouton propose, et elle seule.
  // Proposer les trois reviendrait à redonner une liste à quelqu'un qui n'a pas
  // encore fait la première ligne.
  const enCours = etapes.findIndex((e) => !e.faite);

  return (
    <section className="premiers-pas glass-panel">
      <div className="premiers-pas-intro">
        <h3>Comment ça marche</h3>
        <p>
          Tu dis qui tu veux devenir, {nomCoach} te donne quoi faire aujourd'hui, tu le fais.
          Demain, on recommence — et c'est la répétition qui te change.
        </p>
      </div>

      <ol className="premiers-pas-liste">
        {etapes.map((etape, i) => (
          <li
            key={etape.titre}
            className={`premiers-pas-etape ${etape.faite ? 'faite' : ''} ${i === enCours ? 'en-cours' : ''}`}
          >
            <span className="premiers-pas-puce" aria-hidden="true">
              {etape.faite ? <Check size={16} /> : etape.icone}
            </span>
            <span className="premiers-pas-texte">
              <strong>{etape.titre}</strong>
              <span className="premiers-pas-detail">{etape.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      {/*
        Les deux premiers pas se font dans la conversation ; le troisième se fait
        dans la liste juste en dessous, où le bouton n'aurait rien à ouvrir.
      */}
      {enCours >= 0 && enCours < 2 && (
        <button
          className="premiers-pas-action"
          onClick={() => {
            playClickSound();
            onOuvrirChat();
          }}
        >
          <Sparkles size={16} />
          {enCours === 0 ? `Parler à ${nomCoach}` : `Demander mon plan à ${nomCoach}`}
        </button>
      )}
    </section>
  );
};
