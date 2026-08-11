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

  private firstTitles(value: any, max: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((v: any) => (Array.isArray(v?.items) ? v.items : [v]))
      .map((v: any) => v?.title || v?.name)
      .filter((t: any) => typeof t === 'string' && t.trim())
      .slice(0, max);
  }

  buildPrompt(prenom: string, sync: any): string {
    const streak = this.computeStreak(sync?.daily_scores);
    const taches = this.firstTitles(sync?.routines, 3);
    const objectifs = this.firstTitles(sync?.micro_objectives, 2);

    return [
      `Prénom : ${prenom || 'champion'}`,
      `Série en cours : ${streak} jour(s)`,
      taches.length ? `Tâches prévues aujourd'hui : ${taches.join(', ')}` : `Aucune tâche planifiée aujourd'hui`,
      objectifs.length ? `Objectifs de la semaine : ${objectifs.join(', ')}` : '',
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
      "Appuie-toi sur ses données : cite sa série si elle est en cours, ou une tâche précise du jour.",
      "Ton direct et motivant, un seul emoji maximum. Réponds uniquement par le texte de la notification.",
    ].join(' ');

    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), MorningBriefService.TIMEOUT_MS);

    try {
      const reponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
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
