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
}
