import { Test, TestingModule } from '@nestjs/testing';
import { AiCoachingController } from './ai-coaching.controller';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';

/**
 * Le remboursement est la contrepartie du débit anticipé : on prélève avant l'appel
 * pour que deux requêtes simultanées ne passent pas avec le même solde, ce qui rend
 * indispensable de rendre la mise quand l'IA échoue. Un compte gratuit n'a que dix
 * messages par mois ; les lui brûler sur une saturation du fournisseur ne se voit
 * dans aucun log et se paie en désabonnements.
 *
 * Ce chemin n'avait jamais tourné, faute de pouvoir provoquer une panne réelle.
 */
describe('AiCoachingController — débit et remboursement du chat', () => {
  let controller: AiCoachingController;
  let ia: { chatWithAi: jest.Mock };
  let quota: { consumeAiCredit: jest.Mock; refundAiCredit: jest.Mock };
  let coins: { spend: jest.Mock; refund: jest.Mock; getBalance: jest.Mock };

  const requete = { user: { userId: 'u1' } } as any;
  const message = { prompt: 'Comment tu vas ?' } as any;

  beforeEach(async () => {
    ia = { chatWithAi: jest.fn() };
    quota = { consumeAiCredit: jest.fn().mockResolvedValue({}), refundAiCredit: jest.fn().mockResolvedValue({}) };
    coins = {
      spend: jest.fn().mockResolvedValue({ depense: 10, solde: 40 }),
      refund: jest.fn().mockResolvedValue({}),
      getBalance: jest.fn().mockResolvedValue(50),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiCoachingController],
      providers: [
        { provide: AiCoachingService, useValue: ia },
        { provide: AiQuotaService, useValue: quota },
        { provide: CoinLedgerService, useValue: coins },
      ],
    }).compile();

    controller = module.get<AiCoachingController>(AiCoachingController);
  });

  it('prélève avant d’appeler l’IA, jamais après', async () => {
    ia.chatWithAi.mockResolvedValue({ reply: 'Ça va.' });

    await controller.chat(requete, message);

    // Débiter après coup rouvrirait la fenêtre que le prélèvement anticipé ferme :
    // deux requêtes simultanées passeraient avec le même solde.
    expect(coins.spend.mock.invocationCallOrder[0]).toBeLessThan(ia.chatWithAi.mock.invocationCallOrder[0]);
    expect(quota.consumeAiCredit.mock.invocationCallOrder[0]).toBeLessThan(ia.chatWithAi.mock.invocationCallOrder[0]);
  });

  it('ne rembourse rien quand la réponse arrive, et annonce le solde restant', async () => {
    ia.chatWithAi.mockResolvedValue({ reply: 'Ça va.' });

    const resultat = await controller.chat(requete, message);

    // Le solde voyage avec la réponse : sans lui, l'app décomptait de son côté et
    // finissait par afficher un chiffre qui n'était plus celui de la base.
    expect(resultat).toEqual({ reply: 'Ça va.', coins: 40 });
    expect(coins.refund).not.toHaveBeenCalled();
    expect(quota.refundAiCredit).not.toHaveBeenCalled();
  });

  it('rend les coins et le crédit mensuel quand le service signale une panne', async () => {
    // Le cas réel : saturation du fournisseur. Le service répond 200 avec un message
    // d'attente et ce drapeau — pas d'exception, donc rien ne rembourserait sans lui.
    ia.chatWithAi.mockResolvedValue({ reply: 'Trop de monde me parle en ce moment…', erreur: true });

    const resultat: any = await controller.chat(requete, message);

    expect(coins.refund).toHaveBeenCalledWith('u1');
    expect(quota.refundAiCredit).toHaveBeenCalledWith('u1', 'chat');
    // La personne reçoit quand même le message d'attente.
    expect(resultat.reply).toContain('Trop de monde');
    // Et le solde annoncé est celui d'après remboursement, pas celui du débit :
    // afficher 40 alors que la base en a rendu 50 ferait croire à un message perdu.
    expect(resultat.coins).toBe(50);
  });

  it('rembourse aussi sur exception, sans masquer l’erreur', async () => {
    ia.chatWithAi.mockRejectedValue(new Error('base injoignable'));

    await expect(controller.chat(requete, message)).rejects.toThrow('base injoignable');

    expect(coins.refund).toHaveBeenCalledWith('u1');
    expect(quota.refundAiCredit).toHaveBeenCalledWith('u1', 'chat');
  });

  it('laisse remonter l’erreur d’origine si le remboursement échoue lui aussi', async () => {
    ia.chatWithAi.mockRejectedValue(new Error('base injoignable'));
    coins.refund.mockRejectedValue(new Error('écriture impossible'));

    // Un remboursement en échec ne doit jamais remplacer la cause : c'est elle qu'on
    // cherchera dans les logs.
    await expect(controller.chat(requete, message)).rejects.toThrow('base injoignable');
    expect(quota.refundAiCredit).toHaveBeenCalledWith('u1', 'chat');
  });
});
