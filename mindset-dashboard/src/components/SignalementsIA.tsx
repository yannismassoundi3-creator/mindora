import React, { useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { api } from '../services/api';
import './SignalementsIA.css';

/*
  Les réponses du coach que des gens ont signalées.

  Le bouton de signalement dans le chat ne vaut que par cet écran : un
  signalement que personne ne lit n'est pas un garde-fou, c'est l'illusion d'un
  garde-fou — et cette application a déjà payé plusieurs fois le prix des choses
  qui échouent en silence.

  Chargé à l'ouverture du panneau, sans bouton : contrairement au test des
  modèles ou du secours, lire une liste ne coûte ni appel payant ni quota.
*/

interface Signalement {
  id: string;
  quand: string;
  prenom: string;
  email: string;
  message: string;
  motif: string | null;
}

export const SignalementsIA: React.FC = () => {
  const [total, setTotal] = useState<number | null>(null);
  const [liste, setListe] = useState<Signalement[]>([]);
  const [panne, setPanne] = useState(false);

  useEffect(() => {
    api
      .get('/admin/signalements')
      .then((r: any) => {
        setTotal(r.total);
        setListe(r.signalements ?? []);
      })
      .catch(() => setPanne(true));
  }, []);

  return (
    <section className="signalements">
      <h2 className="signalements-titre">
        <Flag size={20} /> Réponses signalées
      </h2>

      <p className="signalements-intro">
        Ce que le coach a écrit et qu'on lui a reproché. Chaque ligne est une personne
        qui a lu quelque chose de choquant, de faux ou de dangereux — c'est le seul
        endroit où on l'apprend.
      </p>

      {panne && <p className="signalements-vide">La liste n’a pas pu être chargée.</p>}

      {!panne && total === 0 && (
        <p className="signalements-vide">Aucun signalement. C’est la bonne nouvelle.</p>
      )}

      {liste.map((s) => (
        <article key={s.id} className="signalement">
          <header className="signalement-tete">
            <span className="signalement-qui">{s.prenom}</span>
            <span className="signalement-quand">
              {new Date(s.quand).toLocaleString('fr-FR', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </header>
          {/* Le texte exact, sans coupe : le juger sur un extrait n'aurait aucun sens. */}
          <p className="signalement-message">{s.message}</p>
          {s.motif && <p className="signalement-motif">« {s.motif} »</p>}
        </article>
      ))}

      {total !== null && total > liste.length && (
        <p className="signalements-vide">
          {total} au total, les {liste.length} plus récents sont affichés.
        </p>
      )}
    </section>
  );
};
