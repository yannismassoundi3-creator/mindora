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

    // L'activité du jour se lisait dans DailyProgress. Cette table n'est écrite nulle
    // part dans l'application — le compte valait donc zéro tous les jours, sur un
    // tableau de bord qui a l'air de fonctionner. C'est pire qu'une case vide : on
    // croit connaître un chiffre.
    //
    // La trace réelle d'activité est la ligne de synchronisation, mise à jour à chaque
    // action dans l'app. C'est déjà elle qui décide qui reçoit le brief du matin.
    const debutDuJour = new Date();
    debutDuJour.setHours(0, 0, 0, 0);

    const activeUsersToday = await this.prisma.syncData.count({
      where: { updated_at: { gte: debutDuJour } },
    });

    return {
      totalUsers,
      totalSubscribers,
      activeUsersToday
    };
  }
}
