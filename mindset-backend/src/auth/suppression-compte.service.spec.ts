import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { SuppressionCompteService } from './suppression-compte.service';

jest.mock('argon2', () => ({ verify: jest.fn() }));

/**
 * Supprimer son compte : la seule action du produit qu'aucune sauvegarde ne
 * rattrape, et la seule qui puisse laisser un prélèvement derrière elle.
 *
 * Ce qui se vérifie ici n'est donc pas « la ligne disparaît » — c'est que rien ne
 * disparaît quand quelque chose s'est mal passé avant.
 */
describe('SuppressionCompteService', () => {
  let service: SuppressionCompteService;
  let prisma: any;
  let abonnements: any;

  const COMPTE = {
    id: 'u1',
    email: 'quelqu-un@exemple.fr',
    password_hash: 'empreinte',
    stripe_customer_id: 'cus_123',
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(COMPTE), delete: jest.fn() },
      payment: { deleteMany: jest.fn() },
      auditLog: { deleteMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    abonnements = { resilierPourSuppression: jest.fn().mockResolvedValue(undefined) };
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    service = new SuppressionCompteService(prisma, abonnements);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  });

  it('efface la personne, ses paiements et son journal', async () => {
    await expect(service.supprimer('u1', 'bon-mot-de-passe')).resolves.toEqual({ supprime: true });

    expect(prisma.payment.deleteMany).toHaveBeenCalledWith({ where: { user_id: 'u1' } });
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { user_id: 'u1' } });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    // En une seule transaction : un effacement à moitié fait laisserait un compte
    // sans données, ou des données sans compte.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('résilie l’abonnement avant d’effacer quoi que ce soit', async () => {
    const ordre: string[] = [];
    abonnements.resilierPourSuppression.mockImplementation(async () => {
      ordre.push('stripe');
    });
    prisma.$transaction.mockImplementation(async () => {
      ordre.push('base');
      return [];
    });

    await service.supprimer('u1', 'bon-mot-de-passe');

    expect(ordre).toEqual(['stripe', 'base']);
  });

  it('n’efface rien si l’abonnement n’a pas pu être résilié', async () => {
    /*
      Le cas qui justifie tout le reste. Un compte effacé dont l'abonnement tourne
      encore prélève 9,99 € par mois à quelqu'un qui n'a plus aucun moyen de se
      connecter pour l'arrêter, ni aucune trace pour comprendre. C'est pire que de
      ne pas supprimer : on refuse, et on le dit.
    */
    abonnements.resilierPourSuppression.mockRejectedValue(new Error('Stripe injoignable'));

    await expect(service.supprimer('u1', 'bon-mot-de-passe')).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('refuse un mot de passe faux, et ne touche pas à Stripe', async () => {
    (argon2.verify as jest.Mock).mockResolvedValue(false);

    await expect(service.supprimer('u1', 'au-hasard')).rejects.toBeInstanceOf(UnauthorizedException);

    expect(abonnements.resilierPourSuppression).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ne parle pas à Stripe pour un compte qui n’a jamais payé', async () => {
    // Un client Stripe inexistant ferait lever l'API pour rien, et la suppression
    // échouerait sur un abonnement qui n'a jamais existé.
    prisma.user.findUnique.mockResolvedValue({ ...COMPTE, stripe_customer_id: null });

    await service.supprimer('u1', 'bon-mot-de-passe');

    expect(abonnements.resilierPourSuppression).not.toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalled();
  });
});
