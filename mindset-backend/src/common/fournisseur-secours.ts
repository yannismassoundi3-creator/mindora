/**
 * Le fournisseur de secours, quand Groq ne répond plus.
 *
 * Groq est gratuit et rapide, et ses limites sont comptées par modèle et par jour.
 * Tant qu'il tient, il n'y a aucune raison de payer. Mais son plan Developer est
 * fermé — « temporarily unavailable due to high demand », signalé sur leur forum
 * depuis mai 2026 : on ne peut pas acheter davantage de capacité, même en le
 * voulant. Le produit dépend donc entièrement d'un quota gratuit qu'il partage
 * avec tout le monde, et le coach est précisément ce que l'abonnement fait payer.
 *
 * D'où ce dernier maillon : il ne s'ajoute qu'**après** toute la chaîne gratuite,
 * il ne travaille donc que sur les requêtes que Groq a refusées. À quelques
 * dizaines de messages par jour, cela se compte en centimes — et le coach cesse
 * de ne pas répondre.
 *
 * **Rien n'est codé en dur au fournisseur.** L'adresse, le modèle et la clé
 * viennent de l'environnement : le jour où Groq rouvre, où le secours devient
 * moins cher ailleurs, ou où celui-ci ferme à son tour, c'est une variable à
 * changer sur Render, pas un déploiement. Tout service exposant l'API de complétion
 * au format OpenAI convient — c'est le format qu'utilise déjà chaque appel du
 * projet, Groq compris.
 */

/** Là où le secours répond, si rien n'est précisé. */
const URL_PAR_DEFAUT = 'https://openrouter.ai/api/v1/chat/completions';

export interface FournisseurSecours {
  url: string;
  apiKey: string;
  modele: string;
}

/**
 * La configuration du secours, ou `null` s'il n'y en a pas.
 *
 * **L'absence de clé est le cas normal, pas une erreur.** Sans elle, la chaîne se
 * limite aux modèles gratuits et l'application se comporte exactement comme avant
 * — c'est ce qui permet de déployer ce code avant d'avoir un compte, et de couper
 * la dépense en retirant une variable.
 */
export function lireFournisseurSecours(): FournisseurSecours | null {
  const apiKey = process.env.SECOURS_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;

  const modele = process.env.SECOURS_MODELE;
  if (!modele || !modele.trim()) {
    /*
      Une clé sans modèle ne peut pas marcher : l'identifiant n'est pas devinable,
      il change d'un fournisseur à l'autre. On le dit une fois, fort, plutôt que de
      laisser la chaîne échouer sur un 400 que personne ne reliera à ceci.
    */
    console.error(
      '[Secours] SECOURS_API_KEY est définie mais SECOURS_MODELE manque : le secours reste inactif.',
    );
    return null;
  }

  return {
    url: process.env.SECOURS_API_URL?.trim() || URL_PAR_DEFAUT,
    apiKey: apiKey.trim(),
    modele: modele.trim(),
  };
}

export interface EtatSecours {
  configure: boolean;
  url: string | null;
  modele: string | null;
  ok: boolean;
  latenceMs: number | null;
  erreur: string | null;
}

/**
 * Un vrai appel au secours, pour savoir s'il répondrait le jour où tout brûle.
 *
 * Ce maillon ne travaille que quand toute la chaîne gratuite a échoué. Une clé
 * fautive, une adresse mal recopiée ou un identifiant de modèle à un caractère
 * près y resteraient donc **invisibles jusqu'à la première panne de Groq** —
 * c'est-à-dire au seul moment où l'on comptait dessus. Un filet qu'on n'a jamais
 * tendu n'est pas un filet, c'est une intention.
 *
 * L'appel est réel parce qu'il n'y a pas d'autre façon de savoir : vérifier que
 * la variable est non vide ne prouve rien du tout. Il est en revanche réduit au
 * strict minimum — cinq jetons, une question d'un mot — pour que le contrôle
 * coûte moins qu'un centième de message.
 */
export async function verifierSecours(): Promise<EtatSecours> {
  const secours = lireFournisseurSecours();
  if (!secours) {
    return {
      configure: false,
      url: null,
      modele: null,
      ok: false,
      latenceMs: null,
      erreur: 'Aucun secours configuré : SECOURS_API_KEY ou SECOURS_MODELE manque.',
    };
  }

  // L'adresse et le modèle ne sont pas des secrets, et les afficher est le seul
  // moyen de repérer une faute de frappe sans lire la valeur masquée sur Render.
  const base = { configure: true, url: secours.url, modele: secours.modele };

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 20000);
  const depart = Date.now();

  try {
    const reponse = await fetch(secours.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secours.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: secours.modele,
        messages: [{ role: 'user', content: 'Réponds seulement : ok' }],
        /*
          Assez large pour qu'un modèle à raisonnement puisse répondre.

          Ce contrôle demandait 5 jetons. C'est suffisant pour un modèle qui écrit
          directement, et strictement insuffisant pour un GPT-OSS ou tout autre
          modèle qui réfléchit d'abord : ses premiers jetons partent dans le
          raisonnement, le budget est épuisé avant le premier mot de réponse, et
          `content` revient vide. Le contrôle accusait alors le fournisseur d'un
          défaut qui venait de lui-même — le pire diagnostic possible, celui qui
          envoie corriger une configuration correcte.

          200 jetons de sortie coûtent un dix-millième d'euro. Il n'y avait aucune
          raison d'être aussi avare.
        */
        max_tokens: 200,
        temperature: 0,
      }),
      signal: controleur.signal,
    });

    const latenceMs = Date.now() - depart;

    if (!reponse.ok) {
      const corps = await reponse.text().catch(() => '');
      return {
        ...base,
        ok: false,
        latenceMs,
        // Le corps d'erreur est celui du fournisseur : il nomme précisément la
        // faute (« model not found », « invalid api key »), ce qu'aucun message
        // écrit ici ne saurait faire. Il est tronqué et expurgé de la clé, qui n'a
        // aucune raison d'atterrir dans une réponse HTTP.
        erreur: `${reponse.status} ${reponse.statusText} — ${sansLaCle(corps, secours.apiKey).slice(0, 300)}`,
      };
    }

    const data = await reponse.json().catch(() => null);
    const choix = data?.choices?.[0];
    const texte = choix?.message?.content;

    if (typeof texte !== 'string' || texte.trim() === '') {
      /*
        200 sans texte exploitable. Trois causes possibles, et elles n'appellent
        pas du tout le même geste — d'où ce diagnostic détaillé plutôt qu'une
        phrase unique qui accusait l'adresse à tort :

        — `finish_reason: length` : le budget de jetons a été mangé avant la
          réponse. C'est un réglage d'ici, pas une faute du fournisseur.
        — le message porte un champ de raisonnement mais pas de contenu : modèle à
          raisonnement qui n'a pas eu la place de conclure.
        — aucune structure reconnaissable : là seulement, l'adresse ne rend pas le
          format OpenAI, et c'est bien elle qu'il faut corriger.

        Les noms de champs suffisent à trancher, et ne révèlent rien : l'invite
        envoyée est « Réponds seulement : ok ».
      */
      const champs = choix?.message ? Object.keys(choix.message).join(', ') : 'aucun';
      const fin = choix?.finish_reason ?? 'non précisé';

      return {
        ...base,
        ok: false,
        latenceMs,
        erreur: choix
          ? `Réponse acceptée mais sans texte. finish_reason : ${fin} · champs du message : ${champs}`
          : "Réponse acceptée mais illisible : l'adresse ne rend pas le format OpenAI attendu.",
      };
    }

    return { ...base, ok: true, latenceMs, erreur: null };
  } catch (e: any) {
    return {
      ...base,
      ok: false,
      latenceMs: Date.now() - depart,
      erreur:
        e?.name === 'AbortError'
          ? "Aucune réponse en 20 s : adresse injoignable, ou service très lent."
          : sansLaCle(String(e?.message ?? e), secours.apiKey).slice(0, 300),
    };
  } finally {
    clearTimeout(minuteur);
  }
}

/** Une clé n'a jamais à ressortir d'ici, même recopiée par le fournisseur. */
function sansLaCle(texte: string, cle: string): string {
  return cle ? texte.split(cle).join('***') : texte;
}
