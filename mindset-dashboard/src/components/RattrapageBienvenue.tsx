import React, { useState } from 'react';
import { UserPlus, Check, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import './EtatSecours.css';

/*
  L'accueil de ceux qui étaient déjà inscrits avant que l'accueil existe.

  Le message de bienvenue part à l'inscription depuis le 20 août 2026. Tous ceux
  qui étaient là avant n'ont jamais rien reçu : cet écran vide cet arriéré, une
  fois, à la main.

  **Il part par lots, et c'est le point important.** Le domaine d'envoi est neuf —
  il n'a aucun historique de réputation. Cinquante messages d'un seul geste depuis
  un domaine sans passé est le profil exact d'un expéditeur compromis, et la
  sanction n'emporterait pas que ces messages : les codes de connexion partent de
  la même adresse. Le défaut est donc prudent, et c'est un choix explicite d'aller
  plus vite.
*/

interface Bilan {
  simulation: boolean;
  aAccueillir: number;
  /** Ceux qui ont reçu un autre message cette semaine et attendent leur tour. */
  differes: number;
  envoyes: number;
  echecs: number;
  restants: number;
  destinataires?: Array<{ email: string; inscritIlYA: number }>;
}

const LOTS = [10, 25, 50];

export const RattrapageBienvenue: React.FC = () => {
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const [lot, setLot] = useState(10);
  const [encours, setEncours] = useState(false);
  const [panne, setPanne] = useState<string | null>(null);

  const lancer = async (simulation: boolean) => {
    setEncours(true);
    setPanne(null);
    try {
      setBilan(await api.post(`/emails/bienvenue/rattrapage?simulation=${simulation}&max=${lot}`, {}));
    } catch (e: any) {
      setPanne(e?.message || 'Le rattrapage n’a pas pu être lancé.');
    } finally {
      setEncours(false);
    }
  };

  return (
    <section className="secours">
      <h2 className="secours-titre">
        <UserPlus size={20} /> Accueillir les déjà-inscrits
      </h2>

      <p className="secours-intro">
        Le message de bienvenue part à l’inscription. Ceux qui s’étaient inscrits
        avant n’ont jamais rien reçu : ils reçoivent ici une version qui dit son
        propre retard, et qui demande la même chose — parler au coach une fois.
        Une seule par personne, jamais deux.
      </p>

      <label className="rattrapage-lot">
        Par lot de
        <select value={lot} onChange={(e) => setLot(Number(e.target.value))} disabled={encours}>
          {LOTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className="tournee-boutons">
        <button className="btn-primary secours-bouton" onClick={() => lancer(true)} disabled={encours}>
          {encours ? 'En cours…' : 'Voir qui recevrait l’accueil'}
        </button>
        <button
          className="secours-bouton tournee-bouton--reel"
          onClick={() => lancer(false)}
          disabled={encours}
        >
          Envoyer ce lot pour de vrai
        </button>
      </div>

      {panne && <p className="secours-erreur">{panne}</p>}

      {bilan && (
        <div
          className={
            'secours-resultat ' + (bilan.echecs > 0 ? 'secours-resultat--ko' : 'secours-resultat--ok')
          }
        >
          <p className="secours-verdict">
            {bilan.echecs > 0 ? <AlertTriangle size={16} /> : <Check size={16} />}
            {bilan.simulation
              ? `${bilan.envoyes} accueil(s) partiraient — ${bilan.aAccueillir} compte(s) n’ont jamais rien reçu`
              : `${bilan.envoyes} accueil(s) envoyé(s)${bilan.echecs > 0 ? `, ${bilan.echecs} échec(s)` : ''}`}
          </p>

          {/*
            Le chiffre qui dit s'il faut recliquer. Un rattrapage à moitié fait
            ressemble en tout point à un rattrapage fini : sans ce reste, on
            s'arrête en croyant avoir terminé.
          */}
          <p className="secours-note">
            {bilan.restants > 0
              ? `${bilan.restants} compte(s) restent à accueillir après ce lot.`
              : 'Plus personne n’attend son accueil.'}
            {/*
              Sans cette phrase, un arriéré qui cesse de descendre passe pour une
              panne : les boutons répondent « 0 envoyé » alors qu'il reste du
              monde, et rien n'explique pourquoi.
            */}
            {bilan.differes > 0 && (
              <>
                {' '}
                Dont {bilan.differes} qui ont reçu un autre message cette semaine —
                ils repasseront d’eux-mêmes : on n’écrit pas deux fois à la même
                personne en si peu de temps.
              </>
            )}
          </p>

          {bilan.destinataires && bilan.destinataires.length > 0 && (
            <ul className="tournee-liste">
              {bilan.destinataires.map((d) => (
                <li key={d.email}>
                  <span>{d.email}</span>
                  <span className="tournee-motif">inscrit il y a {d.inscritIlYA} j</span>
                </li>
              ))}
            </ul>
          )}

          {bilan.simulation && bilan.envoyes > 0 && (
            <p className="secours-note">
              Rien n’est parti et rien n’a été écrit. L’envoi est irréversible :
              chaque personne ci-dessus recevra son message une fois, et ne pourra
              plus jamais le recevoir une seconde.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
