import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats() {
    const totalUsers = await this.prisma.user.count();
    
    // Total users who have subscribed at least once (Elite Plan or currently Active/Trialing)
    const totalSubscribers = await this.prisma.subscription.count({
      where: {
        status: {
          in: ['ACTIVE', 'TRIALING', 'PAST_DUE']
        }
      }
    });

    // Count how many users have done a routine today
    const today = new Date().toISOString().slice(0, 10);
    const activeUsersToday = await this.prisma.dailyProgress.count({
      where: {
        date: new Date(today)
      }
    });

    return {
      totalUsers,
      totalSubscribers,
      activeUsersToday
    };
  }
}
