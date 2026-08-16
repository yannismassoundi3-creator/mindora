import { Injectable, Logger } from '@nestjs/common';
import { lireReponseGroq } from '../common/groq';
import { separerTaches } from './taches';

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
  static readonly MODELES = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

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

  /** Voir `taches.ts` : le tri est partagé avec le coup de pouce. */
  private splitTasks(value: any): { restantes: string[]; faites: string[] } {
    return separerTaches(value);
  }

  /**
   * L'angle tourne avec le jour de l'année. Sans ça le modèle reprend toujours la
   * même construction (« prénom, jour N, tâches ») et le message redevient un
   * automatisme au bout d'une semaine — le défaut qu'on cherchait justement à corriger.
   */
  private angleDuJour(etat: 'rien' | 'reste' | 'toutFait'): string {
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
    const routines = this.splitTasks(sync?.routines);
    const objectifs = this.splitTasks(sync?.micro_objectives);

    const riens = routines.restantes.length === 0 && routines.faites.length === 0;
    const toutEstFait = !riens && routines.restantes.length === 0;
    const etat: 'rien' | 'reste' | 'toutFait' = riens ? 'rien' : toutEstFait ? 'toutFait' : 'reste';

    return [
      `Prénom : ${prenom || 'champion'}`,
      `Série en cours : ${streak} jour(s) d'affilée`,
      routines.faites.length ? `DÉJÀ FAIT aujourd'hui (ne le redemande jamais) : ${routines.faites.join(', ')}` : '',
      toutEstFait
        ? `Tout est terminé pour aujourd'hui.`
        : routines.restantes.length
          ? `RESTE À FAIRE aujourd'hui : ${routines.restantes.slice(0, 3).join(', ')}`
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
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return null;

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

    for (const modele of MorningBriefService.MODELES) {
      const texte = await this.tenter(apiKey, modele, systeme, invite);
      if (texte) return texte;
    }

    // Les deux modèles ont renoncé : l'appelant enverra le message générique.
    this.logger.warn("Aucun modèle n'a pu écrire le message du matin");
    return null;
  }

  /** Un appel, sur un modèle donné. Retourne null pour laisser sa chance au suivant. */
  private async tenter(apiKey: string, modele: string, systeme: string, invite: string): Promise<string | null> {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), MorningBriefService.TIMEOUT_MS);

    try {
      const reponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modele,
          messages: [
            { role: 'system', content: systeme },
            { role: 'user', content: invite },
          ],
          temperature: 0.7,
          max_tokens: 80,
        }),
        signal: controleur.signal,
      });

      if (!reponse.ok) {
        this.logger.warn(`Groq a répondu ${reponse.status} sur ${modele} pour le message du matin`);
        return null;
      }

      const data = await reponse.json();
      const { texte, tronque } = lireReponseGroq(data);
      if (!texte) return null;

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
