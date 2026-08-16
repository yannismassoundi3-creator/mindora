import { Test, TestingModule } from '@nestjs/testing';
import { ActiviteService } from './activite.service';
import { PrismaService } from '../prisma/prisma.service';
import { cleJourParis } from '../common/jour-paris';

/**
 * Un compteur d'usage n'a le droit ni de faire tomber l'application, ni de
 * compter faux. Les deux sont vérifiés ici, parce que ce sont les deux façons
 * dont ce genre de code nuit : en cassant ce qu'il mesure, ou en le décrivant mal.
 */
describe('ActiviteService', () => {
  let service: ActiviteService;
  let prisma: { appOuverture: { upsert: jest.Mock } };

  beforeEach(async () => {
    prisma = { appOuverture: { upsert: jest.fn().mockResolvedValue({}) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ActiviteService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ActiviteService>(ActiviteService);
  });

  it('incrémente la journée en cours plutôt que d’écrire une ligne par ouverture', async () => {
    await service.enregistrerOuverture('u1');

    const appel = prisma.appOuverture.upsert.mock.calls[0][0];
    expect(appel.where.user_id_jour).toEqual({ user_id: 'u1', jour: cleJourParis() });
    // Un incrément atomique : deux ouvertures simultanées sur deux appareils ne
    // doivent pas se recouvrir en se relisant l'une l'autre.
    expect(appel.update.nombre).toEqual({ increment: 1 });
    expect(appel.create).toEqual({ user_id: 'u1', jour: cleJourParis(), nombre: 1 });
  });

  it("range l'ouverture dans la journée parisienne, pas dans celle du serveur", async () => {
    // Render tourne en UTC : une ouverture de 00 h 30 heure de Paris tomberait la
    // veille, et le chiffre du matin décrirait une autre journée que celle qu'on
    // regarde juste à côté.
    await service.enregistrerOuverture('u1');

    const { jour } = prisma.appOuverture.upsert.mock.calls[0][0].create;
    expect(jour).toBe(cleJourParis(new Date()));
    expect(jour).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('avale une panne de base plutôt que de faire échouer le démarrage', async () => {
    prisma.appOuverture.upsert.mockRejectedValue(new Error('base injoignable'));

    // Si cet appel levait, l'application refuserait de démarrer à cause d'un
    // compteur. Le chiffre ne vaut pas ça.
    await expect(service.enregistrerOuverture('u1')).resolves.toBeUndefined();
  });
});
