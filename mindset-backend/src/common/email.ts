import { Logger } from '@nestjs/common';

/**
 * L'envoi d'un e-mail par l'API REST de Brevo.
 *
 * `nodemailer` est encore dans `package.json` mais n'est importé nulle part : tout
 * passe par cette API. Le SMTP n'est donc pas une porte de secours, c'est un
 * reliquat — ne pas y revenir en croyant reprendre un chemin existant.
 *
 * Ce module ne sert que le courrier de cycle de vie (les relances). Les deux envois
 * d'`auth.service.ts` — code de connexion, lien de réinitialisation — gardent leur
 * propre appel : ils sont vérifiés en production et n'ont aucune raison de dépendre
 * d'un code qui bouge pour d'autres motifs.
 */
const logger = new Logger('Email');

export interface EnvoiEmail {
  destinataire: string;
  sujet: string;
  html: string;
  /**
   * Version texte du même message.
   *
   * Un e-mail qui n'a qu'une partie HTML est un signal de courrier indésirable à
   * lui seul : les filtres attendent le multipart que produit n'importe quel
   * client de messagerie normal. C'est aussi ce que lisent les montres et les
   * lecteurs d'écran.
   */
  texte?: string;
  /**
   * Adresse de retrait, posée en en-tête `List-Unsubscribe`.
   *
   * Depuis février 2024, Gmail et Yahoo l'exigent de tout expéditeur de masse, avec
   * `List-Unsubscribe-Post` pour le retrait en un clic. Sans eux, le message part
   * en indésirable **avant même d'être lu** — aucun soin apporté au contenu ne
   * rattrape leur absence.
   */
  lienRetrait?: string;
}

/**
 * Rend `true` seulement si Brevo a accepté le message.
 *
 * Le booléen compte : un envoi qui échoue en silence ferait marquer la relance
 * comme faite, et la personne ne recevrait jamais rien — sans que rien ne le dise.
 * C'est le défaut le plus fréquent de ce projet, on ne le rejoue pas ici.
 */
export async function envoyerEmail({
  destinataire,
  sujet,
  html,
  texte,
  lienRetrait,
}: EnvoiEmail): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    logger.warn(`BREVO_API_KEY absente : « ${sujet} » non envoyé à ${destinataire}.`);
    return false;
  }
  const expediteur = process.env.BREVO_SENDER_EMAIL || 'mindoraappli@gmail.com';

  /*
    Le retrait est annoncé deux fois : dans le pied de page, pour la personne, et
    en en-tête, pour sa messagerie. Le second compte davantage — c'est lui qui fait
    apparaître le bouton « Se désabonner » à côté de l'expéditeur, celui que les
    gens utilisent au lieu de cliquer sur « Signaler comme indésirable ». Une seule
    plainte pèse autant que des centaines de désabonnements.
  */
  const entetes = lienRetrait
    ? {
        'List-Unsubscribe': `<${lienRetrait}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }
    : undefined;

  try {
    const reponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Disciplix', email: expediteur },
        to: [{ email: destinataire }],
        subject: sujet,
        htmlContent: html,
        ...(texte ? { textContent: texte } : {}),
        ...(entetes ? { headers: entetes } : {}),
      }),
    });

    if (!reponse.ok) {
      logger.error(`Brevo a refusé « ${sujet} » pour ${destinataire} : ${await reponse.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    logger.error(`Envoi de « ${sujet} » impossible pour ${destinataire} : ${(e as any)?.message}`);
    return false;
  }
}

/**
 * La mise en page commune, et le pied de page qui porte le lien de retrait.
 *
 * Ce lien n'est pas une politesse : un courrier de relance qui n'offre aucun moyen
 * d'en sortir finit signalé comme indésirable, et c'est le domaine entier qui est
 * puni — y compris les codes de connexion, sans lesquels plus personne n'entre.
 * Le seul canal qui atteint tout le monde est aussi le plus facile à perdre.
 */
/**
 * Le bouton est facultatif : un message qui ne demande rien n'en porte pas.
 *
 * Un remerciement muni d'un appel à l'action redevient une relance, et c'est
 * exactement ce qui fait qu'on ne croit plus les remerciements.
 */
export function gabarit(options: {
  titre: string;
  corps: string;
  bouton?: { texte: string; lien: string };
  lienRetrait: string;
}): string {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f5; padding: 32px 16px;">
      <div style="background-color: #ffffff; padding: 32px; border-radius: 12px; max-width: 520px; margin: 0 auto;">
        <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">${options.titre}</h2>
        <div style="color: #374151; font-size: 15px; line-height: 1.6;">${options.corps}</div>
        ${
          options.bouton
            ? `<a href="${options.bouton.lien}" style="display: inline-block; margin: 28px 0 8px; padding: 14px 26px; background: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">${options.bouton.texte}</a>`
            : ''
        }
      </div>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 20px;">
        Disciplix · <a href="${options.lienRetrait}" style="color: #9ca3af;">ne plus recevoir ces messages</a>
      </p>
    </div>
  `;
}
