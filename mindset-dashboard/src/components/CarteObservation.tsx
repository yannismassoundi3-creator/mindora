import React, { useEffect, useState } from 'react';
import { Eye, ArrowRight, Lock } from 'lucide-react';
import { chargerObservation, type Observation } from '../utils/observation';
import { api } from '../services/api';
import './CarteObservation.css';

/*
  « Ce que ton coach a remarqué », et ce qu'il en lit.

  La carte porte deux choses de nature différente, et l'ordre compte :

  1. **Le motif du moment, gratuit.** Calculé côté serveur à partir des scores
     jour par jour (`ObservationService`), jamais deviné par le modèle. Il reste
     libre parce qu'il est la démonstration : personne ne paie pour savoir
     pourquoi payer.
  2. **L'analyse complète, réservée aux abonnés.** Tous les motifs qui tiennent,
     les habitudes et leur trajectoire, le levier, et une lecture qui rattache
     tout ça au cap que la personne s'est donné. C'est la suite de la phrase
     qu'elle vient de lire — le seul endroit où un mur se justifie, parce qu'il
     ne cache pas l'entrée, il cache la profondeur.

  Le verrou dit **combien** de motifs attendent derrière, jamais lesquels. Un
  verrou qui ne promet rien de vérifiable est une publicité ; celui-ci annonce un
  nombre que l'abonnement rendra exact.

  Le bouton du bas ne mène pas au chat : il **envoie le message**. Quelqu'un qui
  vient de lire « sur 4 samedis, 3 sont à zéro » ne devrait pas avoir à
  reformuler ce constat pour en parler.
*/

interface CarteObservationProps {
  /** Ouvre la conversation. Même fonction que le bouton du coach du tableau de bord. */
  onOuvrirChat: () => void;
}

/** Ce que rend `GET /ai-coaching/analyse`, dans ses deux formes. */
interface Analyse {
  verrouille: boolean;
  nombreFaits?: number;
  faits?: Array<{ code: string; titre: string; fait: string; invite: string }>;
  levier?: { titre: string; scoreAvec: number; scoreSans: number } | null;
  serie?: number;
  cap?: string | null;
  lecture?: string | null;
}

export const CarteObservation: React.FC<CarteObservationProps> = ({ onOuvrirChat }) => {
  const [observation, setObservation] = useState<Observation | null>(null);
  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [ouverte, setOuverte] = useState(false);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    let annule = false;
    chargerObservation()
      .then((o) => {
        if (!annule) setObservation(o);
      })
      // Un échec réseau ne montre rien : c'est un bonus d'affichage, pas une
      // donnée dont dépend l'écran. Signaler une panne ici parlerait d'un
      // problème à quelqu'un qui n'a rien demandé.
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  if (!observation) return null;

  /*
    L'analyse n'est demandée qu'au dépliage.

    Elle coûte un appel au modèle côté serveur, la première fois de la journée.
    La charger au montage la ferait payer pour tous ceux qui passent sur le
    tableau de bord sans jamais ouvrir la carte — c'est-à-dire presque tout le
    monde.
  */
  const deplier = async () => {
    setOuverte(true);
    if (analyse) return;
    setChargement(true);
    try {
      setAnalyse(await api.get('/ai-coaching/analyse'));
    } catch {
      // Rien ne s'ajoute plutôt qu'une erreur : la phrase du dessus reste, et
      // c'est elle le vrai contenu de la carte.
      setAnalyse(null);
    } finally {
      setChargement(false);
    }
  };

  const voirOffre = () => window.dispatchEvent(new Event('openPricing'));

  const enParler = () => {
    // Même chemin que la bannière et que la fin du questionnaire : `AIChat`
    // consomme cette clé à son montage et envoie le message tout seul.
    localStorage.setItem('mindset_pending_chat_msg', observation.invite);
    onOuvrirChat();
  };

  return (
    <section className="observation-carte glass-panel">
      <p className="observation-carte__entete">
        <Eye size={14} /> Ce que ton coach a remarqué
      </p>

      <h3 className="observation-carte__titre">{observation.titre}</h3>
      <p className="observation-carte__fait">{observation.fait}</p>

      {!ouverte && (
        <button type="button" className="observation-carte__deplier" onClick={deplier}>
          Voir l'analyse complète
          <ArrowRight size={14} />
        </button>
      )}

      {ouverte && chargement && (
        <p className="observation-analyse__attente">Ton coach relit ton historique…</p>
      )}

      {ouverte && analyse?.verrouille && (
        <div className="observation-verrou">
          <p className="observation-verrou__titre">
            <Lock size={13} /> L'analyse complète
          </p>
          <p className="observation-verrou__texte">
            {/*
              Le nombre vient du serveur et il est exact : c'est le décompte réel
              des motifs qui franchissent leurs seuils sur cet historique. Une
              promesse vérifiable est la seule qui survive à l'achat.
            */}
            {(analyse.nombreFaits ?? 0) > 1
              ? `Ton coach a relevé ${analyse.nombreFaits} motifs dans ton historique. Tu en lis un.`
              : 'Ton coach croise tes motifs, tes habitudes et ce que tu lui as dit en conversation.'}{' '}
            L'analyse complète les relie au cap que tu t'es donné, et te dit la seule
            chose à essayer cette semaine. C'est réservé aux abonnés.
          </p>
          <button type="button" className="observation-verrou__action" onClick={voirOffre}>
            Voir l'offre
          </button>
        </div>
      )}

      {ouverte && analyse && !analyse.verrouille && (
        <div className="observation-analyse">
          {analyse.lecture ? (
            /* Le modèle sépare ses paragraphes par une ligne vide ; les rendre en
               un seul bloc fondrait les trois temps de la lecture. */
            analyse.lecture.split(/\n{2,}/).map((paragraphe, i) => (
              <p key={i} className="observation-analyse__texte">
                {paragraphe.trim()}
              </p>
            ))
          ) : (
            <p className="observation-analyse__texte">
              Pas encore assez de jours pour en tirer une lecture. Ce qui suit est ce
              que ton coach a déjà.
            </p>
          )}

          {analyse.faits && analyse.faits.length > 1 && (
            <ul className="observation-analyse__faits">
              {/* Le premier est déjà affiché en haut de la carte. */}
              {analyse.faits.slice(1).map((f) => (
                <li key={f.code}>{f.fait}</li>
              ))}
            </ul>
          )}

          {analyse.levier && (
            <p className="observation-analyse__levier">
              {/* « avec » et « sans », jamais « à cause de » : ce chiffre mesure une
                  coïncidence entre deux séries, pas une cause. */}
              Tes journées avec « {analyse.levier.titre} » sont à {analyse.levier.scoreAvec} %,
              celles sans à {analyse.levier.scoreSans} %.
            </p>
          )}
        </div>
      )}

      <button type="button" className="observation-carte__action" onClick={enParler}>
        En parler avec ton coach
        <ArrowRight size={15} />
      </button>
    </section>
  );
};
