import { Injectable, Logger } from '@nestjs/common';
import { lireReponseGroq } from '../common/groq';
import { chaineCourte, appelerMaillon, MaillonCourt } from '../common/chaine-courte';
import { objectifsDeLaSemaine, tachesDuJour } from './taches';
import { JETONS_TEXTE_COURT, MODELES_COURTS } from '../common/modeles';

/**
 * Le coup de pouce : un message du coach en pleine journée, quand il a quelque
 * chose à dire.
 *
 * Cinq notifications partent déjà — 10 h, 18 h, 20 h, 22 h, et le bilan du
 * dimanche. En ajouter une sixième à heure fixe reviendrait à faire couper les
 * notifications, ce qui est le seul dommage irréversible dans cette affaire : un
 * refus navigateur ne se redemande pas. Ce qui manque n'est donc pas une
 * notification de plus, c'est une notification qu'on n'attend pas.
 *
 * D'où les deux règles qui définissent ce service, et qui comptent plus que le
 * texte qu'il produit :
 *
 * 1. Rare. Au plus un coup de pouce tous les trois jours par personne. Une
 *    relance quotidienne devient un bruit de fond au bout d'une semaine — c'est
 *    exactement ce qui est arrivé au check-in de 18 h, identique pour tout le
 *    monde tous les soirs.
 * 2. Seulement s'il y a un fait à citer. Trois situations, pas une de plus :
 *    quelqu'un s'est arrêté après avoir tenu, quelqu'un a des tâches devant lui
 *    et n'a rien coché, quelqu'un tient une série et peut la prolonger. Hors de
 *    ces cas, on n'envoie rien — un encouragement sans fait est un spam poli.
 *
 * Le texte est écrit par l'IA à partir des données réelles, avec les mêmes
 * garde-fous que le brief du matin : interdiction d'inventer une tâche,
 * interdiction de réclamer ce qui est déjà coché. Si l'IA ne répond pas, on
 * retombe sur une phrase factuelle construite à partir des mêmes données — jamais
 * sur un slogan.
 */

/** Ce qui justifie qu'on écrive à quelqu'un aujourd'hui. */
export type Raison = 'reprise' | 'aFinir' | 'serie';

export interface Situation {
  raison: Raison;
  /** Jours consécutifs terminés par une action, en repartant d'hier. */
  serie: number;
  /** Jours écoulés depuis la dernière journée avec au moins une action. */
  joursSansRien: number;
  /** Titres des tâches encore à faire aujourd'hui, tels que la personne les a écrits. */
  restantes: string[];
  /** Titres déjà cochés aujourd'hui. */
  faites: string[];
}

export interface EtatCompte {
  dailyScores: Record<string, number> | null | undefined;
  routines: unknown;
  /**
   * Le jour auquel se rapportent les coches des routines (`last_routine_date`).
   * Obligatoire, et non optionnel : un appelant qui l'oublie doit s'en apercevoir à
   * la compilation, pas six mois plus tard sur le téléphone de quelqu'un. Voir
   * `cochesDuJour` dans `taches.ts`.
   */
  jourDesRoutines: string | null | undefined;
  objectifs: unknown;
  /** Dernier coup de pouce envoyé à cette personne, s'il y en a eu un. */
  dernierCoupDePouce: Date | null;
  /** Dernière synchronisation : la trace qu'un compte est encore vivant. */
  derniereSynchro: Date | null;
}

@Injectable()
export class CoupDePouceService {
  private readonly logger = new Logger(CoupDePouceService.name);

  /** Au plus un coup de pouce tous les trois jours. C'est la règle qui le rend supportable. */
  static readonly DELAI_MINIMUM_JOURS = 3;

  /**
   * Au-delà, le compte est parti pour de bon : une notification ne le ramènera
   * pas, et générer son texte coûte un appel IA. La reprise vise les gens qui
   * viennent de décrocher, pas ceux qui sont partis le mois dernier.
   */
  static readonly ABSENCE_MAXIMALE_JOURS = 10;

  /** En dessous, s'arrêter un jour n'est pas encore un décrochage. */
  private static readonly ABSENCE_MINIMALE_JOURS = 2;

  /** Une série en dessous de ce seuil ne vaut pas la peine d'être défendue à voix haute. */
  private static readonly SERIE_NOTABLE = 3;

  private static readonly MODELES = MODELES_COURTS;
  private static readonly TIMEOUT_MS = 8000;
  private static readonly PLAFOND_CARACTERES = 160;

  /** La clé de jour telle que le client l'écrit : `YYYY-MM-DD` en UTC. */
  private static cleJour(recul = 0): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - recul);
    return d.toISOString().slice(0, 10);
  }

  /** Jours consécutifs terminés par au moins une action, en repartant d'hier. */
  static serie(dailyScores: Record<string, number> | null | undefined): number {
    if (!dailyScores) return 0;
    let serie = 0;
    for (let i = 1; i <= 60; i++) {
      if ((dailyScores[CoupDePouceService.cleJour(i)] || 0) > 0) serie++;
      else break;
    }
    return serie;
  }

  /**
   * Jours écoulés depuis la dernière journée active. 0 si la personne a déjà agi
   * aujourd'hui.
   */
  static joursSansRien(dailyScores: Record<string, number> | null | undefined): number {
    if (!dailyScores) return Infinity;
    for (let i = 0; i <= 60; i++) {
      if ((dailyScores[CoupDePouceService.cleJour(i)] || 0) > 0) return i;
    }
    return Infinity;
  }

  /**
   * Y a-t-il quelque chose à dire à cette personne aujourd'hui ?
   *
   * Retourne `null` quand la réponse est non — et c'est le cas le plus fréquent,
   * volontairement. Un service de relance qui trouve toujours une raison d'écrire
   * n'est pas un coach, c'est une liste de diffusion.
   */
  situation(etat: EtatCompte, maintenant: Date = new Date()): Situation | null {
    // La cadence d'abord : elle prime sur tout le reste. Même une série en danger
    // ne justifie pas deux notifications hors programme dans la même semaine.
    if (etat.dernierCoupDePouce) {
      const ecoule = maintenant.getTime() - etat.dernierCoupDePouce.getTime();
      if (ecoule < CoupDePouceService.DELAI_MINIMUM_JOURS * 86400000) return null;
    }

    const serie = CoupDePouceService.serie(etat.dailyScores);
    const joursSansRien = CoupDePouceService.joursSansRien(etat.dailyScores);
    // Chaque liste est lue à sa propre échéance : les routines au jour (récurrence
    // comprise — une tâche du mardi n'est pas sur l'écran d'un dimanche), les
    // objectifs à la semaine. Voir `taches.ts`.
    const routines = tachesDuJour(
      { routines: etat.routines, last_routine_date: etat.jourDesRoutines },
      maintenant,
    );
    const objectifs = objectifsDeLaSemaine(etat.objectifs, maintenant);
    const restantes = [...routines.restantes, ...objectifs.restantes];
    const faites = routines.faites;

    const base = { serie, joursSansRien, restantes, faites };

    /*
      Le compte est dormant : plus rien ne part, quel que soit ce qu'il reste dans
      ses listes.

      Ce garde doit venir AVANT les trois situations, et non se contenter de borner
      la reprise. Sans lui, quelqu'un parti depuis un mois retombait sur « des
      tâches en attente, rien de coché » — évidemment vrai pour un compte
      abandonné — et recevait une relance tous les trois jours pour toujours. Une
      notification ne ramène pas quelqu'un parti depuis des semaines ; elle lui
      rappelle seulement de désinstaller.

      `Infinity` (aucune activité de toute l'histoire du compte) tombe ici aussi :
      le brief du matin et le check-in de 18 h parlent déjà aux nouveaux venus.
    */
    if (joursSansRien > CoupDePouceService.ABSENCE_MAXIMALE_JOURS) return null;

    /*
      Quelqu'un qui s'est arrêté après avoir tenu. C'est la seule situation où une
      notification a une chance de changer quelque chose : la personne connaît
      l'app, elle y a mis du sien, et elle vient de décrocher.
    */
    if (joursSansRien >= CoupDePouceService.ABSENCE_MINIMALE_JOURS) {
      return { ...base, raison: 'reprise' };
    }

    // Journée déjà active : il n'y a rien à relancer, la personne est dans l'app.
    if (joursSansRien === 0 && faites.length > 0 && restantes.length === 0) return null;

    /*
      Des tâches devant soi, rien de coché. Le seul cas où citer une tâche précise
      sert : elle existe, elle est de la personne, et elle n'est pas faite.
    */
    if (restantes.length > 0 && faites.length === 0 && joursSansRien !== 0) {
      return { ...base, raison: 'aFinir' };
    }

    // Une série qui tient et une journée entamée : on la nomme, c'est ce qui la
    // rend coûteuse à briser. Sous trois jours, ça ne veut encore rien dire.
    if (serie >= CoupDePouceService.SERIE_NOTABLE && restantes.length > 0) {
      return { ...base, raison: 'serie' };
    }

    // Rien de tangible à dire. On se tait — c'est une décision, pas un oubli.
    return null;
  }

  /**
   * La phrase de repli, quand l'IA ne répond pas.
   *
   * Factuelle et construite sur les mêmes données : une notification banale vaut
   * mieux qu'aucune notification, mais un slogan vaut moins que rien. « Tu vas y
   * arriver ! » envoyé à quelqu'un qui a décroché depuis trois jours ne fait
   * qu'annoncer que personne ne regarde.
   */
  texteFactuel(prenom: string, situation: Situation): string {
    const nom = prenom?.trim() || '';
    const premiere = situation.restantes[0];

    if (situation.raison === 'reprise') {
      const jours = situation.joursSansRien;
      return situation.serie > 0
        ? `${jours} jours sans rien cocher, après ${situation.serie} jours d'affilée. Reprends sur une seule tâche.`
        : `${jours} jours sans rien cocher. Une seule tâche aujourd'hui suffit à repartir.`;
    }

    if (situation.raison === 'serie') {
      return premiere
        ? `${situation.serie} jours d'affilée. Il te reste « ${premiere} » pour tenir la série.`
        : `${situation.serie} jours d'affilée. Ne casse pas ça aujourd'hui.`;
    }

    return premiere
      ? `${nom ? nom + ', il' : 'Il'} te reste « ${premiere} ». Commence par celle-là.`
      : `Rien de coché aujourd'hui. Ouvre l'app et choisis une seule chose à faire.`;
  }

  /** Le titre de la notification. Il dit la situation, pas une interjection. */
  titre(situation: Situation): string {
    if (situation.raison === 'reprise') return '👋 Ton coach';
    if (situation.raison === 'serie') return `🔥 ${situation.serie} jours d'affilée`;
    return '💬 Un mot de ton coach';
  }

  /**
   * L'angle imposé au modèle. Sans consigne serrée, il écrit la même phrase
   * d'encouragement pour les trois situations, et le coup de pouce redevient le
   * bruit de fond qu'on cherchait à éviter.
   */
  private angle(situation: Situation): string {
    if (situation.raison === 'reprise') {
      return situation.serie > 0
        ? `Il s'est arrêté depuis ${situation.joursSansRien} jours après ${situation.serie} jours d'affilée. Constate-le sans reproche, et propose de reprendre par UNE seule tâche facile.`
        : `Il s'est arrêté depuis ${situation.joursSansRien} jours. Constate-le sans reproche et propose de reprendre par UNE seule chose.`;
    }
    if (situation.raison === 'serie') {
      return `Il tient ${situation.serie} jours d'affilée. Nomme cette série, et relie-la à une tâche précise encore à faire aujourd'hui.`;
    }
    return `Sa journée n'est pas entamée. Cite UNE tâche précise encore à faire et rends-la facile à commencer tout de suite.`;
  }

  construireInvite(prenom: string, situation: Situation): string {
    return [
      `Prénom : ${prenom || 'champion'}`,
      `Série en cours : ${situation.serie} jour(s) d'affilée`,
      situation.joursSansRien > 0
        ? `Dernière action : il y a ${situation.joursSansRien} jour(s)`
        : `Il a déjà agi aujourd'hui`,
      situation.faites.length
        ? `DÉJÀ FAIT aujourd'hui (ne le redemande jamais) : ${situation.faites.join(', ')}`
        : '',
      situation.restantes.length
        ? `RESTE À FAIRE : ${situation.restantes.slice(0, 3).join(', ')}`
        : `Aucune tâche planifiée`,
      '',
      `Angle imposé : ${this.angle(situation)}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Retourne null si l'IA n'est pas disponible : l'appelant écrira la phrase factuelle. */
  async generer(prenom: string, situation: Situation): Promise<string | null> {
    const chaine = chaineCourte(process.env.GROQ_API_KEY);
    if (chaine.length === 0) return null;

    const systeme = [
      "Tu es le coach personnel de l'utilisateur dans l'app Disciplix.",
      "Écris UNE notification courte, en français, tutoiement.",
      "Maximum 140 caractères, une à deux phrases. Pas de guillemets.",
      "Respecte l'angle imposé et appuie-toi uniquement sur les données ci-dessous.",
      "INTERDIT de réclamer une tâche listée comme DÉJÀ FAIT.",
      "INTERDIT d'inventer une tâche, une durée ou un chiffre absents des données : reprends leurs mots exacts.",
      "Ton direct, jamais mielleux ni culpabilisant : « Bravo », « tu vas y arriver », « courage » sans un fait pour les appuyer sont interdits.",
      "Ne commence pas par son prénom systématiquement : varie l'attaque.",
      "Un seul emoji maximum. Réponds uniquement par le texte de la notification.",
    ].join(' ');

    const invite = this.construireInvite(prenom, situation);

    for (const maillon of chaine) {
      const texte = await this.tenter(maillon, systeme, invite);
      if (!texte) continue;

      if (maillon.paye) {
        this.logger.warn(`[Secours] 💳 Coup de pouce écrit par ${maillon.modele} — la chaîne gratuite a refusé`);
      }
      return texte;
    }

    this.logger.warn("Aucun modèle n'a pu écrire le coup de pouce");
    return null;
  }

  /** Un appel, sur un modèle donné. Retourne null pour laisser sa chance au suivant. */
  private async tenter(maillon: MaillonCourt, systeme: string, invite: string): Promise<string | null> {
    const modele = maillon.modele;
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), CoupDePouceService.TIMEOUT_MS);

    try {
      const reponse = await appelerMaillon(
        maillon,
        {
          messages: [
            { role: 'system', content: systeme },
            { role: 'user', content: invite },
          ],
          temperature: 0.8,
          jetons: JETONS_TEXTE_COURT,
        },
        controleur.signal,
      );

      if (!reponse.ok) {
        this.logger.warn(`Groq a répondu ${reponse.status} sur ${modele} pour le coup de pouce`);
        return null;
      }

      const data = await reponse.json();
      const { texte, tronque } = lireReponseGroq(data);
      if (!texte) return null;

      const propre = texte.replace(/^["'«»\s]+|["'«»\s]+$/g, '');

      // Même arbitrage que pour le brief du matin : une phrase coupée au milieu
      // d'un mot part sur le téléphone de quelqu'un et ne se rattrape pas. En
      // deçà du plafond, on préfère la phrase factuelle, entière.
      if (tronque && propre.length <= CoupDePouceService.PLAFOND_CARACTERES) {
        this.logger.warn(`Coup de pouce coupé par max_tokens sur ${modele}`);
        return null;
      }

      return propre.length > CoupDePouceService.PLAFOND_CARACTERES
        ? propre.slice(0, CoupDePouceService.PLAFOND_CARACTERES - 3) + '…'
        : propre;
    } catch (e: any) {
      this.logger.warn(
        `Coup de pouce non généré sur ${modele} : ${e?.name === 'AbortError' ? 'délai dépassé' : e?.message}`,
      );
      return null;
    } finally {
      clearTimeout(minuteur);
    }
  }
}
