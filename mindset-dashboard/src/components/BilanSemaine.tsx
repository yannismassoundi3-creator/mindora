import React, { useEffect, useState } from 'react';
import { CalendarCheck, Lock, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../services/api';
import './BilanSemaine.css';

/*
  Le bilan de la semaine.

  Il existait déjà, mais uniquement en notification : 180 caractères, le dimanche
  soir, sur un écran verrouillé. Ce n'est pas un bilan, c'est une alerte — et
  c'était pourtant tout ce que l'abonnement offrait de visible en plus.

  Ici, deux choses volontairement séparées :

  - **Les chiffres sont à tout le monde.** Ce sont les siens. Les mettre derrière
    l'abonnement transformerait une application de suivi en péage, et personne ne
    paie pour voir ce qu'il a déjà fait.
  - **La lecture est celle des abonnés.** Ce qui a tenu, ce qui a lâché, la seule
    chose à changer. C'est du travail que l'application fait *pour* la personne,
    et c'est la seule chose ici qui mérite d'être payée.

  Le verrou dit la vérité sur ce qui manque, et montre les vrais chiffres à côté :
  un cadenas devant un écran vide ne vend rien, un cadenas à côté de sa propre
  semaine donne envie de savoir ce que le coach en dit.
*/

interface Habitude {
  titre: string;
  joursTenus: number;
}

interface Semaine {
  joursActifs: number;
  scoreMoyen: number;
  meilleurScore: number;
  /** Écart en points avec la semaine précédente. 0 quand il n'y a pas de quoi comparer. */
  evolution: number;
  habitudes: Habitude[];
}

interface Bilan {
  disponible: boolean;
  abonne: boolean;
  semaine: Semaine | null;
  /** La lecture du coach. `null` pour un compte gratuit, ou si le modèle n'a pas répondu. */
  lecture: string | null;
}

export const BilanSemaine: React.FC = () => {
  const [bilan, setBilan] = useState<Bilan | null>(null);

  /*
    L'écran d'abonnement s'ouvre par événement, comme partout ailleurs.

    `openPricing` est déjà écouté par `App` et sert au bouton du menu comme à la
    proposition du chat quand les coins manquent. Faire descendre une prop depuis
    la racine jusqu'ici pour rouvrir la même modale ajouterait un second chemin
    vers le même écran, avec deux occasions de diverger.
  */
  const voirOffre = () => window.dispatchEvent(new Event('openPricing'));

  useEffect(() => {
    let annule = false;
    api
      .get('/ai-coaching/bilan-semaine')
      .then((r) => {
        if (!annule) setBilan(r);
      })
      // Un échec réseau ne montre rien : c'est un écran de lecture, pas une
      // fonction dont dépend le travail de la personne.
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  // Rien à raconter, ou pas encore chargé : la section n'existe pas. Afficher
  // « 0 jour actif, score moyen 0 % » à quelqu'un qui n'a rien fait de la semaine
  // est un reproche, pas un bilan.
  if (!bilan?.disponible || !bilan.semaine) return null;

  const { semaine, lecture, abonne } = bilan;
  const enHausse = semaine.evolution > 0;

  return (
    <section className="bilan glass-panel">
      <p className="bilan__entete">
        <CalendarCheck size={14} /> Ta semaine
      </p>

      <div className="bilan__chiffres">
        <div className="bilan__chiffre">
          <span className="bilan__valeur">{semaine.joursActifs}/7</span>
          <span className="bilan__legende">jours actifs</span>
        </div>
        <div className="bilan__chiffre">
          <span className="bilan__valeur">{semaine.scoreMoyen} %</span>
          <span className="bilan__legende">score moyen</span>
        </div>
        <div className="bilan__chiffre">
          <span className="bilan__valeur">{semaine.meilleurScore} %</span>
          <span className="bilan__legende">meilleur jour</span>
        </div>
      </div>

      {/*
        L'évolution ne s'affiche pas quand elle vaut zéro : le serveur y met zéro
        aussi bien pour « stable » que pour « pas de semaine précédente ». Annoncer
        « stable » à quelqu'un qui vient d'arriver serait inventer une comparaison.
      */}
      {semaine.evolution !== 0 && (
        <p className={`bilan__evolution${enHausse ? ' bilan__evolution--hausse' : ''}`}>
          {enHausse ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {enHausse ? '+' : ''}
          {semaine.evolution} points par rapport à la semaine dernière
        </p>
      )}

      {semaine.habitudes.length > 0 && (
        <ul className="bilan__habitudes">
          {semaine.habitudes.map((h) => (
            <li key={h.titre} className="bilan__habitude">
              <span className="bilan__habitude-titre">{h.titre}</span>
              <span className="bilan__habitude-jours">{h.joursTenus}/7</span>
            </li>
          ))}
        </ul>
      )}

      {abonne && lecture && (
        <div className="bilan__lecture">
          <p className="bilan__lecture-entete">Ce que ton coach en lit</p>
          {/* Le modèle sépare ses paragraphes par une ligne vide ; on les rend tels
              quels plutôt qu'en un bloc, sinon les trois temps du bilan se fondent. */}
          {lecture.split(/\n{2,}/).map((paragraphe, i) => (
            <p key={i} className="bilan__lecture-texte">
              {paragraphe.trim()}
            </p>
          ))}
        </div>
      )}

      {!abonne && (
        <div className="bilan__verrou">
          <p className="bilan__verrou-titre">
            <Lock size={13} /> Ce que ton coach en lit
          </p>
          <p className="bilan__verrou-texte">
            Ton coach peut lire cette semaine et te dire ce qui a tenu, ce qui a lâché,
            et la seule chose à changer la semaine prochaine. C'est réservé aux abonnés.
          </p>
          <button type="button" className="bilan__verrou-action" onClick={voirOffre}>
            Voir l'offre
          </button>
        </div>
      )}
    </section>
  );
};
