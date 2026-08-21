import { OAuth2Client } from 'google-auth-library';

/**
 * La vérification du jeton d'identité rendu par Google.
 *
 * **Écrite avec la bibliothèque officielle plutôt qu'à la main**, et ce n'est pas
 * de la paresse : vérifier un JWT soi-même demande de rejeter l'algorithme `none`,
 * de refuser toute signature qui n'est pas RS256, de retrouver la bonne clé par son
 * `kid`, de la renouveler quand Google la tourne, et de contrôler l'émetteur,
 * l'audience et l'expiration. Chacune de ces lignes oubliée ouvre une porte, et une
 * porte ouverte ici donne accès à n'importe quel compte. C'est le seul endroit du
 * projet où je préfère une dépendance à du code lisible.
 *
 * Ce que cette fonction garantit si elle rend un résultat : Google a signé ce jeton,
 * il a été émis pour **notre** application, il n'a pas expiré, et l'adresse est
 * vérifiée chez Google.
 */

/** Ce dont l'inscription a besoin, et rien de plus. */
export interface IdentiteGoogle {
  /** L'identifiant stable du compte Google. Ne change jamais, même si l'e-mail change. */
  sub: string;
  email: string;
  prenom: string;
  nom: string;
}

/**
 * Le client est construit une fois : il met en cache les clés publiques de Google
 * et les renouvelle tout seul. En reconstruire un à chaque connexion referait un
 * aller-retour réseau pour rien, et sur la route la plus chaude du produit.
 */
let client: OAuth2Client | null = null;

export function identifiantClientGoogle(): string | undefined {
  const brut = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  return brut ? brut : undefined;
}

/**
 * Rend l'identité, ou `null` si le jeton ne vaut rien.
 *
 * **`null` et jamais une exception**, pour que l'appelant décide du message : un
 * jeton refusé n'est pas forcément une attaque, c'est le plus souvent une page
 * restée ouverte trop longtemps.
 *
 * L'adresse non vérifiée chez Google est refusée. Sans ce test, quelqu'un pourrait
 * ouvrir un compte Google portant l'adresse d'un tiers et récupérer, par la liaison
 * automatique par e-mail, le compte Disciplix de cette personne.
 */
export async function verifierJetonGoogle(jeton: string): Promise<IdentiteGoogle | null> {
  const clientId = identifiantClientGoogle();
  if (!clientId || !jeton) return null;

  if (!client) client = new OAuth2Client(clientId);

  try {
    const billet = await client.verifyIdToken({ idToken: jeton, audience: clientId });
    const charge = billet.getPayload();

    if (!charge?.sub || !charge.email || charge.email_verified !== true) return null;

    return {
      sub: charge.sub,
      email: charge.email.toLowerCase().trim(),
      // Google ne garantit ni l'un ni l'autre. Le prénom sert partout dans le
      // produit — le coach s'adresse à quelqu'un par lui — donc il lui faut un
      // repli ; le nom peut rester vide sans conséquence.
      prenom: (charge.given_name || charge.name || '').trim().slice(0, 60) || 'Toi',
      nom: (charge.family_name || '').trim().slice(0, 60),
    };
  } catch {
    return null;
  }
}
