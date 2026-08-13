import { Injectable, Logger } from '@nestjs/common';

/** Ce qu'on sait d'une semaine, avant d'en faire une phrase. */
export interface SemaineEcoulee {
  /** Jours des sept derniers où quelque chose a été fait. */
  joursActifs: number;
  /** Moyenne du score mental sur les jours actifs, arrondie. */
  scoreMoyen: number;
  /** Meilleur score de la semaine. */
  meilleurScore: number;
  /** Écart avec la semaine d'avant, en points de score moyen. */
  evolution: number;
  /** Habitudes et leur régularité, les plus tenues d'abord. */
  habitudes: { titre: string; joursTenus: number }[];
}

/**
 * Le bilan du dimanche soir.
 *
 * Il existait déjà, mais disait la même chose à tout le monde — « Voici ton plan
 * d'attaque pour lundi. Ouvre l'app pour le découvrir ! » — alors que rien, nulle
 * part, ne préparait ce plan. Une notification qui promet ce qui n'existe pas coûte
 * plus cher qu'une notification absente : elle apprend à ne plus les ouvrir.
 *
 * Deux versions désormais, et la différence est le principal intérêt visible de
 * l'abonnement. Les comptes gratuits reçoivent leurs chiffres, exacts et sans
 * fioriture. Les abonnés reçoivent une lecture de leur semaine, écrite par leur
 * coach à partir des mêmes chiffres : ce qui a tenu, ce qui a lâché, et où porter
 * l'effort. Personne ne perd ce qu'il avait.
 */
@Injectable()
export class WeeklyReviewService {
  private readonly logger = new Logger(WeeklyReviewService.name);

  private static readonly TIMEOUT_MS = 8000;

  /**
   * Le petit modèle d'abord, comme pour le brief : son budget quotidien est compté
   * à part chez Groq, et écrire deux phrases ne demande pas le gros. Le second est
   * là parce qu'un modèle peut disparaître du catalogue ou être interdit sur le
   * projet — sans recours, tous les bilans repasseraient au texte factuel sans que
   * rien ne le signale.
   */
  static readonly MODELES = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

  /** Clé du jour, en heure de Paris : le serveur, lui, tourne en UTC. */
  private static cleJour(decalageJours: number): string {
    return new Date(Date.now() - decalageJours * 86400000).toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Paris',
    });
  }

  /**
   * Résume la semaine écoulée. Rend `null` s'il ne s'est rien passé : mieux vaut se
   * taire que d'envoyer un bilan de zéro à quelqu'un qui n'a rien fait — c'est un
   * reproche, pas un service.
   */
  resumerSemaine(
    dailyScores: Record<string, number> | null | undefined,
    habits: unknown,
  ): SemaineEcoulee | null {
    const scores = dailyScores || {};

    const semaine: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const v = scores[WeeklyReviewService.cleJour(i)];
      if (typeof v === 'number' && v > 0) semaine.push(v);
    }
    if (semaine.length === 0) return null;

    const precedente: number[] = [];
    for (let i = 8; i <= 14; i++) {
      const v = scores[WeeklyReviewService.cleJour(i)];
      if (typeof v === 'number' && v > 0) precedente.push(v);
    }

    const moyenne = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0);
    const scoreMoyen = moyenne(semaine);

    const habitudes = (Array.isArray(habits) ? habits : [])
      .map((h: any) => ({
        titre: String(h?.title || h?.name || '').slice(0, 60),
        joursTenus: WeeklyReviewService.joursTenus(h?.history ?? h?.completed_dates),
      }))
      .filter((h) => h.titre)
      .sort((a, b) => b.joursTenus - a.joursTenus)
      .slice(0, 5);

    return {
      joursActifs: semaine.length,
      scoreMoyen,
      meilleurScore: Math.max(...semaine),
      // Sans semaine précédente, on n'annonce aucune évolution : « +42 » face à rien
      // ferait passer un premier essai pour un exploit.
      evolution: precedente.length ? scoreMoyen - moyenne(precedente) : 0,
      habitudes,
    };
  }

  /** Jours tenus sur les sept derniers, historique de l'habitude en main. */
  static joursTenus(historique: unknown): number {
    if (!Array.isArray(historique)) return 0;

    const recents = new Set<string>();
    for (let i = 0; i <= 7; i++) recents.add(WeeklyReviewService.cleJour(i));

    const tenus = new Set(
      historique
        .filter((d): d is string => typeof d === 'string' && recents.has(d.slice(0, 10)))
        .map((d) => d.slice(0, 10)),
    );
    return tenus.size;
  }

  /**
   * Le bilan des comptes gratuits : leurs chiffres, sans interprétation.
   *
   * Il doit rester utile tout seul. C'est ce qui rend honnête la version payante :
   * on n'a rien retiré, on a ajouté la lecture par-dessus.
   */
  texteFactuel(prenom: string, s: SemaineEcoulee): string {
    const jours = `${s.joursActifs} jour${s.joursActifs > 1 ? 's' : ''} actif${s.joursActifs > 1 ? 's' : ''}`;
    const tendance =
      s.evolution > 0 ? ` (+${s.evolution} pts vs semaine dernière)` : s.evolution < 0 ? ` (${s.evolution} pts)` : '';
    return `${prenom ? prenom + ', t' : 'T'}a semaine : ${jours}, score moyen ${s.scoreMoyen}%${tendance}.`;
  }

  buildPrompt(prenom: string, s: SemaineEcoulee): string {
    const habitudes = s.habitudes.length
      ? s.habitudes.map((h) => `• ${h.titre} : tenue ${h.joursTenus}/7`).join('\n')
      : 'Aucune habitude suivie';

    return [
      `Prénom : ${prenom || 'champion'}`,
      `Jours actifs cette semaine : ${s.joursActifs}/7`,
      `Score mental moyen : ${s.scoreMoyen}% (meilleur jour : ${s.meilleurScore}%)`,
      s.evolution === 0
        ? `Pas de semaine précédente pour comparer : ne parle d'aucune évolution.`
        : `Évolution par rapport à la semaine précédente : ${s.evolution > 0 ? '+' : ''}${s.evolution} points`,
      ``,
      `HABITUDES :`,
      habitudes,
    ].join('\n');
  }

  /**
   * Rend `null` si l'IA n'est pas disponible : l'appelant retombe alors sur le texte
   * factuel. Un abonné qui reçoit ses chiffres bruts est déçu ; un abonné qui ne
   * reçoit rien croit que le service est mort.
   */
  async generate(prenom: string, s: SemaineEcoulee): Promise<string | null> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return null;

    const systeme = [
      "Tu es le coach personnel de l'utilisateur dans l'app Disciplix.",
      'Écris le bilan de sa semaine, en français, tutoiement.',
      'Maximum 180 caractères, deux phrases : ce qui a tenu, puis où porter l\'effort la semaine prochaine.',
      "INTERDIT d'inventer un chiffre, une habitude ou une activité absents des données : reprends leurs mots.",
      'Sois précis et franc, jamais mielleux. Un seul emoji maximum. Pas de guillemets.',
      'Réponds uniquement par le texte du bilan.',
    ].join(' ');

    for (const modele of WeeklyReviewService.MODELES) {
      const texte = await this.tenter(apiKey, modele, systeme, this.buildPrompt(prenom, s));
      if (texte) return texte;
    }

    this.logger.warn("Aucun modèle n'a pu écrire le bilan hebdomadaire");
    return null;
  }

  /** Un appel, sur un modèle donné. Retourne null pour laisser sa chance au suivant. */
  private async tenter(apiKey: string, modele: string, systeme: string, invite: string): Promise<string | null> {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), WeeklyReviewService.TIMEOUT_MS);

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
          max_tokens: 120,
        }),
        signal: controleur.signal,
      });

      if (!reponse.ok) {
        this.logger.warn(`Groq a répondu ${reponse.status} sur ${modele} pour le bilan hebdomadaire`);
        return null;
      }

      const data = await reponse.json();
      const texte = data?.choices?.[0]?.message?.content?.trim();
      if (!texte) return null;

      const propre = texte.replace(/^["'«»\s]+|["'«»\s]+$/g, '');
      return propre.length > 200 ? propre.slice(0, 197) + '…' : propre;
    } catch (e: any) {
      this.logger.warn(
        `Bilan hebdomadaire non généré sur ${modele} : ${e?.name === 'AbortError' ? 'délai dépassé' : e?.message}`,
      );
      return null;
    } finally {
      clearTimeout(minuteur);
    }
  }
}
