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
 *
 * ## ⚠️ Ce bouton dépend d'un en-tête HTTP, et rien ne le dit à l'écran
 *
 * `vercel.json` doit servir **`Cross-Origin-Opener-Policy: same-origin-allow-popups`**.
 * Avec `same-origin` — la valeur la plus stricte, et celle qui y était — le
 * navigateur coupe le lien `window.opener` de toute fenêtre ouverte vers un autre
 * domaine. Or c'est précisément par ce lien que la page `accounts.google.com/gsi/transform`
 * rend le jeton à l'application. Sans lui, **la fenêtre de Google reste blanche
 * indéfiniment** : aucune erreur, aucun rappel, rien dans la console de la page
 * principale. C'est ce qui s'est passé du 21 au 22 août 2026.
 *
 * `same-origin-allow-popups` garde la protection qui compte — un site tiers qui
 * nous ouvre en fenêtre surgissante n'obtient aucune poignée sur la nôtre — et ne
 * relâche que le cas où c'est **nous** qui ouvrons la fenêtre. C'est la valeur que
 * Google documente pour ce flux.
 *
 * Un durcissement de cet en-tête casse donc la connexion Google sans le moindre
 * signe. Le seul symptôme visible est une fenêtre blanche chez l'utilisateur.
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

  /*
    Les deux fonctions passent par des refs, et ce n'est pas une coquetterie.

    L'écran de connexion les écrit en ligne dans son JSX : elles sont donc
    recréées à chaque rendu, et un effet qui en dépend se rejoue à chaque frappe
    dans le formulaire. Google le signalait lui-même dans la console —
    « initialize() is called multiple times ... only the last initialized instance
    will be used » — ce qui veut dire un bouton redessiné en boucle et, à terme,
    un rappel branché sur une instance qui n'est plus la bonne.

    La ref garde la dernière version des fonctions sans faire partie des
    dépendances : l'initialisation n'a lieu qu'une fois, et le rappel appelle
    toujours le code à jour.
  */
  const surSession = useRef(onSession);
  const surErreur = useRef(onErreur);
  surSession.current = onSession;
  surErreur.current = onErreur;

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
            if (session?.access_token) surSession.current(session);
            else surErreur.current('Connexion Google incomplète. Réessaie.');
          } catch (e: any) {
            surErreur.current(e?.message || 'Connexion Google impossible. Réessaie.');
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
  }, [clientId, source]);

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
