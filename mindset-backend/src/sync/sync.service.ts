import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

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
        routines: data.routines,
        micro_objectives: data.micro_objectives,
        macro_objectives: data.macro_objectives,
        habits: data.habits,
        points: data.points,
        mental_score: data.mental_score,
        bonus_score: data.bonus_score,
        daily_scores: data.daily_scores,
        last_routine_date: data.last_routine_date,
        last_habit_date: data.last_habit_date,
        join_date: data.join_date,
        settings: data.settings,
        rewards: data.rewards,
        inventory: data.inventory,
      },
      create: {
        user_id: userId,
        routines: data.routines,
        micro_objectives: data.micro_objectives,
        macro_objectives: data.macro_objectives,
        habits: data.habits,
        points: data.points || 0,
        mental_score: data.mental_score || 0,
        bonus_score: data.bonus_score || 0,
        daily_scores: data.daily_scores,
        last_routine_date: data.last_routine_date,
        last_habit_date: data.last_habit_date,
        join_date: data.join_date,
        settings: data.settings,
        rewards: data.rewards,
        inventory: data.inventory,
      }
    });
  }
}
