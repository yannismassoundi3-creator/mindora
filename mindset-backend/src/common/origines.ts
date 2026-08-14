/**
 * D'où l'application est servie, et comment fabriquer un lien qui l'ouvre vraiment.
 *
 * Le 13 août 2026, `FRONTEND_URL` sur Render pointait vers un
 * « …-dashboard.onrender.com » qui n'existe pas. Personne ne s'en apercevait :
 * une variable d'environnement fausse ne lève aucune erreur, elle fabrique
 * simplement des liens morts. Trois chemins en dépendaient — le retour de
 * paiement (corrigé à part, le navigateur y dit son origine), les liens de
 * réinitialisation de mot de passe, et les sept notifications push. Les deux
 * derniers n'ont personne pour les corriger : l'e-mail part, la notification
 * s'affiche, et le clic tombe sur « Not Found ».
 *
 * D'où le principe retenu ici : la variable n'est plus crue sur parole. Elle est
 * confrontée à la liste des adresses où l'application est réellement servie, et
 * ignorée si elle n'en fait pas partie. Une variable oubliée ou mal saisie ne
 * peut donc plus casser un lien ; au pire elle n'a aucun effet.
 */

/**
 * Les adresses où l'application est servie.
 *
 * Écrite en clair plutôt que lue dans une variable : c'est précisément la
 * variable qui s'est révélée fausse. Ajouter un domaine propre ici le jour où
 * il existera.
 */
export const ORIGINES_AUTORISEES = ['https://disciplix-ai.vercel.app'];

/** L'adresse utilisée quand rien de fiable n'est disponible. */
export const ORIGINE_PAR_DEFAUT = ORIGINES_AUTORISEES[0];

/**
 * Rend l'origine si elle est l'une des nôtres, sinon `null`.
 *
 * Sert aussi bien à valider ce qu'annonce un navigateur (où accepter n'importe
 * quoi ouvrirait une redirection arbitraire, avec notre nom sur la page) qu'à
 * valider notre propre configuration.
 *
 * La comparaison porte sur `url.origin` entier, jamais sur un préfixe :
 * `https://disciplix-ai.vercel.app.pirate.example` commence par notre domaine.
 */
export function origineValide(origine?: string | null): string | null {
  if (!origine) return null;
  let url: URL;
  try {
    url = new URL(origine);
  } catch {
    return null;
  }
  if (ORIGINES_AUTORISEES.includes(url.origin)) return url.origin;
  // En développement, front et API tournent sur deux ports de localhost.
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (local && process.env.NODE_ENV !== 'production') return url.origin;
  return null;
}

/**
 * Adresse de base de l'application, garantie ouvrable.
 *
 * `FRONTEND_URL` n'est retenue que si elle désigne une origine connue. Passer par
 * `URL.origin` règle au passage un défaut ancien : selon la façon dont la variable
 * était saisie sur Render, une barre finale produisait des liens en « //?auth=true ».
 * Une origine ne porte jamais de barre finale, il n'y a donc plus rien à nettoyer.
 */
export function origineApp(): string {
  return origineValide(process.env.FRONTEND_URL) ?? ORIGINE_PAR_DEFAUT;
}

/** Lien absolu vers un chemin de l'application (`chemin` commence par « / »). */
export function lienApp(chemin = ''): string {
  return origineApp() + chemin;
}
