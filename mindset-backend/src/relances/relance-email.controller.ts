import { Controller, Get, Post, Query, Body, Res, HttpCode, UseGuards, Request } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiExcludeEndpoint, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { RelanceEmailService } from './relance-email.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { lienApp, lienApi } from '../common/origines';

/**
 * Le retrait des relances, et le déclenchement manuel de la tournée.
 *
 * Ces deux routes sont publiques ou administratives, jamais authentifiées côté
 * utilisateur : quelqu'un qui veut ne plus rien recevoir est précisément quelqu'un
 * qui ne se reconnectera pas pour le demander.
 */
@ApiTags('Relances')
@Controller('emails')
export class RelanceEmailController {
  constructor(private readonly relances: RelanceEmailService) {}

  /**
   * Le lien du pied de page ne désabonne pas : il demande confirmation.
   *
   * Les boîtes mail et les antivirus d'entreprise ouvrent les liens d'un message
   * pour les inspecter, sans que personne n'ait cliqué. Un GET qui modifie l'état
   * désabonnerait donc des gens qui n'ont rien demandé — et, plus embêtant, sans
   * qu'ils le sachent : ils constateraient seulement, des semaines plus tard, ne
   * jamais rien recevoir. La page rendue ici ne fait que poser la question ; c'est
   * le bouton, en POST, qui agit.
   */
  @Get('retrait')
  @ApiExcludeEndpoint()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  pageRetrait(@Query('u') userId: string, @Query('s') signature: string, @Res() res: Response) {
    const valide = !!userId && RelanceEmailService.verifierSignature(userId, signature);
    res.type('html').send(RelanceEmailController.page(valide, userId, signature));
  }

  @Post('retrait')
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async confirmerRetrait(
    @Body() body: { u?: string; s?: string },
    @Query('u') qU: string,
    @Query('s') qS: string,
    @Res() res: Response,
  ) {
    // Le formulaire de la page poste en `application/x-www-form-urlencoded`, mais la
    // même route doit rester appelable en query : les deux origines sont acceptées.
    const userId = body?.u || qU;
    const signature = body?.s || qS;

    if (!userId || !RelanceEmailService.verifierSignature(userId, signature)) {
      res.status(200).type('html').send(RelanceEmailController.resultat(false));
      return;
    }
    const fait = await this.relances.retirer(userId);
    res.type('html').send(RelanceEmailController.resultat(fait));
  }

  /**
   * Rejouer la tournée sans attendre 11h. Réservé aux administrateurs comme
   * `push/morning-brief/run-all` : elle écrit à tout le monde, ce n'est pas une
   * fonctionnalité de compte mais de l'outillage d'exploitation.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiResponse({ status: 403, description: 'Réservé aux comptes ADMIN.' })
  @Post('relances/run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Lancer la tournée de relances maintenant, et rendre son décompte',
    description:
      "Avec ?simulation=true, rien n'est envoyé ni écrit : la réponse dit seulement " +
      'qui recevrait quoi. Un envoi est irréversible et sort du produit — la liste ' +
      'doit pouvoir se lire avant, pas se deviner.',
  })
  async lancer(@Request() req, @Query('simulation') simulation?: string) {
    // Tout ce qui n'est pas explicitement « true » envoie pour de bon : c'est le
    // sens de la route, et un mode d'essai qu'on active par mégarde en croyant
    // avoir envoyé est pire que pas de mode d'essai du tout.
    return this.relances.tournee(simulation === 'true');
  }

  private static enveloppe(contenu: string): string {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Disciplix</title></head>
      <body style="font-family: Arial, Helvetica, sans-serif; background: #f4f4f5; margin: 0; padding: 48px 16px;">
        <div style="max-width: 460px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; text-align: center;">
          ${contenu}
        </div>
      </body></html>`;
  }

  private static page(valide: boolean, userId: string, signature: string): string {
    if (!valide) {
      return RelanceEmailController.enveloppe(
        `<h2 style="color:#111827;font-size:19px;">Ce lien n'est plus valable</h2>
         <p style="color:#4b5563;font-size:15px;">Ouvre le lien depuis l'e-mail d'origine.</p>`,
      );
    }
    // L'action est postée sur la même URL, signature comprise : la page est servie
    // sans session et ne peut donc rien porter d'autre.
    const action = lienApi(`/emails/retrait?u=${encodeURIComponent(userId)}&s=${encodeURIComponent(signature)}`);
    return RelanceEmailController.enveloppe(
      `<h2 style="color:#111827;font-size:19px;">Ne plus recevoir de relances ?</h2>
       <p style="color:#4b5563;font-size:15px;">Les codes de connexion et les e-mails de mot de passe continueront d'arriver : ils répondent à un geste que tu viens de faire.</p>
       <form method="post" action="${action}">
         <button type="submit" style="margin-top:20px;padding:14px 26px;background:#3b82f6;color:#fff;border:0;border-radius:8px;font-weight:bold;font-size:15px;cursor:pointer;">Confirmer</button>
       </form>`,
    );
  }

  private static resultat(fait: boolean): string {
    if (!fait) {
      return RelanceEmailController.enveloppe(
        `<h2 style="color:#111827;font-size:19px;">Ce lien n'est plus valable</h2>
         <p style="color:#4b5563;font-size:15px;">Ouvre le lien depuis l'e-mail d'origine.</p>`,
      );
    }
    return RelanceEmailController.enveloppe(
      `<h2 style="color:#111827;font-size:19px;">C'est fait</h2>
       <p style="color:#4b5563;font-size:15px;">Tu ne recevras plus de relances. Ton compte, lui, reste intact.</p>
       <a href="${lienApp('')}" style="display:inline-block;margin-top:20px;color:#3b82f6;font-size:14px;">Ouvrir Disciplix</a>`,
    );
  }
}
