import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Les rappels que le coach promet — et qui doivent vraiment arriver.
 *
 * Constaté sur un vrai utilisateur le 18 août 2026 : il écrit « commence le 1er
 * rappel pour 22h30 », le coach répond « Rappel : 22 h 30 — commence la première
 * tâche », et **rien n'existe derrière**. Pas de table, pas de tâche planifiée,
 * pas de notification. La promesse était parfaitement crédible et entièrement
 * fausse, et c'est la personne qui devait la découvrir à 22 h 30, en ne recevant
 * rien.
 *
 * C'est la pire forme de la panne muette que ce projet paie régulièrement : ici
 * elle ne se voit ni dans les journaux, ni dans les tests, ni à l'écran — elle ne
 * se voit que dans le silence d'un téléphone, chez quelqu'un qui comptait dessus.
 *
 * **La règle qui tient ce fichier : un rappel n'est confirmé que s'il est écrit
 * en base.** Le modèle ne décide pas seul qu'il a posé un rappel ; il émet un
 * marqueur, ce service le transforme en ligne, et c'est cette ligne — jamais la
 * phrase du coach — qui fait foi. Quand l'écriture échoue, la confirmation est
 * retirée de la réponse : mieux vaut un coach qui n'a pas compris qu'un coach qui
 * ment.
 */

/** Un rappel demandé par le modèle, avant écriture. */
export interface RappelDemande {
  quand: Date;
  texte: string;
}

@Injectable()
export class RappelService {
  private readonly logger = new Logger(RappelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le marqueur que le modèle émet pour poser un rappel.
   *
   * Volontairement plus simple que le bloc `<PLAN>` : deux informations, dont une
   * date. Le JSON s'y prêterait mal — c'est le premier format que les petits
   * modèles abîment, et il n'y a rien ici qui justifie de courir ce risque.
   *
   * L'heure est acceptée avec ou sans secondes, et avec ou sans fuseau : la
   * consigne demande l'heure de Paris, et `depuisParis` la convertit. Un modèle
   * qui ajoute un « Z » de son propre chef serait sinon décalé de deux heures en
   * été, silencieusement.
   */
  static readonly MARQUEUR =
    /<RAPPEL\s+(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?\s*>([\s\S]{1,300}?)<\/RAPPEL>/gi;

  /**
   * Le marqueur d annulation : le numero affiche au modele, pas un identifiant.
   *
   * Le contexte lui liste ses rappels numerotes [1], [2]... Lui faire recopier un
   * UUID reviendrait a parier sur trente-six caracteres recopies sans faute par un
   * modele — et une seule lettre fausse annulerait un rappel qui n existe pas, en
   * silence, pendant qu il confirme.
   */
  static readonly MARQUEUR_ANNULE = /<ANNULE_RAPPEL\s+(\d{1,2})\s*>/gi;

  /** Au-delà, on ne demande plus un rappel, on prend un rendez-vous. */
  private static readonly HORIZON_JOURS = 30;

  /** Un même échange ne pose pas dix rappels : c'est une conversation, pas un agenda. */
  private static readonly MAX_PAR_MESSAGE = 3;

  /**
   * Sépare la réponse du coach de ses marqueurs de rappel.
   *
   * Le texte rendu est **toujours** débarrassé des marqueurs, même quand
   * l'écriture échoue ensuite : un marqueur affiché tel quel dans la
   * conversation est la seule chose pire qu'un rappel manquant.
   */
  static extraire(reponse: string, maintenant = new Date()): { texte: string; rappels: RappelDemande[] } {
    const rappels: RappelDemande[] = [];

    const texte = reponse
      .replace(RappelService.MARQUEUR, (_tout, jour: string, hh: string, mm: string, contenu: string) => {
        if (rappels.length >= RappelService.MAX_PAR_MESSAGE) return '';

        const quand = RappelService.depuisParis(jour, Number(hh), Number(mm));
        const propre = contenu.trim().replace(/\s+/g, ' ').slice(0, 200);

        // Un rappel dans le passé n'arrivera jamais, et un rappel dans six mois
        // n'a pas été demandé par quelqu'un qui parle de sa soirée. Dans les deux
        // cas on laisse tomber la ligne plutôt que d'écrire une promesse morte.
        const dansLHorizon =
          quand.getTime() > maintenant.getTime() &&
          quand.getTime() < maintenant.getTime() + RappelService.HORIZON_JOURS * 86400000;

        if (propre && dansLHorizon) rappels.push({ quand, texte: propre });
        return '';
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { texte, rappels };
  }

  /**
   * Sort les numeros de rappel que le coach veut annuler, et nettoie le texte.
   *
   * Le coach savait poser un rappel et pas en retirer un : a « annule celui de
   * 22 h 30 » il repondait « c est annule » et le rappel sonnait quand meme. Plus
   * grave que la panne d origine — la personne avait alors une raison de croire
   * que c etait regle, et le telephone la contredisait.
   */
  static extraireAnnulations(reponse: string): { texte: string; numeros: number[] } {
    const numeros: number[] = [];

    const texte = reponse
      .replace(RappelService.MARQUEUR_ANNULE, (_tout, n: string) => {
        const num = Number(n);
        if (num >= 1 && !numeros.includes(num)) numeros.push(num);
        return '';
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { texte, numeros };
  }

  /**
   * Annule par le numero affiche au modele, et rend ce qui a vraiment ete annule.
   *
   * La liste est relue ici plutot que passee depuis le contexte : entre le moment
   * ou le contexte a ete construit et celui ou la reponse arrive, un rappel a pu
   * partir. Annuler d apres une liste perimee retirerait le mauvais.
   */
  async annulerParNumero(userId: string, numeros: number[]): Promise<string[]> {
    if (!numeros.length) return [];

    const liste = await this.aVenir(userId);
    const annules: string[] = [];

    for (const n of numeros) {
      const cible = liste[n - 1];
      if (!cible) continue;
      if (await this.annuler(userId, cible.id)) annules.push(cible.texte);
    }

    return annules;
  }

  /**
   * Convertit une heure de Paris en instant absolu.
   *
   * `new Date('2026-08-18T22:30')` est interprété dans le fuseau du serveur — or
   * Render tourne en UTC. Un rappel demandé pour 22 h 30 serait donc parti à
   * minuit trente en été, et personne n'aurait su pourquoi. On calcule le décalage
   * réel de Paris à cette date, ce qui traite aussi le changement d'heure.
   */
  static depuisParis(jour: string, heures: number, minutes: number): Date {
    const naif = Date.UTC(
      Number(jour.slice(0, 4)),
      Number(jour.slice(5, 7)) - 1,
      Number(jour.slice(8, 10)),
      heures,
      minutes,
    );

    // Le décalage se mesure sur la date visée, pas sur aujourd'hui : un rappel
    // posé fin octobre pour début novembre change de fuseau en route.
    const sonde = new Date(naif);
    const aParis = new Date(sonde.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const aUtc = new Date(sonde.toLocaleString('en-US', { timeZone: 'UTC' }));
    const decalage = aParis.getTime() - aUtc.getTime();

    return new Date(naif - decalage);
  }

  /**
   * Écrit les rappels demandés, et rend ceux qui existent vraiment.
   *
   * C'est cette liste — jamais la phrase du modèle — qui autorise à confirmer
   * quoi que ce soit à la personne.
   */
  async poser(userId: string, demandes: RappelDemande[]): Promise<RappelDemande[]> {
    const poses: RappelDemande[] = [];

    for (const d of demandes) {
      try {
        await this.prisma.rappel.create({
          data: { user_id: userId, texte: d.texte, quand: d.quand },
        });
        poses.push(d);
      } catch (e: any) {
        // On ne confirme pas ce qu'on n'a pas écrit. La réponse du coach sera
        // amputée de sa confirmation plus haut, ce qui est le comportement voulu.
        this.logger.error(`Rappel non écrit pour ${userId} : ${e?.message}`);
      }
    }

    return poses;
  }

  /** Les rappels à venir d'une personne, le plus proche d'abord. */
  async aVenir(userId: string) {
    return this.prisma.rappel.findMany({
      where: { user_id: userId, envoye_le: null, annule_le: null, quand: { gte: new Date() } },
      orderBy: { quand: 'asc' },
      take: 20,
      select: { id: true, texte: true, quand: true },
    });
  }

  /** Annule un rappel. Rend `false` s'il n'appartient pas à cette personne. */
  async annuler(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.rappel.updateMany({
      where: { id, user_id: userId, annule_le: null },
      data: { annule_le: new Date() },
    });
    return count > 0;
  }

  /**
   * Les rappels dus, pour la tournée d'envoi.
   *
   * **Le retard est borné.** Un rappel de 22 h 30 délivré à 9 h le lendemain ne
   * rend pas service : il réveille une intention morte et apprend surtout que
   * l'application n'est pas à l'heure. Passé la fenêtre, la ligne est marquée
   * comme traitée sans être envoyée — voir `abandonner`.
   */
  private static readonly RETARD_MAX_MS = 2 * 3600 * 1000;

  async dus(maintenant = new Date()) {
    return this.prisma.rappel.findMany({
      where: {
        envoye_le: null,
        annule_le: null,
        quand: { lte: maintenant, gte: new Date(maintenant.getTime() - RappelService.RETARD_MAX_MS) },
      },
      orderBy: { quand: 'asc' },
      take: 200,
      select: { id: true, user_id: true, texte: true, quand: true },
    });
  }

  /** Marque un rappel comme parti. Appelé **après** l'envoi, jamais avant. */
  async marquerEnvoye(id: string): Promise<void> {
    await this.prisma.rappel
      .update({ where: { id }, data: { envoye_le: new Date() } })
      .catch((e) => this.logger.error(`Rappel ${id} envoyé mais non marqué : ${e?.message}`));
  }

  /**
   * Ferme les rappels trop en retard pour servir.
   *
   * Sans ça ils restent éligibles pour toujours : la requête les écarte par sa
   * borne basse, mais ils traînent en base et repasseraient au premier
   * élargissement de la fenêtre — un rappel de la semaine dernière qui sonne un
   * mardi matin, sans que rien n'explique pourquoi.
   */
  async abandonnerLesPerimes(maintenant = new Date()): Promise<number> {
    const { count } = await this.prisma.rappel.updateMany({
      where: {
        envoye_le: null,
        annule_le: null,
        quand: { lt: new Date(maintenant.getTime() - RappelService.RETARD_MAX_MS) },
      },
      data: { annule_le: maintenant },
    });
    if (count > 0) this.logger.warn(`${count} rappel(s) abandonné(s) : trop en retard pour servir.`);
    return count;
  }
}
