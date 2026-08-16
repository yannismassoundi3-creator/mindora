/*
  Reconnaître l'appareil et le navigateur, pour ce qui dépend vraiment d'eux.

  Une seule chose s'y joue : dire à quelqu'un comment installer l'application. Le
  chemin diffère d'un navigateur à l'autre, et se tromper de consigne est pire que
  se taire — on décrit un bouton qui n'existe pas là où on le désigne.
*/

/** L'application tourne depuis l'écran d'accueil, et non dans un onglet. */
export function estInstallee(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

/**
 * iPhone, iPod **et iPad**.
 *
 * Le test par user-agent seul rate tous les iPad : depuis iPadOS 13, Safari s'y
 * annonce comme un Mac de bureau (`Macintosh; Intel Mac OS X`) et le mot « ipad »
 * a disparu de la chaîne. Un utilisateur iPad ne voyait donc jamais la marche à
 * suivre — et sur iOS c'est la seule façon d'installer, il n'y a pas de bouton de
 * secours.
 *
 * La parade reconnue est de croiser la plateforme et le tactile : seul un iPad se
 * déclare `MacIntel` tout en acceptant plusieurs points de contact.
 */
export function estIOS(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return true;
  const nav = navigator as any;
  const plateforme = nav.platform || '';
  return /^mac/i.test(plateforme) && (nav.maxTouchPoints ?? 0) > 1;
}

export function estAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

/**
 * iPad plutôt qu'iPhone, pour les textes qui nomment l'appareil.
 *
 * Un iPad récent se déclare `MacIntel` sans jamais dire « ipad » : la seule
 * distinction qui reste est la taille de l'écran. Approximatif par nature — c'est
 * assez pour choisir un mot dans une phrase, ce ne serait pas assez pour décider
 * d'un comportement.
 */
export function estIPad(): boolean {
  if (/ipad/i.test(navigator.userAgent)) return true;
  return estIOS() && Math.min(window.screen.width, window.screen.height) >= 744;
}

/**
 * Les navigateurs intégrés aux applications, où l'installation est impossible.
 *
 * C'est le cas qui compte le plus ici : la publicité sur les réseaux sociaux amène
 * les gens **dans** Instagram ou TikTok, pas dans Safari. Ces navigateurs n'ont ni
 * menu Partager utilisable, ni « Sur l'écran d'accueil » — leur afficher les trois
 * étapes revient à décrire des boutons qu'ils n'ont pas, et à les laisser conclure
 * que l'application est cassée.
 *
 * La détection est volontairement large côté Facebook (`FBAN`/`FBAV` couvrent
 * l'app Facebook et Messenger) ; un faux positif ne coûte qu'une consigne un peu
 * trop prudente, un faux négatif coûte une installation.
 */
export function estNavigateurIntegre(): boolean {
  const ua = navigator.userAgent;
  return /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|Twitter|LinkedInApp|Pinterest/i.test(ua);
}

/**
 * Le navigateur, quand la consigne d'installation en dépend.
 *
 * Sur iOS, tous les navigateurs partagent le moteur d'Apple mais pas la place de
 * leurs boutons : Safari met Partager **en bas**, Chrome et Firefox le rangent
 * dans la barre d'adresse, **en haut**. Une consigne qui dit « en bas » à
 * quelqu'un sous Chrome l'envoie chercher au mauvais endroit.
 */
export type NavigateurIOS = 'safari' | 'chrome' | 'firefox' | 'edge' | 'autre';

/**
 * Lien qui rouvre la page dans Chrome, depuis un navigateur intégré Android.
 *
 * Android sait faire ce qu'iOS ne sait pas : le schéma `intent://` est compris par
 * le système, y compris depuis le webview d'Instagram ou de TikTok, et `package=`
 * désigne l'application qui doit prendre le relais. Un simple clic suffit donc à
 * sortir — là où sur iPhone il n'existe aucune sortie programmable, seulement une
 * consigne à lire.
 *
 * `S.browser_fallback_url` est ce qui se produit si Chrome n'est pas installé :
 * sans lui, le clic ne fait **rien du tout**, ce qui est la pire des réponses —
 * indiscernable d'un bouton cassé.
 *
 * Rend `null` hors Android : on ne propose pas un bouton dont on sait qu'il ne
 * mènera nulle part.
 */
export function lienSortieAndroid(): string | null {
  if (!estAndroid()) return null;
  const url = window.location.href;
  const sansSchema = url.replace(/^https?:\/\//, '');
  const repli = encodeURIComponent(url);
  return `intent://${sansSchema}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${repli};end`;
}

export function navigateurIOS(): NavigateurIOS {
  const ua = navigator.userAgent;
  if (/CriOS/i.test(ua)) return 'chrome';
  if (/FxiOS/i.test(ua)) return 'firefox';
  if (/EdgiOS/i.test(ua)) return 'edge';
  if (/Safari/i.test(ua)) return 'safari';
  return 'autre';
}
