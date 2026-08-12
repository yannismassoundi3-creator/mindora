import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ce que le coach sait de la personne au-delà de l'instant présent.
 *
 * Il lui manquait deux choses. D'abord le questionnaire d'inscription : âge, métier,
 * contraintes, style de coaching souhaité étaient enregistrés puis jamais relus, si
 * bien qu'on pouvait déclarer un genou fragile et se voir proposer des squats.
 * Ensuite la durée : l'historique transmis est plafonné, donc tout ce qui dépassait
 * la fenêtre disparaissait pour de bon.
 */
@Injectable()
export class CoachMemoryService {
  private readonly logger = new Logger(CoachMemoryService.name);

  /** Au-delà, on recompresse les anciens échanges en une note. */
  private static readonly SEUIL_MESSAGES = 40;
  /** On ne résume pas plus d'une fois par jour : inutile et facturé. */
  private static readonly INTERVALLE_RESUME_MS = 24 * 3600 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /** Le questionnaire d'inscription, mis en forme pour le prompt. */
  formatProfil(profil: any): string {
    if (!profil) return '';
    const l: string[] = [];
    if (profil.age) l.push(`Âge : ${profil.age} ans`);
    if (profil.occupation) l.push(`Métier : ${profil.occupation}`);
    if (profil.objectives?.length) l.push(`Objectifs déclarés : ${profil.objectives.join(', ')}`);
    // Les contraintes passent en premier plan : c'est ce qui rend un conseil
    // inapplicable quand on l'ignore.
    if (profil.constraints?.length) l.push(`CONTRAINTES À RESPECTER ABSOLUMENT : ${profil.constraints.join(', ')}`);
    if (profil.current_habits?.length) l.push(`Habitudes déjà en place : ${profil.current_habits.join(', ')}`);
    if (profil.personality) l.push(`Personnalité : ${profil.personality}`);
    if (profil.coaching_style) l.push(`Style de coaching qu'il attend de toi : ${profil.coaching_style}`);
    if (!l.length) return '';
    return `\n--- SON PROFIL (rempli à l'inscription) ---\n${l.join('\n')}`;
  }

  /** La note de mémoire longue, si elle existe. */
  formatMemoire(profil: any): string {
    if (!profil?.memory_summary) return '';
    return `\n--- CE QUE TU SAIS DÉJÀ DE LUI (échanges passés) ---\n${profil.memory_summary}`;
  }

  /**
   * Tendance sur 7 jours. L'IA ne recevait que l'état du jour : elle ne pouvait ni
   * constater un décrochage, ni féliciter une progression, ni repérer qu'une journée
   * précise coince toutes les semaines.
   */
  formatTendance(dailyScores: Record<string, number> | null | undefined): string {
    if (!dailyScores) return '';
    const jours: { date: string; jour: string; score: number }[] = [];
    const noms = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const cle = d.toISOString().slice(0, 10);
      jours.push({ date: cle, jour: noms[d.getDay()], score: dailyScores[cle] || 0 });
    }
    if (jours.every((j) => j.score === 0)) return '';

    const moyenne = Math.round(jours.reduce((s, j) => s + j.score, 0) / jours.length);
    const debut = jours.slice(0, 3).reduce((s, j) => s + j.score, 0) / 3;
    const fin = jours.slice(-3).reduce((s, j) => s + j.score, 0) / 3;
    const ecart = Math.round(fin - debut);
    const sens = ecart > 10 ? 'en progression' : ecart < -10 ? 'EN DÉCROCHAGE' : 'stable';
    const creux = jours.filter((j) => j.score === 0).map((j) => j.jour);

    return [
      `\n--- SA TENDANCE SUR 7 JOURS ---`,
      jours.map((j) => `${j.jour} ${j.score}%`).join(' | '),
      `Moyenne : ${moyenne}% — tendance ${sens} (${ecart >= 0 ? '+' : ''}${ecart} points)`,
      creux.length ? `Jours sans aucune activité : ${creux.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async chargerProfil(userId: string) {
    return this.prisma.aIProfile.findUnique({ where: { user_id: userId } });
  }

  /**
   * Recompresse les anciens échanges dans la note de mémoire, au plus une fois par
   * jour. Silencieux en cas d'échec : rater un résumé ne doit jamais empêcher de
   * répondre à l'utilisateur.
   */
  async rafraichirMemoire(userId: string, profil: any): Promise<void> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || !profil) return;

    const recemment =
      profil.memory_updated_at &&
      Date.now() - new Date(profil.memory_updated_at).getTime() < CoachMemoryService.INTERVALLE_RESUME_MS;
    if (recemment) return;

    const total = await this.prisma.chatMessage.count({ where: { user_id: userId } });
    if (total < CoachMemoryService.SEUIL_MESSAGES) return;

    // On résume ce qui sort de la fenêtre transmise, pas les échanges récents :
    // ceux-là sont déjà rejoués intégralement.
    const anciens = await this.prisma.chatMessage.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      skip: 20,
      take: 60,
      select: { sender: true, text: true },
    });
    if (!anciens.length) return;

    const transcript = anciens
      .reverse()
      .map((m) => `${m.sender === 'ai' ? 'Coach' : 'Lui'}: ${String(m.text).replace(/<PLAN>[\s\S]*?<\/PLAN>/g, '').trim()}`)
      .filter((l) => l.length > 8)
      .join('\n')
      .slice(0, 8000);

    const messages = [
      {
        role: 'system',
        content:
          "Tu tiens la fiche de suivi d'un coach. À partir de la conversation, écris en français une note de 6 lignes maximum sur cette personne : ce qui la motive, ses blocages récurrents, les faits personnels qu'elle a partagés (prénoms, contexte, blessures, contraintes), ce qui a marché et ce qui a échoué. Des faits, pas de politesses. Si la note existante contient déjà une information, garde-la.",
      },
      {
        role: 'user',
        content:
          (profil.memory_summary ? `Note actuelle :\n${profil.memory_summary}\n\n` : '') + `Conversation :\n${transcript}`,
      },
    ];

    for (const modele of CoachMemoryService.MODELES) {
      const note = await this.resumer(apiKey, modele, messages);
      if (!note) continue;

      await this.prisma.aIProfile.update({
        where: { user_id: userId },
        data: { memory_summary: note.slice(0, 2000), memory_updated_at: new Date() },
      });
      this.logger.log(`Mémoire longue rafraîchie pour ${userId} (${modele})`);
      return;
    }

    this.logger.warn(`Mémoire non rafraîchie pour ${userId} : aucun modèle disponible`);
  }

  /**
   * Modèles essayés dans l'ordre.
   *
   * Résumer une conversation est une tâche de synthèse, pas de coaching : le petit
   * modèle s'en sort et son quota quotidien est compté à part. Laissée sur le gros
   * modèle, cette note consommait à elle seule, pour cent utilisateurs, le double du
   * budget journalier disponible — d'où l'ordre. Le second n'est là que pour le cas
   * où le premier est retiré du catalogue ou interdit sur le projet Groq : sans lui,
   * la mémoire longue cessait de se mettre à jour définitivement et en silence.
   */
  static readonly MODELES = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

  /** Un appel. Retourne null pour laisser sa chance au modèle suivant. */
  private async resumer(apiKey: string, modele: string, messages: any[]): Promise<string | null> {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), 12000);
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modele, messages, temperature: 0.3, max_tokens: 300 }),
        signal: controleur.signal,
      });
      if (!r.ok) {
        this.logger.warn(`Groq a répondu ${r.status} sur ${modele} pour la mémoire longue`);
        return null;
      }
      const data = await r.json();
      return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (e: any) {
      this.logger.warn(
        `Mémoire non rafraîchie sur ${modele} : ${e?.name === 'AbortError' ? 'délai dépassé' : e?.message}`,
      );
      return null;
    } finally {
      clearTimeout(minuteur);
    }
  }
}
