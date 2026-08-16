import React, { useEffect, useState } from 'react';
import { TrendingUp, UserX, Users, MessageSquare, CreditCard, CalendarClock, KeyRound, ClipboardList } from 'lucide-react';
import { api } from '../services/api';
import './TableauRetention.css';

/*
  Ce que deviennent les gens après leur inscription.

  Le panneau d'administration comptait les arrivées et rien d'autre. C'est le
  chiffre le plus flatteur et le moins utile : il ne dit pas si l'application
  mérite qu'on la fasse connaître. Tant qu'on ignore combien de personnes
  reviennent, faire venir du monde n'apprend qu'une chose — que du monde est venu.

  Deux principes de lecture, tenus jusque dans l'affichage :
  - un taux calculé sur trop peu de monde n'est pas affiché comme un taux ;
  - la base est toujours montrée à côté du pourcentage. « 33 % » sur trois
    personnes et « 33 % » sur trois cents ne se décident pas de la même façon.
*/

interface Fenetre {
  fenetre: number;
  revenus: number;
  base: number;
  taux: number | null;
}

interface Cohorte {
  semaine: string;
  inscrits: number;
  revenusJ7: number;
  base: number;
  tauxJ7: number | null;
}

interface Retention {
  comptes: {
    total: number;
    actifsAujourdhui: number;
    actifs7j: number;
    actifs30j: number;
    jamaisActifs: number;
  };
  retention: Fenetre[];
  entonnoir: {
    inscrits: number;
    ontOuvertUneSession: number;
    ontFiniLeQuestionnaire: number;
    ontAgi: number;
    ontParleAuCoach: number;
    abonnes: number;
  };
  cohortes: Cohorte[];
}

const LIBELLES: Record<number, string> = {
  1: 'Revenus le lendemain',
  7: 'Revenus dans la semaine',
  30: 'Revenus dans le mois',
};

/** En dessous, un pourcentage se lit comme une information alors qu'il n'en est pas une. */
const BASE_MINIMALE = 5;

function formaterSemaine(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const TableauRetention: React.FC = () => {
  const [donnees, setDonnees] = useState<Retention | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/admin/retention')
      .then(setDonnees)
      .catch(() => setErreur("Les chiffres de rétention n'ont pas pu être chargés."));
  }, []);

  if (erreur) return <p className="retention-erreur">{erreur}</p>;
  if (!donnees) return <p className="retention-attente">Calcul en cours…</p>;

  const { comptes, retention, entonnoir, cohortes } = donnees;
  /*
    Les deux marches du milieu sont les murs qu'on ne voyait pas. « Inscrits » puis
    « Ont fait au moins une action » ne laissait qu'une chute de vingt-six points
    sans nom : impossible de savoir si les gens se perdaient sur le code envoyé par
    e-mail ou sur les six questions qui suivent. Ce sont deux problèmes distincts,
    et deux corrections distinctes.
  */
  const marches = [
    { cle: 'inscrits', libelle: 'Inscrits', valeur: entonnoir.inscrits, icone: Users },
    { cle: 'session', libelle: 'Sont entrés dans l\'app', valeur: entonnoir.ontOuvertUneSession, icone: KeyRound },
    { cle: 'questionnaire', libelle: 'Ont fini le questionnaire', valeur: entonnoir.ontFiniLeQuestionnaire, icone: ClipboardList },
    { cle: 'agi', libelle: 'Ont fait au moins une action', valeur: entonnoir.ontAgi, icone: TrendingUp },
    { cle: 'coach', libelle: 'Ont parlé au coach', valeur: entonnoir.ontParleAuCoach, icone: MessageSquare },
    { cle: 'abonnes', libelle: 'Abonnés', valeur: entonnoir.abonnes, icone: CreditCard },
  ];

  return (
    <section className="retention">
      <h2 className="retention-titre">
        <CalendarClock size={20} /> Rétention
      </h2>

      <div className="retention-cartes">
        {retention.map((f) => (
          <div key={f.fenetre} className="retention-carte glass-panel">
            <span className="retention-carte__libelle">{LIBELLES[f.fenetre] ?? `J+${f.fenetre}`}</span>
            {f.taux === null || f.base < BASE_MINIMALE ? (
              <>
                <span className="retention-carte__valeur retention-carte__valeur--vide">—</span>
                <span className="retention-carte__base">
                  {f.base === 0
                    ? `aucun compte n'a encore ${f.fenetre} jour${f.fenetre > 1 ? 's' : ''}`
                    : `seulement ${f.base} compte${f.base > 1 ? 's' : ''} concerné${f.base > 1 ? 's' : ''}`}
                </span>
              </>
            ) : (
              <>
                <span className="retention-carte__valeur">{f.taux} %</span>
                <span className="retention-carte__base">
                  {f.revenus} sur {f.base} comptes assez anciens
                </span>
              </>
            )}
          </div>
        ))}

        <div className="retention-carte glass-panel retention-carte--alerte">
          <span className="retention-carte__libelle">
            <UserX size={14} /> Jamais utilisés
          </span>
          <span className="retention-carte__valeur">{comptes.jamaisActifs}</span>
          <span className="retention-carte__base">
            comptes créés puis jamais ouverts, sur {comptes.total}
          </span>
        </div>
      </div>

      <div className="retention-actifs">
        <span>
          Actifs aujourd'hui : <strong>{comptes.actifsAujourdhui}</strong>
        </span>
        <span>
          Sur 7 jours : <strong>{comptes.actifs7j}</strong>
        </span>
        <span>
          Sur 30 jours : <strong>{comptes.actifs30j}</strong>
        </span>
      </div>

      <h3 className="retention-sous-titre">Où on les perd</h3>
      <div className="retention-entonnoir">
        {marches.map((m, i) => {
          const Icone = m.icone;
          const part = entonnoir.inscrits === 0 ? 0 : (m.valeur / entonnoir.inscrits) * 100;
          // Ce qui se perd sur cette marche-là, et pas depuis le départ. Le total
          // rapporté aux inscrits dit qu'on perd du monde ; l'écart avec la marche
          // précédente dit où. C'est le second qui désigne quoi réparer.
          const precedente = i === 0 ? null : marches[i - 1].valeur;
          const perdus = precedente === null ? 0 : precedente - m.valeur;
          return (
            <div key={m.cle} className="retention-marche">
              <span className="retention-marche__libelle">
                <Icone size={14} /> {m.libelle}
              </span>
              <div className="retention-marche__piste">
                <div className="retention-marche__jauge" style={{ width: `${Math.max(part, 1.5)}%` }} />
              </div>
              <span className="retention-marche__valeur">
                {m.valeur}
                <span className="retention-marche__part">
                  {entonnoir.inscrits === 0 ? '' : ` · ${Math.round(part)} %`}
                </span>
                {perdus > 0 && (
                  <span className="retention-marche__perte" title={`${perdus} perdus depuis « ${marches[i - 1].libelle} »`}>
                    −{perdus}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <h3 className="retention-sous-titre">Par semaine d'arrivée</h3>
      {cohortes.length === 0 ? (
        <p className="retention-attente">Aucune inscription sur les huit dernières semaines.</p>
      ) : (
        <div className="retention-tableau-cadre">
          <table className="retention-tableau">
            <thead>
              <tr>
                <th>Semaine du</th>
                <th>Inscrits</th>
                <th>Revenus sous 7 j</th>
              </tr>
            </thead>
            <tbody>
              {cohortes.map((c) => (
                <tr key={c.semaine}>
                  <td>{formaterSemaine(c.semaine)}</td>
                  <td>{c.inscrits}</td>
                  <td>
                    {c.tauxJ7 === null ? (
                      <span className="retention-trop-jeune">trop récent</span>
                    ) : (
                      <>
                        {c.revenusJ7} / {c.base}
                        <span className="retention-marche__part"> · {c.tauxJ7} %</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="retention-note">
        Une cohorte trop récente n'a pas de taux : un compte créé hier ne peut pas
        « ne pas être revenu dans la semaine ». Le compter ferait passer une semaine
        normale pour un échec.
      </p>
    </section>
  );
};
