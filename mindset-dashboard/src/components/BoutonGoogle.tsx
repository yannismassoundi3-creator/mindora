import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import './BoutonGoogle.css';

/**
 * « Continuer avec Google », et les deux raisons de ne pas l'afficher.
 *
 * Le formulaire demandait quatre champs et un mot de passe à inventer puis à
 * retenir — entre le clic payé et la première vue du produit. C'est le mur qui a
 * déjà coûté un quart des inscrits sous une autre forme, celle du code à six
 * chiffres retiré le 16 août 2026.
 *
 * ## Le navigateur intégré d'Instagram, et pourquoi le bouton disparaît
 *
 * **Google refuse d'authentifier dans une webview embarquée** : la personne reçoit
 * une page d'erreur `disallowed_useragent` qui vient de Google, pas de nous. Or
 * c'est exactement là qu'arrivent les gens amenés par une publicité Instagram ou
 * TikTok — c'est-à-dire ceux qui coûtent le plus cher.
 *
 * Le bouton ne s'affiche donc pas dans ces contextes. **Un bouton absent coûte
 * moins qu'un bouton qui échoue** : le formulaire, lui, se remplit toujours.
 *
 * ## Et si le serveur n'est pas configuré
 *
 * `GET /auth/google/config` dit si l'identifiant client existe côté serveur. Sans
 * lui, rien ne s'affiche non plus — proposer une porte qu'on ne peut pas ouvrir
 * est la pire des trois issues.
 */

/** Ce que Google dépose dans `window` une fois son script chargé. */
declare global {
  interface Window {
    google?: any;
  }
}

const SCRIPT_GOOGLE = 'https://accounts.google.com/gsi/client';

/**
 * Vrai quand la page tourne dans le navigateur intégré d'une application.
 *
 * La détection se fait sur la signature de l'application hôte, jamais sur
 * « ce n'est pas Safari » : la liste des navigateurs légitimes est infinie, celle
 * des applications qui embarquent une webview et nous envoient du trafic est
 * courte. Se tromper dans ce sens-là ne coûte qu'un bouton non affiché.
 */
export function navigateurIntegre(agent = navigator.userAgent): boolean {
  return /(FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|Snapchat|Pinterest|LinkedInApp)/i.test(agent);
}

interface Props {
  /** Rendu quand la session est ouverte, avec la réponse complète de l'API. */
  onSession: (reponse: any) => void;
  onErreur: (message: string) => void;
  /** La provenance retenue au premier chargement, comme à l'inscription classique. */
  source?: string | null;
  desactive?: boolean;
}

export const BoutonGoogle: React.FC<Props> = ({ onSession, onErreur, source, desactive }) => {
  const [clientId, setClientId] = useState<string | null>(null);
  const conteneur = useRef<HTMLDivElement>(null);

  // Dans une webview embarquée, on ne demande même pas la configuration : ni script
  // tiers chargé, ni requête inutile.
  const integre = navigateurIntegre();

  useEffect(() => {
    if (integre) return;
    let vivant = true;

    api
      .get('/auth/google/config')
      .then((config: any) => {
        if (vivant && config?.disponible && config?.clientId) setClientId(config.clientId);
      })
      // Silence délibéré : l'écran de connexion doit rester utilisable même si
      // cette requête échoue. Le formulaire est là, il suffit.
      .catch(() => undefined);

    return () => {
      vivant = false;
    };
  }, [integre]);

  useEffect(() => {
    if (!clientId || !conteneur.current) return;

    let annule = false;

    const dessiner = () => {
      if (annule || !window.google?.accounts?.id || !conteneur.current) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (reponse: any) => {
          try {
            const session = await api.post('/auth/google', {
              credential: reponse?.credential,
              source: source ?? undefined,
            });
            if (session?.access_token) onSession(session);
            else onErreur('Connexion Google incomplète. Réessaie.');
          } catch (e: any) {
            onErreur(e?.message || 'Connexion Google impossible. Réessaie.');
          }
        },
      });

      window.google.accounts.id.renderButton(conteneur.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
        shape: 'pill',
        locale: 'fr',
      });
    };

    // Le script n'est chargé qu'une fois, et seulement si le bouton doit exister.
    const dejaLa = document.querySelector(`script[src="${SCRIPT_GOOGLE}"]`);
    if (dejaLa) {
      if (window.google?.accounts?.id) dessiner();
      else dejaLa.addEventListener('load', dessiner);
    } else {
      const script = document.createElement('script');
      script.src = SCRIPT_GOOGLE;
      script.async = true;
      script.defer = true;
      script.onload = dessiner;
      document.head.appendChild(script);
    }

    return () => {
      annule = true;
    };
  }, [clientId, source, onSession, onErreur]);

  if (integre || !clientId) return null;

  return (
    <div className={`bouton-google${desactive ? ' bouton-google--attente' : ''}`}>
      <div ref={conteneur} />
      <p className="bouton-google__separateur">
        <span>ou</span>
      </p>
    </div>
  );
};
