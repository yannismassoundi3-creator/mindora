import React, { useEffect, useState } from 'react';
import { Circle, CheckCircle2, Sparkles } from 'lucide-react';
import { lireEtatDuJour, basculerTache, EVENEMENT_JOURNEE } from '../utils/journee';
import type { EtatDuJour } from '../utils/journee';
import { enJeuAujourdhui } from '../utils/enJeu';
import './BandeauCommande.css';

/*
  Le bandeau de commandement.

  Le tableau de bord répondait à « comment je vais » (un graphique, un damier de
  365 jours, des cartes de statistiques) mais jamais à « qu'est-ce que je fais
  maintenant » : sur un téléphone, la première case à cocher se trouvait à 709 px
  du haut, c'est-à-dire hors du premier écran.

  Il vit dans le Layout et non dans le Dashboard : il reste donc affiché sur les
  Objectifs, les Habitudes, la Boutique — et il est collant, pour rester sous les
  yeux quand la page défile. Trois choses seulement, celles qui décident de la
  minute suivante : où en est la journée, depuis combien de temps la série tient,
  et quelle est la prochaine tâche, avec de quoi la cocher sur place.

  Tout le calcul est dans `utils/journee.ts`, partagé avec le Dashboard, pour que
  les deux ne puissent pas afficher deux chiffres différents.
*/

const RAYON = 17;
const CIRCONFERENCE = 2 * Math.PI * RAYON;

/*
  La flamme se colore avec la série : grise et pâle au début, pleinement colorée
  vers cent jours. Elle vivait dans le Dashboard, avec la carte de série qui a été
  retirée ; elle appartient désormais au seul endroit qui l'affiche.
*/
function styleFlamme(serie: number): React.CSSProperties {
  if (serie <= 1) return { filter: 'grayscale(100%)', opacity: 0.3, animation: 'none' };
  if (serie >= 365) {
    return { filter: 'grayscale(100%) brightness(0) drop-shadow(0 0 8px rgba(255,255,255,0.8))' };
  }
  if (serie >= 100) return { filter: 'hue-rotate(240deg) saturate(2) brightness(1.2)' };

  // Entre le deuxième et le centième jour.
  const avancement = (serie - 2) / 98;

  // Le gris se retire sur les trente premiers jours : la flamme s'allume à mesure.
  let gris = 0;
  let opacite = 1;
  if (serie < 30) {
    const debut = (serie - 2) / 28;
    gris = 80 - 80 * debut;
    opacite = 0.5 + 0.5 * debut;
  }

  return {
    filter: `grayscale(${gris}%) hue-rotate(${-45 * avancement}deg) saturate(${1 + avancement})`,
    opacity: opacite,
  };
}

interface BandeauCommandeProps {
  nomIa: string;
  onOuvrirChat: () => void;
  onAllerAuCreneau: (indexGroupe: number) => void;
}

export const BandeauCommande: React.FC<BandeauCommandeProps> = ({
  nomIa,
  onOuvrirChat,
  onAllerAuCreneau,
}) => {
  const [etat, setEtat] = useState<EtatDuJour>(() => lireEtatDuJour());

  /*
    Deux événements, parce qu'il y a deux façons de modifier la journée : `storage`
    quand le chat applique un plan ou que les Objectifs avancent, et
    EVENEMENT_JOURNEE quand une case est cochée — le Dashboard n'émet pas `storage`
    en écrivant ses routines, il se réveillerait lui-même en boucle.
  */
  useEffect(() => {
    const relire = () => setEtat(lireEtatDuJour());
    window.addEventListener('storage', relire);
    window.addEventListener(EVENEMENT_JOURNEE, relire);
    return () => {
      window.removeEventListener('storage', relire);
      window.removeEventListener(EVENEMENT_JOURNEE, relire);
    };
  }, []);

  const { score, serie, faites, total, prochaine, seriePerdue } = etat;
  const journeeComplete = score >= 100;
  const offset = CIRCONFERENCE - (Math.min(100, Math.max(0, score)) / 100) * CIRCONFERENCE;

  const cocher = (e: React.MouseEvent, id: number) => {
    basculerTache(id, { x: e.clientX, y: e.clientY });
    setEtat(lireEtatDuJour());
  };

  return (
    <section className="bandeau-commande">
      <div className="bandeau-etat">
        <div className="bandeau-mesure">
          {/*
            Le chiffre est dans l'anneau et non à côté : sur un téléphone, c'est la
            seule façon de faire tenir la journée, la série et la prochaine tâche
            sur une seule ligne. Le texte à côté n'apparaît qu'à partir de la
            tablette, où la place ne manque pas.
          */}
          <div className="bandeau-anneau">
            <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
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
            <span className="bandeau-anneau-valeur">{score}</span>
          </div>
          <div className="bandeau-mesure-texte bandeau-texte-large">
            <strong>{score} %</strong>
            <span>{total > 0 ? `${faites}/${total} aujourd’hui` : 'aujourd’hui'}</span>
          </div>
        </div>

        <div className="bandeau-mesure">
          <span className="bandeau-flamme" style={styleFlamme(serie)} aria-hidden="true">🔥</span>
          <div className="bandeau-mesure-texte">
            <strong>{serie} j</strong>
            <span className="bandeau-texte-large">de série</span>
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
              onClick={(e) => cocher(e, prochaine.id)}
              aria-label={`Marquer « ${prochaine.titre} » comme faite`}
              title="Marquer comme faite"
            >
              <Circle size={20} />
            </button>
            <button
              className="bandeau-cible"
              onClick={() => onAllerAuCreneau(prochaine.indexGroupe)}
              title="Voir cette tâche dans la liste"
            >
              <span className="bandeau-libelle bandeau-texte-large">Maintenant</span>
              <span className="bandeau-titre">{prochaine.titre}</span>
              <span className="bandeau-detail">
                {prochaine.creneau}
                {prochaine.duree ? ` · ${prochaine.duree}` : ''}
              </span>
            </button>
          </>
        ) : total > 0 ? (
          <div className="bandeau-fini">
            <CheckCircle2 size={20} />
            <span className="bandeau-cible-texte">
              <span className="bandeau-titre">Journée bouclée</span>
              <span className="bandeau-detail">
                {total} tâche{total > 1 ? 's' : ''} faite{total > 1 ? 's' : ''}
              </span>
            </span>
          </div>
        ) : (
          /*
            Aucune tâche aujourd'hui : c'est l'état normal d'un compte neuf, et le
            geste attendu est de demander un plan. Le bandeau y mène directement,
            plutôt que de laisser une liste vide sans issue.
          */
          <button className="bandeau-vide" onClick={onOuvrirChat}>
            <Sparkles size={18} />
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
      {serie <= 1 && seriePerdue > 1 ? (
        <p className="bandeau-alerte">
          {serie === 0
            ? `Série de ${seriePerdue} jours perdue — la première tâche cochée en relance une.`
            : `Série de ${seriePerdue} jours perdue. La nouvelle a démarré aujourd’hui.`}
        </p>
      ) : (
        /*
          Ce qui se joue, une fois seulement, et jamais en même temps que l'alerte.

          Les trois chiffres du haut décrivent le passé : un score, une série, un
          décompte. Aucun ne demande rien. Cette ligne dit ce qui reste devant —
          et surtout, quand la série est en jeu, elle dit la vérité utile : il
          suffit d'une tâche, pas de la journée entière. Voir `enJeuAujourdhui`.

          La série perdue prime : elle explique un chiffre qui vient de tomber, et
          deux phrases empilées sous un bandeau déjà dense n'en laissent lire
          aucune.
        */
        enJeuAujourdhui({ serie, faites, total }) && (
          <p className="bandeau-enjeu">{enJeuAujourdhui({ serie, faites, total })}</p>
        )
      )}
    </section>
  );
};
