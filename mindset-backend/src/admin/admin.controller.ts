import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { RetentionService } from './retention.service';
import { QuotidienService } from './quotidien.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

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
}
