import { MODELES_CHAT, MODELES_COURTS, tousLesModeles } from './modeles';
import { corpsGroq, lireReponseGroq } from './groq';

/**
 * Est-ce que les modèles qu'on appelle existent encore ?
 *
 * La question paraît absurde jusqu'au jour où la réponse est non. Groq a éteint
 * `llama-3.3-70b-versatile` et `llama-3.1-8b-instant` le 16 août 2026 ; le 18,
 * le produit les nommait encore dans cinq fichiers. Rien n'a alerté personne :
 * chaque service retombe proprement sur son repli local quand un modèle refuse,
 * ce qui est le bon comportement et exactement ce qui rend la panne muette. Le
 * brief du matin est parti générique pour tout le monde pendant deux jours, et
 * la seule trace était une ligne dans des journaux que personne ne relit.
 *
 * **Une liste de modèles écrite en dur pourrit toute seule, et sans bruit.** Ce
 * contrôle est le seul moyen de le savoir avant les utilisateurs : il appelle
 * vraiment chaque identifiant, avec la vraie clé, et dit lequel répond.
 * Vérifier qu'une variable d'environnement est non vide ne prouve rien ; lire un
 * catalogue dans une documentation non plus.
 *
 * L'appel est réduit au minimum — un mot à écrire — pour que le contrôle coûte
 * moins qu'un centième de message.
 */

export interface EtatModele {
  modele: string;
  ok: boolean;
  latenceMs: number | null;
  /** Le refus du fournisseur, tronqué. `null` quand tout va bien. */
  erreur: string | null;
  /** Les chaînes qui dépendent de ce modèle, pour savoir ce qui tombe avec lui. */
  usages: string[];
}

export interface EtatModeles {
  configure: boolean;
  modeles: EtatModele[];
  /** Vrai quand chaque chaîne garde au moins un maillon vivant. */
  chainesCompletes: boolean;
}

/** Quel usage dépend de quel identifiant. Sert à dire ce qui tombe, pas juste quoi. */
function usagesDe(modele: string): string[] {
  const usages: string[] = [];
  if (MODELES_CHAT.includes(modele)) usages.push('chat');
  if (MODELES_COURTS.includes(modele)) usages.push('brief, bilan, coup de pouce, mémoire');
  return usages;
}

export async function verifierModeles(): Promise<EtatModeles> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { configure: false, modeles: [], chainesCompletes: false };
  }

  const modeles = await Promise.all(tousLesModeles().map((m) => tester(apiKey, m)));

  /*
    Une chaîne survit tant qu'un seul de ses maillons répond.

    C'est la bonne question à poser, et pas « tout est-il vert ». Un modèle mort
    au milieu d'une chaîne ne casse rien — le code passe au suivant — alors qu'une
    chaîne entièrement éteinte fait basculer tout le monde sur les replis locaux,
    sans que rien ne le dise.
  */
  const vivant = (liste: readonly string[]) =>
    modeles.some((m) => m.ok && liste.includes(m.modele));

  return {
    configure: true,
    modeles,
    chainesCompletes: vivant(MODELES_CHAT) && vivant(MODELES_COURTS),
  };
}

async function tester(apiKey: string, modele: string): Promise<EtatModele> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 15000);
  const depart = Date.now();

  try {
    const reponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        corpsGroq({
          modele,
          messages: [{ role: 'user', content: 'Réponds seulement : ok' }],
          temperature: 0,
          /*
            Le budget le plus serré du produit, pas un budget confortable.

            Ce contrôle demandait 200 jetons quand le brief du matin en accorde
            80. Il a donc certifié verts, le 18 août au soir, trois modèles qui
            rendaient tous un `content` vide en production : ils réfléchissaient
            avant d'écrire et épuisaient les 80 jetons dans leur raisonnement.
            **Un contrôle plus indulgent que la production ne contrôle rien** — il
            met un tampon sur la panne qu'il était censé trouver.
          */
          jetons: 80,
        }),
      ),
      signal: controleur.signal,
    });

    const latenceMs = Date.now() - depart;

    if (!reponse.ok) {
      const corps = await reponse.text().catch(() => '');
      return {
        modele,
        ok: false,
        latenceMs,
        // Le corps du fournisseur nomme la faute précisément — « model has been
        // decommissioned », « model not found » — ce qu'aucune phrase écrite ici
        // ne saurait faire. La clé n'apparaît jamais dans un corps de réponse.
        erreur: `${reponse.status} — ${corps.slice(0, 200)}`,
        usages: usagesDe(modele),
      };
    }

    const { texte } = lireReponseGroq(await reponse.json());

    /*
      Répondre n'est pas écrire.

      Un modèle à raisonnement rend 200 avec un `content` vide quand son budget
      part entièrement dans sa réflexion : la requête a réussi, et il ne s'est rien
      écrit. S'arrêter au statut HTTP, c'est déclarer vivante une chaîne dont pas
      un maillon ne produit une phrase — précisément la panne du 18 août 2026.
    */
    if (!texte) {
      return {
        modele,
        ok: false,
        latenceMs,
        erreur: "Réponse vide en 80 jetons : le modèle dépense son budget avant d'écrire.",
        usages: usagesDe(modele),
      };
    }

    return { modele, ok: true, latenceMs, erreur: null, usages: usagesDe(modele) };
  } catch (e: any) {
    return {
      modele,
      ok: false,
      latenceMs: Date.now() - depart,
      erreur:
        e?.name === 'AbortError' ? 'Aucune réponse en 15 s.' : String(e?.message ?? e).slice(0, 200),
      usages: usagesDe(modele),
    };
  } finally {
    clearTimeout(minuteur);
  }
}
