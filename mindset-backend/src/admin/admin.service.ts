import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { debutDuJourParis } from '../common/jour-paris';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Les réponses du coach que des gens ont signalées.
   *
   * Un signalement que personne ne lit ne vaut pas mieux que pas de signalement :
   * il donne seulement l'illusion d'un garde-fou. D'où cette lecture, et le
   * prénom de qui a signalé — pour pouvoir répondre à quelqu'un plutôt que de
   * contempler une statistique.
   */
  async getSignalements() {
    const lignes = await this.prisma.signalementIA.findMany({
      orderBy: { cree_le: 'desc' },
      take: 50,
      include: { user: { select: { first_name: true, email: true } } },
    });

    return {
      total: await this.prisma.signalementIA.count(),
      signalements: lignes.map((l) => ({
        id: l.id,
        quand: l.cree_le,
        prenom: l.user?.first_name ?? '—',
        email: l.user?.email ?? '—',
        message: l.message,
        motif: l.motif,
      })),
    };
  }

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
    // La journée commence à minuit heure de Paris, pas à minuit serveur. `setHours`
    // suivait l'horloge de la machine, c'est-à-dire UTC sur Render : cette carte
    // et le bloc « Aujourd'hui » juste en dessous répondaient à la même question
    // avec deux journées décalées de deux heures.
    const activeUsersToday = await this.prisma.syncData.count({
      where: { updated_at: { gte: debutDuJourParis() } },
    });

    return {
      totalUsers,
      totalSubscribers,
      activeUsersToday
    };
  }
}
