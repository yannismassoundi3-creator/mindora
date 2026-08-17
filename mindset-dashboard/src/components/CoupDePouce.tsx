import React, { useEffect, useState } from 'react';
import { Flame, RotateCcw, Target } from 'lucide-react';
import { api } from '../services/api';
import './CoupDePouce.css';

/*
  Une chose à faire, maintenant.

  Demandé par un utilisateur le 17 août 2026 : « sur la page objectif tu pourrais
  un petit truc qui donne une chose à faire ». Il ignorait que l'application le
  faisait déjà — mais uniquement par notification, et il ne les avait pas
  activées. Le moteur était donc invisible pour lui, comme pour la plupart des
  comptes.

  Ce n'est donc pas une fonction nouvelle : c'est la même, sur la surface où les
  gens sont réellement.

  **Deux choses qu'elle ne fait pas, et qui la définissent.**

  Elle ne tourne pas sur une horloge. Il avait proposé « qui change toutes les 2h
  3h » ; une suggestion qui apparaît parce que le temps a passé se lit comme du
  bruit au bout de trois jours — c'est ce qui était arrivé au check-in du soir,
  identique pour tout le monde. Elle change quand la *raison* change.

  Elle n'invente aucune action. « Fais 20 pompes » chez quelqu'un dont le plan
  n'en prévoit pas contredit le plan que le coach a lui-même écrit, et se lit
  comme un reproche. La carte ne nomme que des tâches déjà présentes dans ses
  listes, telles qu'il les a écrites.
*/

interface Pousse {
  afficher: boolean;
  raison?: 'reprise' | 'aFinir' | 'serie';
  texte?: string;
  /** La tâche à faire, telle que la personne l'a écrite. */
  action?: string | null;
  serie?: number;
}

const ICONES = {
  reprise: RotateCcw,
  aFinir: Target,
  serie: Flame,
} as const;

const TITRES = {
  reprise: 'Reprends ici',
  aFinir: 'Une chose à faire',
  serie: 'Ta série tient',
} as const;

export const CoupDePouce: React.FC = () => {
  const [pousse, setPousse] = useState<Pousse | null>(null);

  useEffect(() => {
    api
      .get('/push/coup-de-pouce')
      .then(setPousse)
      // Silencieux : cette carte est un bonus. Afficher « impossible de charger
      // ton conseil » serait pire que ne rien afficher — on annoncerait une panne
      // à quelqu'un qui ne savait pas qu'il manquait quelque chose.
      .catch(() => setPousse({ afficher: false }));
  }, []);

  if (!pousse?.afficher || !pousse.raison) return null;

  const Icone = ICONES[pousse.raison];

  return (
    <section className={`pousse glass-panel pousse--${pousse.raison}`}>
      <span className="pousse-titre">
        <Icone size={15} /> {TITRES[pousse.raison]}
      </span>

      {/* La tâche d'abord, en gros : c'est la réponse à « je fais quoi ? ». */}
      {pousse.action && <p className="pousse-action">{pousse.action}</p>}

      {/* Puis le fait qui justifie qu'on en parle. Sans lui, ce serait un slogan. */}
      <p className="pousse-fait">{pousse.texte}</p>
    </section>
  );
};
