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

/** Formule en cours. Distingue le mensuel, qui peut encore passer à vie, du définitif. */
export type Formule = 'monthly' | 'lifetime';

/**
 * Ouvre le Pro dans toute l'interface, d'un seul endroit.
 *
 * Il y avait trois activations écrites séparément et qui ne faisaient pas la même
 * chose : celle d'`App` posait le drapeau sans prévenir personne — le menu n'écoute
 * que l'événement `storage`, qui ne se déclenche jamais dans l'onglet qui écrit — donc
 * les boutons « Passer Pro » restaient affichés à quelqu'un qui venait de payer,
 * jusqu'au rechargement suivant. Celle du Profil, elle, rechargeait la page entière.
 *
 * `mindset:pro-actif` porte l'annonce visible : sans un mot, on ne sait pas si le
 * paiement a abouti, et le premier réflexe est de repayer.
 */
export function activerPro(formule: Formule = 'monthly') {
  localStorage.setItem('mindset_is_subscribed', 'true');
  localStorage.setItem('mindset_formule', formule);
  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('mindset:pro-actif', { detail: { formule } }));
}

/** Ce que le serveur dit de la formule : un achat à vie n'a pas d'abonnement Stripe. */
export function retenirFormule(abonnement: { stripe_sub_id?: string | null } | null | undefined) {
  if (!abonnement) {
    localStorage.removeItem('mindset_formule');
    return;
  }
  localStorage.setItem('mindset_formule', abonnement.stripe_sub_id ? 'monthly' : 'lifetime');
}

export function formuleActuelle(): Formule | null {
  const brut = localStorage.getItem('mindset_formule');
  return brut === 'lifetime' || brut === 'monthly' ? brut : null;
}

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
export async function verifierAbonnement(): Promise<{ ok: boolean; abonne: boolean; formule: Formule }> {
  try {
    const res = await api.post('/subscriptions/verifier', {});
    // Le serveur dit laquelle des deux formules il a trouvée : c'est ce qui décide si
    // on peut encore proposer le passage à vie, ou s'il n'y a plus rien à vendre.
    return {
      ok: true,
      abonne: res?.abonne === true,
      formule: res?.formule === 'lifetime' ? 'lifetime' : 'monthly',
    };
  } catch (error) {
    // `ok` sépare « le serveur a répondu non » de « on n'a pas pu demander ». Les
    // confondre couperait l'accès d'un abonné parce que le réseau a hoqueté — un
    // retrait de Pro doit toujours reposer sur une vraie réponse.
    console.error('[paiement] Vérification impossible :', error);
    return { ok: false, abonne: false, formule: 'monthly' };
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

  const { ok, abonne, formule } = await verifierAbonnement();

  // Sans réponse, on ne conclut rien : surtout pas que le paiement a échoué. La marque
  // reste posée et on redemandera au prochain démarrage.
  if (!ok) return;

  if (abonne) {
    oublier();
    // Le paiement est allé au bout mais personne ne l'a jamais dit : c'est
    // typiquement le cas de quelqu'un revenu par ses propres moyens après avoir
    // atterri ailleurs que dans l'app. On l'annonce maintenant.
    activerPro(formule);
    return;
  }

  // Rien trouvé, et le paiement est parti il y a assez longtemps pour que Stripe
  // l'aurait enregistré : c'est un panier abandonné, on arrête de demander.
  if (enAttente && Date.now() - depuis > RENONCEMENT_MS) oublier();
}

/** Referme le Pro. Symétrique d'`activerPro`, sans annonce : on ne fête pas une perte. */
export function retirerPro() {
  localStorage.setItem('mindset_is_subscribed', 'false');
  localStorage.removeItem('mindset_formule');
  window.dispatchEvent(new Event('storage'));
}

const CLE_CONTROLE = 'mindset_abonnement_verifie';

/** Un abonnement est revérifié une fois par demi-journée, pas à chaque ouverture. */
const PERIODE_CONTROLE_MS = 12 * 60 * 60 * 1000;

/**
 * Vérifie qu'un abonné l'est toujours.
 *
 * Une résiliation, une carte qui expire ou un paiement refusé n'arrivent que par le
 * webhook — et le webhook s'est déjà tu une fois, sans que rien ne le signale. Sans ce
 * contrôle, quelqu'un qui s'est désabonné en janvier garde le coach illimité
 * indéfiniment : la base ne changerait jamais d'avis, et l'app la croit sur parole.
 *
 * Ne s'exécute que pour quelqu'un que l'on croit abonné : rien à revérifier chez un
 * compte gratuit, dont l'accès s'ouvre de toute façon par le chemin du paiement.
 */
export async function controlerAbonnement(): Promise<void> {
  if (localStorage.getItem('mindset_is_subscribed') !== 'true') return;

  const dernier = Number(localStorage.getItem(CLE_CONTROLE));
  if (Number.isFinite(dernier) && dernier > 0 && Date.now() - dernier < PERIODE_CONTROLE_MS) return;

  const { ok, abonne, formule } = await verifierAbonnement();

  // Pas de réponse, pas de conclusion : on ne retire jamais un accès payé sur un
  // silence du réseau. La date n'est pas écrite non plus, pour redemander tout de
  // suite au démarrage suivant plutôt que d'attendre douze heures.
  if (!ok) return;

  localStorage.setItem(CLE_CONTROLE, String(Date.now()));

  if (abonne) {
    localStorage.setItem('mindset_formule', formule);
    return;
  }

  retirerPro();
}
