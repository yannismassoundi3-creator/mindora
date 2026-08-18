import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WeeklyReviewService, SemaineEcoulee } from './weekly-review.service';
import type { LienHabitudeScore } from './analyse-habitudes.service';
import { cleJourParis } from '../common/jour-paris';

/**
 * La lecture de la semaine, et sa mise en cache.
 *
 * Deux appelants la demandent : l'écran du tableau de bord, quand un abonné
 * l'ouvre, et le cron du dimanche soir, qui la prépare d'avance juste avant
 * d'envoyer la notification qui va ramener les gens dans l'application. Les deux
 * doivent obtenir exactement le même texte — d'où ce service, plutôt qu'une
 * méthode privée recopiée des deux côtés. Deux copies de la même règle de cache
 * finissent toujours par diverger, et celle-ci décide de ce qu'un abonné lit.
 *
 * **Le repère de fraîcheur est le jour, pas la semaine.** C'est le point à ne pas
 * se tromper : `resumerSemaine` regarde les sept derniers jours en glissant, pas
 * la semaine du lundi au dimanche. Une lecture datée par semaine calendaire
 * resterait donc affichée jusqu'à six jours pendant que les chiffres qu'elle
 * commente auraient entièrement changé — un texte faux, d'apparence normale,
 * exactement le genre de panne que ce projet paie régulièrement.
 */
@Injectable()
export class BilanHebdoService {
  private readonly logger = new Logger(BilanHebdoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bilan: WeeklyReviewService,
  ) {}

  /**
   * La version des règles qui écrivent la lecture.
   *
   * Le repère ci-dessous date une lecture ; il ne dit pas avec quelles règles elle
   * a été écrite. Quand ces règles changent — un plafond corrigé, une invite
   * réécrite —, les textes déjà en cache gardent l'ancien défaut jusqu'à leur
   * péremption naturelle, et sur un cache journalier cela veut dire toute la
   * journée en cours : on répare un texte que personne ne verra réparé.
   *
   * L'incrémenter est le seul geste qui rattrape les lectures déjà écrites. Il ne
   * coûte qu'une régénération par personne, une seule fois — les anciens repères
   * ne peuvent plus jamais correspondre.
   *
   * **v2, 17 août 2026** : le plafond de longueur coupait au milieu d'un mot, et
   * toujours dans le troisième paragraphe — celui qui porte la seule chose à
   * changer. Voir `WeeklyReviewService.couperProprement`.
   */
  private static readonly VERSION_REGLES = 'v3';

  /**
   * Le repère qui date une lecture : le jour où s'arrête sa fenêtre de sept jours,
   * et la version des règles qui l'ont écrite.
   *
   * En heure de Paris, comme les scores journaliers que la fenêtre parcourt.
   */
  static repere(maintenant = new Date()): string {
    return `${BilanHebdoService.VERSION_REGLES}:${cleJourParis(maintenant)}`;
  }

  /**
   * La lecture du coach pour cette personne, générée si besoin.
   *
   * Rend `null` quand le modèle ne répond pas : l'écran affiche alors ses chiffres
   * sans lecture, ce qui reste utile. On ne montre jamais d'erreur à quelqu'un qui
   * a seulement ouvert son tableau de bord.
   */
  async lecture(
    userId: string,
    prenom: string,
    semaine: SemaineEcoulee,
    levier?: LienHabitudeScore | null,
  ): Promise<string | null> {
    const repere = BilanHebdoService.repere();

    const profil = await this.prisma.aIProfile
      .findUnique({ where: { user_id: userId }, select: { bilan_texte: true, bilan_semaine: true } })
      .catch(() => null);

    if (profil?.bilan_texte && profil.bilan_semaine === repere) return profil.bilan_texte;

    const texte = await this.bilan.genererLecture(prenom, semaine, levier);
    if (!texte) return null;

    /*
      Sans ligne de profil, on rend le texte sans le retenir : mieux vaut un appel
      de plus qu'une exception sur un compte qui n'a pas fini son questionnaire.
      L'échec d'écriture ne doit jamais empêcher la lecture d'arriver à l'écran.
    */
    await this.prisma.aIProfile
      .update({
        where: { user_id: userId },
        data: { bilan_texte: texte, bilan_genere_le: new Date(), bilan_semaine: repere },
      })
      .catch((e) =>
        this.logger.warn(`Lecture de la semaine non mise en cache pour ${userId} : ${e?.message}`),
      );

    return texte;
  }
}
