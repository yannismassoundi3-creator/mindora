import { Injectable, Logger } from '@nestjs/common';
import { lireReponseGroq } from '../common/groq';
import { chaineCourte, appelerMaillon, MaillonCourt } from '../common/chaine-courte';
import { aDesRoutines, objectifsDeLaSemaine, tachesDuJour } from './taches';
import { MODELES_COURTS } from '../common/modeles';

/**
 * Rédige le message du matin avec l'IA, à partir de la situation réelle de la personne.
 *
 * Les rappels étaient des chaînes figées, identiques pour tout le monde tous les jours
 * (« Réveil ! Tes objectifs t'attendent »), alors que le serveur connaît la série en
 * cours, les tâches du jour et les objectifs. C'est ce qui distingue un réveil-matin
 * d'un coach.
 *
 * Ces appels ne sont pas décomptés du quota de l'utilisateur : il n'a rien demandé,
 * c'est nous qui le sollicitons. Le garde-fou est ailleurs — on n'écrit que pour les
 * comptes réellement actifs, avec une réponse courte et un délai maximum.
 */
@Injectable()
export class MorningBriefService {
  private readonly logger = new Logger(MorningBriefService.name);

  /** Au-delà, on considère le compte dormant : inutile de payer un appel IA pour lui. */
  static readonly ACTIVE_WITHIN_DAYS = 7;
  private static readonly TIMEOUT_MS = 8000;

  /**
   * Modèles essayés dans l'ordre.
   *
   * Écrire 140 caractères ne demande pas le gros modèle, et le petit dispose chez Groq
   * d'un budget quotidien compté à part : il reste le bon choix par défaut. Mais il
   * n'avait aucun recours. Un modèle retiré du catalogue, ou simplement interdit sur
   * le projet Groq — le défaut d'une clé neuve — et `generate()` rendait null pour
   * tout le monde, tous les jours : chaque brief repassait au texte générique, et rien
   * ne le signalait ailleurs qu'une ligne d'avertissement noyée dans les logs. La
   * personnalisation entière du réveil tenait à un seul identifiant.
   */
  static readonly MODELES = MODELES_COURTS;

  /**
   * Longueur au-delà de laquelle la phrase est coupée avant d'être envoyée.
   *
   * L'invite en demande 140 ; ce plafond-ci est le filet, pour les jours où le modèle
   * n'écoute pas. Il vaut aussi comme repère de lecture de `finish_reason` — voir
   * `tenter()`.
   */
  private static readonly PLAFOND_CARACTERES = 160;

  isActive(syncUpdatedAt?: Date | null): boolean {
    if (!syncUpdatedAt) return false;
    const limite = Date.now() - MorningBriefService.ACTIVE_WITHIN_DAYS * 86400000;
    return syncUpdatedAt.getTime() >= limite;
  }

  /** Jours consécutifs terminés par au moins une action, en repartant d'hier. */
  computeStreak(dailyScores: Record<string, number> | null | undefined): number {
    if (!dailyScores) return 0;
    let streak = 0;
    for (let i = 1; i <= 60; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if ((dailyScores[d.toISOString().slice(0, 10)] || 0) > 0) streak++;
      else break;
    }
    return streak;
  }

  /**
   * L'angle tourne avec le jour de l'année. Sans ça le modèle reprend toujours la
   * même construction (« prénom, jour N, tâches ») et le message redevient un
   * automatisme au bout d'une semaine — le défaut qu'on cherchait justement à corriger.
   */
  private angleDuJour(etat: 'rien' | 'repos' | 'reste' | 'toutFait'): string {
    // Journée déjà bouclée : réclamer quoi que ce soit serait absurde. On félicite
    // et on projette, sans jamais redemander une tâche cochée.
    if (etat === 'toutFait') {
      const angles = [
        "Sa journée est déjà bouclée : félicite-le franchement et souligne sa régularité.",
        "Tout est fait : félicite-le et invite-le à préparer demain ou à viser plus haut.",
      ];
      const jour = Math.floor(Date.now() / 86400000);
      return angles[jour % angles.length];
    }

    // Rien de planifié : c'est l'état d'un compte qui débute, et le troisième que
    // ce code ignorait. Les angles ci-dessous réclament « une tâche précise encore
    // à faire » — n'en ayant aucune sous les yeux, le modèle en fabriquait une.
    // C'est ainsi qu'un compte sans la moindre routine s'est vu ordonner « 10m de
    // footing » un matin. Ici on ne demande rien : on invite à décider quoi faire,
    // ce qui est exactement le geste attendu à ce moment-là.
    if (etat === 'rien') {
      const angles = [
        "Il n'a rien de prévu aujourd'hui. Ne lui donne AUCUNE tâche : invite-le à ouvrir le chat pour décider avec toi de sa première action.",
        "Sa journée est vide. Ne propose aucune activité précise : demande-lui simplement ce qu'il veut accomplir aujourd'hui, et dis-lui que tu l'attends dans le chat.",
      ];
      const jour = Math.floor(Date.now() / 86400000);
      return angles[jour % angles.length];
    }

    // Un jour sans séance, et non une journée vide. La différence n'existait pas
    // tant que le serveur ignorait la récurrence : il voyait les sept jours de
    // chaque tâche. Maintenant qu'il lit le programme comme l'écran l'affiche, un
    // mardi sans rien peut être exactement ce qui était prévu — l'annoncer comme un
    // vide à combler donnerait tort au plan que le coach a lui-même établi.
    if (etat === 'repos') {
      const angles = [
        "Son programme ne prévoit rien aujourd'hui : dis-le comme une journée de repos assumée, ne réclame aucune tâche et appuie-toi sur sa série.",
        "Jour sans séance à son programme. N'invente rien à faire : rappelle-lui ce qu'il vise cette semaine, ou ce que le repos prépare.",
      ];
      const jour = Math.floor(Date.now() / 86400000);
      return angles[jour % angles.length];
    }

    const angles = [
      "Appuie-toi sur sa série en cours et sur ce qu'il risque de perdre en s'arrêtant.",
      "Cite une tâche précise encore à faire et rends-la facile à commencer maintenant.",
      "Relie sa journée à son objectif de la semaine.",
      "Lance-lui un défi court et concret sur ce qu'il lui reste à faire.",
    ];
    const debutAnnee = new Date(new Date().getFullYear(), 0, 0);
    const jour = Math.floor((Date.now() - debutAnnee.getTime()) / 86400000);
    return angles[jour % angles.length];
  }

  buildPrompt(prenom: string, sync: any): string {
    const streak = this.computeStreak(sync?.daily_scores);
    // Les deux listes sont datées, chacune à son rythme : les routines se décochent
    // chaque nuit, les objectifs chaque lundi, et dans les deux cas c'est le client
    // qui le fait — jamais le serveur. Lire la base sans regarder de quand elle parle,
    // c'est féliciter au réveil quelqu'un dont la journée n'a pas commencé. Voir
    // `taches.ts`.
    const routines = tachesDuJour(sync);
    const objectifs = objectifsDeLaSemaine(sync?.micro_objectives);

    const riens = routines.restantes.length === 0 && routines.faites.length === 0;
    const toutEstFait = !riens && routines.restantes.length === 0;
    // Rien aujourd'hui, mais un programme ailleurs dans la semaine : c'est un jour
    // de repos, pas une journée vide. Voir `aDesRoutines`.
    const repos = riens && aDesRoutines(sync);
    const etat: 'rien' | 'repos' | 'reste' | 'toutFait' = repos
      ? 'repos'
      : riens
        ? 'rien'
        : toutEstFait
          ? 'toutFait'
          : 'reste';

    return [
      `Prénom : ${prenom || 'champion'}`,
      `Série en cours : ${streak} jour(s) d'affilée`,
      routines.faites.length ? `DÉJÀ FAIT aujourd'hui (ne le redemande jamais) : ${routines.faites.join(', ')}` : '',
      toutEstFait
        ? `Tout est terminé pour aujourd'hui.`
        : routines.restantes.length
          ? `RESTE À FAIRE aujourd'hui : ${routines.restantes.slice(0, 3).join(', ')}`
          : repos
            ? `Rien n'est prévu à son programme aujourd'hui : c'est un jour sans séance, pas une journée vide.`
            : `Aucune tâche planifiée aujourd'hui`,
      objectifs.restantes.length ? `Objectifs de la semaine en cours : ${objectifs.restantes.slice(0, 2).join(', ')}` : '',
      '',
      `Angle imposé aujourd'hui : ${this.angleDuJour(etat)}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Retourne null si l'IA n'est pas disponible : l'appelant retombe alors sur le
   * message générique. Une notification banale vaut mieux que pas de notification.
   */
  async generate(prenom: string, sync: any): Promise<string | null> {
    const chaine = chaineCourte(process.env.GROQ_API_KEY);
    if (chaine.length === 0) return null;

    const systeme = [
      "Tu es le coach personnel de l'utilisateur dans l'app Disciplix.",
      "Écris UNE notification de réveil, en français, tutoiement.",
      "Maximum 140 caractères, une à deux phrases. Pas de guillemets.",
      "Appuie-toi sur ses données réelles et respecte l'angle imposé pour aujourd'hui.",
      "INTERDIT de réclamer une tâche listée comme DÉJÀ FAIT : il l'a validée, le lui redemander détruit ta crédibilité.",
      "INTERDIT d'inventer une tâche, un objectif, une durée ou un chiffre absents des données ci-dessous : reprends leurs mots, ne les remplace pas par les tiens. S'il n'y a rien à citer, n'invente rien et invite-le à définir sa journée avec toi.",
      "Ne commence pas systématiquement par son prénom : varie l'attaque.",
      "Ton direct et exigeant, jamais mielleux : « Bravo », « tu vas y arriver », « bonne journée » sans un fait pour les appuyer sont interdits. Si sa veille est vide ou en baisse, tu l'ouvres là-dessus.",
      "Un seul emoji maximum. Réponds uniquement par le texte de la notification.",
    ].join(' ');

    const invite = this.buildPrompt(prenom, sync);

    for (const maillon of chaine) {
      const texte = await this.tenter(maillon, systeme, invite);
      if (!texte) continue;

      // Une dépense mérite sa trace : c'est la seule ligne qui relie l'argent
      // sorti à la saturation gratuite qui l'a provoquée.
      if (maillon.paye) {
        this.logger.warn(`[Secours] 💳 Message du matin écrit par ${maillon.modele} — la chaîne gratuite a refusé`);
      }
      return texte;
    }

    /*
      Toute la chaîne a renoncé, et ce que ça coûte dépend de l'appelant.

      Sur la voie de la notification, il enverra le message générique — banal mais
      entier. Sur celle de l'e-mail, ouverte le 20 août 2026, **il n'enverra
      rien** : un e-mail générique quotidien est le plus court chemin vers un
      signalement pour indésirable. Cette ligne est donc, pour une partie des
      comptes, la seule trace qu'une personne est repartie les mains vides — d'où
      le compteur `sansTexte` de la tournée, qui la rend visible sans avoir à
      lire les logs.
    */
    this.logger.warn("Aucun modèle n'a pu écrire le message du matin");
    return null;
  }

  /** Un appel, sur un modèle donné. Retourne null pour laisser sa chance au suivant. */
  private async tenter(maillon: MaillonCourt, systeme: string, invite: string): Promise<string | null> {
    const modele = maillon.modele;
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), MorningBriefService.TIMEOUT_MS);

    try {
      const reponse = await appelerMaillon(
        maillon,
        {
          messages: [
            { role: 'system', content: systeme },
            { role: 'user', content: invite },
          ],
          temperature: 0.7,
          jetons: 80,
        },
        controleur.signal,
      );

      if (!reponse.ok) {
        this.logger.warn(`Groq a répondu ${reponse.status} sur ${modele} pour le message du matin`);
        return null;
      }

      const data = await reponse.json();
      const { texte, tronque } = lireReponseGroq(data);
      /*
        Répondre n'est pas écrire, et ce cas-là ne laissait aucune trace.

        Un modèle à raisonnement rend un 200 parfaitement formé avec un contenu
        vide quand sa réflexion a mangé les 80 jetons du budget — c'est le mode
        d'échec le plus courant de cette chaîne, et le seul des quatre à sortir
        d'ici sans un mot. Les logs du 21 août 2026 le montrent en creux : dix
        « aucun modèle n'a pu écrire » pour trois avertissements de maillon, donc
        une majorité de renoncements dont on ne pouvait pas nommer la cause.

        Le même écart avait déjà coûté cher le 19 août sur `GET /admin/modeles`,
        qui certifiait verts des modèles muets en production parce qu'il ne
        regardait que le statut HTTP.
      */
      if (!texte) {
        this.logger.warn(`${modele} a répondu 200 sans écrire une ligne pour le message du matin`);
        return null;
      }

      // Le modèle ajoute parfois des guillemets ; une notification tronquée est illisible.
      const propre = texte.replace(/^["'«»\s]+|["'«»\s]+$/g, '');

      // Une coupure par `max_tokens` ne fait de mal que si elle tombe en deçà du
      // plafond de caractères.
      //
      // Au-delà, la phrase est de toute façon ramenée à cette longueur et suivie de
      // points de suspension : le résultat est identique, coupée ou non, et la
      // refuser coûterait un second appel sur un quota quotidien déjà compté. En
      // deçà, en revanche, la notification partirait telle quelle sur le téléphone de
      // quelqu'un, arrêtée au milieu d'un mot — et une notification ne se rattrape
      // pas. Le message générique est moins bon, mais il est entier.
      if (tronque && propre.length <= MorningBriefService.PLAFOND_CARACTERES) {
        this.logger.warn(`Message du matin coupé par max_tokens sur ${modele}`);
        return null;
      }

      return propre.length > MorningBriefService.PLAFOND_CARACTERES
        ? propre.slice(0, MorningBriefService.PLAFOND_CARACTERES - 3) + '…'
        : propre;
    } catch (e: any) {
      this.logger.warn(
        `Message du matin non généré sur ${modele} : ${e?.name === 'AbortError' ? 'délai dépassé' : e?.message}`,
      );
      return null;
    } finally {
      clearTimeout(minuteur);
    }
  }
}
