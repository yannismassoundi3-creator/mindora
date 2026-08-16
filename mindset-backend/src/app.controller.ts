import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller()
export class AppController {

  /**
   * Le commit d'où vient ce serveur, tel que Render le pose à la construction.
   *
   * Lu une fois : la valeur ne change pas d'un appel à l'autre, et un `process.env`
   * relu à chaque requête donnerait à croire qu'elle le pourrait.
   *
   * `RENDER_GIT_COMMIT` est fournie automatiquement par Render à toutes ses
   * exécutions ; les autres noms couvrent un déplacement d'hébergeur sans avoir à
   * y repenser. `null` quand rien n'est disponible — plutôt qu'une chaîne vide ou
   * un « inconnu » qu'on finirait par prendre pour un identifiant.
   */
  private static readonly VERSION =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    null;

  @Get('health')
  @ApiOperation({ summary: 'Vérifie que l\'API fonctionne, et dit de quel commit elle vient' })
  checkHealth() {
    /*
      Le statut seul ne dit pas ce qu'on croit qu'il dit.

      « Render répond 200 sur /health » prouve qu'un serveur est debout, jamais que
      c'est celui qu'on vient de déployer. Aucun point d'entrée ne portait de numéro
      de version : après un déploiement, la seule façon de vérifier qu'il était bien
      parti passait par la console Render, et à défaut on se contentait de supposer.
      Le SHA règle la question en une requête, depuis n'importe où.
    */
    return {
      status: 'ok',
      message: 'Disciplix API is operational',
      version: AppController.VERSION,
      versionCourte: AppController.VERSION ? AppController.VERSION.slice(0, 7) : null,
      timestamp: new Date().toISOString()
    };
  }
}
