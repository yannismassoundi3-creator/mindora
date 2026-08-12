import { Injectable, Logger } from '@nestjs/common';

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
   * Sépare ce qui reste à faire de ce qui est déjà fait.
   *
   * Sans ce tri, le brief réclamait des tâches que la personne venait de cocher —
   * le réflexe le plus sûr pour faire désinstaller une app de coaching.
   */
  private splitTasks(value: any): { restantes: string[]; faites: string[] } {
    const restantes: string[] = [];
    const faites: string[] = [];
    if (!Array.isArray(value)) return { restantes, faites };

    for (const entree of value) {
      const elements = Array.isArray(entree?.items) ? entree.items : [entree];
      for (const el of elements) {
        const titre = el?.title || el?.name;
        if (typeof titre !== 'string' || !titre.trim()) continue;
        (el?.done ? faites : restantes).push(titre);
      }
    }
    return { restantes, faites };
  }

  /**
   * L'angle tourne avec le jour de l'année. Sans ça le modèle reprend toujours la
   * même construction (« prénom, jour N, tâches ») et le message redevient un
   * automatisme au bout d'une semaine — le défaut qu'on cherchait justement à corriger.
   */
  private angleDuJour(toutEstFait: boolean): string {
    // Journée déjà bouclée : réclamer quoi que ce soit serait absurde. On félicite
    // et on projette, sans jamais redemander une tâche cochée.
    if (toutEstFait) {
      const angles = [
        "Sa journée est déjà bouclée : félicite-le franchement et souligne sa régularité.",
        "Tout est fait : félicite-le et invite-le à préparer demain ou à viser plus haut.",
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
      `Angle imposé aujourd'hui : ${this.angleDuJour(toutEstFait)}`,
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
      "Ne commence pas systématiquement par son prénom : varie l'attaque.",
      "Ton direct et motivant, un seul emoji maximum. Réponds uniquement par le texte de la notification.",
    ].join(' ');

    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), MorningBriefService.TIMEOUT_MS);

    try {
      const reponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Écrire 140 caractères de réveil ne demande pas un modèle de 70 milliards
          // de paramètres. Le petit modèle dispose chez Groq d'un budget quotidien
          // cinq fois plus large, compté séparément : déplacer les briefs ici rend au
          // chat l'intégralité du quota du gros modèle, qu'ils amputaient d'un tiers.
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: systeme },
            { role: 'user', content: this.buildPrompt(prenom, sync) },
          ],
          temperature: 0.7,
          max_tokens: 80,
        }),
        signal: controleur.signal,
      });

      if (!reponse.ok) {
        this.logger.warn(`Groq a répondu ${reponse.status} pour le message du matin`);
        return null;
      }

      const data = await reponse.json();
      const texte = data?.choices?.[0]?.message?.content?.trim();
      if (!texte) return null;

      // Le modèle ajoute parfois des guillemets ; une notification tronquée est illisible.
      const propre = texte.replace(/^["'«»\s]+|["'«»\s]+$/g, '');
      return propre.length > 160 ? propre.slice(0, 157) + '…' : propre;
    } catch (e: any) {
      this.logger.warn(`Message du matin non généré : ${e?.name === 'AbortError' ? 'délai dépassé' : e?.message}`);
      return null;
    } finally {
      clearTimeout(minuteur);
    }
  }
}
