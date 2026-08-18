import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ObservationService, type Observation } from './observation.service';
import { CoachMemoryService } from './coach-memory.service';
import {
  AnalyseHabitudesService,
  type HabitudeAnalysee,
  type LienHabitudeScore,
} from '../push/analyse-habitudes.service';
import { WeeklyReviewService } from '../push/weekly-review.service';
import { cleJourParis } from '../common/jour-paris';

/**
 * Ce que le coach a compris de la personne — et non de sa semaine.
 *
 * La carte « ce que ton coach a remarqué » ne montrait qu'un seul motif, le plus
 * fort, en une phrase. C'est ce qui donne envie d'en savoir plus, et c'est
 * exactement là que le produit s'arrêtait. Ce service est la suite : tous les
 * motifs qui tiennent, les habitudes et leur trajectoire, le levier, la série, et
 * une lecture écrite par le modèle qui rattache tout ça au cap que la personne
 * s'est donné elle-même à l'inscription.
 *
 * **La règle du projet tient toujours, et elle tient plus fort ici : les motifs
 * sont calculés, jamais devinés.** Le modèle ne reçoit que des faits déjà établis
 * et seuillés ; il les met en phrases et les relie au cap. Lui donner l'historique
 * brut en lui demandant « que remarques-tu ? » produirait des observations
 * inventées, dites avec le même aplomb que les vraies — et sur une page qu'on
 * fait payer, c'est la pire chose qu'on puisse faire.
 *
 * **Ce qu'apporte la mémoire longue :** le coach cite ce que la personne lui a dit
 * ailleurs, dans la conversation. C'est ce qui sépare une page de statistiques de
 * quelqu'un qui vous connaît.
 */

export interface AnalyseComplete {
  /** Tous les motifs qui franchissent leurs seuils, le plus fort en tête. */
  faits: Observation[];
  /** Les habitudes et leur trajectoire sur deux semaines. */
  habitudes: HabitudeAnalysee[];
  /** L'habitude qui accompagne les meilleures journées, quand l'écart est net. */
  levier: LienHabitudeScore | null;
  /** Jours consécutifs terminés par une action, en repartant d'hier. */
  serie: number;
  /** Le cap déclaré à l'inscription, tel que la personne l'a écrit. */
  cap: string | null;
  /**
   * La lecture écrite par le modèle à partir des faits ci-dessus.
   *
   * `null` quand il n'a pas répondu : l'écran affiche alors les faits seuls, ce
   * qui reste la moitié utile. On ne montre jamais une erreur à quelqu'un qui a
   * seulement ouvert son tableau de bord.
   */
  lecture: string | null;
}

@Injectable()
export class AnalyseCompleteService {
  private readonly logger = new Logger(AnalyseCompleteService.name);

  /**
   * La version des règles qui écrivent la lecture.
   *
   * Même rôle que dans `BilanHebdoService` : sans elle, une consigne corrigée ne
   * rattrape jamais les textes déjà en cache, et on répare une phrase que
   * personne ne verra réparée.
   */
  private static readonly VERSION_REGLES = 'v1';

  /** Plafond de la lecture. Plus long que le bilan : elle couvre plus de faits. */
  private static readonly PLAFOND = 1200;

  /** De quoi écrire ce plafond sans être coupé par le budget de jetons. */
  private static readonly JETONS = 600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly observations: ObservationService,
    private readonly habitudes: AnalyseHabitudesService,
    private readonly memoire: CoachMemoryService,
    private readonly redaction: WeeklyReviewService,
  ) {}

  static repere(maintenant = new Date()): string {
    return `${AnalyseCompleteService.VERSION_REGLES}:${cleJourParis(maintenant)}`;
  }

  /**
   * L'analyse complète d'une personne, dont le texte est écrit au plus une fois
   * par jour.
   *
   * Le cache ne porte que sur le texte : les faits sont recalculés à chaque appel
   * parce qu'ils sont gratuits et qu'ils doivent suivre la journée en cours.
   * Mettre les deux en cache afficherait les chiffres d'hier sous la lecture
   * d'hier — cohérent, et faux.
   */
  async pour(userId: string, prenom: string): Promise<AnalyseComplete> {
    const sync = await this.prisma.syncData
      .findUnique({
        where: { user_id: userId },
        select: { daily_scores: true, habits: true },
      })
      .catch(() => null);

    const scores = (sync?.daily_scores as Record<string, number> | null) ?? null;
    const faits = this.observations.observations(scores);
    const { habitudes, levier } = this.habitudes.analyser(scores, sync?.habits);
    const profil = await this.memoire.chargerProfil(userId).catch(() => null);
    const cap = AnalyseCompleteService.capDeclare(profil);
    const serie = AnalyseCompleteService.serie(scores);

    const base: AnalyseComplete = { faits, habitudes, levier, serie, cap, lecture: null };

    /*
      Sans un seul fait, il n'y a rien à lire.

      Demander au modèle d'écrire une analyse sur un historique vide produirait
      exactement ce que tout ce fichier cherche à éviter : des phrases de coach
      qui ne reposent sur rien. L'écran dit alors qu'il faut plus de jours, ce qui
      est vrai et vérifiable.
    */
    if (faits.length === 0 && habitudes.length === 0) return base;

    const lecture = await this.lecture(userId, prenom, base, profil);
    return { ...base, lecture };
  }

  /** Le cap tel que la personne l'a écrit, sans reformulation. */
  private static capDeclare(profil: any): string | null {
    // `objectives[0]` : c'est la ou le questionnaire ecrit le cap, et c'est ce
    // que le tableau de bord affiche sous le prenom. Aller le chercher ailleurs
    // ferait diverger la phrase montree et la phrase citee par le coach.
    const brut = profil?.objectives?.[0];
    return typeof brut === 'string' && brut.trim() ? brut.trim().slice(0, 200) : null;
  }

  /**
   * Recopiée de `MorningBriefService.computeStreak` : repart d'hier, jamais
   * d'aujourd'hui — une journée en cours n'est pas encore une journée tenue.
   */
  private static serie(scores: Record<string, number> | null): number {
    if (!scores) return 0;
    let n = 0;
    for (let i = 1; i <= 60; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if ((scores[d.toISOString().slice(0, 10)] || 0) > 0) n++;
      else break;
    }
    return n;
  }

  private async lecture(
    userId: string,
    prenom: string,
    a: AnalyseComplete,
    profil: any,
  ): Promise<string | null> {
    const repere = AnalyseCompleteService.repere();

    const cache = await this.prisma.aIProfile
      .findUnique({
        where: { user_id: userId },
        select: { analyse_texte: true, analyse_repere: true },
      })
      .catch(() => null);

    if (cache?.analyse_texte && cache.analyse_repere === repere) return cache.analyse_texte;

    const texte = await this.redaction.ecrire(
      AnalyseCompleteService.consigne(),
      this.invite(prenom, a, profil),
      AnalyseCompleteService.PLAFOND,
      AnalyseCompleteService.JETONS,
    );
    if (!texte) return null;

    // Sans ligne de profil on rend le texte sans le retenir : un appel de plus
    // vaut mieux qu'une exception sur un compte qui n'a pas fini son questionnaire.
    await this.prisma.aIProfile
      .update({
        where: { user_id: userId },
        data: { analyse_texte: texte, analyse_genere_le: new Date(), analyse_repere: repere },
      })
      .catch((e) => this.logger.warn(`Analyse non mise en cache pour ${userId} : ${e?.message}`));

    return texte;
  }

  private static consigne(): string {
    return [
      "Tu es le coach personnel de l'utilisateur dans l'app Disciplix.",
      'Tu lui écris ce que tu as compris de lui, en français, en le tutoyant.',
      'Trois paragraphes courts séparés par une ligne vide, 900 caractères en tout maximum :',
      "1) ce que ses chiffres disent de sa manière de fonctionner ; 2) le lien entre ça et le cap qu'il s'est donné ; 3) UNE seule chose à essayer, petite et datée.",
      "INTERDIT d'inventer un motif, un chiffre, une habitude ou un jour qui ne figure pas dans les données ci-dessous. Tu n'as pas son historique : tu n'as que ces faits, déjà vérifiés.",
      "INTERDIT de dire qu'une chose en cause une autre. Les liens fournis sont des coïncidences mesurées : dis « tes journées avec » et « tes journées sans ».",
      "INTERDIT de parler d'échec, de rater, ou de discipline perdue. Tu constates, tu ne rends pas de verdict.",
      "Si un cap est fourni, reprends ses mots exacts au moins une fois : c'est sa phrase qu'il doit reconnaître.",
      'Pas de liste à puces, pas de titre, pas de guillemets. Réponds uniquement par le texte.',
    ].join(' ');
  }

  /**
   * Ce que le modèle reçoit : des faits, et rien que des faits.
   *
   * La mémoire longue est jointe parce que c'est elle qui sépare une page de
   * statistiques de quelqu'un qui vous connaît — elle porte ce que la personne a
   * dit dans la conversation, et qu'aucun score ne contient.
   */
  private invite(prenom: string, a: AnalyseComplete, profil: any): string {
    const lignes: string[] = [`Prénom : ${prenom}`];

    if (a.cap) lignes.push(`Cap déclaré à l'inscription, mot pour mot : « ${a.cap} »`);
    if (a.serie >= 2) lignes.push(`Série en cours : ${a.serie} jours consécutifs.`);

    if (a.faits.length) {
      lignes.push('', 'Motifs relevés dans son historique (déjà vérifiés, seuils franchis) :');
      for (const f of a.faits) lignes.push(`- ${f.fait}`);
    }

    if (a.habitudes.length) {
      lignes.push('', 'Ses habitudes sur les sept derniers jours :');
      for (const h of a.habitudes.slice(0, 6)) {
        const evo =
          h.evolution === null
            ? ''
            : h.evolution > 0
              ? ` (+${h.evolution} par rapport aux sept jours d'avant)`
              : h.evolution < 0
                ? ` (${h.evolution} par rapport aux sept jours d'avant)`
                : ' (stable)';
        lignes.push(`- ${h.titre} : ${h.joursTenus}/7${evo}`);
      }
    }

    if (a.levier) {
      lignes.push(
        '',
        `Coïncidence mesurée : ses journées avec « ${a.levier.titre} » sont à ${a.levier.scoreAvec} % (${a.levier.joursAvec} jours), celles sans à ${a.levier.scoreSans} % (${a.levier.joursSans} jours).`,
      );
    }

    const memoire = this.memoire.formatMemoire(profil);
    if (memoire && memoire.trim()) {
      lignes.push('', "Ce qu'il t'a dit dans vos conversations :", memoire.trim());
    }

    return lignes.join('\n');
  }
}
