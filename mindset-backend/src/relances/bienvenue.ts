import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { envoyerEmail, gabarit } from '../common/email';
import { lienApp } from '../common/origines';
import { lienRetrait } from '../common/retrait';

/**
 * Le premier e-mail : celui qui part quand quelqu'un vient de créer son compte.
 *
 * Les autres messages du produit arrivent après coup — deux jours de silence, une
 * série interrompue, un abonnement pris. Celui-ci est le seul qui réponde à
 * l'instant présent, et c'est aussi le seul que la personne attend : elle vient de
 * donner son adresse, elle regarde sa boîte.
 *
 * **Il vaut d'abord comme preuve que l'adresse fonctionne.** Depuis le 16 août
 * 2026 la toute première connexion se passe du code à six chiffres — c'était le mur
 * qui perdait un quart des inscrits. La contrepartie est qu'une adresse mal tapée
 * ne se découvre plus à l'inscription : le compte s'ouvre normalement et la panne
 * n'apparaît qu'à la deuxième connexion, ou jamais. Un message envoyé tout de
 * suite laisse une trace en base : `RelanceEmail{motif: 'bienvenue'}` écrit veut
 * dire que Brevo a accepté l'adresse.
 *
 * **Ce qu'il dit est décidé par les chiffres du 20 août 2026, pas par l'habitude.**
 * Le mur du produit n'est pas le haut de l'entonnoir (90 % entrent dans l'app),
 * c'est le jour 2 : 13,5 % reviennent le lendemain, et deux tiers de ceux qui ont
 * agi n'ont agi qu'un seul jour. Le seul trait commun de tous ceux qui ont tenu
 * plus d'une journée est d'avoir parlé au coach. Le message ne fait donc pas le
 * tour des fonctions : il pousse vers la seule action qui prédise un retour.
 */
const logger = new Logger('Bienvenue');

/**
 * Le motif, écrit tel quel en base.
 *
 * Il partage la table des relances au lieu d'avoir la sienne, pour la contrainte
 * d'unicité `(user_id, motif)` : c'est elle, et non un test dans le code, qui
 * garantit qu'on ne souhaite pas deux fois la bienvenue à la même personne.
 */
export const MOTIF_BIENVENUE = 'bienvenue';

/** Le contenu, isolé pour être lisible dans un test sans passer par la base. */
export function contenuBienvenue(prenom: string, userId: string) {
  const retrait = lienRetrait(userId);
  // Même destination que les notifications push : la vue du coach quand la session
  // est encore ouverte, l'écran de connexion sinon.
  const app = lienApp('/?auth=true&vue=chat');

  /*
    Un sujet qui décrit un état, comme les trois autres messages du produit.

    « Bienvenue chez X ! » est la formule que tous les filtres ont apprise, et
    c'est une promesse vide : personne n'ouvre un e-mail pour être accueilli. Ce
    qui se passe vraiment, c'est que le compte existe.
  */
  const sujet = 'Ton compte est prêt';

  const corps =
    "<p>Ton compte est créé. Le produit tient en une phrase : tu dis à ton coach qui tu " +
    "veux devenir, il te donne quoi faire aujourd'hui, tu le fais. Demain, on recommence.</p>" +
    "<p>Une seule chose à faire maintenant : parle-lui une fois. Raconte-lui où tu en es, " +
    "même mal dit. Tant qu'il ne sait rien de toi, il ne peut te donner que des généralités " +
    "— c'est ce premier message qui transforme l'app en quelque chose qui te connaît.</p>" +
    "<p>Si tu ne sais pas par où commencer, ou si quelque chose ne marche pas : réponds à " +
    "cet e-mail. Je le lis.</p>";

  return {
    sujet,
    html: gabarit({
      titre: `${prenom}, bienvenue.`,
      corps,
      bouton: { texte: 'Parler à mon coach', lien: app },
      lienRetrait: retrait,
    }),
    texte:
      `${prenom}, bienvenue.\n\n` +
      "Ton compte est créé. Le produit tient en une phrase : tu dis à ton coach qui tu veux " +
      "devenir, il te donne quoi faire aujourd'hui, tu le fais. Demain, on recommence.\n\n" +
      "Une seule chose à faire maintenant : parle-lui une fois. Raconte-lui où tu en es, même " +
      "mal dit. Tant qu'il ne sait rien de toi, il ne peut te donner que des généralités — " +
      "c'est ce premier message qui transforme l'app en quelque chose qui te connaît.\n\n" +
      "Si tu ne sais pas par où commencer, ou si quelque chose ne marche pas : réponds à cet " +
      `e-mail. Je le lis.\n\n${app}\n\nNe plus recevoir ces messages : ${retrait}\n`,
    lienRetrait: retrait,
  };
}

/**
 * Envoie le message de bienvenue à une personne, une fois et une seule.
 *
 * Rend `true` seulement si Brevo a accepté le message. Comme partout ailleurs dans
 * ce module, **rien n'est écrit sur un échec** : la trace dit « envoyé », pas
 * « tenté ». L'inscrire quand même priverait définitivement la personne de son
 * message d'accueil tout en donnant à croire qu'elle l'a reçu — le défaut que ce
 * projet passe son temps à corriger.
 *
 * **Cette fonction ne lève jamais.** Elle est appelée depuis l'inscription : une
 * panne d'e-mail qui ferait échouer la création du compte coûterait exactement ce
 * que le message cherche à gagner.
 */
export async function envoyerBienvenue(
  prisma: PrismaService,
  compte: { id: string; email: string; first_name?: string | null; relances_email?: boolean },
): Promise<boolean> {
  try {
    // Quelqu'un qui s'est retiré n'a pas fait d'exception pour l'accueil. Le cas ne
    // se présente pas à l'inscription — le drapeau vaut `true` par défaut — mais
    // cette fonction sert aussi au rattrapage, où il peut avoir changé.
    if (compte.relances_email === false) return false;

    const deja = await prisma.relanceEmail.findFirst({
      where: { user_id: compte.id, motif: MOTIF_BIENVENUE },
      select: { id: true },
    });
    if (deja) return false;

    const { sujet, html, texte, lienRetrait: retrait } = contenuBienvenue(
      compte.first_name || 'toi',
      compte.id,
    );
    const parti = await envoyerEmail({
      destinataire: compte.email,
      sujet,
      html,
      texte,
      lienRetrait: retrait,
    });

    if (!parti) {
      logger.warn(`Bienvenue non partie pour ${compte.id} — sera retentée par la tournée de 11h.`);
      return false;
    }

    await prisma.relanceEmail.create({ data: { user_id: compte.id, motif: MOTIF_BIENVENUE } });
    logger.log(`Bienvenue envoyée à ${compte.id}`);
    return true;
  } catch (e) {
    // Y compris la contrainte d'unicité, si deux appels se croisent : deux
    // inscriptions simultanées du même compte sont impossibles, mais un rattrapage
    // lancé pendant une inscription ne l'est pas.
    logger.error(`Bienvenue impossible pour ${compte.id} : ${(e as any)?.message}`);
    return false;
  }
}
