import React, { useEffect, useState } from 'react';
import { CalendarCheck, Lock, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
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

/** Une habitude et sa trajectoire d'une semaine sur l'autre. */
interface HabitudeAnalysee {
  titre: string;
  joursTenus: number;
  /** `null` quand il n'y a pas eu de semaine précédente à comparer. */
  joursTenusAvant: number | null;
  evolution: number | null;
}

/**
 * Le rapprochement entre une habitude et le score des journées, mesuré sur quatre
 * semaines. `null` tant qu'il n'y a pas assez de matière — et c'est le cas le plus
 * fréquent, exprès : un lien annoncé sur trois journées serait une devinette.
 */
interface Levier {
  titre: string;
  scoreAvec: number;
  scoreSans: number;
  ecart: number;
  joursAvec: number;
  joursSans: number;
}

interface Analyse {
  habitudes: HabitudeAnalysee[];
  /** Toujours `null` pour un compte gratuit : c'est la part payante de l'écran. */
  levier: Levier | null;
}

interface Bilan {
  disponible: boolean;
  abonne: boolean;
  semaine: Semaine | null;
  /** Absent quand un serveur d'avant l'analyse répond : l'affichage retombe alors
      sur les habitudes de `semaine`, sans trajectoire. */
  analyse?: Analyse | null;
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

  /*
    Les habitudes viennent de l'analyse quand le serveur la fournit.

    Le repli sur `semaine.habitudes` n'est pas de la superstition : le front et
    l'API se déploient séparément, et pendant quelques minutes un navigateur
    chargé avec ce code peut interroger un serveur qui ne renvoie pas encore
    `analyse`. Sans repli, la liste disparaîtrait de la carte pendant ce temps.
    Les deux comptent la même chose sur la même fenêtre — les jours 1 à 7 —, seule
    la trajectoire manque.
  */
  const habitudes: HabitudeAnalysee[] =
    bilan.analyse?.habitudes ??
    semaine.habitudes.map((h) => ({ ...h, joursTenusAvant: null, evolution: null }));

  const levier = bilan.analyse?.levier ?? null;

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

      {habitudes.length > 0 && (
        <ul className="bilan__habitudes">
          {habitudes.map((h) => (
            <li key={h.titre} className="bilan__habitude">
              <span className="bilan__habitude-titre">{h.titre}</span>
              <span className="bilan__habitude-compte">
                <span className="bilan__habitude-jours">{h.joursTenus}/7</span>
                {/* Un zéro ne s'affiche pas : « =0 » face à une semaine identique
                    ajoute du bruit là où il n'y a rien à signaler. Et `null` veut
                    dire qu'il n'y avait pas de semaine avant — pas qu'elle valait
                    zéro, ce qui se lirait comme une chute. */}
                {h.evolution !== null && h.evolution !== 0 && (
                  <span
                    className={`bilan__habitude-delta${h.evolution > 0 ? ' bilan__habitude-delta--hausse' : ''}`}
                    title={`${h.joursTenusAvant}/7 la semaine dernière`}
                  >
                    {h.evolution > 0 ? '+' : ''}
                    {h.evolution}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Le levier : le seul chiffre de cette carte que la personne ne peut pas
        obtenir en regardant son propre calendrier. Il est placé avant la lecture
        du coach, qui le commente — le fait d'abord, la phrase ensuite.

        « avec » et « sans », jamais « grâce à ». Ce qui est mesuré est une
        coïncidence entre deux séries sur quatre semaines, pas une cause : quelqu'un
        qui s'entraîne les jours où il va déjà bien produit exactement le même
        chiffre. Le nombre de journées est affiché pour cette raison — c'est ce qui
        permet de juger ce que vaut l'écart.
      */}
      {abonne && levier && (
        <div className="bilan__levier">
          <p className="bilan__levier-entete">
            <Sparkles size={13} /> Ce qui revient dans tes bonnes journées
          </p>
          <p className="bilan__levier-titre">{levier.titre}</p>
          <div className="bilan__levier-mesure">
            <span className="bilan__levier-cote">
              <strong>{levier.scoreAvec} %</strong> les jours avec
            </span>
            <span className="bilan__levier-cote bilan__levier-cote--sans">
              <strong>{levier.scoreSans} %</strong> les jours sans
            </span>
          </div>
          <p className="bilan__levier-note">
            {levier.ecart} points d'écart, sur {levier.joursAvec + levier.joursSans} journées
            des quatre dernières semaines.
          </p>
        </div>
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
            Ton coach croise tes habitudes avec le score de tes journées sur quatre
            semaines, et te dit laquelle revient dans tes meilleures. Puis il lit ta
            semaine : ce qui a tenu, ce qui a lâché, la seule chose à changer.
            C'est réservé aux abonnés.
          </p>
          <button type="button" className="bilan__verrou-action" onClick={voirOffre}>
            Voir l'offre
          </button>
        </div>
      )}
    </section>
  );
};
