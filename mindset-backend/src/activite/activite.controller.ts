import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ActiviteService } from './activite.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Activité')
@Controller('activite')
@UseGuards(JwtAuthGuard)
export class ActiviteController {
  constructor(private readonly activiteService: ActiviteService) {}

  /**
   * « J'ouvre l'application. »
   *
   * Le client n'appelle ceci qu'au démarrage ou après une absence d'au moins
   * trente minutes. Le plafond ci-dessous ne dessine donc pas l'usage normal : il
   * borne ce qu'un client fautif — ou quelqu'un qui rejoue l'appel à la main —
   * peut inscrire dans le compteur. Sans lui, le seul chiffre qu'on ait sur
   * l'usage serait aussi le plus facile à gonfler.
   *
   * Rend 204 : il n'y a rien à répondre, et le client n'attend pas.
   */
  @Post('ouverture')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Compter une ouverture de l'application" })
  async ouverture(@Req() req: Request): Promise<void> {
    await this.activiteService.enregistrerOuverture((req.user as any).userId);
  }
}
