import React, { useState } from 'react';
import { Mail, Check, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import './EtatSecours.css';

/*
  La tournée d'e-mails, déclenchable à la main.

  Elle part seule à 11h. Ce bouton existe pour deux raisons : une tâche planifiée
  qu'on ne peut pas rejouer ne se diagnostique que le lendemain, et un abonné qui
  vient de payer n’a pas à attendre le lendemain pour être remercié.

  **La simulation est le mode par défaut, et le bouton réel est séparé.** Un envoi
  sort du produit et ne se rattrape pas : la liste doit pouvoir se lire avant, pas
  se deviner d'après le code.
*/

interface Bilan {
  simulation: boolean;
  examines: number;
  envoyes: number;
  echecs: number;
  parMotif: Record<string, number>;
  destinataires?: Array<{ email: string; motif: string; inscritIlYA: number }>;
}

/*
  Les barreaux portent leur silence, pas leur numéro.

  Le repli `?? motif` afficherait « decroche_2 », lisible pour qui a écrit le code
  et opaque pour qui lit l'écran — or c'est sur ce décompte qu'on décide d'appuyer
  ou non sur « Envoyer pour de vrai ». Le libellé doit dire de quelle population on
  parle, puisque c'est la seule question qu'on se pose devant cette liste.
*/
const LIBELLES_MOTIF: Record<string, string> = {
  bienvenue: 'accueil rattrapé',
  merci_abonnement: 'merci à un abonné',
  jamais_ouvert: 'jamais ouvert',
  decroche: 'a décroché · 3 jours',
  decroche_2: 'a décroché · 2 semaines',
  decroche_3: 'a décroché · dernier message',
};

export const TourneeEmails: React.FC = () => {
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const [encours, setEncours] = useState(false);
  const [panne, setPanne] = useState<string | null>(null);

  const lancer = async (simulation: boolean) => {
    setEncours(true);
    setPanne(null);
    try {
      setBilan(await api.post(`/emails/relances/run?simulation=${simulation}`, {}));
    } catch (e: any) {
      setPanne(e?.message || 'La tournée n’a pas pu être lancée.');
    } finally {
      setEncours(false);
    }
  };

  return (
    <section className="secours">
      <h2 className="secours-titre">
        <Mail size={20} /> Tournée d’e-mails
      </h2>

      <p className="secours-intro">
        Un seul message par personne et par motif, jamais davantage : merci à ceux
        qui viennent de s’abonner, et quatre reprises de contact pour ceux qui
        s’éloignent — jamais ouvert, puis 3 jours, 2 semaines et 50 jours de
        silence. Le dernier barreau annonce qu’il est le dernier, et c’est vrai :
        plus rien ne part ensuite. Elle démarre seule chaque jour à 11h.
      </p>

      <div className="tournee-boutons">
        <button className="btn-primary secours-bouton" onClick={() => lancer(true)} disabled={encours}>
          {encours ? 'En cours…' : 'Voir qui recevrait quoi'}
        </button>
        <button
          className="secours-bouton tournee-bouton--reel"
          onClick={() => lancer(false)}
          disabled={encours}
        >
          Envoyer pour de vrai
        </button>
      </div>

      {panne && <p className="secours-erreur">{panne}</p>}

      {bilan && (
        <div
          className={
            'secours-resultat ' +
            (bilan.echecs > 0 ? 'secours-resultat--ko' : 'secours-resultat--ok')
          }
        >
          <p className="secours-verdict">
            {bilan.echecs > 0 ? <AlertTriangle size={16} /> : <Check size={16} />}
            {bilan.simulation
              ? `${bilan.envoyes} message(s) partiraient, sur ${bilan.examines} compte(s) examiné(s)`
              : `${bilan.envoyes} message(s) envoyé(s)${bilan.echecs > 0 ? `, ${bilan.echecs} échec(s)` : ''}`}
          </p>

          {Object.keys(bilan.parMotif).length > 0 && (
            <dl className="secours-config">
              {Object.entries(bilan.parMotif).map(([motif, n]) => (
                <React.Fragment key={motif}>
                  <dt>{LIBELLES_MOTIF[motif] ?? motif}</dt>
                  <dd>{n}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {/*
            Les adresses ne sortent qu’en simulation — c’est le serveur qui le
            décide, pas cet affichage. Hors simulation le décompte suffit : une
            réponse d’API n’est pas un endroit où laisser traîner les adresses de
            tout le monde.
          */}
          {bilan.destinataires && bilan.destinataires.length > 0 && (
            <ul className="tournee-liste">
              {bilan.destinataires.map((d) => (
                <li key={d.email + d.motif}>
                  <span>{d.email}</span>
                  <span className="tournee-motif">{LIBELLES_MOTIF[d.motif] ?? d.motif}</span>
                </li>
              ))}
            </ul>
          )}

          {bilan.simulation && bilan.envoyes > 0 && (
            <p className="secours-note">
              Rien n’est parti et rien n’a été écrit. « Envoyer pour de vrai » est
              irréversible : chaque personne ci-dessus recevra son message une fois,
              et ne pourra plus jamais le recevoir une seconde.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
