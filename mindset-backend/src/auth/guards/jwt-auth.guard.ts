import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Ici on peut customiser la gestion des erreurs de validation JWT si besoin
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
