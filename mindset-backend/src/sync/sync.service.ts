import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SyncService {
  /**
   * Une personne réelle n'a pas des milliers de routines. Le client peut pourtant
   * envoyer ce qu'il veut, et chaque compte n'a qu'une ligne de synchro : sans
   * plafond, cette ligne grossit indéfiniment et alourdit la base pour tout le monde.
   */
  private static readonly MAX_ELEMENTS = 500;

  constructor(private readonly prisma: PrismaService) {}

  private borner(valeur: any) {
    return Array.isArray(valeur) ? valeur.slice(0, SyncService.MAX_ELEMENTS) : valeur;
  }

  /**
   * L'expérience cumulée, telle qu'on accepte de l'enregistrer.
   *
   * Comme le reste de l'économie de jeu, elle est tenue par le navigateur et donc
   * falsifiable — c'est assumé, elle n'ouvre aucun accès payant. On refuse
   * seulement ce qui casserait l'affichage : une valeur absente laisse la colonne
   * inchangée (un client d'une version antérieure ne doit pas effacer l'XP déjà
   * acquise), et une valeur illisible ou négative est ignorée.
   */
  private xpValide(valeur: any): number | undefined {
    if (typeof valeur !== 'number' || !Number.isFinite(valeur) || valeur < 0) return undefined;
    return Math.floor(valeur);
  }

  /**
   * La ligne telle qu'on la rend au client, jeton de version compris.
   *
   * `updated_at` porte ici la **version de l'état**, pas la date de dernière
   * écriture de la ligne. Ce n'est pas une coquetterie : le client renvoie ce
   * qu'on lui a donné, et il existe des navigateurs qui tournent encore sur un
   * ancien script — celui-ci lit `updated_at` et rien d'autre. Le corriger
   * seulement dans un nouveau champ aurait laissé ces appareils-là en conflit
   * permanent, c'est-à-dire précisément la panne qu'on répare.
   *
   * `etat_version` est rendu à côté, sous son vrai nom, pour que le client à jour
   * puisse s'y référer sans ambiguïté. Les deux valent la même chose.
   */
  private static avecJeton<T extends { updated_at: Date; etat_version: Date | null }>(ligne: T) {
    const jeton = ligne.etat_version ?? ligne.updated_at;
    return { ...ligne, updated_at: jeton, etat_version: jeton };
  }

  async getSyncData(userId: string) {
    let syncData = await this.prisma.syncData.findUnique({
      where: { user_id: userId }
    });

    if (!syncData) {
      syncData = await this.prisma.syncData.create({
        data: { user_id: userId }
      });
    }

    return SyncService.avecJeton(syncData);
  }

  /**
   * Refuse une écriture fondée sur un état que le serveur a déjà dépassé.
   *
   * La ligne de synchro est remplacée en bloc à chaque envoi : deux appareils qui
   * écrivent l'un après l'autre, et le second efface tout le travail du premier
   * sans que personne ne l'apprenne. C'était vrai avant même qu'on borne la
   * descente côté navigateur — la remontée automatique part à chaque écriture.
   *
   * `base_version` est l'horodatage que le client avait en main quand il a composé
   * son état. S'il ne correspond plus à celui de la ligne, quelqu'un d'autre est
   * passé entre-temps : on rend 409 plutôt que d'écraser, et c'est au client de
   * mettre sa copie de côté avant d'adopter la version du serveur.
   *
   * **Une absence de `base_version` reste acceptée.** C'est ce qu'envoient les
   * onglets encore ouverts sur l'ancienne version du code, et refuser leur travail
   * serait exactement le dégât qu'on cherche à éviter.
   */
  private async verifierVersion(userId: string, base: unknown) {
    if (typeof base !== 'string' || !base) return;

    const actuel = await this.prisma.syncData.findUnique({
      where: { user_id: userId },
      select: { etat_version: true },
    });
    if (!actuel) return;

    /*
      Aucune version d'état encore posée : cette ligne est antérieure à la colonne.
      On accepte sans comparer, exactement comme une `base_version` absente, et
      l'écriture qui suit posera le premier jeton. Une seule fois par compte.
    */
    if (!actuel.etat_version) return;

    if (actuel.etat_version.toISOString() !== base) {
      throw new ConflictException({
        code: 'SYNC_CONFLIT',
        message: 'Cet appareil travaillait sur une version qui n’est plus la plus récente.',
        version_serveur: actuel.etat_version.toISOString(),
      });
    }
  }

  async updateSyncData(userId: string, data: any) {
    await this.verifierVersion(userId, data?.base_version);

    const ligne = await this.prisma.syncData.upsert({
      where: { user_id: userId },
      update: {
        // Le jeton ne bouge que d'ici : c'est tout l'intérêt d'une colonne à part.
        etat_version: new Date(),
        routines: this.borner(data.routines),
        micro_objectives: this.borner(data.micro_objectives),
        macro_objectives: this.borner(data.macro_objectives),
        habits: this.borner(data.habits),
        nutrition: this.borner(data.nutrition),
        points: data.points,
        xp: this.xpValide(data.xp),
        mental_score: data.mental_score,
        bonus_score: data.bonus_score,
        daily_scores: this.borner(data.daily_scores),
        last_routine_date: data.last_routine_date,
        last_habit_date: data.last_habit_date,
        join_date: data.join_date,
        settings: data.settings,
        rewards: this.borner(data.rewards),
        inventory: this.borner(data.inventory),
        owned_cosmetics: this.borner(data.owned_cosmetics),
        ai_skin_id: data.ai_skin_id,
      },
      create: {
        user_id: userId,
        etat_version: new Date(),
        routines: this.borner(data.routines),
        micro_objectives: this.borner(data.micro_objectives),
        macro_objectives: this.borner(data.macro_objectives),
        habits: this.borner(data.habits),
        nutrition: this.borner(data.nutrition),
        points: data.points || 0,
        xp: this.xpValide(data.xp),
        mental_score: data.mental_score || 0,
        bonus_score: data.bonus_score || 0,
        daily_scores: this.borner(data.daily_scores),
        last_routine_date: data.last_routine_date,
        last_habit_date: data.last_habit_date,
        join_date: data.join_date,
        settings: data.settings,
        rewards: this.borner(data.rewards),
        inventory: this.borner(data.inventory),
        owned_cosmetics: this.borner(data.owned_cosmetics),
        ai_skin_id: data.ai_skin_id,
      }
    });

    return SyncService.avecJeton(ligne);
  }
}
