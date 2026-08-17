import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { BilanHebdoService } from './bilan-hebdo.service';
import { WeeklyReviewService, SemaineEcoulee } from './weekly-review.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Le cache de la lecture hebdomadaire.
 *
 * Deux appelants la demandent — l'écran d'un abonné et le cron du dimanche soir —
 * et ils doivent obtenir le même texte. Ce qui est vérifié ici, c'est surtout la
 * fraîcheur : le bilan porte sur les **sept derniers jours en glissant**, pas sur
 * la semaine du lundi au dimanche. Un repère hebdomadaire laisserait donc une
 * lecture affichée jusqu'à six jours pendant que les chiffres qu'elle commente
 * auraient entièrement changé — un texte faux, d'apparence parfaitement normale.
 */
describe('BilanHebdoService', () => {
  let service: BilanHebdoService;
  let prisma: any;
  let bilan: { genererLecture: jest.Mock };

  const semaine: SemaineEcoulee = {
    joursActifs: 5,
    scoreMoyen: 68,
    meilleurScore: 92,
    evolution: -12,
    habitudes: [{ titre: 'Sport', joursTenus: 5 }],
  };

  /**
   * Le repère que le service doit poser aujourd'hui.
   *
   * Passe par `repere()` plutôt que de recomposer la chaîne à la main : il porte
   * la version des règles en plus du jour, et une copie ici obligerait à la mettre
   * à jour à chaque incrément — c'est-à-dire qu'elle finirait par mentir.
   */
  const aujourdhui = () => BilanHebdoService.repere();

  /** Le même repère, un jour plus tôt : la fenêtre a glissé, les règles non. */
  const hierMemesRegles = () => BilanHebdoService.repere(new Date(Date.now() - 86400000));

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    prisma = {
      aIProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    bilan = { genererLecture: jest.fn().mockResolvedValue('Ta semaine tient.') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BilanHebdoService,
        { provide: PrismaService, useValue: prisma },
        { provide: WeeklyReviewService, useValue: bilan },
      ],
    }).compile();

    service = module.get<BilanHebdoService>(BilanHebdoService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('génère et met en cache avec le jour comme repère', async () => {
    const texte = await service.lecture('u1', 'Yannis', semaine);

    expect(texte).toBe('Ta semaine tient.');
    expect(prisma.aIProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bilan_semaine: aujourdhui() }),
      }),
    );
  });

  it('resert le texte du jour sans rappeler le modèle', async () => {
    prisma.aIProfile.findUnique.mockResolvedValue({
      bilan_texte: 'Déjà écrite ce matin.',
      bilan_semaine: aujourdhui(),
    });

    const texte = await service.lecture('u1', 'Yannis', semaine);

    expect(texte).toBe('Déjà écrite ce matin.');
    // C'est ce cache qui évite un appel au modèle à chaque passage sur l'écran.
    expect(bilan.genererLecture).not.toHaveBeenCalled();
  });

  it("régénère dès le lendemain, la fenêtre ayant glissé d'un jour", async () => {
    prisma.aIProfile.findUnique.mockResolvedValue({
      bilan_texte: "La lecture d'hier.",
      bilan_semaine: hierMemesRegles(),
    });

    const texte = await service.lecture('u1', 'Yannis', semaine);

    /*
      Le point qui justifie tout ce fichier. Avec un repère hebdomadaire, ce texte
      serait resservi jusqu'au dimanche alors qu'il commente des chiffres qui ne
      sont plus les bons.
    */
    expect(bilan.genererLecture).toHaveBeenCalled();
    expect(texte).toBe('Ta semaine tient.');
  });

  /**
   * Ce que le repère journalier seul ne savait pas faire.
   *
   * Corriger la façon d'écrire la lecture ne répare rien pour qui en a déjà une :
   * son texte reste servi jusqu'au lendemain. Sur un défaut visible — une phrase
   * coupée au milieu d'un mot —, cela veut dire réparer un texte que la personne
   * concernée ne verra pas réparé.
   */
  it('régénère un texte écrit sous des règles antérieures, le même jour', async () => {
    const [, jour] = BilanHebdoService.repere().split(':');
    prisma.aIProfile.findUnique.mockResolvedValue({
      bilan_texte: 'Une lecture coupée au milieu d’un mo…',
      // Même journée, version précédente des règles.
      bilan_semaine: `v1:${jour}`,
    });

    const texte = await service.lecture('u1', 'Yannis', semaine);

    expect(bilan.genererLecture).toHaveBeenCalled();
    expect(texte).toBe('Ta semaine tient.');
  });

  it('régénère les lectures antérieures à toute version', async () => {
    // Le repère ne portait que le jour avant le 17 août 2026 : ces valeurs-là ne
    // doivent jamais correspondre, sans quoi les textes déjà en base gardent leur
    // défaut pour toute la journée en cours.
    prisma.aIProfile.findUnique.mockResolvedValue({
      bilan_texte: 'Une lecture de l’ancien format.',
      bilan_semaine: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }),
    });

    await service.lecture('u1', 'Yannis', semaine);

    expect(bilan.genererLecture).toHaveBeenCalled();
  });

  it("rend la lecture même quand elle ne peut pas être retenue", async () => {
    // Un compte sans ligne de profil n'a pas fini son questionnaire : mieux vaut un
    // appel de plus la prochaine fois qu'une exception à l'ouverture de l'écran.
    prisma.aIProfile.update.mockRejectedValue(new Error('aucune ligne'));

    await expect(service.lecture('u1', 'Yannis', semaine)).resolves.toBe('Ta semaine tient.');
  });

  it("ne retient rien quand le modèle n'a pas répondu", async () => {
    bilan.genererLecture.mockResolvedValue(null);

    const texte = await service.lecture('u1', 'Yannis', semaine);

    expect(texte).toBeNull();
    // Écrire `null` en base ferait passer l'absence de réponse pour une lecture
    // valide du jour, et personne ne réessaierait avant demain.
    expect(prisma.aIProfile.update).not.toHaveBeenCalled();
  });
});
