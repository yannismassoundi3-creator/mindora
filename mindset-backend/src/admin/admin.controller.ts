import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { RetentionService } from './retention.service';
import { QuotidienService } from './quotidien.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { verifierSecours } from '../common/fournisseur-secours';
import { verifierModeles } from '../common/verifier-modeles';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly retentionService: RetentionService,
    private readonly quotidienService: QuotidienService,
  ) {}

  @Get('stats')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtenir les statistiques du tableau de bord administrateur' })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  /**
   * Réservée aux administrateurs comme le reste : ces chiffres décrivent le
   * comportement de tous les comptes, ce n'est pas une donnée d'utilisateur.
   */
  @Get('retention')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rétention, entonnoir et cohortes hebdomadaires' })
  async getRetentionStats() {
    return this.retentionService.getRetentionStats();
  }

  /**
   * La journée en cours, et les treize précédentes. Même réserve d'accès : on y
   * lit les arrivées nominatives du jour.
   */
  @Get('quotidien')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Inscriptions du jour et usage du coach, jour par jour" })
  async getStatsQuotidiennes() {
    return this.quotidienService.getStatsQuotidiennes();
  }

  /**
   * Le secours du coach répondrait-il, là, maintenant ?
   *
   * Il ne travaille que quand toute la chaîne gratuite a échoué : une clé fautive
   * ou un modèle mal nommé y dormiraient jusqu'à la première panne de Groq, donc
   * jusqu'au seul moment où l'on comptait dessus. Ce contrôle tend le filet
   * exprès, avec un vrai appel — le seul qui prouve quoi que ce soit.
   *
   * **Déclenché à la demande, jamais au chargement de la page.** L'appel est
   * payant : minuscule, mais il n'a aucune raison de partir chaque fois que
   * quelqu'un ouvre l'administration.
   */
  @Get('secours')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tester le fournisseur de secours du coach' })
  async testerSecours() {
    return verifierSecours();
  }

  /**
   * Est-ce que les modeles nommes par le code existent encore chez Groq ?
   *
   * Groq a eteint deux des modeles du produit le 16 aout 2026 ; le 18, ils
   * etaient encore nommes dans cinq fichiers. Personne ne l a su : chaque
   * service retombe proprement sur son repli local, donc le brief du matin est
   * parti generique pour tout le monde pendant deux jours sans lever la moindre
   * erreur.
   *
   * Ce controle est le seul moyen de l apprendre avant les utilisateurs. Comme
   * pour le secours, l appel est reel : lire un catalogue dans une documentation
   * ne prouve rien sur ce que cette cle-la peut appeler.
   */
  /**
   * Ce que le coach a écrit et qu'on lui a reproché.
   *
   * Même réserve d'accès que le reste : on y lit des messages nominatifs.
   */
  /**
   * Les paiements refusés à l'ouverture. Réservé comme le reste : la liste est
   * nominative, et le message de Stripe décrit la configuration du serveur.
   */
  /**
   * Les deux mécanismes censés créer un deuxième jour, et leur portée réelle.
   */
  @Get('jour-deux')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Portée des notifications et des relances' })
  async getJourDeux() {
    return this.adminService.getJourDeux();
  }

  @Get('paiements-echoues')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Paiements qui n'ont pas pu s'ouvrir" })
  async getEchecsPaiement() {
    return this.adminService.getEchecsPaiement();
  }

  @Get('signalements')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Réponses du coach signalées par les utilisateurs' })
  async getSignalements() {
    return this.adminService.getSignalements();
  }

  @Get('modeles')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verifier que les modeles appeles existent encore' })
  async testerModeles() {
    return verifierModeles();
  }
}
