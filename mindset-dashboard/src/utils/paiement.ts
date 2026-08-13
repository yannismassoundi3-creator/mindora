import { api } from '../services/api';

/**
 * Filet de sécurité de l'encaissement, côté navigateur.
 *
 * Le 13 août 2026, le tout premier achat réel a été encaissé par Stripe sans que le
 * compte passe Pro : le webhook n'a rien écrit, et le retour de paiement pointait sur
 * un domaine mort — la personne n'est même pas revenue dans l'app. Trois maillons
 * différents, tous capables de casser en silence, entre « j'ai payé » et « j'ai accès ».
 *
 * On cesse donc de dépendre de l'un d'eux : dès qu'un paiement a été lancé depuis cet
 * appareil, l'app demande elle-même à Stripe, au démarrage suivant, ce qu'il en est.
 * La marque est posée avant le départ vers Stripe (voir `PricingScreen`), elle survit
 * donc à n'importe quel atterrissage, y compris une page d'erreur.
 */

const CLE = 'mindset_paiement_en_cours';

/** Au-delà, on considère que la personne a renoncé : plus la peine d'interroger Stripe. */
const FENETRE_MS = 24 * 60 * 60 * 1000;

/**
 * Délai après lequel un « pas d'abonnement » vaut renoncement.
 *
 * Stripe crée l'abonnement en quelques secondes. Une heure plus tard, une réponse
 * négative ne veut plus dire « ça n'est pas encore arrivé » mais « ça n'arrivera pas » —
 * sans quoi un panier abandonné ferait interroger Stripe à chaque ouverture pendant
 * une journée entière.
 */
const RENONCEMENT_MS = 60 * 60 * 1000;

export function marquerPaiementLance() {
  localStorage.setItem(CLE, String(Date.now()));
}

function oublier() {
  localStorage.removeItem(CLE);
}

/**
 * Retire « success » de l'adresse sans toucher aux autres paramètres.
 *
 * L'app se repère entièrement à la query string (`auth`, `vue`, `plan`…), faute de
 * routeur : remplacer la recherche en bloc casserait le reste du démarrage.
 */
function nettoyerAdresse() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('success')) return;
  url.searchParams.delete('success');
  window.history.replaceState({}, '', url.toString());
}

/**
 * Demande au serveur d'aller lire l'état réel chez Stripe, et de le reporter en base.
 * Ne lève jamais : un démarrage d'application ne doit pas échouer parce que Stripe
 * était indisponible.
 */
export async function verifierAbonnement(): Promise<boolean> {
  try {
    const res = await api.post('/subscriptions/verifier', {});
    return res?.abonne === true;
  } catch (error) {
    console.error('[paiement] Vérification impossible :', error);
    return false;
  }
}

/**
 * Vérifie l'issue d'un paiement s'il y a lieu de le faire.
 *
 * Deux déclencheurs : le retour de Stripe (`?success=true`), et la marque posée au
 * départ — le second couvre le premier, qui peut ne jamais arriver.
 */
export async function reconcilierPaiement(): Promise<void> {
  const retourDeStripe = new URLSearchParams(window.location.search).get('success') === 'true';
  const brut = localStorage.getItem(CLE);
  const depuis = brut ? Number(brut) : NaN;
  const enAttente = Number.isFinite(depuis) && Date.now() - depuis < FENETRE_MS;

  // Une marque illisible ou périmée est retirée, sinon elle resterait indéfiniment.
  if (brut && !enAttente) oublier();
  if (!retourDeStripe && !enAttente) return;

  if (retourDeStripe) nettoyerAdresse();

  const abonne = await verifierAbonnement();

  if (abonne) {
    oublier();
    return;
  }

  // Rien trouvé, et le paiement est parti il y a assez longtemps pour que Stripe
  // l'aurait enregistré : c'est un panier abandonné, on arrête de demander.
  if (enAttente && Date.now() - depuis > RENONCEMENT_MS) oublier();
}
