import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PushController } from './push.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

/**
 * Deux des routes de ce contrôleur n'agissent pas sur le compte qui les appelle mais
 * sur l'ensemble des utilisateurs : elles déclenchent une notification à tout le monde
 * et consomment le budget IA de la journée, partagé par toute l'application. Être
 * connecté suffisait pour les atteindre.
 *
 * Une protection posée par décorateur ne se voit pas à l'exécution des autres tests :
 * la retirer ne casse rien, aucune assertion n'en dépend, et la brèche se rouvre en
 * silence. D'où ces vérifications sur les métadonnées elles-mêmes.
 */
describe('PushController — qui a le droit de déclencher quoi', () => {
  const roles = (methode: keyof PushController) =>
    Reflect.getMetadata(ROLES_KEY, PushController.prototype[methode] as any);

  const gardes = (methode: keyof PushController) =>
    Reflect.getMetadata(GUARDS_METADATA, PushController.prototype[methode] as any) ?? [];

  describe("outillage d'exploitation", () => {
    it.each<[string, keyof PushController]>([
      ['lancer la tournée pour tout le monde', 'runMorningBriefs'],
      ['lire le décompte de la tournée', 'morningBriefStatus'],
    ])('réserve « %s » aux administrateurs', (_libelle, methode) => {
      expect(roles(methode)).toEqual(['ADMIN']);
      // Le rôle exigé ne sert à rien si le garde qui le lit n'est pas monté : les deux
      // vont ensemble, et oublier le second laisserait la route grande ouverte.
      expect(gardes(methode)).toContain(RolesGuard);
    });
  });

  describe('routes agissant sur son propre compte', () => {
    it.each<[string, keyof PushController]>([
      ["s'abonner aux notifications", 'subscribe'],
      ['tester une notification sur soi', 'testPush'],
      ['recevoir son propre brief', 'testMorningBrief'],
    ])('laisse « %s » à tout compte connecté', (_libelle, methode) => {
      // Le rôle ADMIN n'a rien à faire ici : ces routes ne touchent que l'appelant, et
      // les verrouiller priverait les utilisateurs des notifications elles-mêmes.
      expect(roles(methode)).toBeUndefined();
    });
  });
});
