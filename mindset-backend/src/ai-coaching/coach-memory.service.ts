import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { lireReponseGroq } from '../common/groq';
import { MODELES_COURTS } from '../common/modeles';

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

  /**
   * Le point de départ physique déclaré, dit au coach en termes de prescription.
   *
   * Sans lui, le modèle propose « Pompes (4x12) » à tout le monde — y compris à
   * quelqu'un qui ne peut pas en faire trois. Un plan infaisable est abandonné le
   * premier jour, et la personne en conclut que c'est elle qui a échoué.
   */
  static readonly NIVEAU_LISIBLE: Record<string, string> = {
    sedentaire:
      "Sédentaire, ne fait aucun sport actuellement. Commence par des mouvements au poids du corps sans matériel, des séries courtes, et de la marche. Aucune séance de plus de 20 minutes la première semaine.",
    reprise:
      "Reprend après un arrêt. A déjà su faire, mais le volume d'avant le blesserait. Remonte progressivement, en dessous de ce qu'il croit pouvoir tenir.",
    regulier:
      "S'entraîne déjà, mais irrégulièrement. Ce qui lui manque n'est pas l'effort mais le rythme : donne-lui une structure fixe plutôt que des séances plus dures.",
    confirme:
      "Sportif confirmé. Des séances exigeantes et chiffrées, avec une progression d'une semaine sur l'autre ; un plan trop facile lui fera quitter l'application.",
  };

  /**
   * Ce que le métier déclaré impose à la forme du plan.
   *
   * C'est la donnée la plus souvent gâchée : elle était enregistrée puis récitée au
   * modèle comme une étiquette (« Métier : Entrepreneur »), ce qui ne change rien à
   * ce qu'il produit. Traduite en contrainte d'emploi du temps, elle change tout —
   * un salarié et un étudiant ne peuvent pas recevoir les mêmes créneaux.
   */
  static readonly METIER_LISIBLE: Record<string, string> = {
    Entrepreneur:
      "pas d'horaires imposés, mais des journées qui débordent et des urgences qui écrasent le reste. Ancre ses tâches tôt le matin, avant que la journée ne lui soit prise. Ne place rien d'important en fin de journée.",
    Étudiant:
      "des cours en journée, des horaires qu'il ne choisit pas, et des périodes d'examens. Ses créneaux fiables sont tôt le matin et le soir. Découpe les révisions en blocs courts plutôt qu'en longues sessions.",
    Salarié:
      "journée bloquée, une pause déjeuner exploitable, des soirées courtes où l'énergie est basse. Le matin avant le travail et la pause de midi sont ses deux vrais créneaux ; ne compte pas sur de longues séances en semaine.",
    Freelance:
      "horaires souples mais revenus irréguliers, donc une charge mentale continue et des journées sans structure. C'est la structure qui lui manque : donne-lui des heures fixes, pas des durées.",
  };

  /** Au-delà, on recompresse les anciens échanges en une note. */
  private static readonly SEUIL_MESSAGES = 40;
  /** On ne résume pas plus d'une fois par jour : inutile et facturé. */
  private static readonly INTERVALLE_RESUME_MS = 24 * 3600 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le questionnaire d'inscription, mis en forme pour le prompt.
   *
   * Chaque réponse est écrite comme une contrainte à respecter, jamais comme une
   * étiquette : « Métier : Entrepreneur » ne change rien à ce que produit un modèle,
   * là où « pas d'horaires imposés, des journées qui débordent, ancre ses tâches tôt »
   * change la forme du plan. La traduction se fait dans `AiCoachingService`, ici on
   * ne fait que présenter — en mettant en tête ce qui rend un conseil inapplicable
   * quand on l'ignore.
   */
  formatProfil(profil: any): string {
    if (!profil) return '';
    const l: string[] = [];
    if (profil.age) l.push(`Âge : ${profil.age} ans`);
    if (profil.occupation) l.push(`Métier : ${profil.occupation}`);
    if (profil.metier_contrainte) l.push(`CE QUE SON MÉTIER IMPOSE : ${profil.metier_contrainte}`);
    if (profil.objectives?.length) l.push(`Objectifs déclarés : ${profil.objectives.join(', ')}`);
    // Ce que la personne a écrit elle-même passe avant les réponses à choix fermés :
    // c'est la seule chose qu'aucun autre compte ne partage avec elle.
    if (profil.situation) l.push(`CE QU'IL T'A DIT DE SA SITUATION, DANS SES MOTS : « ${profil.situation} »`);
    if (profil.minutes_par_jour) {
      l.push(
        `TEMPS DISPONIBLE : ${profil.minutes_par_jour} minutes par jour, pas davantage. ` +
          `La somme des durées que tu prescris pour une journée ne doit jamais dépasser ce nombre — ` +
          `un plan qui déborde n'est pas ambitieux, il est abandonné dès le premier jour.`,
      );
    }
    if (profil.niveau_lisible) l.push(`SON POINT DE DÉPART : ${profil.niveau_lisible}`);
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

  /**
   * Le profil, enrichi de ce que ses réponses fermées impliquent.
   *
   * Les deux champs dérivés ne sont pas stockés : ce sont des traductions, et les
   * figer en base voudrait dire qu'améliorer une formulation n'atteindrait plus
   * jamais les comptes déjà inscrits.
   */
  async chargerProfil(userId: string) {
    const profil = await this.prisma.aIProfile.findUnique({ where: { user_id: userId } });
    if (!profil) return profil;
    return {
      ...profil,
      metier_contrainte: profil.occupation ? CoachMemoryService.METIER_LISIBLE[profil.occupation] ?? null : null,
      niveau_lisible: profil.niveau_depart ? CoachMemoryService.NIVEAU_LISIBLE[profil.niveau_depart] ?? null : null,
    };
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
  static readonly MODELES = MODELES_COURTS;

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
      const { texte, tronque } = lireReponseGroq(data);

      // Une note coupée en route ne se rattrape jamais.
      //
      // Elle est écrite en base, puis renvoyée au modèle le lendemain sous le titre
      // « Note actuelle » avec la consigne d'en garder les informations : il recopie
      // donc consciencieusement la phrase interrompue au milieu d'un fait, et
      // l'amputation devient permanente. Ne rien écrire laisse la note précédente en
      // place, entière — c'est strictement mieux qu'une version abîmée.
      if (tronque) {
        this.logger.warn(`Note de mémoire longue coupée par max_tokens sur ${modele} : non enregistrée`);
        return null;
      }

      return texte;
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
