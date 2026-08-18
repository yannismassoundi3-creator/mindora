import { Injectable } from '@nestjs/common';

/**
 * Ce que les habitudes font aux journées.
 *
 * Le bilan de la semaine **affiche** les habitudes — « Sommeil de qualité 2/7 » —
 * mais ne les analyse jamais, et surtout ne les croise avec rien. Or l'application
 * détient les deux moitiés de la seule question qui vaille : le score de chaque
 * journée, et les jours où chaque habitude a été tenue. Personne ne peut faire ce
 * rapprochement de tête ; c'est exactement le genre de travail qu'on paie une
 * application à faire pour soi.
 *
 * **Le motif est calculé, jamais deviné.** Même règle que dans
 * `ObservationService`, et pour la même raison : un modèle à qui l'on donne un
 * historique trouvera toujours un lien, y compris dans du bruit, et l'annoncera
 * avec le même aplomb que s'il avait raison. Ici tout est compté, seuillé, et le
 * silence est la réponse par défaut.
 *
 * **On ne dit jamais « à cause de ».** Ce service mesure une coïncidence entre
 * deux séries, pas une cause. Quelqu'un qui s'entraîne les jours où il va déjà
 * bien produit le même chiffre que quelqu'un dont l'entraînement fait la journée.
 * D'où le vocabulaire retenu partout — « tes journées avec » et « sans » — et
 * l'interdiction faite au modèle d'en conclure autre chose.
 */

/** Une habitude, ses sept derniers jours et les sept d'avant. */
export interface HabitudeAnalysee {
  titre: string;
  /** Jours tenus sur les sept derniers. */
  joursTenus: number;
  /** Jours tenus sur les sept précédents. `null` quand il n'y a pas de quoi comparer. */
  joursTenusAvant: number | null;
  /** Écart entre les deux, en jours. `null` quand `joursTenusAvant` l'est. */
  evolution: number | null;
}

/** Le rapprochement entre une habitude et le score des journées. */
export interface LienHabitudeScore {
  titre: string;
  /** Score moyen des journées où elle a été tenue. */
  scoreAvec: number;
  /** Score moyen des journées actives où elle ne l'a pas été. */
  scoreSans: number;
  /** `scoreAvec - scoreSans`, en points. Toujours positif ici : voir `trouverLevier`. */
  ecart: number;
  joursAvec: number;
  joursSans: number;
}

export interface AnalyseHabitudes {
  /** Les habitudes et leur trajectoire, la plus tenue d'abord. */
  habitudes: HabitudeAnalysee[];
  /**
   * L'habitude dont la présence accompagne les meilleures journées.
   *
   * `null` bien plus souvent qu'à son tour, et c'est voulu : il faut de
   * l'historique des deux côtés et un écart net. Rien à dire est une réponse.
   */
  levier: LienHabitudeScore | null;
}

@Injectable()
export class AnalyseHabitudesService {
  /**
   * Fenêtre d'observation, en jours.
   *
   * Quatre semaines : assez pour que chaque habitude ait des journées des deux
   * côtés, pas assez pour décrire quelqu'un qui n'existe plus. Même fenêtre que
   * `ObservationService`, exprès — deux fenêtres différentes finiraient par
   * rendre deux verdicts sur la même personne le même jour.
   */
  static readonly FENETRE_JOURS = 28;

  /**
   * Journées minimum de chaque côté du rapprochement.
   *
   * En dessous, la moyenne d'un côté tient à une seule journée : un lundi
   * exceptionnel suffirait à fabriquer un « levier ». Trois n'est pas une
   * garantie statistique, c'est le seuil en dessous duquel on sait qu'on raconte
   * n'importe quoi.
   */
  static readonly JOURS_MINIMUM_PAR_COTE = 3;

  /**
   * Écart minimum, en points de score, pour qu'un lien soit dit.
   *
   * Quinze points sur cent. En dessous, on décrit du bruit avec des mots de
   * certitude — la façon la plus rapide d'apprendre à quelqu'un que le coach
   * devine au lieu de savoir.
   */
  static readonly ECART_MINIMUM = 15;

  /** La clé de jour telle que le client l'écrit, en heure de Paris comme le reste du bilan. */
  private static cleJour(recul: number, depuis: number): string {
    return new Date(depuis - recul * 86400000).toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Paris',
    });
  }

  /** Les jours `YYYY-MM-DD` où cette habitude a été tenue, dédoublonnés. */
  private static joursDeLHabitude(historique: unknown): Set<string> {
    if (!Array.isArray(historique)) return new Set();
    return new Set(
      historique
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    );
  }

  /** Jours tenus dans un intervalle de recul `[debut, fin]` (1 = hier). */
  private static tenusEntre(
    jours: Set<string>,
    debut: number,
    fin: number,
    depuis: number,
  ): number {
    let n = 0;
    for (let i = debut; i <= fin; i++) {
      if (jours.has(AnalyseHabitudesService.cleJour(i, depuis))) n++;
    }
    return n;
  }

  private static moyenne(valeurs: number[]): number {
    return valeurs.length ? Math.round(valeurs.reduce((a, b) => a + b, 0) / valeurs.length) : 0;
  }

  /** Y a-t-il eu une journée active dans la semaine précédente (jours 8 à 14) ? */
  private static aVecuLaSemainePrecedente(
    scores: Record<string, number>,
    maintenant: number,
  ): boolean {
    for (let i = 8; i <= 14; i++) {
      const v = scores[AnalyseHabitudesService.cleJour(i, maintenant)];
      if (typeof v === 'number' && v > 0) return true;
    }
    return false;
  }

  /**
   * L'analyse complète, ou des listes vides quand il n'y a rien à en tirer.
   *
   * `habits` arrive tel que le navigateur le synchronise : un tableau d'objets
   * dont les noms de champs ont changé au fil des versions, d'où les replis sur
   * `name` et `completed_dates`. Une entrée illisible est ignorée, jamais une
   * cause d'échec — ce serait perdre tout le bilan pour une ligne abîmée.
   */
  analyser(
    dailyScores: Record<string, number> | null | undefined,
    habits: unknown,
    maintenant = Date.now(),
  ): AnalyseHabitudes {
    const scores = dailyScores && typeof dailyScores === 'object' ? dailyScores : {};

    const brutes = (Array.isArray(habits) ? habits : [])
      .map((h: any) => ({
        titre: String(h?.title || h?.name || '').slice(0, 60),
        jours: AnalyseHabitudesService.joursDeLHabitude(h?.history ?? h?.completed_dates),
      }))
      .filter((h) => h.titre);

    /*
      Une semaine précédente entièrement vide ne se distingue pas d'une semaine
      qui n'a pas existé — le compte venait d'être créé. Annoncer « +2 par rapport
      à la semaine dernière » à quelqu'un qui n'en a pas eu fabrique une
      comparaison, exactement ce que l'évolution du score évite déjà.
    */
    const aVecu = AnalyseHabitudesService.aVecuLaSemainePrecedente(scores, maintenant);

    const habitudes: HabitudeAnalysee[] = brutes
      .map((h) => {
        const joursTenus = AnalyseHabitudesService.tenusEntre(h.jours, 1, 7, maintenant);
        const avant = AnalyseHabitudesService.tenusEntre(h.jours, 8, 14, maintenant);
        return {
          titre: h.titre,
          joursTenus,
          joursTenusAvant: aVecu ? avant : null,
          evolution: aVecu ? joursTenus - avant : null,
        };
      })
      .sort((a, b) => b.joursTenus - a.joursTenus)
      .slice(0, 5);

    return { habitudes, levier: this.trouverLevier(scores, brutes, maintenant) };
  }

  /**
   * L'habitude dont la présence accompagne les meilleures journées.
   *
   * **Seuls les écarts positifs sortent.** Un écart négatif existe et peut être
   * réel — une habitude qu'on ne tient que les jours creux, parce qu'elle est la
   * seule chose qu'on arrive encore à faire. Mais l'annoncer se lit comme un
   * reproche adressé à ce qui tenait encore, et n'ouvre sur aucun geste. On se
   * tait plutôt que de blesser sans servir.
   */
  private trouverLevier(
    scores: Record<string, number>,
    brutes: { titre: string; jours: Set<string> }[],
    maintenant: number,
  ): LienHabitudeScore | null {
    // Les journées actives de la fenêtre, avec leur score.
    const journees: { cle: string; score: number }[] = [];
    for (let i = 1; i <= AnalyseHabitudesService.FENETRE_JOURS; i++) {
      const cle = AnalyseHabitudesService.cleJour(i, maintenant);
      const v = scores[cle];
      if (typeof v === 'number' && v > 0) journees.push({ cle, score: v });
    }

    let meilleur: LienHabitudeScore | null = null;

    for (const h of brutes) {
      const avec = journees.filter((j) => h.jours.has(j.cle)).map((j) => j.score);
      const sans = journees.filter((j) => !h.jours.has(j.cle)).map((j) => j.score);

      if (
        avec.length < AnalyseHabitudesService.JOURS_MINIMUM_PAR_COTE ||
        sans.length < AnalyseHabitudesService.JOURS_MINIMUM_PAR_COTE
      ) {
        continue;
      }

      const scoreAvec = AnalyseHabitudesService.moyenne(avec);
      const scoreSans = AnalyseHabitudesService.moyenne(sans);
      const ecart = scoreAvec - scoreSans;

      if (ecart < AnalyseHabitudesService.ECART_MINIMUM) continue;
      if (meilleur && ecart <= meilleur.ecart) continue;

      meilleur = {
        titre: h.titre,
        scoreAvec,
        scoreSans,
        ecart,
        joursAvec: avec.length,
        joursSans: sans.length,
      };
    }

    return meilleur;
  }
}
