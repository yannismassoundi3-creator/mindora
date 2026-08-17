import React, { useEffect, useState } from 'react';
import { Sunrise, UserPlus, MessageSquare, Send, Users } from 'lucide-react';
import { api } from '../services/api';
import './TableauJour.css';

/*
  La journée en cours.

  Le reste du panneau raisonne en semaines : utile pour savoir si le produit
  retient, inutile le jour où l'on vient de le faire connaître quelque part. Ce
  bloc-ci répond à la question qu'on se pose ce jour-là — combien sont arrivés
  aujourd'hui, et sont-ils allés jusqu'au coach.

  Les deux nombres sont montrés ensemble et jamais l'un sans l'autre : des
  inscriptions sans une seule conversation ne sont pas une bonne journée, ce sont
  des lignes en base.
*/

interface Jour {
  date: string;
  inscrits: number;
  /** Parmi les inscrits de ce jour-là, ceux qui ont parlé au coach le jour même. */
  inscritsAyantParleAuCoach: number;
  /** Tous comptes confondus, anciens compris. */
  ontParleAuCoach: number;
  messages: number;
  /**
   * Les plans demandés automatiquement à la fin du questionnaire.
   *
   * Ce message part au nom de la personne sans qu'elle l'écrive. Compté comme une
   * conversation, il affichait « 9 inscrits, 9 ont parlé au coach » — une
   * conversion parfaite et entièrement mécanique. Il est donc sorti du compte, et
   * montré ici pour que le nouveau chiffre reste explicable.
   */
  plansAutomatiques: number;
}

interface Quotidien {
  fuseau: string;
  aujourdhui: Jour & {
    ontOuvertUneSession: number;
    ontFiniLeQuestionnaire: number;
  };
  hier: Jour | null;
  jours: Jour[];
  /**
   * D'où viennent les inscrits des quatorze derniers jours.
   *
   * `(lien nu)` regroupe ceux arrivés sans marque — comptes antérieurs à la mesure
   * compris. Ce nombre-là est le plus utile au début : il dit quelle part des
   * arrivées reste aveugle.
   */
  provenances: Array<{ source: string; inscrits: number; ontParleAuCoach: number }>;
  /**
   * Toutes les arrivées des quatorze jours, pas seulement celles d'aujourd'hui.
   *
   * Le tableau nominatif se vidait chaque nuit : le lendemain d'une bonne soirée,
   * les gens arrivés la veille disparaissaient avec leur nombre de messages, au
   * moment précis où l'on veut voir ce qu'ils sont devenus.
   *
   * `messagesAuCoach` compte ici **tout ce que la personne a écrit depuis son
   * arrivée**, et non ce qu'elle a écrit le jour de son inscription : sur une
   * ligne vieille de dix jours, le second ne voudrait plus rien dire.
   */
  inscritsRecents: Array<{
    id: string;
    prenom: string;
    email: string;
    jour: string;
    heure: string;
    entre: boolean;
    questionnaireFini: boolean;
    source: string | null;
    messagesAuCoach: number;
    dernierMessage: string | null;
  }>;
  inscritsDuJour: Array<{
    id: string;
    prenom: string;
    email: string;
    heure: string;
    emailVerifie: boolean;
    entre: boolean;
    questionnaireFini: boolean;
    messagesAuCoach: number;
  }>;
}

function formaterJour(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** L'écart avec la veille, écrit comme on le dit : « +3 » ou « −1 ». */
function ecart(aujourdhui: number, hier: number | null | undefined): string | null {
  if (hier === null || hier === undefined) return null;
  const delta = aujourdhui - hier;
  if (delta === 0) return `autant qu'hier (${hier})`;
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} par rapport à hier (${hier})`;
}

export const TableauJour: React.FC = () => {
  const [donnees, setDonnees] = useState<Quotidien | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/admin/quotidien')
      .then(setDonnees)
      .catch(() => setErreur("Les chiffres du jour n'ont pas pu être chargés."));
  }, []);

  if (erreur) return <p className="jour-erreur">{erreur}</p>;
  if (!donnees) return <p className="jour-attente">Lecture de la journée…</p>;

  const { aujourdhui, hier, jours, inscritsDuJour, provenances } = donnees;
  // Repli sur la liste du jour tant que l'API déployée ne rend pas encore la
  // liste longue : les deux moitiés se déploient séparément, et un écran vide
  // pendant l'intervalle serait pris pour une perte de données.
  const recents = donnees.inscritsRecents ?? [];

  /*
    Toutes les barres se lisent contre la même échelle, sinon deux journées de
    hauteurs égales ne veulent pas dire le même nombre. L'échelle ne retient que
    les inscrits — la seule série dessinée : y mêler le nombre de conversations
    écraserait toutes les barres sans que rien à l'écran n'explique pourquoi. Le
    plancher à 1 évite une division par zéro les jours vides.
  */
  const sommet = Math.max(1, ...jours.map((j) => j.inscrits));

  const cartes = [
    {
      cle: 'inscrits',
      icone: UserPlus,
      libelle: "Inscrits aujourd'hui",
      valeur: aujourdhui.inscrits,
      detail: ecart(aujourdhui.inscrits, hier?.inscrits),
    },
    {
      cle: 'nouveaux-coach',
      icone: MessageSquare,
      libelle: 'Dont ont vraiment écrit au coach',
      valeur: aujourdhui.inscritsAyantParleAuCoach,
      detail:
        aujourdhui.inscrits === 0
          ? 'aucune inscription à convertir'
          : `sur ${aujourdhui.inscrits} arrivé${aujourdhui.inscrits > 1 ? 's' : ''} · le plan demandé automatiquement ne compte pas`,
      alerte: aujourdhui.inscrits > 0 && aujourdhui.inscritsAyantParleAuCoach === 0,
    },
    {
      cle: 'coach',
      icone: Users,
      libelle: 'Ont parlé au coach',
      valeur: aujourdhui.ontParleAuCoach,
      detail: 'tous comptes confondus, anciens compris',
    },
    {
      cle: 'messages',
      icone: Send,
      libelle: 'Messages envoyés',
      valeur: aujourdhui.messages,
      detail: "questions posées au coach, réponses de l'IA non comptées",
    },
  ];

  return (
    <section className="jour">
      <h2 className="jour-titre">
        <Sunrise size={20} /> Aujourd'hui
        <span className="jour-titre__fuseau">heure de Paris</span>
      </h2>

      <div className="jour-cartes">
        {cartes.map((c) => {
          const Icone = c.icone;
          return (
            <div
              key={c.cle}
              className={`jour-carte glass-panel${c.alerte ? ' jour-carte--alerte' : ''}`}
            >
              <span className="jour-carte__libelle">
                <Icone size={14} /> {c.libelle}
              </span>
              <span className="jour-carte__valeur">{c.valeur}</span>
              {c.detail && <span className="jour-carte__detail">{c.detail}</span>}
            </div>
          );
        })}
      </div>

      {aujourdhui.inscrits > 0 && (
        <p className="jour-marches">
          Sur ces {aujourdhui.inscrits} inscrit{aujourdhui.inscrits > 1 ? 's' : ''} :{' '}
          <strong>{aujourdhui.ontOuvertUneSession}</strong> {aujourdhui.ontOuvertUneSession > 1 ? 'sont entrés' : 'est entré'} dans
          l'app, <strong>{aujourdhui.ontFiniLeQuestionnaire}</strong> {aujourdhui.ontFiniLeQuestionnaire > 1 ? 'ont' : 'a'} fini le
          questionnaire.
        </p>
      )}

      {/*
        Sorti de la phrase ci-dessus : celle-ci ne parle que des inscrits du jour,
        alors que ce compte-ci porte sur tous les comptes. Écrits à la suite, les
        deux se lisaient comme une même population — « 13 ont fini le
        questionnaire, 12 plans demandés » invitait à chercher la personne
        manquante, qui n'existe peut-être pas.
      */}
      {aujourdhui.plansAutomatiques > 0 && (
        <p className="jour-marches">
          Par ailleurs, tous comptes confondus,{' '}
          <strong>{aujourdhui.plansAutomatiques}</strong> plan
          {aujourdhui.plansAutomatiques > 1 ? 's ont' : ' a'} été demandé
          {aujourdhui.plansAutomatiques > 1 ? 's' : ''} automatiquement en fin de
          questionnaire aujourd'hui — ce n'est pas une conversation, et ce n'est pas
          compté comme telle.
        </p>
      )}

      <h3 className="jour-sous-titre">Les quatorze derniers jours</h3>
      <div className="jour-graphique">
        {jours.map((j) => {
          const estAujourdhui = j.date === aujourdhui.date;
          return (
            <div
              key={j.date}
              className={`jour-colonne${estAujourdhui ? ' jour-colonne--aujourdhui' : ''}`}
              title={`${formaterJour(j.date)} · ${j.inscrits} inscrit${j.inscrits > 1 ? 's' : ''}, dont ${j.inscritsAyantParleAuCoach} ${j.inscritsAyantParleAuCoach > 1 ? 'ont' : 'a'} écrit au coach · ${j.ontParleAuCoach} au coach en tout · ${j.plansAutomatiques} plan${j.plansAutomatiques > 1 ? 's' : ''} auto`}
            >
              <span className="jour-colonne__nombre">{j.inscrits || ''}</span>
              <div className="jour-colonne__piste">
                {/*
                  Une seule barre, dont une part est pleine : les inscrits qui ont
                  parlé au coach sont un sous-ensemble des inscrits, pas une
                  seconde série. Deux barres côte à côte laisseraient croire qu'on
                  peut avoir plus de conversations que d'arrivées.
                */}
                <div
                  className="jour-colonne__barre"
                  style={{
                    height: `${(j.inscrits / sommet) * 100}%`,
                    // Le minimum ne vaut que pour un jour où quelqu'un est venu :
                    // il sert à rendre visible un petit nombre, pas à dessiner un
                    // trait là où il n'y a personne — un jour vide qui montre
                    // deux pixels se lit comme un jour à un inscrit.
                    minHeight: j.inscrits > 0 ? 2 : 0,
                  }}
                >
                  <div
                    className="jour-colonne__barre-coach"
                    style={{
                      height:
                        j.inscrits === 0
                          ? '0%'
                          : `${(j.inscritsAyantParleAuCoach / j.inscrits) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <span className="jour-colonne__date">{formaterJour(j.date)}</span>
            </div>
          );
        })}
      </div>

      <div className="jour-legende">
        <span>
          <i className="jour-pastille jour-pastille--inscrits" /> Inscrits du jour
        </span>
        <span>
          <i className="jour-pastille jour-pastille--coach" /> Dont ont écrit eux-mêmes au coach
        </span>
      </div>

      <h3 className="jour-sous-titre">D'où ils viennent · quatorze jours</h3>
      {provenances.length === 0 ? (
        <p className="jour-attente">Aucune inscription sur la période.</p>
      ) : (
        <div className="jour-tableau-cadre">
          <table className="jour-tableau">
            <thead>
              <tr>
                <th>Provenance</th>
                <th>Inscrits</th>
                <th>Dont ont écrit au coach</th>
              </tr>
            </thead>
            <tbody>
              {provenances.map((p) => (
                <tr key={p.source}>
                  <td>
                    {p.source === '(lien nu)' ? (
                      <span className="jour-non">lien sans marque</span>
                    ) : (
                      <strong>{p.source}</strong>
                    )}
                  </td>
                  <td>{p.inscrits}</td>
                  <td>{p.ontParleAuCoach}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="jour-note">
        La provenance est celle du lien suivi : ajoute <code>?s=dm</code> ou{' '}
        <code>?s=com</code> à l'adresse que tu donnes, et l'inscription se rangera
        sous cette étiquette. Elle est retenue au premier chargement et gardée
        jusqu'à la création du compte — entre les deux, l'adresse a perdu son
        paramètre depuis longtemps. La première vue gagne : quelqu'un qui arrive par
        une story puis revient par la bio s'est décidé sur la story. Tout ce qui
        précède le 17 août 2026 est forcément sans marque.
      </p>

      <h3 className="jour-sous-titre">Qui est arrivé aujourd'hui</h3>
      {inscritsDuJour.length === 0 ? (
        <p className="jour-attente">Aucune inscription depuis minuit.</p>
      ) : (
        <div className="jour-tableau-cadre">
          <table className="jour-tableau">
            <thead>
              <tr>
                <th>Heure</th>
                <th>Personne</th>
                <th>Entré</th>
                <th>Questionnaire</th>
                <th>Coach</th>
              </tr>
            </thead>
            <tbody>
              {inscritsDuJour.map((p) => (
                <tr key={p.id}>
                  <td>{p.heure}</td>
                  <td>
                    <span className="jour-personne__prenom">{p.prenom}</span>
                    <span className="jour-personne__email">{p.email}</span>
                  </td>
                  <td>{p.entre ? '✓' : <span className="jour-non">—</span>}</td>
                  <td>{p.questionnaireFini ? '✓' : <span className="jour-non">—</span>}</td>
                  <td>
                    {p.messagesAuCoach > 0 ? (
                      <strong>{p.messagesAuCoach} msg</strong>
                    ) : (
                      <span className="jour-non">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recents.length > inscritsDuJour.length && (
        <>
          <h3 className="jour-sous-titre">Tous les arrivants · quatorze jours</h3>
          <div className="jour-tableau-cadre">
            <table className="jour-tableau">
              <thead>
                <tr>
                  <th>Arrivé le</th>
                  <th>Personne</th>
                  <th>Entré</th>
                  <th>Questionnaire</th>
                  <th>Coach</th>
                  <th>Dernier message</th>
                </tr>
              </thead>
              <tbody>
                {recents.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {formaterJour(p.jour)}
                      <span className="jour-personne__email"> {p.heure}</span>
                    </td>
                    <td>
                      <span className="jour-personne__prenom">{p.prenom}</span>
                      <span className="jour-personne__email">{p.email}</span>
                    </td>
                    <td>{p.entre ? '✓' : <span className="jour-non">—</span>}</td>
                    <td>{p.questionnaireFini ? '✓' : <span className="jour-non">—</span>}</td>
                    <td>
                      {p.messagesAuCoach > 0 ? (
                        <strong>{p.messagesAuCoach} msg</strong>
                      ) : (
                        <span className="jour-non">—</span>
                      )}
                    </td>
                    <td>
                      {p.dernierMessage ? (
                        formaterJour(p.dernierMessage)
                      ) : (
                        <span className="jour-non">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="jour-note">
            Ici, <strong>« Coach » compte tout ce que la personne a écrit depuis son
            arrivée</strong>, pas ce qu'elle a écrit le jour de son inscription — sur
            une ligne vieille de dix jours, le second ne voudrait plus rien dire. La
            colonne « Dernier message » est celle qui distingue quelqu'un qui a parlé
            une fois le premier soir de quelqu'un qui revient parler.
          </p>
        </>
      )}

      <p className="jour-note">
        Les journées commencent à minuit heure de Paris, pas à minuit UTC : sans
        cela, tout ce qui arrive entre minuit et 2 h serait rangé dans la veille.
        Le message que le questionnaire envoie au coach à la place de la personne
        est exclu partout : il partait pour tout le monde, et faisait afficher une
        conversion parfaite là où il n'y avait qu'un automatisme.
      </p>
    </section>
  );
};
