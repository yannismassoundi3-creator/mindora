import { Injectable } from '@nestjs/common';

/**
 * Ce que le coach a remarqué sur quelqu'un.
 *
 * C'est la seule chose que cette application peut dire et qu'aucune autre ne
 * peut : elle a l'historique jour par jour, et un coach qui parle. Toutes les
 * applications d'habitudes affichent « 71 % de complétion » ; aucune ne dit « tu
 * tiens la semaine et tu lâches le samedi, trois fois de suite ». Le premier est
 * une statistique, le second est quelqu'un qui vous suit — et c'est pour le
 * second qu'on paie.
 *
 * **Le motif est trouvé par le code, jamais par le modèle.** C'est la règle qui
 * tient tout le fichier. Un modèle à qui l'on donne un historique et à qui l'on
 * demande « que remarques-tu ? » trouvera toujours quelque chose, y compris dans
 * du bruit, et le dira avec le même aplomb que s'il avait raison. Ici chaque
 * observation est calculée, comptée, et ne sort qu'au-dessus d'un seuil. Le modèle
 * ne sert qu'à la formuler, plus tard et ailleurs.
 *
 * Deuxième règle, du même ordre : **sur peu de jours, tout ressemble à un motif.**
 * Trois samedis ratés sur trois samedis observés, ce n'est pas une habitude, c'est
 * trois samedis. Chaque détection exige donc un nombre minimum d'occurrences et un
 * écart minimum — et le silence est la réponse par défaut.
 */

/** Ce qui déclenche une observation, une fois les seuils franchis. */
export type CodeObservation =
  | 'jourFaible'
  | 'weekend'
  | 'progression'
  | 'rechute'
  | 'record'
  | 'regularite';

export interface Observation {
  code: CodeObservation;
  /** Titre court, pour une bannière. */
  titre: string;
  /**
   * Le fait, écrit en code à partir des chiffres. Il doit rester vrai sorti de
   * son contexte : c'est lui qu'on montre, et c'est lui que le modèle recevra.
   */
  fait: string;
  /**
   * Ce que le coach propose d'explorer. Envoyé tel quel dans la conversation si
   * la personne appuie — d'où la première personne : c'est elle qui le dit.
   */
  invite: string;
  /**
   * Force du signal, pour départager. Ce n'est pas une probabilité : juste un
   * ordre de priorité entre observations toutes déjà jugées solides.
   */
  force: number;
}

const NOMS_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

@Injectable()
export class ObservationService {
  /** En deçà, il n'y a pas d'historique : il y a des débuts. */
  private static readonly JOURS_MINIMUM = 12;

  /** Un compte qui n'a agi que deux fois n'a pas de motif, il a deux points. */
  private static readonly ACTIFS_MINIMUM = 5;

  /** Fenêtre d'observation. Au-delà, on décrit quelqu'un qui n'existe plus. */
  private static readonly FENETRE_JOURS = 28;

  /** Il faut avoir vu le même jour de la semaine au moins trois fois pour en parler. */
  private static readonly OCCURRENCES_MINIMUM = 3;

  /**
   * Écart minimum, en points de score, pour qu'une différence soit dite.
   *
   * Vingt points sur cent. En dessous, on décrit du bruit avec des mots de
   * certitude — la façon la plus rapide d'apprendre à quelqu'un qu'on devine.
   */
  private static readonly ECART_MINIMUM = 20;

  /** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
  private static cle(recul: number, depuis = new Date()): string {
    const d = new Date(depuis);
    d.setUTCDate(d.getUTCDate() - recul);
    return d.toISOString().slice(0, 10);
  }

  /** Le jour de la semaine d'une clé, à midi UTC pour ne pas basculer d'un jour. */
  private static jourSemaine(cle: string): number {
    return new Date(cle + 'T12:00:00Z').getUTCDay();
  }

  /**
   * Les jours de la fenêtre, avec leur score, du plus ancien au plus récent.
   *
   * Une clé absente vaut zéro et non « pas de donnée » : ne pas avoir ouvert
   * l'application un jour est précisément l'information qu'on cherche. Mais on ne
   * remonte pas avant le premier jour connu — compter des zéros avant
   * l'inscription ferait passer tout nouveau venu pour quelqu'un qui décroche.
   */
  private static serie(dailyScores: Record<string, number>, maintenant = new Date()) {
    const cles = Object.keys(dailyScores).filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c));
    if (cles.length === 0) return [];
    const premier = cles.sort()[0];

    const jours: { cle: string; score: number }[] = [];
    for (let recul = ObservationService.FENETRE_JOURS - 1; recul >= 0; recul--) {
      const cle = ObservationService.cle(recul, maintenant);
      if (cle < premier) continue;
      jours.push({ cle, score: dailyScores[cle] || 0 });
    }
    return jours;
  }

  /**
   * Toutes les observations qui tiennent, la plus forte en tête.
   *
   * Rend un tableau vide quand il n'y a rien de solide à dire, ce qui est le cas
   * le plus fréquent et doit le rester : une observation servie chaque jour cesse
   * d'être une observation.
   */
  observations(
    dailyScores: Record<string, number> | null | undefined,
    maintenant = new Date(),
  ): Observation[] {
    if (!dailyScores) return [];
    const jours = ObservationService.serie(dailyScores, maintenant);
    if (jours.length < ObservationService.JOURS_MINIMUM) return [];

    const actifs = jours.filter((j) => j.score > 0);
    if (actifs.length < ObservationService.ACTIFS_MINIMUM) return [];

    const trouvees = [
      this.jourFaible(jours),
      this.weekend(jours),
      this.progression(jours),
      this.rechute(jours),
      this.record(jours),
      this.regularite(jours),
    ].filter((o): o is Observation => o !== null);

    return trouvees.sort((a, b) => b.force - a.force);
  }

  /** La meilleure observation du moment, ou `null`. */
  meilleure(
    dailyScores: Record<string, number> | null | undefined,
    maintenant = new Date(),
  ): Observation | null {
    return this.observations(dailyScores, maintenant)[0] ?? null;
  }

  /**
   * Le jour de la semaine qui tombe systématiquement.
   *
   * C'est l'observation la plus utile du lot, parce qu'elle est actionnable : on
   * ne corrige pas « un manque de motivation », on corrige un samedi.
   */
  private jourFaible(jours: { cle: string; score: number }[]): Observation | null {
    const parJour = new Map<number, number[]>();
    for (const j of jours) {
      const n = ObservationService.jourSemaine(j.cle);
      parJour.set(n, [...(parJour.get(n) ?? []), j.score]);
    }

    let pire: { jour: number; scores: number[]; moyenne: number } | null = null;
    for (const [jour, scores] of parJour) {
      if (scores.length < ObservationService.OCCURRENCES_MINIMUM) continue;
      const moyenne = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (!pire || moyenne < pire.moyenne) pire = { jour, scores, moyenne };
    }
    if (!pire) return null;

    // Comparé aux autres jours, pas à zéro : quelqu'un de régulièrement moyen n'a
    // pas de jour faible, il a un niveau.
    const autres = jours.filter((j) => ObservationService.jourSemaine(j.cle) !== pire!.jour);
    if (autres.length < ObservationService.OCCURRENCES_MINIMUM) return null;
    const moyenneAutres = autres.reduce((a, b) => a + b.score, 0) / autres.length;

    if (moyenneAutres - pire.moyenne < ObservationService.ECART_MINIMUM) return null;

    /*
      Une moyenne ne suffit pas : un seul samedi à zéro sur trois suffit à la faire
      tomber de vingt-sept points, et « tes samedis tournent à 53 % » serait alors
      exact et complètement trompeur — il n'y a pas de motif, il y a un mauvais
      samedi. On exige donc que la plupart des occurrences soient elles-mêmes
      basses. C'est la différence entre décrire quelqu'un et décrire un accident.
    */
    const seuilBas = moyenneAutres - ObservationService.ECART_MINIMUM;
    const basses = pire.scores.filter((s) => s <= seuilBas).length;
    if (basses < Math.ceil((pire.scores.length * 2) / 3)) return null;

    const rates = pire.scores.filter((s) => s === 0).length;
    const vus = pire.scores.length;

    const nom = NOMS_JOURS[pire.jour];
    return {
      code: 'jourFaible',
      titre: `Le ${nom} te coûte`,
      fait:
        rates >= 2
          ? `Sur ${vus} ${nom}s observés, ${rates} sont à zéro. Les autres jours, tu es à ${Math.round(moyenneAutres)} %.`
          : `Tes ${nom}s tournent à ${Math.round(pire.moyenne)} %, contre ${Math.round(moyenneAutres)} % le reste de la semaine.`,
      invite: `Mes ${nom}s sont mon point faible. Aide-moi à changer ça.`,
      // La plus forte du lot : c'est celle qui désigne une cause plutôt qu'un état.
      force: 100 + (moyenneAutres - pire.moyenne),
    };
  }

  /** Le décrochage du week-end, quand il ne se réduit pas à un seul jour. */
  private weekend(jours: { cle: string; score: number }[]): Observation | null {
    const estWeekend = (c: string) => [0, 6].includes(ObservationService.jourSemaine(c));
    const we = jours.filter((j) => estWeekend(j.cle));
    const semaine = jours.filter((j) => !estWeekend(j.cle));

    if (we.length < 4 || semaine.length < ObservationService.OCCURRENCES_MINIMUM) return null;

    const moyWe = we.reduce((a, b) => a + b.score, 0) / we.length;
    const moySemaine = semaine.reduce((a, b) => a + b.score, 0) / semaine.length;
    if (moySemaine - moyWe < ObservationService.ECART_MINIMUM) return null;

    return {
      code: 'weekend',
      titre: 'Le week-end casse ta série',
      fait: `En semaine tu tiens ${Math.round(moySemaine)} %. Le week-end, ${Math.round(moyWe)} %.`,
      invite: "Je décroche le week-end. Qu'est-ce que je peux mettre en place ?",
      force: 80 + (moySemaine - moyWe),
    };
  }

  /** Sept jours contre les sept précédents. La seule mesure qui dit un sens. */
  private progression(jours: { cle: string; score: number }[]): Observation | null {
    if (jours.length < 14) return null;
    const recents = jours.slice(-7);
    const avant = jours.slice(-14, -7);

    const moyRecents = recents.reduce((a, b) => a + b.score, 0) / 7;
    const moyAvant = avant.reduce((a, b) => a + b.score, 0) / 7;
    const ecart = moyRecents - moyAvant;
    if (ecart < ObservationService.ECART_MINIMUM) return null;

    return {
      code: 'progression',
      titre: 'Tu montes',
      fait: `Cette semaine tu es à ${Math.round(moyRecents)} %, contre ${Math.round(moyAvant)} % la semaine d'avant.`,
      invite: 'Je progresse en ce moment. Comment je fais pour que ça tienne ?',
      force: 70 + ecart,
    };
  }

  /** L'inverse, qui compte davantage : une chute se dit avant qu'elle s'installe. */
  private rechute(jours: { cle: string; score: number }[]): Observation | null {
    if (jours.length < 14) return null;
    const recents = jours.slice(-7);
    const avant = jours.slice(-14, -7);

    const moyRecents = recents.reduce((a, b) => a + b.score, 0) / 7;
    const moyAvant = avant.reduce((a, b) => a + b.score, 0) / 7;
    const ecart = moyAvant - moyRecents;
    if (ecart < ObservationService.ECART_MINIMUM) return null;

    return {
      code: 'rechute',
      titre: 'Tu ralentis',
      fait: `Tu es passé de ${Math.round(moyAvant)} % la semaine dernière à ${Math.round(moyRecents)} % cette semaine.`,
      invite: "J'ai ralenti cette semaine. Aide-moi à repartir.",
      // Au-dessus de la progression : une chute qu'on nomme tôt se rattrape,
      // une chute qu'on laisse courir devient un désabonnement.
      force: 90 + ecart,
    };
  }

  /** Le record, et où l'on en est par rapport à lui. */
  private record(jours: { cle: string; score: number }[]): Observation | null {
    let record = 0;
    let courante = 0;
    for (const j of jours) {
      if (j.score > 0) {
        courante++;
        record = Math.max(record, courante);
      } else {
        courante = 0;
      }
    }

    // Une série record de deux jours ne mérite pas d'être nommée, et une série en
    // cours qui égale le record n'est pas encore une comparaison.
    if (record < 4) return null;
    if (courante >= record) {
      return {
        code: 'record',
        titre: 'Ton record, maintenant',
        fait: `Tu es à ${courante} jours d'affilée : c'est ta plus longue série.`,
        invite: 'Je suis sur ma meilleure série. Comment je ne la casse pas ?',
        force: 60 + courante,
      };
    }

    return {
      code: 'record',
      titre: `Ton record est de ${record} jours`,
      fait: `Ta plus longue série est de ${record} jours d'affilée. Là tu es à ${courante}.`,
      invite: `Mon record est de ${record} jours d'affilée. Je veux le battre.`,
      force: 50 + record,
    };
  }

  /** Le repli : combien de jours sur la fenêtre, sans chercher de motif. */
  private regularite(jours: { cle: string; score: number }[]): Observation | null {
    const actifs = jours.filter((j) => j.score > 0).length;
    const part = actifs / jours.length;

    // Ni très régulier ni très irrégulier : il n'y a rien à dire, et le dire
    // quand même produit exactement la platitude qu'on cherche à éviter.
    if (part >= 0.4 && part < 0.8) return null;

    if (part >= 0.8) {
      return {
        code: 'regularite',
        titre: 'Tu es là presque tous les jours',
        fait: `${actifs} jours actifs sur les ${jours.length} derniers.`,
        invite: 'Je suis régulier. Je veux passer au niveau au-dessus.',
        force: 40,
      };
    }

    return {
      code: 'regularite',
      titre: 'Tu viens par à-coups',
      fait: `${actifs} jours actifs sur les ${jours.length} derniers.`,
      invite: "Je n'arrive pas à être régulier. Par quoi je commence ?",
      force: 45,
    };
  }
}
