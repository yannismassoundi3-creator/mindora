import React, { useEffect, useState } from 'react';
import { Sunrise } from 'lucide-react';
import { api } from '../services/api';
import './JourDeux.css';

/*
  Le deuxième jour, et les deux seules choses qui peuvent le créer.

  Deux tiers des comptes qui agissent n'agissent qu'un seul jour ; la médiane est
  d'une journée d'activité. Le produit dispose d'exactement deux mécanismes pour
  ramener quelqu'un le lendemain — la notification du matin et la relance par
  e-mail — et **aucun des deux n'apparaissait dans ce panneau**. On ne pouvait donc
  pas savoir s'ils touchent dix personnes ou trois, ni si l'un des deux avait cessé
  de fonctionner.

  La distinction que cet écran existe pour montrer : **« joignable » n'est pas
  « a accepté »**. Une permission accordée sur un iPhone qui n'a pas installé
  l'application ne produit aucun abonnement, et le brief du matin n'atteindra
  jamais cette personne. C'est la différence entre les deux chiffres du haut qui
  dit s'il faut convaincre, ou faire installer.
*/

interface Etat {
  comptes: number;
  joignablesParPush: number;
  permissions: { etat: string; comptes: number }[];
  relances: { parMotif: { motif: string; envoyees: number }[]; derniere: string | null };
  briefsEmail: {
    creneauxActifs: string[];
    parCreneau: { creneau: string; envoyes: number }[];
    dernier: string | null;
  };
  effetAccueil: {
    depuis: string;
    avant: Groupe;
    apres: Groupe;
    /** Combien, parmi les inscrits depuis, portent la trace d'un envoi réussi. */
    accueillis: number;
  };
}

interface Groupe {
  comptes: number;
  /** Ceux qui ont déjà eu leur lendemain. Les autres n'ont pas d'avis à donner. */
  mesurables: number;
  revenus: number;
  tauxJ1: number | null;
}

/**
 * En deçà, on lit du bruit.
 *
 * Un taux sur trois personnes bascule de 33 points quand une seule change d'avis.
 * L'afficher sans le dire, c'est fabriquer une décision à partir d'une pièce
 * lancée — et ici la décision est « faut-il continuer ».
 */
const MINIMUM_LISIBLE = 10;

/** Les codes bruts de la base, dits en français. */
const LIBELLES: Record<string, string> = {
  accorde: 'ont accepté',
  refuse: 'ont refusé',
  non_supporte: 'navigateur sans notifications',
  ios_a_installer: 'iPhone — app non installée',
  reporte: 'ont repoussé la question',
  jamais_ouvert: 'jamais entrés dans l’app',
  decroche: 'ont décroché',
  merci_abonnement: 'ont été remerciés',
  bienvenue: 'ont reçu l’accueil',
};

const dire = (code: string) => LIBELLES[code] ?? code;

/*
  Les motifs que seule la tournée de 11 h peut produire.

  `bienvenue` partage la même table mais part à l'inscription, et `merci_abonnement`
  répond à un paiement : tous deux se rempliraient tout seuls. Compter la ligne
  totale reviendrait à masquer un cron mort derrière des messages qu'il n'a pas
  envoyés — l'alerte ci-dessous ne se déclencherait plus jamais.
*/
const MOTIFS_DE_LA_TOURNEE = ['jamais_ouvert', 'decroche'];

export const JourDeux: React.FC = () => {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [panne, setPanne] = useState(false);

  useEffect(() => {
    api
      .get('/admin/jour-deux')
      .then(setEtat)
      .catch(() => setPanne(true));
  }, []);

  if (panne) return <p className="jour2-vide">La portée du jour 2 n’a pas pu être chargée.</p>;
  if (!etat) return null;

  const part = etat.comptes > 0 ? Math.round((etat.joignablesParPush / etat.comptes) * 100) : 0;

  return (
    <section className="jour2">
      <h2 className="jour2-titre">
        <Sunrise size={20} /> Ce qui peut les ramener demain
      </h2>

      <p className="jour2-intro">
        La notification du matin et la relance par e-mail sont les deux seuls mécanismes
        capables de créer un deuxième jour. Voici combien de personnes ils atteignent.
      </p>

      <div className="jour2-chiffres">
        <div className="jour2-carte">
          <span className="jour2-nombre">{etat.joignablesParPush}</span>
          <span className="jour2-libelle">
            joignables par notification
            <br />
            <span className="jour2-detail">
              sur {etat.comptes} comptes · {part} %
            </span>
          </span>
        </div>

        <div className="jour2-carte">
          <span className="jour2-nombre">{etat.comptes}</span>
          <span className="jour2-libelle">
            joignables par e-mail
            <br />
            <span className="jour2-detail">tout le monde, par construction</span>
          </span>
        </div>
      </div>

      <h3 className="jour2-sous">Ce que les appareils ont répondu</h3>
      {etat.permissions.length === 0 ? (
        <p className="jour2-vide">Aucune réponse enregistrée pour l’instant.</p>
      ) : (
        <ul className="jour2-liste">
          {etat.permissions.map((p) => (
            <li key={p.etat}>
              <span>{dire(p.etat)}</span>
              <strong>{p.comptes}</strong>
            </li>
          ))}
        </ul>
      )}

      <h3 className="jour2-sous">Brief porté par e-mail</h3>
      {/*
        Le brief ne partait que par notification, donc à 12 % des comptes. Il part
        désormais par e-mail à ceux que la notification n'atteint pas — et ce
        décompte est le seul endroit où l'on peut s'en apercevoir : un canal qui
        cesse de fonctionner ne lève aucune erreur, il ne fait rien tous les matins.
      */}
      <p className="jour2-detail">
        Créneaux allumés :{' '}
        <strong>{etat.briefsEmail?.creneauxActifs?.join(', ') || 'aucun'}</strong> — les autres
        attendent que le domaine ait fait ses preuves.
      </p>
      {!etat.briefsEmail?.parCreneau?.length ? (
        <p className="jour2-vide">Aucun brief encore parti par e-mail.</p>
      ) : (
        <>
          <ul className="jour2-liste">
            {etat.briefsEmail.parCreneau.map((b) => (
              <li key={b.creneau}>
                <span>{b.creneau}</span>
                <strong>{b.envoyes}</strong>
              </li>
            ))}
          </ul>
          <p className="jour2-detail">
            Dernier parti le{' '}
            {etat.briefsEmail.dernier
              ? new Date(etat.briefsEmail.dernier).toLocaleString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'}
          </p>
        </>
      )}

      <h3 className="jour2-sous">Relances par e-mail</h3>
      {etat.relances.parMotif.filter((r) => MOTIFS_DE_LA_TOURNEE.includes(r.motif)).length === 0 ? (
        /* Une tournée qui n'a jamais rien envoyé ne lève aucune erreur : elle se
           contente de ne rien faire, tous les jours, à onze heures. */
        <p className="jour2-vide jour2-alerte">
          Aucune relance envoyée, jamais. Le cron de 11 h ne fait rien, ou n’a trouvé personne.
        </p>
      ) : (
        <>
          <ul className="jour2-liste">
            {etat.relances.parMotif.map((r) => (
              <li key={r.motif}>
                <span>{dire(r.motif)}</span>
                <strong>{r.envoyees}</strong>
              </li>
            ))}
          </ul>
          <p className="jour2-detail">
            Dernière partie le{' '}
            {etat.relances.derniere
              ? new Date(etat.relances.derniere).toLocaleString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'}
          </p>
        </>
      )}

      {/*
        La seule partie de cet écran qui parle de résultat.

        Tout ce qui précède compte ce qui est parti. Un mécanisme qui part sans
        rien changer part quand même : sans ces deux taux, on continuerait à
        empiler des leviers en croyant qu'ils servent.
      */}
      <h3 className="jour2-sous">Retour le lendemain, avant / après l’accueil</h3>
      <EffetAccueil effet={etat.effetAccueil} />
    </section>
  );
};

const EffetAccueil: React.FC<{ effet: Etat['effetAccueil'] }> = ({ effet }) => {
  const { avant, apres, accueillis, depuis } = effet;

  const dit = (g: Groupe) =>
    g.tauxJ1 === null ? '—' : `${g.tauxJ1} %`;

  return (
    <>
      <ul className="jour2-liste">
        <li>
          <span>avant le {new Date(depuis).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</span>
          <strong>
            {dit(avant)}{' '}
            <span className="jour2-sur">sur {avant.mesurables}</span>
          </strong>
        </li>
        <li>
          <span>depuis</span>
          <strong>
            {dit(apres)} <span className="jour2-sur">sur {apres.mesurables}</span>
          </strong>
        </li>
      </ul>

      {/*
        Trois états, et il faut les distinguer : rien à lire, trop peu pour
        conclure, ou un chiffre utilisable. Les confondre transforme une attente
        en verdict.
      */}
      {apres.mesurables === 0 ? (
        <p className="jour2-detail">
          Pas encore lisible : aucun inscrit d’après n’a eu son lendemain. Il en
          faut {MINIMUM_LISIBLE} pour que la comparaison veuille dire quelque chose.
        </p>
      ) : apres.mesurables < MINIMUM_LISIBLE ? (
        <p className="jour2-detail">
          Trop peu pour conclure — {apres.mesurables} compte(s) mesurable(s) sur
          les {MINIMUM_LISIBLE} nécessaires. Un taux sur si peu de monde bascule
          d’une personne à l’autre.
        </p>
      ) : (
        <p className="jour2-detail">
          Direction, pas preuve : à cette échelle, une différence de moins de dix
          points ne se distingue pas du hasard. Et si la provenance du trafic a
          changé entre les deux périodes, ces deux taux la mesurent aussi.
        </p>
      )}

      {/*
        La sonde qui sépare « ça ne sert à rien » de « ce n'est jamais parti ».
        Les deux donnent le même taux.
      */}
      {apres.comptes > accueillis && (
        <p className="jour2-detail jour2-alerte">
          {accueillis} accueil(s) réellement partis sur {apres.comptes} inscrit(s)
          depuis. L’écart n’est pas un effet à mesurer, c’est un envoi à réparer.
        </p>
      )}
    </>
  );
};
