import * as crypto from 'crypto';
import { lienApi } from './origines';

/**
 * Le lien qui permet de ne plus rien recevoir, et sa signature.
 *
 * Extrait de `RelanceEmailService` le 20 août 2026, au moment où un second envoi
 * périodique — le brief du matin par e-mail — a eu besoin du même lien. Le
 * recopier aurait créé deux façons de signer la même chose : le jour où l'une
 * change, les liens déjà partis dans des boîtes cessent de fonctionner, et
 * personne ne s'en aperçoit avant qu'un signalement pour spam tombe.
 *
 * **Ce lien n'est pas une politesse.** Un courrier périodique qui n'offre aucune
 * sortie finit signalé comme indésirable, et c'est le domaine entier qui est puni
 * — codes de connexion compris, sans lesquels plus personne n'entre.
 */

/**
 * Jeton lié à un compte, invérifiable sans le secret du serveur.
 *
 * Sans signature, le lien se réduirait à un identifiant en clair dans une URL :
 * n'importe qui pourrait désabonner n'importe qui en changeant un caractère.
 */
export function signatureRetrait(userId: string): string {
  const secret = process.env.JWT_SECRET || process.env.JWT_REFRESH_SECRET || 'disciplix';
  return crypto.createHmac('sha256', secret).update(`retrait:${userId}`).digest('hex').slice(0, 32);
}

export function verifierSignatureRetrait(userId: string, signature: string): boolean {
  const attendue = signatureRetrait(userId);
  // Comparaison à temps constant : une comparaison ordinaire s'arrête au premier
  // caractère faux et laisse deviner la signature octet par octet.
  const a = Buffer.from(attendue);
  const b = Buffer.from(signature ?? '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Le lien pointe vers l'API et non vers l'application.
 *
 * C'est le serveur qui tient la préférence, et l'application ne saurait pas la
 * poser sans une session — or quelqu'un qui veut ne plus rien recevoir est
 * précisément quelqu'un qui ne se reconnectera pas.
 */
export function lienRetrait(userId: string): string {
  return lienApi(`/emails/retrait?u=${encodeURIComponent(userId)}&s=${signatureRetrait(userId)}`);
}
