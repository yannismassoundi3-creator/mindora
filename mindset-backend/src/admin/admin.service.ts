import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BriefEmailService } from '../push/brief-email.service';
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

  /**
   * Les paiements qui n'ont même pas pu s'ouvrir.
   *
   * Le pire échec du produit : quelqu'un a voulu donner son argent et l'écran a
   * répondu « réessaie plus tard ». Jusqu'ici la cause vivait dans les journaux de
   * l'hébergeur — c'est-à-dire nulle part, pour qui ne les lit pas à la minute
   * près. Le code de Stripe est ce qui dit s'il faut attendre ou corriger une
   * variable ; il est donc rendu tel quel.
   */
  async getEchecsPaiement() {
    const lignes = await this.prisma.echecPaiement.findMany({
      orderBy: { created_at: 'desc' },
      take: 30,
      include: { user: { select: { first_name: true, email: true } } },
    });

    return {
      total: await this.prisma.echecPaiement.count(),
      // Un échec rattrapé compte : il dit qu'une configuration reste à corriger,
      // même si la personne a fini par payer.
      rattrapes: await this.prisma.echecPaiement.count({ where: { rattrape: true } }),
      echecs: lignes.map((l) => ({
        id: l.id,
        quand: l.created_at,
        prenom: l.user?.first_name ?? '—',
        email: l.user?.email ?? '—',
        formule: l.formule,
        code: l.code,
        parametre: l.parametre,
        message: l.message,
        rattrape: l.rattrape,
      })),
    };
  }

  /**
   * Ce qui doit ramener les gens le lendemain — et qui n'était mesuré nulle part.
   *
   * Deux tiers des comptes qui agissent n'agissent qu'un seul jour. Le produit a
   * exactement deux mécanismes pour créer un deuxième jour : la notification du
   * matin et la relance par e-mail. **Aucun des deux n'apparaissait dans ce
   * panneau**, donc personne ne pouvait savoir combien de personnes ils touchent
   * réellement — ni si l'un des deux ne fait plus rien depuis des jours.
   *
   * La distinction qui compte : « joignables » n'est pas « ont accepté ». Une
   * permission accordée sur un iPhone qui n'a pas installé l'app ne produit aucun
   * abonnement, et le brief du matin n'atteindra jamais cette personne.
   */
  async getJourDeux() {
    const [comptes, abonnesPush, permissions, relances, briefs, briefsEmail, dernierBriefEmail] = await Promise.all([
      this.prisma.user.count({ where: { deleted_at: null } }),
      // Des appareils, pas des personnes : un même compte peut en avoir plusieurs.
      this.prisma.pushSubscription.findMany({ select: { user_id: true } }),
      this.prisma.pushPermission.groupBy({ by: ['etat'], _count: { _all: true } }),
      this.prisma.relanceEmail.groupBy({ by: ['motif'], _count: { _all: true } }),
      this.prisma.relanceEmail.aggregate({ _max: { envoye_le: true } }),
      // Le brief porté par e-mail à ceux que la notification n'atteint pas. Sans
      // ce décompte, on ne saurait pas s'il part — et un canal qui ne part pas ne
      // lève aucune erreur : il ne fait rien, tous les matins.
      this.prisma.briefEmail.groupBy({ by: ['creneau'], _count: { _all: true } }),
      this.prisma.briefEmail.aggregate({ _max: { created_at: true } }),
    ]);

    return {
      comptes,
      /*
        Le seul chiffre qui décide si la notification du matin sert à quelque
        chose. Compté en personnes joignables, pas en appareils enregistrés.
      */
      joignablesParPush: new Set(abonnesPush.map((p) => p.user_id)).size,
      permissions: permissions.map((p) => ({ etat: p.etat, comptes: p._count._all })),
      relances: {
        parMotif: relances.map((r) => ({ motif: r.motif, envoyees: r._count._all })),
        derniere: briefs._max.envoye_le,
      },
      briefsEmail: {
        /* Les créneaux réellement allumés, lus depuis la même variable que le
           service : afficher « soir » à côté d'un zéro alors que le créneau est
           éteint ferait chercher une panne là où il n'y a qu'un réglage. */
        creneauxActifs: BriefEmailService.creneauxActifs(),
        parCreneau: briefsEmail.map((b) => ({ creneau: b.creneau, envoyes: b._count._all })),
        dernier: dernierBriefEmail._max.created_at,
      },
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
