/**
 * La carte d'une semaine, dessinée pour être montrée ailleurs que dans l'app.
 *
 * Dessinée sur un canvas et non rendue en HTML : ce qu'on veut produire est un
 * fichier image, que l'on puisse joindre à un message ou publier. Convertir du
 * HTML en image demande une bibliothèque, et échoue sur les polices ; un canvas
 * donne un PNG directement, sans dépendance et sans surprise.
 *
 * Le format est carré (1080 px) parce que c'est le seul qui ne se fasse recadrer
 * nulle part.
 */
import type { BilanSemaine } from './semaine';

const COTE = 1080;

/** Coins arrondis : `roundRect` manque encore sur de vieux WebKit (iOS 15). */
function rectArrondi(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  l: number,
  h: number,
  r: number,
) {
  const rayon = Math.min(r, l / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rayon, y);
  ctx.arcTo(x + l, y, x + l, y + h, rayon);
  ctx.arcTo(x + l, y + h, x, y + h, rayon);
  ctx.arcTo(x, y + h, x, y, rayon);
  ctx.arcTo(x, y, x + l, y, rayon);
  ctx.closePath();
}

function moisAnnee(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/**
 * Dessine la carte et rend le PNG.
 *
 * Les polices sont celles du système : embarquer une fonte demanderait de la
 * charger et d'attendre `document.fonts.ready`, pour un gain nul sur une image
 * de ce genre.
 */
export async function dessinerCarteSemaine(bilan: BilanSemaine, prenom?: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = COTE;
  canvas.height = COTE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas indisponible');

  // Fond
  const fond = ctx.createLinearGradient(0, 0, COTE, COTE);
  fond.addColorStop(0, '#0b1120');
  fond.addColorStop(1, '#111c33');
  ctx.fillStyle = fond;
  ctx.fillRect(0, 0, COTE, COTE);

  // Voile coloré du rang, pour que deux cartes de rangs différents ne se
  // ressemblent pas — c'est ce qui donne envie d'en montrer une autre plus tard.
  const halo = ctx.createRadialGradient(COTE * 0.5, 120, 0, COTE * 0.5, 120, COTE * 0.75);
  halo.addColorStop(0, bilan.couleurRang + '44');
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, COTE, COTE);

  const fin = new Date(bilan.debut);
  fin.setUTCDate(fin.getUTCDate() + 6);

  // En-tête
  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(`Semaine du ${moisAnnee(bilan.debut)} au ${moisAnnee(fin)}`, COTE / 2, 96);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 62px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(prenom ? `La semaine de ${prenom}` : 'Ma semaine', COTE / 2, 172);

  // Le chiffre principal
  ctx.fillStyle = bilan.couleurRang;
  ctx.font = '800 200px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(`${bilan.moyenne}%`, COTE / 2, 360);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 32px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('de discipline en moyenne', COTE / 2, 410);

  // Les sept jours
  const largeurJour = 108;
  const espace = 18;
  const totalLargeur = 7 * largeurJour + 6 * espace;
  let x = (COTE - totalLargeur) / 2;
  const yBarre = 470;
  const hauteurMax = 170;

  for (const jour of bilan.jours) {
    const hauteur = Math.max(8, (jour.score / 100) * hauteurMax);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    rectArrondi(ctx, x, yBarre, largeurJour, hauteurMax, 16);
    ctx.fill();

    if (!jour.aVenir) {
      ctx.fillStyle = jour.score > 0 ? bilan.couleurRang : 'rgba(255,255,255,0.14)';
      rectArrondi(ctx, x, yBarre + hauteurMax - hauteur, largeurJour, hauteur, 16);
      ctx.fill();
    }

    ctx.fillStyle = jour.aVenir ? 'rgba(148,163,184,0.45)' : '#cbd5e1';
    ctx.font = '600 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(jour.initiale, x + largeurJour / 2, yBarre + hauteurMax + 46);
    x += largeurJour + espace;
  }

  // Trois chiffres qui disent le reste
  const cases = [
    { valeur: `${bilan.serie}`, libelle: bilan.serie > 1 ? 'jours de série' : 'jour de série' },
    { valeur: `${bilan.joursActifs}/${bilan.joursEcoules}`, libelle: 'jours tenus' },
    { valeur: `Niv. ${bilan.niveau}`, libelle: bilan.rang },
  ];
  const largeurCase = 300;
  const espaceCase = 24;
  let cx = (COTE - (3 * largeurCase + 2 * espaceCase)) / 2;
  const yCase = 760;

  for (const c of cases) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    rectArrondi(ctx, cx, yCase, largeurCase, 150, 24);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(c.valeur, cx + largeurCase / 2, yCase + 76);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(c.libelle, cx + largeurCase / 2, yCase + 118);
    cx += largeurCase + espaceCase;
  }

  // La signature. C'est elle qui fait de cette image autre chose qu'un souvenir
  // privé : sans nom lisible, une carte partagée n'apprend à personne d'où elle
  // vient.
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '700 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('Mindora', COTE / 2, 990);
  ctx.fillStyle = '#64748b';
  ctx.font = '500 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('disciplix-ai.vercel.app', COTE / 2, 1030);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('image non produite'))), 'image/png');
  });
}

export type ResultatPartage = 'partage' | 'telecharge' | 'annule' | 'echec';

/**
 * Partage la carte, ou l'enregistre quand le partage natif n'existe pas.
 *
 * `navigator.share` avec un fichier n'est pas disponible partout — absent sur la
 * plupart des navigateurs de bureau, et `canShare` doit être interrogé avec le
 * fichier lui-même, un navigateur pouvant accepter le partage de texte mais pas
 * de fichier. Le repli n'est pas un pis-aller : enregistrer l'image puis la
 * publier à la main est le geste normal sur un ordinateur.
 */
export async function partagerCarte(blob: Blob, texte: string): Promise<ResultatPartage> {
  const fichier = new File([blob], 'ma-semaine-mindora.png', { type: 'image/png' });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], text: texte });
      return 'partage';
    } catch (e: any) {
      // Fermer la feuille de partage lève `AbortError` : ce n'est pas une panne,
      // et l'annoncer comme telle serait mensonger.
      if (e?.name === 'AbortError') return 'annule';
      return 'echec';
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = 'ma-semaine-mindora.png';
    lien.click();
    // Révoqué plus tard : sur Safari, révoquer aussitôt annule le téléchargement.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'telecharge';
  } catch {
    return 'echec';
  }
}
