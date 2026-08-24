import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CoachMemoryService } from './coach-memory.service';
import { RappelService } from './rappel.service';
import { ObservationService } from './observation.service';
import { AnalyseHabitudesService } from '../push/analyse-habitudes.service';
import { lireReponseGroq, pourModele } from '../common/groq';
import { lireFournisseurSecours, FournisseurSecours } from '../common/fournisseur-secours';
import { MODELES_CHAT } from '../common/modeles';
import { construirePromptBase } from './prompt-coach';
import { cleJourParis } from '../common/jour-paris';

@Injectable()
export class AiCoachingService {
  /**
   * Mot par lequel le modèle réclame lui-même le schéma du plan.
   *
   * C'est le filet de la détection par mots-clés ci-dessous : celle-ci est volontairement
   * large, mais une formulation inattendue lui échappera toujours. Plutôt que de laisser
   * l'utilisateur devant un refus inexplicable, le modèle signale qu'il lui manque les
   * instructions et on relance l'appel avec le schéma complet.
   */
  private static readonly MARQUEUR_PLAN = 'BESOIN_SCHEMA_PLAN';

  /*
    Numerotee 13, apres les douze regles du prompt de base.

    Elle portait le numero 11, deja pris par POSER UN RAPPEL — et arrivait apres
    la 12. Le modele lisait donc deux regles 11 contradictoires, dont l une lui
    demande de repondre un seul mot et rien d autre. Une regle qu on ecrase de
    cette facon n est pas une regle, c est un tirage au sort.
  */
  private static readonly MARQUEUR_PLAN_REGLE = `13. **DEMANDE PORTANT SUR SON PLAN** : Si le message demande de créer, modifier, compléter, remplacer ou supprimer ses routines, ses habitudes, ses objectifs ou ses repas, réponds EXCLUSIVEMENT par le mot ${AiCoachingService.MARQUEUR_PLAN}, seul, sans aucun autre mot. On te fournira alors les instructions nécessaires. Dans tous les autres cas — encouragement, question, bilan, discussion — ignore cette règle et réponds normalement.`;

  /**
   * Repère une demande portant sur le plan, pour joindre le schéma dès le premier appel.
   *
   * Délibérément généreuse : un faux positif ne coûte que des jetons — le prix qu'on
   * payait de toute façon avant le découpage — là où un faux négatif coûte un
   * aller-retour supplémentaire à l'utilisateur.
   */
  /*
    Les mots d'apprentissage manquaient, et c'est une famille entière de demandes.

    « Donne-moi toutes les notions à apprendre » ne contenait aucun de ces mots :
    le schéma n'était pas joint, et le coach répondait une action du jour à
    quelqu'un qui demandait un parcours — alors que l'application sait fabriquer
    ce parcours et l'installer chez lui. Capture d'un vrai échange, 21 août 2026.

    Le coût d'un mot en trop n'est pas symétrique : joindre le schéma sans raison
    alourdit l'invite d'un millier de jetons, l'omettre à tort fait répondre à côté
    — et il existe déjà un rattrapage pour le premier cas seulement (le modèle
    réclame le schéma, on rappelle avec). On élargit donc, mais sur des mots qui
    désignent vraiment une structure à construire : apprendre, étudier, formation,
    parcours, étape, notion, compétence.
  */
  private static readonly MOTS_PLAN =
    /(plan|planning|programme|routine|habitude|objectif|repas|nutrition|aliment|menu|entra[iî]n|s[ée]ance|exercice|sport|muscu|apprendre|apprends|apprentissage|[ée]tudier|formation|parcours|[ée]tape|notion|comp[ée]tence|ajoute|rajoute|cr[ée]e|change|modifie|remplace|supprime|enl[èe]ve|retire|g[ée]n[èe]re|refais|r[ée]initialise|organise|pr[ée]pare|que dois-je faire|quoi faire)/i;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoire: CoachMemoryService,
    private readonly rappels: RappelService,
    /*
      Ce que l application a calcule sur la personne, et que le coach ignorait.

      Les motifs et le levier existaient depuis le 16 aout, mais ne sortaient que
      sur des cartes d ecran : dans une conversation, le coach n en savait rien. Le
      produit connaissait donc quelque chose de la personne que son coach ne
      connaissait pas — exactement ce que l abonnement pretend vendre.
    */
    private readonly observations: ObservationService,
    private readonly analyseHabitudes: AnalyseHabitudesService,
  ) {}

  /** Le serveur tourne en UTC ; les personnes à qui il parle vivent en France. */
  private static readonly FUSEAU = 'Europe/Paris';

  /**
   * Marque, dans l'historique, les messages qui ne sont pas d'aujourd'hui.
   *
   * Les vingt derniers messages partaient au modèle sans aucune date. Ils peuvent
   * couvrir deux semaines : le coach relisait donc « je le fais demain », écrit
   * quatre jours plus tôt, comme s'il venait d'être dit — et raisonnait sur un
   * « demain » déjà passé. C'est la même erreur que le rappel posé au mauvais
   * jour, par le même chemin : une date que le modèle doit deviner, il la devine
   * mal.
   *
   * **Un seul repère par journée, pas un par message.** Marquer chaque ligne
   * coûterait une vingtaine de jetons par message pour redire la même chose ;
   * seul le changement de jour porte une information. Les messages du jour ne
   * sont pas marqués du tout : c'est le cas par défaut, et le dire serait du
   * bruit sur les échanges courants, qui sont la majorité.
   */
  static marquerLesJours(
    messages: Array<{ role: string; content: string; quand?: Date }>,
    maintenant = new Date(),
  ): Array<{ role: string; content: string }> {
    const aujourdhui = cleJourParis(maintenant);
    const hier = new Date(
      Date.UTC(
        Number(aujourdhui.slice(0, 4)),
        Number(aujourdhui.slice(5, 7)) - 1,
        Number(aujourdhui.slice(8, 10)) - 1,
      ),
    )
      .toISOString()
      .slice(0, 10);

    let jourPrecedent = '';

    return messages.map(({ role, content, quand }) => {
      if (!quand || Number.isNaN(quand.getTime())) return { role, content };

      const jour = cleJourParis(quand);
      if (jour === aujourdhui || jour === jourPrecedent) {
        jourPrecedent = jour;
        return { role, content };
      }
      jourPrecedent = jour;

      const libelle =
        jour === hier
          ? 'hier'
          : quand.toLocaleDateString('fr-FR', {
              timeZone: AiCoachingService.FUSEAU,
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            });

      return { role, content: `[${libelle}] ${content}` };
    });
  }

  /**
   * Retire d'une réponse passée le bloc technique destiné à l'interface.
   *
   * L'expression employée jusqu'ici exigeait les deux balises intactes. Or le modèle
   * en abîme parfois la fermeture — « ; ↘'PLAN> » observé en production. Le bloc
   * restait alors dans l'historique **pour toujours**, renvoyé au modèle à chaque
   * message : il y lisait un exemple de sa propre production ratée, et l'imitait.
   *
   * L'ouverture suffit donc à condamner la suite. Tout ce qui vient après `<PLAN>`
   * s'adresse à l'application, jamais à la conversation.
   */
  static retirerPlan(texte: string): string {
    const ouverture = texte.search(/<\s*PLAN\s*>/i);
    if (ouverture === -1) return texte.trim();

    const apres = texte.slice(ouverture).replace(/<\s*PLAN\s*>/i, '');
    const fermeture = apres.search(/<?\s*\/?\s*PLAN\s*>/i);
    const suite = fermeture === -1 ? '' : apres.slice(fermeture).replace(/<?\s*\/?\s*PLAN\s*>/i, '');

    return `${texte.slice(0, ouverture)}\n${suite}`.replace(/<?\s*\/?\s*PLAN\s*>/gi, '').trim();
  }

  /**
   * Nombre de jours tenus sur les sept derniers, historique de l'habitude en main.
   *
   * Les dates sont comparées sous forme de chaînes `AAAA-MM-JJ`, comme le client les
   * écrit : passer par des objets `Date` rejouerait le décalage de fuseau que la clé
   * du jour évite précisément.
   */
  static joursTenus(historique: unknown): number {
    if (!Array.isArray(historique)) return 0;

    const recents = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 86400000);
      recents.add(d.toLocaleDateString('sv-SE', { timeZone: AiCoachingService.FUSEAU }));
    }

    // Un même jour peut figurer deux fois dans l'historique : on compte les jours,
    // pas les lignes, sinon une habitude cochée deux fois afficherait 8/7.
    const tenus = new Set(
      historique.filter((d): d is string => typeof d === 'string' && recents.has(d.slice(0, 10))).map((d) => d.slice(0, 10)),
    );
    return tenus.size;
  }

  /** Ce que le questionnaire d'inscription propose, traduit pour le coach. */
  private static readonly OBJECTIFS_LISIBLES: Record<string, string> = {
    business: 'Développer son business',
    discipline: 'Construire une discipline de fer',
    health: 'Retrouver santé et énergie',
    mental: 'Prendre soin de sa santé mentale',
  };

  private static readonly CONSTANCE_LISIBLE: Record<string, string> = {
    high: "Très discipliné : il ne lâche pas ce qu'il commence.",
    medium: "En dents de scie : des pics de motivation, puis des relâchements. C'est dans les creux qu'il a besoin de toi.",
    low: "Se disperse et abandonne vite. Vise des victoires courtes et immédiates plutôt que des programmes ambitieux.",
  };


  /**
   * Enregistre le questionnaire d'inscription.
   *
   * Cette table est lue à chaque message par `formatProfil()` pour que le coach
   * connaisse la personne. Le frontend ne l'appelait jamais : il affichait trois
   * secondes d'animation puis jetait les réponses, si bien que la personnalisation
   * construite côté serveur n'avait aucune donnée à lire.
   *
   * Les réponses arrivent sous la forme brute du questionnaire (`job`, `consistency`,
   * `goal`) : on les traduit ici, car c'est un prompt qui les lira, pas une machine.
   *
   * Le questionnaire ne posait que trois questions à choix fermés — quarante-huit
   * profils possibles pour toute la base. Aucune consigne ne fabrique un plan unique
   * à partir de « Entrepreneur / en dents de scie / discipline » : le modèle retombe
   * alors sur l'exemple du prompt, et tout le monde reçoit le même programme. Trois
   * réponses ont donc été ajoutées, dont la seule ouverte du parcours.
   */
  async processOnboarding(userId: string, data: any) {
    const objectif = AiCoachingService.OBJECTIFS_LISIBLES[data?.goal] || data?.goal;
    const constance = AiCoachingService.CONSTANCE_LISIBLE[data?.consistency];

    // Le temps déclaré n'a de valeur que borné : une valeur fantaisiste venue d'un
    // client modifié ferait produire un plan de vingt heures ou de zéro minute.
    const minutes = Number(data?.minutesParJour ?? data?.minutes_par_jour);
    const minutesParJour = Number.isFinite(minutes) ? Math.min(240, Math.max(5, Math.round(minutes))) : null;

    const niveau = typeof data?.niveau === 'string' ? data.niveau : data?.niveau_depart;
    const niveauDepart = niveau && niveau in CoachMemoryService.NIVEAU_LISIBLE ? niveau : null;

    // Le seul champ libre du parcours, et donc le seul endroit où quelqu'un peut dire
    // ce qu'aucun bouton ne prévoyait. Plafonné : il repart dans le prompt à chaque
    // message, et un roman s'y facturerait indéfiniment.
    const situation =
      typeof data?.situation === 'string' && data.situation.trim() ? data.situation.trim().slice(0, 600) : null;

    const champs = {
      // Les deux formes sont acceptées : celle du questionnaire et celle, déjà
      // nommée comme la base, qu'utilisent les appels existants.
      occupation: data?.job ?? data?.occupation ?? null,
      objectives: objectif ? [objectif] : data?.objectives || [],
      personality: constance ?? data?.personality ?? null,
      age: data?.age ?? null,
      constraints: data?.constraints || [],
      current_habits: data?.current_habits || [],
      situation,
      minutes_par_jour: minutesParJour,
      niveau_depart: niveauDepart,
    };

    // upsert et non create : une inscription rejouée — reconnexion, double clic,
    // relance après une coupure réseau — levait P2002 sur la contrainte d'unicité
    // et renvoyait une erreur à quelqu'un dont le compte venait d'être créé.
    const profile = await this.prisma.aIProfile.upsert({
      where: { user_id: userId },
      update: champs,
      create: { user_id: userId, ...champs },
    });

    console.log(`[Onboarding] Profil enregistré pour ${userId} (${champs.occupation}, ${objectif})`);

    // L'objectif long terme reprend ce qu'il a choisi, au lieu du « Devenir plus
    // discipliné (Auto-généré) » identique pour tout le monde qui était écrit ici.
    await this.prisma.goal.create({
      data: {
        user_id: userId,
        title: objectif || 'Construire une discipline de fer',
        category: data?.goal || 'mindset',
        timeframe: 'long_term',
      }
    });

    // Le message annonçait « et premier programme généré », ce qui n'a jamais été le
    // cas. Un retour qui décrit autre chose que ce qui s'est produit finit par être cru.
    return { message: 'Profil enregistré.', profile };
  }

  /** Longueur au-delà de laquelle un objectif n'est plus une phrase mais un texte. */
  static readonly MAX_OBJECTIF = 120;

  /**
   * Ce que la personne a déclaré vouloir devenir.
   *
   * Cette table était en écriture seule : remplie à l'inscription, lue uniquement
   * par le prompt du serveur, et jamais réaffichée. On demandait donc à quelqu'un
   * « quel est ton objectif numéro 1 ? » pour ne plus jamais le lui redire — alors
   * que c'est la seule phrase qui explique pourquoi il coche des cases tous les
   * jours. L'app peut maintenant la lui remettre sous les yeux.
   *
   * Le sous-ensemble rendu est délibéré : ni la mémoire longue, ni l'ouverture en
   * cache n'ont à sortir d'ici. La première est une fiche de suivi écrite pour le
   * modèle, pas pour la personne qu'elle décrit.
   */
  async lireProfil(userId: string) {
    const profil = await this.prisma.aIProfile.findUnique({
      where: { user_id: userId },
      select: {
        objectives: true,
        occupation: true,
        personality: true,
        coaching_style: true,
        situation: true,
        minutes_par_jour: true,
        niveau_depart: true,
        reveil: true,
      },
    });
    return {
      objectif: profil?.objectives?.[0] ?? null,
      occupation: profil?.occupation ?? null,
      personality: profil?.personality ?? null,
      coaching_style: profil?.coaching_style ?? null,
      situation: profil?.situation ?? null,
      minutesParJour: profil?.minutes_par_jour ?? null,
      niveau: profil?.niveau_depart ?? null,
      // Nul veut dire « rien de reglé », pas « pas de brief » : l'écran affiche
      // alors l'heure par défaut comme un choix implicite, ce qu'elle est.
      reveil: profil?.reveil ?? null,
      // Le questionnaire ne se rejoue que si le serveur ignore tout de la personne
      // (`has_ai_profile`), donc les comptes ouverts avant ces trois questions ne les
      // verront jamais : leurs réponses resteraient vides à vie, et leur coach
      // continuerait à composer des plans sans savoir de combien de temps ils
      // disposent. Ce drapeau permet à l'app de le leur demander après coup.
      // La situation est facultative : ne pas avoir de blessure à déclarer n'est pas
      // un profil incomplet, et redemander indéfiniment à ceux qui n'ont rien à dire
      // transformerait la carte en harcèlement.
      cadrageManquant: !profil?.minutes_par_jour || !profil?.niveau_depart,
    };
  }

  /**
   * Complète ou corrige ce qui cadre le plan : temps, niveau, situation.
   *
   * Ces trois réponses ne sont pas décoratives — ce sont elles qui bornent le volume
   * du plan, sa difficulté et ce qu'il doit éviter. Elles se périment par ailleurs
   * toutes seules dès que le produit marche : quelqu'un de sédentaire qui s'entraîne
   * deux mois n'est plus sédentaire, et un coach qui continue à lui prescrire de la
   * marche nie la progression qu'il est censé produire.
   *
   * Chaque champ est optionnel : la carte du Dashboard n'en envoie que deux, l'écran
   * Profil n'en corrige souvent qu'un seul.
   */
  async majCadrage(
    userId: string,
    donnees: { minutesParJour?: number; niveau?: string; situation?: string; reveil?: string | null },
  ) {
    const champs: Record<string, unknown> = {};

    if (donnees.minutesParJour !== undefined) {
      const n = Number(donnees.minutesParJour);
      if (!Number.isFinite(n)) throw new BadRequestException('Temps disponible invalide.');
      champs.minutes_par_jour = Math.min(240, Math.max(5, Math.round(n)));
    }

    if (donnees.niveau !== undefined) {
      if (!(donnees.niveau in CoachMemoryService.NIVEAU_LISIBLE)) {
        throw new BadRequestException('Niveau de départ inconnu.');
      }
      champs.niveau_depart = donnees.niveau;
    }

    // Une chaîne vide efface : c'est la façon dont on retire une blessure guérie ou
    // des partiels passés. Sans ce cas, une contrainte périmée serait indélébile.
    if (donnees.situation !== undefined) {
      const propre = String(donnees.situation).trim().slice(0, 600);
      champs.situation = propre || null;
    }

    /*
      L'heure de réveil, validée ici et nulle part ailleurs.

      C'est une valeur qui décide de l'heure d'une notification : acceptée telle
      quelle, une saisie abîmée ne lèverait rien et priverait simplement la
      personne de son brief, tous les matins, sans que rien ne le signale. Une
      chaîne vide efface et fait revenir au défaut de 10 h — c'est le seul moyen de
      revenir en arrière, et il doit exister.
    */
    if (donnees.reveil !== undefined) {
      const propre = String(donnees.reveil ?? '').trim();
      if (!propre) {
        champs.reveil = null;
      } else if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(propre)) {
        throw new BadRequestException('Heure de réveil attendue au format HH:MM.');
      } else {
        champs.reveil = propre;
      }
    }

    if (!Object.keys(champs).length) throw new BadRequestException('Rien à mettre à jour.');

    await this.prisma.aIProfile.upsert({
      where: { user_id: userId },
      update: champs,
      create: { user_id: userId, ...champs },
    });

    // Même raison que pour l'objectif : la phrase d'ouverture en cache a été écrite
    // en ignorant ce qu'on vient d'apprendre.
    await this.prisma.aIProfile
      .update({ where: { user_id: userId }, data: { ouverture_texte: null, ouverture_genere_le: null } })
      .catch(() => {});

    return this.lireProfil(userId);
  }

  /**
   * Change l'objectif déclaré.
   *
   * Sans cette route, afficher l'objectif en permanence serait pire que de ne pas
   * l'afficher : un objectif figé sur ce qu'on a coché en trente secondes le jour
   * de l'inscription, impossible à corriger, devient un reproche quotidien.
   *
   * `upsert` parce qu'un compte peut n'avoir jamais eu de profil — le questionnaire
   * a longtemps échoué en silence, et ces comptes-là existent toujours.
   */
  async majObjectif(userId: string, objectif: string) {
    const propre = String(objectif ?? '').trim().slice(0, AiCoachingService.MAX_OBJECTIF);
    if (!propre) throw new BadRequestException('Un objectif ne peut pas être vide.');

    const profil = await this.prisma.aIProfile.upsert({
      where: { user_id: userId },
      update: { objectives: [propre] },
      create: { user_id: userId, objectives: [propre] },
      select: { objectives: true },
    });

    // L'ouverture en cache a été écrite en connaissant l'ancien objectif. La garder
    // ferait accueillir quelqu'un qui vient de changer de cap par une phrase qui
    // parle de l'ancien — exactement le genre de détail qui trahit un coach qui ne
    // suit pas. On la jette, la suivante sera régénérée.
    await this.prisma.aIProfile
      .update({ where: { user_id: userId }, data: { ouverture_texte: null, ouverture_genere_le: null } })
      .catch(() => {});

    return { objectif: profil.objectives?.[0] ?? propre };
  }

  // generateRoutinesForUser a été supprimé avec la route qui l'exposait.
  //
  // Il annonçait « Routine générée avec succès » et écrivait deux tâches en dur —
  // « Méditation » et « Lecture » — dans la table `Routine`, que l'application ne lit
  // pas : elle range les routines dans `sync_data`. Le frontend ne l'appelait nulle
  // part, et chaque appel décomptait pourtant un crédit d'IA.
  //
  // La vraie génération passe par le coach, qui sait déjà produire un bloc <PLAN>
  // que l'interface applique.

  async getChatHistory(userId: string) {
    if (!userId || userId === 'demo-user') return [];
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const messages = await this.prisma.chatMessage.findMany({
        where: { 
          user_id: userId,
          created_at: {
            gte: today // Seulement les messages du jour
          }
        },
        orderBy: { created_at: 'asc' },
        take: 100 // Get up to 100 past messages for UI
      });
      return messages.map((m: any) => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }));
    } catch (e) {
      console.error("Erreur lors de la récupération de l'historique:", e);
      return [];
    }
  }

  async chatWithAi(userId: string, prompt: string, userContext?: any) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY') {
      return { 
        reply: "Mon moteur d'intelligence (Groq) est déconnecté. ⚠️\n\nPour me donner vie, ajoute ta clé API dans le fichier `.env` du backend à la ligne `GROQ_API_KEY=...` (et sur Render) puis redémarre le serveur." 
      };
    }

    // 1. Sauvegarder le message de l'utilisateur
    if (userId && userId !== 'demo-user') {
      try {
        await this.prisma.chatMessage.create({
          data: { user_id: userId, sender: 'user', text: prompt }
        });
      } catch (e) {
        console.error("Impossible de sauvegarder le message utilisateur", e);
      }
    }

    // 2. Récupérer l'historique récent (limité à 20 pour ne pas saturer l'IA)
    let history: any[] = [];
    if (userId && userId !== 'demo-user') {
      try {
        const dbHistory = await this.prisma.chatMessage.findMany({
          where: { user_id: userId },
          orderBy: { created_at: 'desc' },
          take: 21 // 20 anciens + le nouveau qu'on vient d'ajouter
        });
        history = dbHistory.reverse().map((m: any) => ({
          sender: m.sender,
          text: m.text,
          // La date part avec le message : sans elle, vingt messages étalés sur
          // deux semaines se lisent comme une seule conversation d'aujourd'hui.
          quand: m.created_at,
        }));
        // On retire le dernier (qui est le prompt actuel) car il est ajouté manuellement plus bas
        history.pop();
      } catch (e) {
        console.error("Impossible de récupérer l'historique", e);
      }
    }

    // Build rich context from user data
    let contextString = "";
    if (userContext) {
      // Ce contexte vient entièrement du client : rien ne l'empêche d'annoncer
      // 10 000 routines, ce qui ferait exploser le coût et le temps de réponse pour
      // le même prix en coins. On borne le nombre d'entrées et la longueur de chacune.
      const MAX_ENTREES = 20;
      const MAX_LONGUEUR = 120;
      const borner = (v: any) => (Array.isArray(v) ? v.slice(0, MAX_ENTREES) : []);
      const couper = (t: any) => String(t ?? '').slice(0, MAX_LONGUEUR);

      const macroList = borner(userContext.macroObjectives)
        .map((o: any) => `• ${couper(o.title || o.name)} (catégorie: ${couper(o.category) || 'non définie'}, deadline: ${couper(o.deadline) || 'non définie'})`)
        .join('\n') || 'Aucun macro-objectif défini';

      const microList = borner(userContext.microObjectives)
        .map((o: any) => `• ${couper(o.title || o.name)} — ${o.done ? '✅ Complété' : '⬜ En cours'} (catégorie: ${couper(o.category) || 'non définie'})`)
        .join('\n') || 'Aucun micro-objectif défini';

      const routinesList = borner(userContext.routines)
        .map((r: any) => `• ${couper(r.title)}: ` + borner(r.items).map((t: any) => `${couper(t.title)} (${t.done ? '✅' : '⬜'})`).join(', '))
        .join('\n') || 'Aucune routine';

      // Le niveau seul ne dit rien de la régularité : une habitude niveau 4 peut
      // n'avoir pas été tenue depuis trois semaines. Le client envoie déjà
      // l'historique complet, il n'était simplement pas lu — le coach ne pouvait
      // donc jamais dire « tu as sauté la méditation quatre fois cette semaine »,
      // qui est pourtant l'observation la plus utile qu'il puisse faire.
      const habitsList = borner(userContext.habits)
        .map((h: any) => {
          const tenue = AiCoachingService.joursTenus(h.history ?? h.completed_dates);
          return `• ${couper(h.title || h.name)} (Niveau ${h.level || 1}) — tenue ${tenue}/7 sur les 7 derniers jours`;
        })
        .join('\n') || 'Aucune habitude';

      const nutritionList = borner(userContext.nutrition)
        .map((n: any) => `• ${couper(n.title)}: ${couper(n.details)} (${n.done ? '✅' : '⬜'})`)
        .join('\n') || 'Aucun repas défini';

      // Le coach ignorait la date. Il pouvait donc écrire « on est mercredi » un
      // samedi, promettre un bilan « dimanche » sans savoir combien de jours cela
      // laisse, et surtout poser des échéances de plan qui ne tombent nulle part.
      // C'est le genre de détail qui trahit immédiatement un coach qui ne suit pas.
      const maintenant = new Date();
      const dateLisible = maintenant.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: AiCoachingService.FUSEAU,
      });

      contextString = `
--- DONNÉES TEMPS RÉEL DE L'UTILISATEUR ---
Nous sommes le ${dateLisible}.
Score Mental du jour : ${userContext.mentalScore ?? 0}%
Mindset Coins accumulés : ${userContext.coins ?? 0}

ROUTINES ET TÂCHES DU JOUR :
${routinesList}

HABITUDES :
${habitsList}

ALIMENTATION :
${nutritionList}

MACRO-OBJECTIFS (Visions long terme) :
${macroList}

MICRO-OBJECTIFS (Actions de la semaine) :
${microList}
--- FIN DES DONNÉES ---`;
    }

    // Le questionnaire d'inscription, la mémoire des échanges passés et la tendance
    // récente. Sans eux, le coach ne connaissait la personne que par l'état du jour :
    // il ignorait ses contraintes déclarées, oubliait tout au-delà de la fenêtre de
    // conversation, et ne pouvait constater ni décrochage ni progression.
    let profil: any = null;
    if (userId && userId !== 'demo-user') {
      try {
        profil = await this.memoire.chargerProfil(userId);
        const sync = await this.prisma.syncData.findUnique({
          where: { user_id: userId },
          select: { daily_scores: true, habits: true },
        });
        contextString +=
          this.memoire.formatProfil(profil) +
          this.memoire.formatMemoire(profil) +
          this.memoire.formatTendance(sync?.daily_scores as any) +
          this.formatMotifs(sync?.daily_scores as any, (sync as any)?.habits) +
          (await this.formatRappels(userId));
      } catch (e) {
        console.error('Contexte de suivi indisponible', e);
      }
    }

    const customAiName = userContext?.aiName || 'Coach IA';
    const customUserName = userContext?.userName || "l'utilisateur";

    // Le prompt était envoyé d'un bloc à chaque message : environ 1900 jetons, dont
    // plus de la moitié décrit le schéma JSON du plan. Or ce schéma ne sert que
    // lorsqu'on demande explicitement un plan — c'est-à-dire rarement. On le paie donc
    // sur chaque « j'ai fini ma routine » et chaque « je suis fatigué », ce qui est le
    // premier poste de dépense de l'application.
    //
    // Les règles de comportement, elles, s'appliquent toujours et restent ici.
    /*
      L'instant présent, dit au modèle en toutes lettres.

      Sans lui, « rappelle-moi à 22 h 30 » n'a pas de date : le modèle invente une
      journée, et le rappel part la veille ou la semaine suivante. En heure de
      Paris, parce que c'est ce que la personne a en tête quand elle dit « 22 h 30 »
      — le serveur, lui, tourne en UTC.
    */
    const maintenantParis = new Date().toLocaleString('fr-FR', {
      timeZone: AiCoachingService.FUSEAU,
      dateStyle: 'full',
      timeStyle: 'short',
    });

    /*
      La même date, en `AAAA-MM-JJ`, prête à être recopiée dans une balise.

      « lundi 24 août 2026 à 12:11 » suppose deux opérations avant de servir :
      traduire en `2026-08-24`, puis comparer 15 h 30 à 12 h 11. Le 24 août à
      12 h 11, sur « rappelle-moi mes 25 pompes à 15h30 », le modèle a raté la
      seconde et posé le rappel au mardi. Les deux clés lui sont donc données
      toutes faites : il lui reste à choisir laquelle recopier, ce qui est le seul
      jugement qu'on peut raisonnablement lui demander.
    */
    const aujourdhui = cleJourParis();
    const demain = new Date(Date.UTC(
      Number(aujourdhui.slice(0, 4)),
      Number(aujourdhui.slice(5, 7)) - 1,
      Number(aujourdhui.slice(8, 10)) + 1,
    ))
      .toISOString()
      .slice(0, 10);

    const promptBase = construirePromptBase({
      nomCoach: customAiName,
      nomPersonne: customUserName,
      maintenantParis,
      aujourdhui,
      demain,
    });

    // Le schéma complet, ajouté uniquement quand la demande porte sur le plan.
    const promptPlan = `
**GÉRER LES HABITUDES, ROUTINES, ALIMENTATION ET OBJECTIFS (TRÈS IMPORTANT)** :
    Tu as l'INTERDICTION STRICTE de générer le bloc JSON si l'utilisateur ne te donne pas un ordre direct (ex: "fais-moi un plan", "ajoute une habitude", "change mon repas"). 
    Si l'utilisateur rapporte simplement un progrès (ex: "J'ai terminé ma routine", "J'ai fait mon sport", "C'est fait"), NE GÉNÈRE ABSOLUMENT AUCUN JSON. Contente-toi de le féliciter, de le motiver et de discuter.
    N'invente JAMAIS un plan de toi-même pour anticiper sa journée. Ne génère le JSON que s'il te dit "Que dois-je faire ensuite ?" ou "Crée mon plan".
    
    **RÈGLE D'AJOUT VS REMPLACEMENT :**
    - Si l'utilisateur te demande de **RAJOUTER** ou **AJOUTER** quelque chose à son plan actuel, mets TOUS les champs "replace..." à "false". Cela conservera ses données actuelles.
    - Si l'utilisateur te demande un **NOUVEAU PLAN COMPLET**, mets **OBLIGATOIREMENT** tous les champs "replace..." à "true" : il veut repartir de zéro, et laisser l'ancien plan à côté du nouveau lui donnerait le double de tâches à faire. Comptent comme demande de plan complet, entre autres : "refais-moi un plan", "refais mon plan", "recommence mon plan", "fais-moi un nouveau plan", "change tout", "je veux changer d'objectif", "réinitialise tout", "reprends tout à zéro". Le mot "refais" veut dire remplacer, jamais ajouter.
    - Si l'utilisateur te demande de **MODIFIER UN SEUL ÉLÉMENT** (ex: "change juste le repas du soir"), ne génère **QUE** la catégorie concernée dans le JSON (ex: "newNutrition" et "replaceNutrition: true"), et NE METS PAS "newHabits", "newRoutines", etc. Ne renvoie jamais tout le plan si on te demande de changer un seul truc, sinon ça va tout casser ! 
      IMPORTANT: Même si tu modifies un seul élément, ton JSON DOIT OBLIGATOIREMENT être un objet valide commençant par \`{\` et finissant par \`}\`. Par exemple :
      <PLAN>
      {
        "replaceNutrition": true,
        "newNutrition": [ { "meal": "Nouveau repas", "details": "Détails" } ]
      }
      </PLAN>

    Quand tu dois VRAIMENT générer un plan suite à une demande explicite, voici le format exact du JSON que tu dois fournir à la toute fin de ta réponse (inclus seulement les champs que tu modifies vraiment) :
    <PLAN>
    {
      "replaceHabits": false, 
      "replaceRoutines": false, 
      "replaceNutrition": false, 
      "replaceMacroObjectives": false, 
      "replaceMicroObjectives": false, 
      "routineExplanation": "Pourquoi ces exercices, dans cet ordre, et ce qu'ils produisent. Concret, pas lyrique.",
      "habitExplanation": "Ce que chaque habitude déclenche, et pourquoi celle-là plutôt qu'une autre.",
      "objectiveExplanation": "Le cap, et en quoi les micro-objectifs de la semaine y mènent vraiment.",
      "nutritionExplanation": "Ce que ce plan alimentaire vise, et la contrainte qu'il respecte.",
      "newHabits": [
        { "name": "<habitude quotidienne, 3 à 5 mots>", "description": "<ce qu'elle implique concrètement>", "frequency": "daily" }
      ],
      "newRoutines": [
        { "type": "MORNING", "tasks": [ { "title": "<exercice précis avec ses chiffres>", "duration": 8, "jours": ["lundi","mercredi","vendredi"] }, { "title": "<deuxième tâche précise>", "duration": 5 }, { "title": "<troisième tâche précise>", "duration": 7 } ] },
        { "type": "MIDDAY", "tasks": [ { "title": "<tâche réalisable dans sa pause>", "duration": 15, "jours": ["lundi","mardi","mercredi","jeudi","vendredi"] } ] },
        { "type": "EVENING", "tasks": [ { "title": "<tâche de fin de journée>", "duration": 10 } ] }
      ],
      "newNutrition": [
        { "meal": "<nom du repas>", "details": "<aliments - kcal, protéines>" }
      ],
      "newMacroObjectives": [
        { "title": "<son cap à long terme, tiré de ce qu'il t'a dit>", "category": "Physique", "deadline": "<mois année>" }
      ],
      "newMicroObjectives": [
        { "title": "<une victoire atteignable cette semaine>", "category": "Physique", "deadline": "Dimanche" }
      ]
    }
    </PLAN>
    **LES CHEVRONS CI-DESSUS SONT DES TROUS À REMPLIR**, jamais à recopier : aucun chevron ne doit apparaître dans ton JSON. Ils remplacent les tâches d'exemple qui figuraient ici : le modèle les recopiait mot pour mot, et deux personnes aux situations opposées repartaient avec le même programme. Le nombre de tâches et de routines de ce squelette n'est pas une consigne non plus — c'est le temps disponible de la personne qui le décide.
    **AUCUNE TÂCHE NOMMÉE AILLEURS DANS CES INSTRUCTIONS NE DOIT SE RETROUVER DANS TON PLAN.** Les titres cités plus haut ("Squats (4x12)", "Planche (3x45s)", "Course (5 km)"…) montrent la FORME attendue — un mouvement précis suivi de ses chiffres — jamais le contenu à livrer. Reprendre l'un d'eux tel quel est une faute : c'est le signe que tu as recopié au lieu de composer.

    **COMMENT COMPOSER CE PLAN (C'EST LA PARTIE QUI COMPTE)** :
    Son profil est dans les données ci-dessous. Ce ne sont pas des étiquettes à réciter, ce sont les contraintes qui décident du contenu. Avant d'écrire le JSON, dérive-le dans cet ordre :
    1. **SON TEMPS DISPONIBLE fixe le volume.** Additionne les "duration" que tu prescris pour une même journée : le total doit tenir sous le nombre de minutes qu'il a déclaré. S'il a vingt minutes, il reçoit vingt minutes — pas une séance d'une heure « au cas où ». Un plan qui déborde n'est pas ambitieux, il est abandonné le premier jour.
    2. **CE QUE SON MÉTIER IMPOSE fixe les créneaux.** Un salarié n'est pas libre à 14 h, un étudiant a cours, un entrepreneur se fait dévorer sa fin de journée. Place les tâches là où il est réellement disponible, et dis-le dans l'explication.
    3. **SON POINT DE DÉPART fixe la difficulté.** Un sédentaire ne reçoit pas quatre séries de douze pompes. Un confirmé ne reçoit pas de la marche. Se tromper de niveau est la façon la plus rapide de perdre quelqu'un.
    4. **CE QU'IL T'A DIT DANS SES MOTS prime sur tout le reste.** S'il a mentionné une blessure, un horaire, un matériel qu'il n'a pas, un enfant, une échéance — le plan doit visiblement en tenir compte. C'est la seule chose qu'aucun autre compte ne partage avec lui : c'est là que se joue le fait que ce plan soit le sien.
    5. **TES OBJECTIFS NE DOIVENT PAS CONTREDIRE TON PROPRE PLAN.** Un objectif qui réclame trente minutes de marche par jour, alors que les routines en prescrivent cinq, se lit comme un reproche permanent : la personne voit chaque jour qu'elle est en dessous d'une barre que tu as toi-même placée hors de portée. Relis tes routines avant d'écrire les objectifs, et n'y fixe jamais un volume quotidien supérieur à ce que tu viens de prescrire.
    6. **SA CONSTANCE fixe l'ambition.** Quelqu'un qui abandonne vite reçoit peu de tâches, très courtes, et une victoire atteignable dès aujourd'hui. Quelqu'un de discipliné reçoit de quoi progresser réellement.
    **Les quatre champs "...Explanation" doivent nommer explicitement ce qui a guidé tes choix** — son métier, son temps, son niveau, ce qu'il t'a raconté. Une explication qui pourrait être envoyée à n'importe qui d'autre est une explication ratée. **Deux personnes différentes ne doivent jamais recevoir le même plan.**
    **CE QU'UN PLAN DOIT CONTENIR (RÈGLE DÉCISIVE)** :
    - Dès que tu construis ou reconstruis un plan, tu DOIS produire à la fois "newMacroObjectives" (1 à 3 visions long terme, c'est le cap) ET "newMicroObjectives" (2 à 4 petites victoires pour la semaine en cours). Attention : "macro-objectif" désigne un objectif de vie à long terme, JAMAIS les macronutriments de l'alimentation — ceux-là vont dans "newNutrition". Un plan sans macro-objectif est un plan sans direction : c'est le défaut le plus fréquent, ne le commets pas.
    - Chaque routine que tu produis doit contenir AU MINIMUM 3 tâches précises et chiffrées, comme dans l'exemple ci-dessus. Une routine à une seule tâche est un plan bâclé.
    - **RYTHME HEBDOMADAIRE — REGARDE L'EXEMPLE, LA PLUPART DES TÂCHES PORTENT UN CHAMP "jours"** : c'est la liste des jours où la tâche s'applique, en français ("lundi", "mardi"…). **Une tâche SANS ce champ apparaît tous les jours de la semaine, sans exception.** Tu DOIS donc écrire "jours" dans ces trois cas : la personne indique une fréquence ("trois fois par semaine", "le week-end", "les jours de cours") ; la tâche est de la musculation, car un muscle travaillé sept jours sur sept ne récupère jamais ; la tâche n'a de sens que certains jours. Ne l'omets que pour ce qui se fait vraiment chaque jour, comme la méditation ou le bilan du soir.
    - **TOUTE TÂCHE DE SPORT DOIT PORTER SES CHIFFRES DANS SON TITRE**, sans quoi la personne ne sait pas quoi faire une fois devant : séries et répétitions pour la musculation ("Développé couché (4x8)", "Fentes (3x12 par jambe)"), temps de maintien pour le gainage ("Planche (3x45s)"), distance ou durée pour le cardio ("Course (5 km)", "Rameur (15 min)"). Une tâche nommée "Musculation", "Cardio", "Haut du corps" ou "Séance jambes" est INTERDITE : découpe-la en exercices distincts et chiffrés. Précise le poids ou le niveau seulement si l'utilisateur t'a dit où il en est.
    - Les échéances ("deadline") se calculent à partir de la date du jour qui t'est donnée dans les données de l'utilisateur. Ne recopie jamais l'année de l'exemple.
    - N'ajoute une catégorie que si la demande la concerne : si on te demande seulement de changer un repas, ne produis que la nutrition.
    Si l'utilisateur dit de "tout supprimer" ou "remplacer" UNE catégorie spécifique (ex: l'alimentation), mets SEULEMENT le flag correspondant (ex: "replaceNutrition": true) et laisse les autres à false. Ainsi, tu ne détruiras pas le reste de son plan.
    Si l'utilisateur ne demande rien de spécifique à modifier, ou si tu refuses une demande (comme le mode développeur), tu as l'INTERDICTION STRICTE de générer le bloc JSON. Réponds uniquement avec du texte.
 11. **RÈGLE ABSOLUE POUR LE JSON** : Ton code JSON DOIT IMPÉRATIVEMENT commencer par { et se terminer par }. Ne génère JAMAIS de syntaxe cassée comme "] , , , ]". 
     Si tu dois inclure le bloc JSON, il doit OBLIGATOIREMENT être encadré par les balises XML <PLAN> et </PLAN>. Place le JSON directement à la fin de ton message. Exemple parfait:
     <PLAN>
     {
       "replaceRoutines": false,
       "newMicroObjectives": []
     }
     </PLAN>
    **NE COMMENTE PAS LE PLAN** : Ne dis pas "Voici le plan". Ton JSON s'appliquera silencieusement à l'interface de l'utilisateur, ton texte normal sera affiché dans le chat.
    **PAS DE REPAS DANS LES ROUTINES** : Les routines (MORNING, MIDDAY, EVENING) sont réservées aux actions (sport, apprentissage, méditation). L'alimentation a déjà sa propre section "newNutrition". Par conséquent, N'AJOUTE JAMAIS de tâches comme "Petit-déjeuner", "Dîner", "Collation" ou "Repas" dans les routines. C'est redondant et strictement interdit.`;

    try {
      console.log('[Groq] 🔄 Tentative avec Llama 3.3 70B (Groq)...');
      
      // L'historique était chargé depuis la base puis jamais transmis au modèle :
      // le coach repartait de zéro à chaque message. On le passe désormais réellement.
      // Les blocs <PLAN> sont retirés des réponses passées : ce sont des instructions
      // destinées à l'interface, les renvoyer au modèle l'incite à régénérer des plans
      // qu'on ne lui a pas demandés (et gonfle la note pour rien).
      const historyMessages = AiCoachingService.marquerLesJours(
        history
          .map((m: any) => ({
            role: m.sender === 'ai' ? 'assistant' : 'user',
            content: m.sender === 'ai'
              ? AiCoachingService.retirerPlan(String(m.text))
              : String(m.text),
            quand: m.quand instanceof Date ? m.quand : m.quand ? new Date(m.quand) : undefined,
          }))
          .filter((m) => m.content.length > 0),
      );

      // Limiter à 20 messages ne borne rien : une réponse peut monter à 1500 jetons,
      // donc trois réponses longues suffisent à faire exploser la requête. On plafonne
      // en volume, en gardant les échanges les plus récents (les plus pertinents).
      const BUDGET_HISTORIQUE = 6000; // caractères, ~1600 jetons
      const retenus: typeof historyMessages = [];
      let volume = 0;
      for (let i = historyMessages.length - 1; i >= 0; i--) {
        volume += historyMessages[i].content.length;
        if (volume > BUDGET_HISTORIQUE) break;
        retenus.unshift(historyMessages[i]);
      }

      // Un appel complet, schéma du plan joint ou non.
      //
      // La règle du marqueur n'accompagne que la version sans schéma : la laisser dans
      // les deux ferait réclamer au modèle des instructions qu'il a déjà sous les yeux,
      // et chaque demande de plan coûterait deux appels au lieu d'un.
      const demander = async (avecPlan: boolean, exclus: string[] = []) => {
        // Rendu avec la réponse, et non déduit du message : quand le second appel a
        // lieu, le schéma est joint alors que la détection par mots-clés disait le
        // contraire. Un journal de diagnostic qui se trompe sur ce point-là ferait
        // chercher la coupure dans la mauvaise moitié du prompt.
        const consigne = avecPlan
          ? promptBase + promptPlan + '\n' + contextString
          : promptBase + AiCoachingService.MARQUEUR_PLAN_REGLE + '\n' + contextString;

        const messages = [
          { role: 'system', content: consigne },
          ...retenus,
          { role: 'user', content: prompt },
        ];

        const { response, modele } = await this.appelerGroqAvecRepli(
          apiKey,
          {
            messages,
          // Deux exigences opposées, donc deux réglages.
          //
          // Quand le schéma est joint, la réponse doit contenir un JSON strictement
          // valide : toute latitude accordée au modèle se paie en virgules en rafale
          // et en balises mutilées, vues l'une comme l'autre en production. Quand il
          // s'agit seulement de parler, la chaleur du ton compte davantage que la
          // ponctuation, et 0,6 la préserve.
          temperature: avecPlan ? 0.3 : 0.6,
          // Un plan complet fait à lui seul près de mille jetons de JSON : rogner ici
          // le tronquerait en plein objet et casserait son application dans l'app.
            max_tokens: 1500,
          },
          exclus,
        );

        const data = await response.json();
        const { texte, tronque } = lireReponseGroq(data);
        return { texte: texte ?? undefined, modele, tronque, schemaJoint: avecPlan };
      };

      const planProbable = AiCoachingService.MOTS_PLAN.test(prompt);
      console.log(
        `[Groq] 🧠 ${retenus.length}/${historyMessages.length} message(s) de contexte (${volume} car.), ` +
          `schéma du plan ${planProbable ? 'joint' : 'omis'}`,
      );

      let { texte: reply, modele, tronque, schemaJoint } = await demander(planProbable);

      // Le modèle réclame le schéma : la détection par mots-clés est passée à côté.
      // Un second appel coûte moins qu'un utilisateur à qui on répond qu'on ne sait
      // pas faire ce que l'application sait faire.
      if (reply?.includes(AiCoachingService.MARQUEUR_PLAN)) {
        console.log('[Groq] ↻ Schéma du plan réclamé par le modèle, second appel');
        ({ texte: reply, modele, tronque, schemaJoint } = await demander(true));
      }

      /*
        Un 200 sans texte est une panne du maillon, pas une panne de la chaîne.

        Ce cas sortait directement en message d'excuse : le modèle avait répondu
        « avec succès », donc la boucle de repli était déjà terminée et les maillons
        suivants — dont le filet payant — n'étaient jamais sollicités. C'est le même
        défaut que celui corrigé dans la boucle, d'un cran plus haut : ce n'est pas
        parce qu'un modèle rend du vide que le suivant en rendrait aussi.

        On redescend donc la chaîne en sautant le maillon muet. Une seule fois : si
        le second se tait aussi, la cause n'est plus le modèle mais ce qu'on lui
        envoie, et insister ferait payer un troisième appel pour le même vide.
      */
      if (!reply) {
        console.warn(`[Groq] 🔇 ${modele} a répondu 200 sans texte, essai du maillon suivant`);
        ({ texte: reply, modele, tronque, schemaJoint } = await demander(schemaJoint, [modele]));
      }

      // Le maillon est joint à l'erreur comme le fait la chaîne pour les siennes : ces
      // deux échecs-là naissent après un appel réussi, et sans ça la trace écrite en
      // base ne dirait pas quel modèle rend du vide — c'est pourtant ce qui décide
      // s'il faut le retirer de la liste.
      if (!reply) throw Object.assign(new Error('Empty response from Groq'), { modele });

      // Garde-fou : si le marqueur survit au second appel, il ne doit jamais s'afficher
      // dans la conversation. Mieux vaut une réponse vide traitée comme une erreur —
      // et donc remboursée — qu'un mot de code envoyé à l'utilisateur.
      if (reply.includes(AiCoachingService.MARQUEUR_PLAN)) {
        throw Object.assign(
          new Error('Le modèle a renvoyé le marqueur de plan deux fois de suite'),
          { modele },
        );
      }

      // Réponse arrêtée par `max_tokens` et non par le modèle.
      //
      // Elle arrive avec le même statut 200 et la même forme qu'une réponse finie :
      // sans cette lecture, la coupure était rigoureusement invisible, ici comme dans
      // les journaux. Les deux cas ne se soignent pas de la même façon.
      //
      // Bloc <PLAN> ouvert : son JSON est forcément incomplet, donc `JSON.parse`
      // échouera côté navigateur et la personne lira déjà « Je n'ai pas réussi à
      // appliquer ce plan ». Il n'y a rien à ajouter à l'écran — ce qui manquait,
      // c'est la trace côté serveur, sans laquelle on chercherait la cause dans la
      // mise en forme du modèle alors qu'elle est dans le plafond de jetons.
      //
      // Prose seule : le texte s'arrête au milieu d'une phrase, et il n'est pas
      // question de le jeter — mille cinq cents jetons de réponse utile valent mieux
      // qu'un message d'erreur, et les refacturer serait pire. Les points de
      // suspension sont le seul aveu honnête disponible.
      if (tronque) {
        const planOuvert = /<\s*PLAN\s*>/i.test(reply);
        console.warn(
          `[Groq] ✂️ Réponse de ${modele} coupée par max_tokens (${reply.length} chars, ` +
            `schéma ${schemaJoint ? 'joint' : 'omis'}${planOuvert ? ', bloc <PLAN> ouvert' : ''})`,
        );
        if (!planOuvert) reply = reply.replace(/[\s.…]*$/, '') + '…';
      }

      /*
        Le rappel, transformé en ligne avant d'être confirmé.

        Le coach répondait « Rappel : 22 h 30 — commence la première tâche » et il
        ne se passait rien : ni table, ni tâche planifiée, ni notification. La
        promesse était crédible et entièrement fausse, et c'est la personne qui la
        découvrait à 22 h 30, en ne recevant rien.

        Ce qui fait foi est **la ligne écrite**, jamais la phrase du modèle : on
        extrait ses balises, on écrit, et on ne confirme que ce qui existe. Une
        confirmation est ajoutée par le serveur plutôt que laissée au modèle,
        pour la même raison — lui seul sait s'il a vraiment programmé quelque
        chose, et la réponse est déjà écrite quand on l'apprend.
      */
      if (userId && userId !== 'demo-user') {
        // Le message de la personne est passé avec la réponse : c'est lui qui dit
        // si un rappel posé pour demain était voulu ou reporté à tort.
        const { texte: sansBalise, rappels: demandes } = RappelService.extraire(
          reply,
          new Date(),
          prompt,
        );
        const { texte: sansAnnul, numeros } = RappelService.extraireAnnulations(sansBalise);
        reply = sansAnnul;

        /*
          L annulation avant la pose.

          Un message qui deplace un rappel — « non, plutot 23 h » — porte les deux
          balises. Poser avant d annuler decalerait la numerotation entre le
          contexte lu par le modele et la liste relue ici, et retirerait le mauvais.
        */
        if (numeros.length) {
          const annules = await this.rappels.annulerParNumero(userId, numeros);
          // On ne confirme que ce qui a vraiment ete annule : un numero qui ne
          // designe rien ne doit pas produire de phrase rassurante.
          if (annules.length) {
            reply +=
              String.fromCharCode(10, 10) + '🗑️ Rappel retiré : ' + annules.join(', ') + '.';
          }
        }

        if (demandes.length) {
          const poses = await this.rappels.poser(userId, demandes);
          if (poses.length) reply += await this.confirmerRappels(userId, poses);
        }

        /*
          La bulle ne commence jamais par du vide.

          Sur une demande de rappel, le modèle répond parfois **la balise et rien
          d'autre** — mesuré le 21 août 2026, deux fois sur deux. Une fois la
          balise extraite il ne reste rien, et la confirmation du serveur commence
          par deux sauts de ligne : la bulle s'ouvre alors sur un blanc, ce qui se
          lit comme un message à moitié chargé. La règle du prompt demande une
          phrase avant la balise ; elle n'est pas toujours suivie, et une consigne
          au modèle ne remplace jamais un garde-fou dans le code.
        */
        reply = reply.trim();
      } else {
        // Même en démonstration, la balise ne doit jamais atteindre l'écran.
        reply = RappelService.extraireAnnulations(RappelService.extraire(reply).texte).texte;
      }

      console.log(`[Groq] ✅ Réponse de ${modele} reçue (${reply.length} chars)`);
      
      // 3. Sauvegarder la réponse de l'IA
      if (userId && userId !== 'demo-user') {
        try {
          await this.prisma.chatMessage.create({
            data: { user_id: userId, sender: 'ai', text: reply }
          });
        } catch (e) {
          console.error("Impossible de sauvegarder la réponse IA", e);
        }

        // Recompression de la mémoire longue, lancée sans être attendue : elle est
        // au plus quotidienne, et l'utilisateur n'a pas à patienter pour ça.
        this.memoire.rafraichirMemoire(userId, profil).catch(() => {});
      }

      return { reply };

    } catch (error: any) {
      // Le détail technique reste dans les logs. Il était auparavant recopié dans la
      // bulle de réponse, avec le corps d'erreur de l'API et un rappel sur la variable
      // d'environnement à vérifier sur Render : un message écrit pour le développeur,
      // lu par les utilisateurs à chaque saturation du fournisseur.
      console.error('[Groq] ❌ Erreur Groq API:', error?.message);
      this.tracerEchec(userId, error);

      const sature = error?.code === 'GROQ_RATE_LIMIT';
      return {
        reply: sature
          ? "Trop de monde me parle en ce moment — laisse-moi une minute et repose ta question, je serai là. ⏳"
          : "Je n'arrive pas à réfléchir correctement là, réessaie dans un instant. 🔌",
        // Lu par le contrôleur, qui rend alors les coins et le crédit mensuel :
        // faire payer un message jamais reçu est le plus sûr moyen de perdre un client.
        erreur: true,
      };
    }
  }

  /**
   * Garde la cause d'un silence, pour que le suivant n'ait plus à être deviné.
   *
   * Le tableau d'administration sait compter les silences depuis toujours — lignes
   * `user` moins lignes `ai` — mais la cause n'existait que dans un `console.error`
   * sur l'hébergeur, c'est-à-dire nulle part : personne ne relit ces journaux le
   * lendemain, et c'est le lendemain qu'on se demande pourquoi quelqu'un est parti.
   * Saturation, délai dépassé, clé refusée et réponse vide appellent pourtant
   * quatre gestes différents.
   *
   * **N'interrompt jamais rien et n'est jamais attendue.** La personne a déjà son
   * message d'excuse à l'écran ; faire échouer la réponse parce que la trace de
   * l'échec n'a pas pu s'écrire serait ajouter une panne à une panne, et la faire
   * attendre pour cela serait pire encore.
   */
  private tracerEchec(userId: string | undefined, erreur: any): void {
    if (!userId || userId === 'demo-user') return;

    const code =
      typeof erreur?.code === 'string' && erreur.code
        ? erreur.code
        // Les deux échecs qui n'ont pas de code parce qu'ils naissent ici et non chez
        // le fournisseur : un 200 sans texte, et le marqueur de plan qui a survécu au
        // second appel. Les confondre avec « inconnu » ferait chercher chez Groq une
        // panne qui est de notre côté.
        : /Empty response/i.test(String(erreur?.message))
          ? 'VIDE'
          : /marqueur de plan/i.test(String(erreur?.message))
            ? 'MARQUEUR_PLAN'
            : 'INCONNU';

    /*
      Le `try` entoure aussi l'appel lui-même, pas seulement la promesse.

      Nous sommes ici dans le `catch` de la réponse au coach : une exception lancée
      à cet endroit ne serait rattrapée par personne et transformerait un message
      d'excuse en 500. Le `.catch()` seul ne couvre que l'échec de l'écriture, pas
      celui du chemin qui y mène.
    */
    try {
      this.prisma.coachEchec
        .create({ data: { user_id: userId, code, modele: erreur?.modele ?? null } })
        .catch((e: any) => console.error('[Groq] Trace de l’échec non écrite :', e?.message));
    } catch (e: any) {
      console.error('[Groq] Trace de l’échec impossible :', e?.message);
    }
  }

  /**
   * Les motifs deja calcules sur cette personne, donnes au coach.
   *
   * Ils existaient depuis le 16 aout mais ne sortaient que sur des cartes
   * d ecran. Dans une conversation, le coach etait aveugle a ce que sa propre
   * application avait trouve : il pouvait repondre « tu manques de regularite »
   * a quelqu un dont le systeme savait, chiffres a l appui, que seuls ses samedis
   * lachent. Le produit connaissait la personne mieux que son coach.
   *
   * **Ce sont des faits, pas une invitation a en trouver d autres.** La consigne
   * le dit : le modele les cite, il n en deduit pas de nouveaux. C est la meme
   * regle que partout ailleurs, et elle compte davantage ici puisque le modele a
   * cette fois de vrais motifs sous les yeux et pourrait etre tente d extrapoler.
   */
  private formatMotifs(scores: any, habits: any): string {
    try {
      const motifs = this.observations.observations(scores).slice(0, 3);
      const { levier } = this.analyseHabitudes.analyser(scores, habits);
      if (!motifs.length && !levier) return '';

      const lignes = ['', '--- CE QUE L APPLICATION A MESURE SUR LUI (faits verifies) ---'];
      for (const m of motifs) lignes.push('- ' + m.fait);
      if (levier) {
        // « avec » et « sans », jamais « a cause de » : c est une coincidence
        // mesuree entre deux series, pas une cause, et le modele doit le lire
        // dans ces mots-la pour ne pas la transformer en explication.
        lignes.push(
          '- Ses journees avec « ' + levier.titre + ' » sont a ' + levier.scoreAvec +
            ' % (' + levier.joursAvec + ' jours), celles sans a ' + levier.scoreSans +
            ' % (' + levier.joursSans + ' jours).',
        );
      }
      lignes.push('Cite-les si c est utile. N en deduis aucun autre motif.', '');
      return lignes.join('\n');
    } catch (e) {
      // Un contexte enrichi qui echoue ne doit pas couter la reponse : le coach
      // repond alors comme avant, avec un peu moins sous les yeux.
      console.error('Motifs indisponibles pour le contexte du coach', e);
      return '';
    }
  }

  /**
   * Les rappels deja programmes, pour que le coach cesse d en inventer.
   *
   * Il sait en poser depuis ce matin, et **il ne sait pas lesquels existent**. A
   * « c est quoi mes rappels ? » il repondait donc de memoire, c est-a-dire au
   * hasard ; a « annule celui de 22 h 30 » il repondait « c est annule » et rien
   * ne bougeait. C est exactement le mensonge repare ce matin, refait dans l autre
   * sens — et il etait plus grave, puisque le rappel annule sonnait quand meme.
   *
   * Les rappels sont numerotes : c est ce numero que le modele renvoie pour en
   * annuler un, et non un identifiant qu il recopierait de travers.
   */
  private async formatRappels(userId: string): Promise<string> {
    try {
      const liste = await this.rappels.aVenir(userId);
      if (!liste.length) return '';

      const lignes = ['', '--- RAPPELS DEJA PROGRAMMES ---'];
      // La date en clair ET en `AAAA-MM-JJ` : « mardi 15:30 » ne dit pas si le
      // rappel est demain ou dans huit jours, et le modèle s'en sert pour juger
      // s'il doit en poser un de plus ou déplacer celui-ci.
      liste.forEach((r, i) => {
        const quand = RappelService.libelleQuand(r.quand);
        const cle = cleJourParis(r.quand);
        lignes.push('[' + (i + 1) + '] ' + quand + ' (' + cle + ') : ' + r.texte);
      });
      lignes.push('', '');
      return lignes.join('\n');
    } catch (e) {
      console.error('Rappels indisponibles pour le contexte du coach', e);
      return '';
    }
  }
  /**
   * La phrase de confirmation, ajoutée après l'écriture en base.
   *
   * **Elle dit aussi quand le rappel ne pourra pas arriver.** Un rappel se
   * délivre par notification ; sans notification autorisée, la ligne existe et
   * personne ne la lira jamais — on aurait remplacé une promesse fausse par une
   * promesse muette, ce qui ne vaut pas mieux. Le compte des abonnements push est
   * donc lu ici, et la personne apprend le problème maintenant, pas à 22 h 30.
   */
  private async confirmerRappels(
    userId: string,
    poses: Array<{ quand: Date; texte: string }>,
  ): Promise<string> {
    const quand = poses.map((r) => RappelService.libelleQuand(r.quand)).join(', ');

    const push = await this.prisma.pushSubscription
      .count({ where: { user_id: userId } })
      .catch(() => 1);

    if (push === 0) {
      return `

⏰ C'est noté pour ${quand} — mais tes notifications sont coupées, donc rien ne sonnera. Active-les dans ton profil.`;
    }

    return `

⏰ C'est noté : je te le rappelle ${quand}.`;
  }

  /**
   * Modèles essayés dans l'ordre pour le chat.
   *
   * Les limites de Groq sont comptées par modèle : être saturé sur l'un ne dit rien
   * de la disponibilité des autres. Basculer coûte une requête, attendre coûte une
   * conversation — d'où le repli plutôt que la patience.
   *
   * L'ordre suit la capacité à produire le bloc <PLAN> en JSON valide, puisque c'est
   * ce qui casse en premier sur un petit modèle. Le dernier de la liste tient
   * 500 000 jetons par jour à lui seul, contre 100 000 pour le premier : c'est le
   * filet qui rend la journée survivable sur le plan gratuit.
   */
  private static readonly MODELES_CHAT = MODELES_CHAT;

  /**
   * Appelle Groq en descendant la chaîne de modèles tant que la saturation persiste.
   *
   * Renvoie aussi le modèle qui a effectivement répondu : sans cette information,
   * une dégradation de qualité côté utilisateur serait impossible à relier à un
   * repli dans les logs.
   */
  /**
   * La chaîne réellement essayée : les modèles gratuits, puis le secours payant.
   *
   * Le secours est **en dernier**, jamais ailleurs. Placé plus haut, il paierait
   * des requêtes que le gratuit aurait servies ; placé ici, il ne voit que ce que
   * Groq a refusé. Sans clé configurée, la chaîne est identique à ce qu'elle a
   * toujours été.
   */
  private static chaineChat(): Array<{ modele: string; secours: FournisseurSecours | null }> {
    const gratuits = AiCoachingService.MODELES_CHAT.map((modele) => ({ modele, secours: null }));
    const secours = lireFournisseurSecours();
    return secours ? [...gratuits, { modele: secours.modele, secours }] : gratuits;
  }

  /**
   * Le temps total que la chaîne a le droit de prendre, tous maillons confondus.
   *
   * Borné bien en deçà de ce qu'un hébergeur coupe de lui-même : une requête tuée
   * à la passerelle rend une erreur que le code d'ici ne voit jamais passer — donc
   * qu'il ne journalise pas, et surtout qu'il ne rembourse pas.
   */
  private static readonly BUDGET_CHAINE_MS = 75000;

  /** En deçà, un maillon de plus n'a plus le temps de répondre : autant s'arrêter. */
  private static readonly MINIMUM_UTILE_MS = 10000;

  private async appelerGroqAvecRepli(
    apiKey: string,
    corps: any,
    /* Maillons déjà essayés et écartés par l'appelant — un modèle qui vient de
       rendre 200 sans texte, par exemple. Les redemander coûterait le même vide. */
    exclus: string[] = [],
  ): Promise<{ response: Response; modele: string }> {
    let derniere: any;
    // La saturation prime sur les erreurs suivantes au moment de rendre la main.
    // Quand les modèles de repli sont interdits ou retirés, la dernière erreur de la
    // chaîne est un problème de configuration — vrai, mais inutile à l'utilisateur.
    // Ce qu'il doit lire, c'est « réessaie dans une minute », qui est actionnable.
    let saturation: any;

    const chaine = AiCoachingService.chaineChat();
    /* Vraie dès qu'une clé Groq a été refusée : les maillons gratuits restants la
       partagent, les essayer coûterait trois 401 pour la même réponse. */
    let cleGroqRefusee = false;
    let dernierModele: string | null = null;
    const depart = Date.now();

    for (const { modele, secours } of chaine) {
      if (cleGroqRefusee && !secours) continue;
      if (exclus.includes(modele)) continue;

      /*
        Le temps qu'il reste à la personne, pas au modèle.

        Rendre les délais réessayables ouvre un risque neuf : quatre maillons à
        45 s chacun font trois minutes devant un curseur qui clignote, et personne
        n'attend trois minutes. Le budget est donc porté par la chaîne, pas par
        l'appel — chaque maillon reçoit ce qui reste, et on n'en ouvre pas un
        nouveau avec si peu de temps qu'il ne pourrait qu'expirer à son tour. Un
        échec en 8 s vaut mieux que le même échec en 20 s.
      */
      const restant = AiCoachingService.BUDGET_CHAINE_MS - (Date.now() - depart);
      if (restant < AiCoachingService.MINIMUM_UTILE_MS) {
        console.warn(`[Groq] ⏱️ Budget de la chaîne épuisé avant ${modele}.`);
        break;
      }

      dernierModele = modele;

      try {
        const response = secours
          ? await this.appelerModele(secours.apiKey, pourModele(corps, modele, false), secours.url, restant)
          : await this.appelerModele(apiKey, pourModele(corps, modele), undefined, restant);
        if (secours) {
          // Une requête payante mérite sa ligne : c'est la seule trace qui relie la
          // dépense à la saturation qui l'a provoquée.
          console.warn(`[Secours] 💳 Réponse payante servie par ${modele} — toute la chaîne gratuite a échoué`);
        } else if (modele !== AiCoachingService.MODELES_CHAT[0]) {
          console.warn(`[Groq] ⚠️ Réponse servie par ${modele} (repli après saturation)`);
        }
        return { response, modele };
      } catch (e: any) {
        derniere = e;
        if (e?.code === 'GROQ_RATE_LIMIT' && !saturation) saturation = e;

        /*
          Ce qui condamne la suite, et ce qui ne condamne que le maillon essayé.

          La liste était écrite à l'envers : elle énumérait les deux pannes autorisées
          à passer au maillon suivant, et **tout le reste emportait la chaîne
          entière, filet payant compris**. Un délai dépassé sur le premier modèle
          suffisait donc à ce que les deux autres et le secours ne soient jamais
          appelés — alors qu'un modèle lent ne dit rien de la disponibilité des
          autres. C'est exactement le raisonnement déjà tenu pour un modèle retiré
          du catalogue ; il valait pour la même raison ici, et manquait.

          La question juste n'est pas « cette panne est-elle connue ? » mais « le
          maillon suivant échouerait-il pour la même cause ? ». Une seule le fait :
          une clé refusée — et seulement pour les maillons qui partagent cette clé.
          Le secours a la sienne, il reste donc joignable même quand Groq nous
          claque la porte au nez.
        */
        if (e?.code === 'GROQ_AUTH') {
          if (secours) throw e;
          console.error('[Groq] 🔑 Clé refusée : le reste des modèles Groq est sauté.');
          cleGroqRefusee = true;
          continue;
        }

        console.warn(
          `[Groq] ${modele} indisponible (${e?.code ?? e?.message}), essai du maillon suivant`,
        );
      }
    }

    /*
      Le maillon sur lequel la chaîne s'est arrêtée, attaché à l'erreur.

      Sans lui, la trace écrite en base dirait « saturé » sans dire de quoi — or
      les limites de Groq se comptent par modèle, et savoir lequel a cédé est
      justement ce qui désigne le réglage à changer.
    */
    const sortie = saturation ?? derniere;
    if (sortie && typeof sortie === 'object' && !sortie.modele) sortie.modele = dernierModele;
    throw sortie;
  }

  /**
   * Un appel, avec un délai maximum.
   *
   * Sans `AbortController`, une requête partie chez le fournisseur pouvait rester
   * ouverte indéfiniment : l'utilisateur attendait devant un écran figé et la
   * connexion restait mobilisée côté serveur — de quoi saturer une petite instance
   * bien avant que le nombre d'utilisateurs ne le justifie.
   */
  private async appelerModele(
    apiKey: string,
    corps: any,
    url = 'https://api.groq.com/openai/v1/chat/completions',
    /* Ce que la chaîne consent à attendre pour cet appel-ci. Le plafond historique
       reste le défaut : un appel isolé ne perd rien au passage. */
    budgetMs = 45000,
  ): Promise<Response> {
    const DELAI_MAX_MS = Math.min(45000, budgetMs);

    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), DELAI_MAX_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
        signal: controleur.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw Object.assign(new Error(`Groq n'a pas répondu en ${DELAI_MAX_MS / 1000} s`), {
          code: 'GROQ_TIMEOUT',
        });
      }
      throw e;
    } finally {
      clearTimeout(minuteur);
    }

    if (response.status === 429) {
      throw Object.assign(new Error(`${corps?.model} saturé (429)`), { code: 'GROQ_RATE_LIMIT' });
    }

    // La seule panne qui se reproduirait à l'identique sur les maillons partageant
    // cette clé — et donc la seule qui autorise à sauter la suite.
    if (response.status === 401) {
      const corpsErreur = await response.text().catch(() => '');
      throw Object.assign(new Error(`Groq API Error: 401 ${response.statusText} - ${corpsErreur}`), {
        code: 'GROQ_AUTH',
      });
    }

    if (!response.ok) {
      const errBody = await response.text();
      const erreur = new Error(`Groq API Error: ${response.status} ${response.statusText} - ${errBody}`);

      // 404, ou 400/403 mentionnant le modèle : identifiant retiré du catalogue, ou
      // interdit sur le projet Groq. Ce second cas est le défaut d'une clé neuve —
      // les projets récents n'autorisent qu'une liste réduite de modèles, et Groq
      // répond alors « blocked at the project level ». Un modèle interdit est aussi
      // indisponible qu'un modèle supprimé : il doit faire passer au suivant, pas
      // emporter toute la chaîne. Une clé réellement invalide, elle, reçoit un 401,
      // qui reste fatal puisqu'il échouerait à l'identique partout.
      if (
        response.status === 404 ||
        ((response.status === 400 || response.status === 403) && /model/i.test(errBody))
      ) {
        throw Object.assign(erreur, { code: 'GROQ_MODELE_INCONNU' });
      }

      // Un 403 qui ne parle pas de modèle vise le compte, pas le modèle : une
      // suspension, un blocage géographique. Les autres modèles Groq répondraient
      // le même refus à la même clé — mais le secours, lui, a la sienne, et c'est
      // toute la différence entre « sauter les maillons jumeaux » et « abandonner ».
      if (response.status === 403) {
        throw Object.assign(erreur, { code: 'GROQ_AUTH' });
      }

      throw erreur;
    }

    return response;
  }

}
