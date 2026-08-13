import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, type DecisionRelance } from '../services/api';
import { playClickSound } from '../utils/sounds';
import './RelanceOffre.css';

/**
 * Reparle de l'abonnement, au bon moment et sans insister.
 *
 * L'offre ne s'ouvrait toute seule qu'à l'épuisement des dix messages mensuels —
 * un seuil que presque personne n'atteint, puisque le mur des coins arrive bien
 * avant. Autrement dit, la seule relance automatique du produit se déclenchait à un
 * moment qui n'arrive jamais, et « Passer Pro » n'était plus qu'une ligne de menu
 * qu'il fallait avoir l'idée d'aller chercher.
 *
 * Le serveur décide (`OfferPromptService`) : rien avant trois jours, jamais deux
 * fois dans la même semaine, cadence mensuelle après trois refus. Ici on ne fait
 * qu'écrire la phrase — parce que le nom du coach n'existe que dans ce navigateur —
 * et remonter ce qu'on en a fait.
 */
export const RelanceOffre: React.FC = () => {
  const [decision, setDecision] = useState<DecisionRelance | null>(null);
  const [masquee, setMasquee] = useState(false);
  /** L'affichage ne se signale qu'une fois, même si React remonte le composant. */
  const signalee = useRef(false);

  useEffect(() => {
    let vivant = true;
    api.relanceOffre().then((d) => {
      if (!vivant || !d.afficher || !d.palier) return;
      setDecision(d);
      // On ne consomme le palier qu'à l'affichage réel : une relance décidée puis
      // jamais montrée — écran quitté, composant démonté — ne doit pas être perdue.
      if (!signalee.current) {
        signalee.current = true;
        api.repondreRelance(d.palier, 'vue');
      }
    });
    return () => {
      vivant = false;
    };
  }, []);

  if (!decision || masquee || !decision.palier) return null;

  const aiName = localStorage.getItem('mindset_ai_name') || 'ton coach';
  const { titre, corps } = texte(decision, aiName);

  const decouvrir = () => {
    playClickSound();
    api.repondreRelance(decision.palier!, 'ouvert');
    // Le même événement que le bouton « Passer Pro » du menu : une seule entrée
    // vers l'écran de paiement, une seule chose à maintenir.
    window.dispatchEvent(new Event('openPricing'));
  };

  const reporter = () => {
    api.repondreRelance(decision.palier!, 'reporte');
    setMasquee(true);
  };

  return (
    <section className="relance-offre glass-panel fade-in">
      <div className="relance-offre-icone" aria-hidden="true">
        <Sparkles size={22} />
      </div>
      <h3>{titre}</h3>
      <p>{corps}</p>
      <div className="relance-offre-actions">
        <button className="relance-offre-cta" onClick={decouvrir}>
          Essayer Pro 7 jours
        </button>
        <button className="relance-offre-btn secondaire" onClick={reporter}>
          Plus tard
        </button>
      </div>
      {/* Dit avant le clic, pas après : ce qui coûte, et comment en sortir. */}
      <p className="relance-offre-mention">
        9,99 €/mois après l'essai, résiliable en un clic. Tes objectifs et tes habitudes
        restent gratuits dans tous les cas.
      </p>
    </section>
  );
};

/**
 * Ce qu'on dit dépend d'abord de ce qui bloque la personne, ensuite du temps passé.
 *
 * Tous ces messages n'énoncent que des faits venus du serveur. Une relance qui
 * exagère se paie deux fois : elle ne convertit pas, et elle apprend à ne plus lire
 * ce qu'on affiche.
 */
function texte(d: DecisionRelance, aiName: string): { titre: string; corps: string } {
  if (d.angle === 'coins') {
    return {
      titre: `Tu n'as plus de quoi parler à ${aiName}`,
      corps:
        `Il te reste ${d.coins} coin${(d.coins ?? 0) > 1 ? 's' : ''}, et un message en coûte dix. ` +
        `Tu peux en regagner en validant tes actions de la journée — ou passer Pro, et ne plus jamais compter.`,
    };
  }

  if (d.angle === 'quota') {
    const restants = d.messagesRestants ?? 0;
    return {
      titre:
        restants === 0
          ? `Tes messages du mois sont épuisés`
          : `Il te reste ${restants} message${restants > 1 ? 's' : ''} ce mois-ci`,
      corps:
        `Tu en as utilisé ${d.messagesUtilises} sur les dix qu'un compte gratuit reçoit chaque mois. ` +
        `Avec Pro, le compteur disparaît : ${aiName} répond aussi souvent que tu en as besoin.`,
    };
  }

  const jours = d.jours ?? 0;
  switch (d.palier) {
    case 'j3':
      return {
        titre: `Trois jours que tu t'y tiens`,
        corps:
          `Tes objectifs et tes habitudes sont posés. ${aiName}, lui, est encore rationné : ` +
          `dix messages par mois. Sept jours d'essai gratuit pour voir ce qu'il donne sans limite.`,
      };
    case 'j7':
      return {
        titre: `Une semaine. C'est là que la plupart lâchent`,
        corps:
          `Toi, tu es encore là. C'est le moment où un coach qui répond sans compteur change ` +
          `vraiment quelque chose — et les sept premiers jours ne te coûtent rien.`,
      };
    case 'j21':
      return {
        titre: `Trois semaines : ce n'est plus un essai`,
        corps:
          `Tu t'en sers pour de bon. Si ${aiName} t'est utile, Pro lève la seule limite qu'il te reste, ` +
          `et l'essai de sept jours te laisse en juger avant de payer quoi que ce soit.`,
      };
    default:
      return {
        titre: `${jours} jours avec Disciplix`,
        corps:
          `Tout ton suivi restera gratuit. La seule chose qu'on te compte, ce sont tes échanges avec ` +
          `${aiName} — dix par mois. Pro les libère, avec sept jours d'essai.`,
      };
  }
}
