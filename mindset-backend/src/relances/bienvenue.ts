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

/**
 * Au-delà, l'accueil n'est plus un accueil : c'est un mot d'excuse.
 *
 * Deux jours, la même valeur que `JOURS_AVANT_JAMAIS_OUVERT` — mais les deux
 * répondent à des questions différentes et n'ont aucune raison de rester égales :
 * l'une dit à partir de quand on peut reprocher une absence, celle-ci dit à partir
 * de quand « ton compte est prêt » sonne faux.
 *
 * Ça compte parce que le rattrapage des comptes déjà inscrits passe par ici. Un
 * message qui annonce la création d'un compte vieux de trois semaines se lit comme
 * un envoi automatique déréglé, et c'est ce qui fait cliquer sur « indésirable ».
 */
export const JOURS_AVANT_ACCUEIL_TARDIF = 2;

/**
 * Le rendez-vous, annoncé dès le premier message.
 *
 * **C'est la réponse du 25 août 2026 au mur du deuxième jour.** Deux tiers de ceux
 * qui agissent n'agissent qu'une seule journée, et rien dans le produit ne donnait
 * de raison de revenir : le plan est livré le premier jour, après quoi
 * l'application demande du travail et rend un pourcentage. On revient pour un
 * rendez-vous, pas pour un tableau de bord.
 *
 * Dire quand le prochain message arrive coûte une phrase et change la nature de
 * celui de demain : il n'est plus une relance qui tombe, c'est quelque chose qui
 * était prévu. Personne ne signale pour indésirable un message qu'on lui a annoncé.
 *
 * **La promesse doit être tenue, et elle l'est par construction :** quand le modèle
 * ne répond pas le matin, `BriefEmailService.repliPremierMatin` écrit le tout
 * premier brief sans lui. Ne jamais retirer l'un sans retirer l'autre — une
 * promesse démentie au premier matin coûte plus cher que pas de promesse.
 *
 * Absent du message de rattrapage : annoncer un rendez-vous pour demain à quelqu'un
 * à qui l'on écrit avec trois semaines de retard n'engage que celui qui l'écoute.
 */
const RENDEZ_VOUS =
  "Demain matin, je t'écris avec ta journée. C'est comme ça que ça marche ici : " +
  'un point par jour, court, et on avance.';

/**
 * Le contenu, isolé pour être lisible dans un test sans passer par la base.
 *
 * Deux ouvertures, une seule demande. `tardif` ne change pas ce qu'on attend de la
 * personne — parler au coach, la seule action qui prédise un retour — il change la
 * raison pour laquelle ce message arrive aujourd'hui. Quelqu'un qui s'est inscrit
 * il y a trois semaines a droit à cette explication : sans elle, un e-mail qui
 * tombe sans raison depuis un produit qu'on avait oublié est un signalement pour
 * indésirable qui attend.
 */
export function contenuBienvenue(prenom: string, userId: string, tardif = false) {
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
  const sujet = tardif ? 'Je ne t’avais jamais écrit' : 'Ton compte est prêt';

  if (tardif) {
    /*
      Le message de rattrapage, pour ceux qui étaient déjà inscrits le jour où
      l'accueil a été écrit.

      Il dit la vérité sur son propre retard, et c'est le seul moyen de le rendre
      recevable — l'alternative serait d'annoncer à quelqu'un que son compte de
      trois semaines vient d'être créé. Il finit par une question ouverte plutôt
      que par une relance : une réponse, même « je ne reviendrai pas », vaut mieux
      qu'un signalement, et une conversation dans les deux sens est le meilleur
      signal de réputation qu'un domaine neuf puisse recevoir.
    */
    return {
      sujet,
      html: gabarit({
        titre: `${prenom}, je te dois un mot.`,
        corps:
          "<p>Tu as créé ton compte il y a quelque temps, et tu n'as jamais rien reçu de moi. " +
          "Ce n'était pas un choix : le message d'accueil n'existait pas encore. Le voici, en retard.</p>" +
          '<p>Disciplix tient en une phrase : tu dis à ton coach qui tu veux devenir, il te donne ' +
          "quoi faire aujourd'hui, tu le fais. Demain, on recommence.</p>" +
          '<p>Si tu veux lui laisser une chance, commence par lui parler une fois. Raconte-lui où ' +
          "tu en es, même mal dit — tant qu'il ne sait rien de toi, il ne peut te donner que des " +
          'généralités.</p>' +
          '<p>Et si tu ne comptes pas revenir, dis-le-moi en répondant à cet e-mail. Savoir ce qui ' +
          "n'allait pas m'est plus utile qu'un compte de plus.</p>",
        bouton: { texte: 'Reprendre avec mon coach', lien: app },
        lienRetrait: retrait,
      }),
      texte:
        `${prenom}, je te dois un mot.\n\n` +
        "Tu as créé ton compte il y a quelque temps, et tu n'as jamais rien reçu de moi. Ce " +
        "n'était pas un choix : le message d'accueil n'existait pas encore. Le voici, en retard.\n\n" +
        'Disciplix tient en une phrase : tu dis à ton coach qui tu veux devenir, il te donne quoi ' +
        "faire aujourd'hui, tu le fais. Demain, on recommence.\n\n" +
        'Si tu veux lui laisser une chance, commence par lui parler une fois. Raconte-lui où tu ' +
        "en es, même mal dit — tant qu'il ne sait rien de toi, il ne peut te donner que des " +
        'généralités.\n\n' +
        'Et si tu ne comptes pas revenir, dis-le-moi en répondant à cet e-mail. Savoir ce qui ' +
        `n'allait pas m'est plus utile qu'un compte de plus.\n\n${app}\n\nNe plus recevoir ces messages : ${retrait}\n`,
      lienRetrait: retrait,
    };
  }

  return {
    sujet,
    html: gabarit({
      titre: `${prenom}, bienvenue.`,
      corps:
        '<p>Ton compte est créé. Le produit tient en une phrase : tu dis à ton coach qui tu ' +
        "veux devenir, il te donne quoi faire aujourd'hui, tu le fais. Demain, on recommence.</p>" +
        '<p>Une seule chose à faire maintenant : parle-lui une fois. Raconte-lui où tu en es, ' +
        "même mal dit. Tant qu'il ne sait rien de toi, il ne peut te donner que des généralités " +
        "— c'est ce premier message qui transforme l'app en quelque chose qui te connaît.</p>" +
        `<p>${RENDEZ_VOUS}</p>` +
        '<p>Si tu ne sais pas par où commencer, ou si quelque chose ne marche pas : réponds à ' +
        'cet e-mail. Je le lis.</p>',
      bouton: { texte: 'Parler à mon coach', lien: app },
      lienRetrait: retrait,
    }),
    texte:
      `${prenom}, bienvenue.\n\n` +
      'Ton compte est créé. Le produit tient en une phrase : tu dis à ton coach qui tu veux ' +
      "devenir, il te donne quoi faire aujourd'hui, tu le fais. Demain, on recommence.\n\n" +
      'Une seule chose à faire maintenant : parle-lui une fois. Raconte-lui où tu en es, même ' +
      "mal dit. Tant qu'il ne sait rien de toi, il ne peut te donner que des généralités — " +
      "c'est ce premier message qui transforme l'app en quelque chose qui te connaît.\n\n" +
      `${RENDEZ_VOUS}\n\n` +
      'Si tu ne sais pas par où commencer, ou si quelque chose ne marche pas : réponds à cet ' +
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
  compte: {
    id: string;
    email: string;
    first_name?: string | null;
    relances_email?: boolean;
    created_at: Date;
  },
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

    /*
      L'ouverture se déduit de l'âge du compte, elle n'est pas passée par l'appelant.

      Deux chemins mènent ici — l'inscription et le rattrapage — et un drapeau
      qu'on se transmet finit toujours par être oublié sur l'un des deux. L'âge,
      lui, est une propriété du compte : il donne la même réponse quel que soit
      celui qui appelle.

      Le test `instanceof` n'est pas une politesse envers TypeScript : une date
      absente ferait lever `.getTime()`, le `catch` plus bas avalerait l'erreur, et
      **personne ne recevrait rien** — une panne muette pour une question de
      formulation. Sans date, on écrit l'accueil du jour même : c'est le seul
      chemin où le cas peut survenir, celui de l'inscription.
    */
    const tardif =
      compte.created_at instanceof Date &&
      Date.now() - compte.created_at.getTime() > JOURS_AVANT_ACCUEIL_TARDIF * 86_400_000;

    const { sujet, html, texte, lienRetrait: retrait } = contenuBienvenue(
      compte.first_name || 'toi',
      compte.id,
      tardif,
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
    logger.log(`Bienvenue envoyée à ${compte.id}${tardif ? ' (rattrapage)' : ''}`);
    return true;
  } catch (e) {
    // Y compris la contrainte d'unicité, si deux appels se croisent : deux
    // inscriptions simultanées du même compte sont impossibles, mais un rattrapage
    // lancé pendant une inscription ne l'est pas.
    logger.error(`Bienvenue impossible pour ${compte.id} : ${(e as any)?.message}`);
    return false;
  }
}
