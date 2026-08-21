import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CoachMemoryService } from './coach-memory.service';
import { lireReponseGroq, corpsGroq } from '../common/groq';

/**
 * La première phrase du coach — celle qu'il dit avant qu'on lui ait rien demandé.
 *
 * Le chat s'ouvrait sur « Bonjour, je suis {nom}. Comment je peux t'aider
 * aujourd'hui ? », une chaîne écrite en dur côté navigateur. Pendant ce temps le
 * serveur disposait déjà, pour construire ses réponses, du questionnaire
 * d'inscription, de la mémoire des échanges passés, de la tendance sur sept jours,
 * de la date et des tâches du jour. Autrement dit : le coach avait tout ce qu'il
 * fallait pour dire quelque chose que personne d'autre ne pouvait dire, et
 * ouvrait sur la phrase d'accueil d'un service client.
 *
 * C'est la première impression, et elle décide de tout le reste : c'est là qu'on
 * comprend, ou non, pourquoi ce coach existe plutôt qu'un carnet.
 *
 * Trois principes tiennent l'implémentation :
 *
 * 1. **Elle ne coûte rien à l'utilisateur.** Ni Énergie, ni quota mensuel : il
 *    n'a rien demandé, il vient d'ouvrir un écran. Facturer l'accueil serait le
 *    meilleur moyen de rendre l'app hostile à ceux qui la découvrent.
 *
 * 2. **Elle est mise en cache.** Un appel au modèle par ouverture d'écran ferait
 *    fondre le quota Groq du jour en quelques rechargements de page. La phrase est
 *    conservée quelques heures — assez pour qu'un aller-retour ne la régénère pas,
 *    trop peu pour qu'elle parle encore du matin à quelqu'un qui ouvre le soir.
 *
 * 3. **Elle échoue en silence.** Si le modèle ne répond pas, la route rend `null`
 *    et le navigateur affiche sa propre phrase, composée à partir des mêmes
 *    données locales. On ne montre jamais d'erreur à quelqu'un dont le seul geste
 *    a été d'ouvrir une conversation.
 */
@Injectable()
export class CoachOuvertureService {
  private readonly logger = new Logger(CoachOuvertureService.name);

  /** Heure de Paris : le serveur tourne en UTC, et « ce matin » doit vouloir dire ce matin. */
  private static readonly FUSEAU = 'Europe/Paris';

  /**
   * Au-delà, on régénère.
   *
   * Le compromis est explicite : plus court, on rappelle le modèle trop souvent
   * pour rien ; plus long, la phrase se met à mentir. Une ouverture qui annonce
   * « la journée est encore entière » à 21 h coûte plus cher en crédibilité que
   * l'appel qu'elle économise.
   */
  private static readonly FRAICHEUR_MS = 6 * 3600 * 1000;

  /** Une ouverture, c'est deux phrases. Le plafond est là pour que ça le reste. */
  private static readonly MAX_JETONS = 160;

  /**
   * Même ordre que la mémoire longue, et pour la même raison : ouvrir une
   * conversation n'est pas la tenir. Le petit modèle suffit, son quota est compté
   * à part, et le gros reste disponible pour les vrais échanges.
   */
  private static readonly MODELES = CoachMemoryService.MODELES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoire: CoachMemoryService,
  ) {}

  /**
   * Rend la phrase d'ouverture, ou `null` s'il n'y a rien à dire de mieux que ce
   * que le navigateur sait déjà composer.
   */
  async ouverture(userId: string, contexte: any, nomCoach?: string): Promise<string | null> {
    if (!userId || userId === 'demo-user') return null;

    const profil = await this.memoire.chargerProfil(userId).catch(() => null);

    /*
      La signature est calculée avant le cache, pas après.

      C'est elle qui décide si la phrase retenue parle encore d'aujourd'hui. Elle
      se lit dans `contexte`, que le navigateur vient d'envoyer — donc l'état réel
      de la personne à cette seconde, et non ce que la base croit savoir d'elle.
    */
    const signature = CoachOuvertureService.signature(contexte);

    const enCache = this.cacheValide(profil, signature);
    if (enCache) return enCache;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY') return null;

    const texte = await this.engendrer(apiKey, userId, profil, contexte, nomCoach);
    if (!texte) return null;

    // Le cache n'est écrit que si le profil existe : sans ligne à mettre à jour, la
    // phrase est simplement rendue sans être retenue. Mieux vaut un appel de plus
    // qu'une exception sur un compte qui n'a pas fini son inscription.
    if (profil) {
      await this.prisma.aIProfile
        .update({
          where: { user_id: userId },
          data: {
            ouverture_texte: texte,
            ouverture_genere_le: new Date(),
            ouverture_signature: signature,
          },
        })
        .catch((e) => this.logger.warn(`Ouverture non mise en cache pour ${userId} : ${e?.message}`));
    }

    return texte;
  }

  /**
   * En dessous, on garde la phrase même si les faits ont bougé.
   *
   * Uniquement contre le pathologique : un écran qui se remonte en boucle, deux
   * onglets ouverts côte à côte. Deux minutes de décalage ne se voient pas ; sans
   * ce plancher, une poignée de secondes suffirait à enchaîner les appels.
   */
  private static readonly PLANCHER_MS = 2 * 60 * 1000;

  /**
   * Les faits sur lesquels la phrase est écrite, réduits à une empreinte courte.
   *
   * **Le jour, le moment de la journée, l'état des tâches.** Ce sont exactement
   * les trois choses dont la phrase parle : dès que l'une bouge, ce qui a été
   * écrit cesse d'être vrai. Le titre des tâches n'y entre pas — renommer
   * « Squats » en « Squats (4×12) » ne change rien à ce qu'il y a à dire.
   */
  static signature(contexte: any): string {
    const { cas, faites, total } = CoachOuvertureService.lireEtatDuJour(contexte);
    const moment = CoachOuvertureService.momentDeLaJournee();
    return `${moment.jour}|${moment.phrase}|${cas}|${faites}/${total}`;
  }

  /**
   * La phrase retenue, si elle est encore vraie.
   *
   * **Un âge ne dit pas si une phrase est encore juste**, et c'est tout le défaut
   * qu'on répare ici. Constaté sur une capture d'un vrai utilisateur le 21 août
   * 2026 : « Il est 11 h 38 et tu n'as encore rien coché aujourd'hui » affiché à
   * 15 h 07, à quelqu'un dont le tableau de bord annonçait « Journée bouclée,
   * 6 tâches faites ». La phrase avait trois heures et demie — bien à l'intérieur
   * des six heures de fraîcheur — et elle était fausse sur les deux points
   * qu'elle avançait.
   *
   * C'est le miroir exact du défaut de synchro du 20 août : là-bas une donnée
   * fraîche n'était pas une donnée d'aujourd'hui, ici un cache jeune n'est pas un
   * cache encore valable. **La bonne question n'est pas « depuis quand ? » mais
   * « est-ce toujours vrai ? »**
   *
   * Une signature absente vaut périmée : les lignes écrites avant ce correctif
   * sont régénérées une fois, ce qui coûte un appel par personne et une seule.
   */
  private cacheValide(profil: any, signature: string): string | null {
    if (!profil?.ouverture_texte || !profil?.ouverture_genere_le) return null;

    const age = Date.now() - new Date(profil.ouverture_genere_le).getTime();
    if (age >= CoachOuvertureService.FRAICHEUR_MS) return null;
    if (age < CoachOuvertureService.PLANCHER_MS) return profil.ouverture_texte;

    return profil.ouverture_signature === signature ? profil.ouverture_texte : null;
  }

  private async engendrer(
    apiKey: string,
    userId: string,
    profil: any,
    contexte: any,
    nomCoach?: string,
  ): Promise<string | null> {
    const sync = await this.prisma.syncData
      .findUnique({ where: { user_id: userId }, select: { daily_scores: true } })
      .catch(() => null);

    const etat = CoachOuvertureService.lireEtatDuJour(contexte);
    const moment = CoachOuvertureService.momentDeLaJournee();

    const donnees = [
      /*
        Le moment, jamais l'heure à la minute.

        La phrase est mise en cache : une heure exacte y devient fausse par le
        simple passage du temps, et elle est la seule chose qu'on puisse
        contredire d'un coup d'œil à l'écran. « Il est 11 h 38 » lu à 15 h 07 ne
        se discute pas — vu sur une capture d'un vrai utilisateur le 21 août 2026.
        Le moment de la journée, lui, reste vrai plusieurs heures, et il entre
        dans la signature du cache : quand il change, la phrase est réécrite.
      */
      `Moment : ${moment.phrase}, on est ${moment.jour}.`,
      etat.resume,
      this.memoire.formatProfil(profil),
      this.memoire.formatMemoire(profil),
      this.memoire.formatTendance(sync?.daily_scores as any),
    ]
      .filter(Boolean)
      .join('\n');

    const messages = [
      { role: 'system', content: CoachOuvertureService.consigne(nomCoach, etat.cas) },
      { role: 'user', content: `Voici ce que tu sais de lui :\n${donnees}` },
    ];

    for (const modele of CoachOuvertureService.MODELES) {
      const texte = await this.appeler(apiKey, modele, messages);
      if (texte) return CoachOuvertureService.nettoyer(texte);
    }

    this.logger.warn(`Ouverture non générée pour ${userId} : aucun modèle disponible`);
    return null;
  }

  /**
   * La consigne.
   *
   * Elle est écrite en gardant deux leçons de ce projet : un modèle imite l'exemple
   * avant d'obéir à la règle, et il invente volontiers une tâche ou une durée qu'on
   * ne lui a pas données. D'où un exemple par cas, et une interdiction explicite.
   */
  private static consigne(nomCoach: string | undefined, cas: CasDuJour): string {
    const nom = nomCoach || 'le coach';

    const exemples: Record<CasDuJour, string> = {
      // Le compte qui n'a encore rien créé. Le geste attendu n'est pas de cocher
      // quelque chose — il n'y a rien à cocher — mais de dire ce qu'il veut devenir.
      vide: `Exemple de ton : « Tu m'as dit vouloir devenir quelqu'un de constant. On n'a encore rien posé ensemble. Dis-moi ce que tu veux que demain matin ressemble, et je te construis le plan. »`,
      /*
        Il reste des choses à faire : c'est le cas où l'on nomme une action précise.

        L'exemple ne cite plus qu'UNE tâche. Le précédent en citait deux — « ta
        séance de sport et ta lecture » — alors même que la consigne demande de
        n'en nommer qu'une. Un modèle imite l'exemple avant d'obéir à la règle :
        c'est de là que venaient les ouvertures à trois sujets.

        Il montre aussi le bon registre pour une journée entamée mais pas finie :
        l'heure sert à dire ce qui reste devant, jamais à juger ce qui est passé.
      */
      reste: `Exemple de ton : « Ta séance de sport n'est pas encore faite, et la journée avance. Dix minutes suffisent à ne pas casser la série. »`,
      // Tout est fait. Ne rien redemander — c'est le moment de reconnaître.
      fini: `Exemple de ton : « Tout est coché, et c'est le quatrième jour d'affilée. C'est exactement comme ça qu'on devient la personne dont tu m'as parlé. »`,
    };

    return [
      `Tu es ${nom}, le coach de discipline de cette personne. Tu lui écris la PREMIÈRE phrase de la conversation d'aujourd'hui : c'est toi qui parles en premier, elle ne t'a rien demandé.`,
      ``,
      `Règles :`,
      `- Deux phrases maximum, en français, en la tutoyant.`,
      `- Tu ouvres sur ce que tu sais d'elle : son objectif, ce qu'elle t'a déjà dit, sa régularité, l'état de sa journée. C'est ce qui prouve que tu la suis.`,
      `- Tu termines par une seule chose à faire maintenant, ou une seule question courte. Jamais les deux.`,
      /*
        Les quatre règles qui suivent viennent d'un message réellement envoyé, à
        19 h 19 : « tu as échoué à accomplir 11 tâches sur 11. Tu as une séance de
        méditation et une de sport, c'est une bonne base. Qu'est-ce que tu vas
        faire pour tes révisions ? » Un verdict d'échec sur une journée encore
        ouverte, un compliment portant sur des tâches non faites, et trois sujets
        en deux phrases. La consigne d'alors demandait de la franchise ; elle
        n'interdisait pas le registre de l'accusation, et rien ne disait qu'une
        journée en cours n'est pas jugeable.
      */
      `- INTERDIT de parler d'échec, d'échouer, de rater, de manquer. Une journée en cours n'est pas un échec : tant qu'il reste des heures, il reste une journée. Tu constates un état, tu ne rends pas un verdict.`,
      `- Une tâche non faite n'est JAMAIS une réussite. Ne félicite jamais quelqu'un pour ce qu'il a prévu, seulement pour ce qu'il a coché.`,
      `- Un seul sujet. Une seule tâche citée, jamais deux, jamais une liste. Si plusieurs restent, choisis-en une et ignore les autres.`,
      `- Ne mets jamais un reproche et un compliment dans le même message : l'un annule l'autre, et il ne reste qu'une impression de langue de bois.`,
      `- Si sa tendance montre un décrochage ou des jours à zéro, c'est par là que tu ouvres, avec le chiffre, sans l'adoucir — mais sans le lui reprocher. Une reprise commence par un constat, pas par un encouragement ni par un procès.`,
      `- Pas de conditionnel mou : ni « tu pourrais », ni « peut-être », ni « si tu veux ». Tu affirmes, tu demandes.`,
      /*
        L'heure exacte est interdite parce que la phrase est conservée.

        Un modèle qui écrit « il est 11 h 38 » fabrique la seule affirmation que
        la personne peut démentir d'un coup d'œil à son téléphone — et elle la
        démentira, puisque la phrase lui sera resservie plus tard dans la journée.
        Le moment de la journée dit la même chose et reste vrai.
      */
      `- N'écris JAMAIS une heure précise (« il est 11 h 38 », « à 14 h »). Cette phrase sera relue plus tard dans la journée : dis « la matinée », « l'après-midi », « la soirée », jamais l'heure qu'il est.`,
      `- Aucun compliment qui ne s'appuie sur un fait présent dans les données. « Bravo » tout seul est interdit.`,
      `- N'INVENTE RIEN. Aucune tâche, aucune durée, aucun chiffre, aucun rendez-vous qui ne soit dans les données ci-dessous. Si tu n'as pas de tâche précise à citer, n'en cite aucune.`,
      `- Pas de « Bonjour, je suis... », pas de « Comment puis-je t'aider ? », pas d'emoji, pas de liste, pas de titre.`,
      `- Écris uniquement la phrase, rien autour.`,
      ``,
      exemples[cas],
    ].join('\n');
  }

  /**
   * Trois états, et non deux.
   *
   * « Rien de prévu » et « tout est fait » se ressemblent — dans les deux cas il ne
   * reste rien à cocher — mais appellent des phrases opposées : féliciter quelqu'un
   * qui n'a jamais rien planifié est le plus sûr moyen de lui montrer qu'on ne le
   * suit pas.
   */
  static lireEtatDuJour(contexte: any): { cas: CasDuJour; resume: string; faites: number; total: number } {
    const routines = Array.isArray(contexte?.routines) ? contexte.routines.slice(0, 20) : [];
    const taches: { titre: string; faite: boolean }[] = [];

    for (const r of routines) {
      const items = Array.isArray(r?.items) ? r.items.slice(0, 20) : [];
      for (const t of items) {
        taches.push({ titre: String(t?.title ?? '').slice(0, 120), faite: !!t?.done });
      }
    }

    if (!taches.length) {
      return {
        cas: 'vide',
        resume: `Sa journée : rien de planifié, il n'a encore aucune tâche dans l'application.`,
        faites: 0,
        total: 0,
      };
    }

    const restantes = taches.filter((t) => !t.faite);
    const faites = taches.filter((t) => t.faite);
    if (!restantes.length) {
      return {
        cas: 'fini',
        resume: [
          `Sa journée : les ${taches.length} tâches prévues sont TOUTES FAITES.`,
          `Ce qu'il a fait : ${faites.map((t) => t.titre).filter(Boolean).join(', ')}`,
        ].join('\n'),
        faites: faites.length,
        total: taches.length,
      };
    }

    /*
      Les deux listes sont nommées et séparées, et l'état de chacune est répété
      dans son intitulé.

      Le résumé disait « 0 tâche(s) faite(s) sur 11 » puis « Il lui reste : … ».
      Le modèle a lu la seconde liste comme un acquis et a écrit, à 19 h 19 :
      « tu as échoué à accomplir 11 tâches sur 11. Tu as une séance de méditation
      et une de sport, c'est une bonne base. » — un reproche, suivi d'un
      compliment portant sur des tâches qui n'étaient pas faites. Les deux
      erreurs viennent d'ici : une liste sans étiquette explicite se fait ranger
      du côté que le modèle préfère.

      D'où « PAS ENCORE FAITES » plutôt que « il lui reste » : la formule dit son
      propre statut, même sortie de son contexte.
    */
    return {
      cas: 'reste',
      resume: [
        `Sa journée : ${faites.length} tâche(s) faite(s) sur ${taches.length}.`,
        faites.length
          ? `DÉJÀ FAITES (ne les redemande jamais) : ${faites.map((t) => t.titre).filter(Boolean).join(', ')}`
          : `Il n'a encore rien coché aujourd'hui.`,
        `PAS ENCORE FAITES (ce sont des choses à faire, surtout pas des réussites) : ${restantes
          .map((t) => t.titre)
          .filter(Boolean)
          .join(', ')}`,
      ].join('\n'),
      faites: faites.length,
      total: taches.length,
    };
  }

  /** L'heure, en clair, dans le fuseau de la personne et non celui du serveur. */
  private static momentDeLaJournee() {
    const maintenant = new Date();
    const heure = maintenant.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: CoachOuvertureService.FUSEAU,
    });
    const jour = maintenant.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: CoachOuvertureService.FUSEAU,
    });
    const h = Number(
      maintenant.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: CoachOuvertureService.FUSEAU }),
    );
    const phrase =
      h < 6 ? 'il fait encore nuit' : h < 12 ? 'la journée commence' : h < 18 ? "c'est l'après-midi" : 'la journée se termine';
    return { heure, jour, phrase };
  }

  /**
   * Le modèle rend parfois la phrase entre guillemets, ou précédée de « Voici ».
   * On ne peut pas le lui interdire de façon fiable, on peut le nettoyer.
   */
  private static nettoyer(texte: string): string {
    let t = texte.trim();
    // Un préambule éventuel, quand le modèle annonce ce qu'il va faire.
    t = t.replace(/^(voici|réponse|ouverture)\s*:\s*/i, '').trim();
    // Des guillemets qui enveloppent toute la phrase — jamais ceux qui sont dedans.
    if (/^["«“']/.test(t) && /["»”']$/.test(t)) t = t.slice(1, -1).trim();
    return t.slice(0, 400);
  }

  /** Un appel. Rend null pour laisser sa chance au modèle suivant. */
  private async appeler(apiKey: string, modele: string, messages: any[]): Promise<string | null> {
    const controleur = new AbortController();
    // Court exprès : c'est un écran qui s'ouvre. Au-delà, la phrase locale a déjà
    // été affichée et la remplacer sous les yeux de quelqu'un serait pire que rien.
    const minuteur = setTimeout(() => controleur.abort(), 8000);
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(
          corpsGroq({
            modele,
            messages,
            temperature: 0.7,
            jetons: CoachOuvertureService.MAX_JETONS,
          }),
        ),
        signal: controleur.signal,
      });
      if (!r.ok) {
        this.logger.warn(`Groq a répondu ${r.status} sur ${modele} pour l'ouverture`);
        return null;
      }
      const data = await r.json();
      const { texte, tronque } = lireReponseGroq(data);

      // Coupée, la phrase d'accueil s'arrête au milieu d'un mot — et elle est mise en
      // cache six heures, donc on la relirait à chaque ouverture du chat de la journée.
      // Rendre null suit la règle de ce service : en cas d'échec on se tait, et la
      // phrase composée localement reste affichée. Elle, au moins, est entière.
      if (tronque) {
        this.logger.warn(`Ouverture coupée par max_tokens sur ${modele}`);
        return null;
      }

      return texte;
    } catch (e: any) {
      this.logger.warn(
        `Ouverture non générée sur ${modele} : ${e?.name === 'AbortError' ? 'délai dépassé' : e?.message}`,
      );
      return null;
    } finally {
      clearTimeout(minuteur);
    }
  }
}

export type CasDuJour = 'vide' | 'reste' | 'fini';
