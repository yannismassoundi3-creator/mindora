import { Injectable } from '@nestjs/common';
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

  async getSyncData(userId: string) {
    let syncData = await this.prisma.syncData.findUnique({
      where: { user_id: userId }
    });

    if (!syncData) {
      syncData = await this.prisma.syncData.create({
        data: { user_id: userId }
      });
    }

    return syncData;
  }

  async updateSyncData(userId: string, data: any) {
    return this.prisma.syncData.upsert({
      where: { user_id: userId },
      update: {
        routines: this.borner(data.routines),
        micro_objectives: this.borner(data.micro_objectives),
        macro_objectives: this.borner(data.macro_objectives),
        habits: this.borner(data.habits),
        nutrition: this.borner(data.nutrition),
        points: data.points,
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
        routines: this.borner(data.routines),
        micro_objectives: this.borner(data.micro_objectives),
        macro_objectives: this.borner(data.macro_objectives),
        habits: this.borner(data.habits),
        nutrition: this.borner(data.nutrition),
        points: data.points || 0,
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
  }
}
