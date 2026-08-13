import { Controller, Post, Get, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';
import { ChatDto } from './dto/chat.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@ApiTags('AI Coaching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-coaching')
export class AiCoachingController {
  constructor(
    private readonly aiCoachingService: AiCoachingService,
    private readonly aiQuota: AiQuotaService,
    private readonly coins: CoinLedgerService,
  ) {}

  @Get('quota')
  @ApiOperation({ summary: 'Messages IA restants pour le mois en cours' })
  async getQuota(@Req() req: Request) {
    const userId = (req.user as any).userId;
    const [quota, solde, claims] = await Promise.all([
      this.aiQuota.getQuota(userId),
      this.coins.getBalance(userId),
      this.coins.claimsAujourdhui(userId),
    ]);
    return {
      ...quota,
      coins: solde,
      coutParMessage: CoinLedgerService.COUT_MESSAGE,
      actionsCrediteesAujourdhui: claims,
      plafondQuotidien: CoinLedgerService.ACTIONS_MAX_PAR_JOUR,
    };
  }

  // Le plafond quotidien borne le gain, pas le nombre d'appels : sans ça, marteler
  // cette route reste un moyen de charger la base pour rien.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('coins/claim')
  @ApiOperation({ summary: 'Créditer les coins d\'une action validée (idempotent)' })
  async claimCoins(@Req() req: Request, @Body() body: { eventKey: string }) {
    return this.coins.claim((req.user as any).userId, body?.eventKey);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('onboarding')
  @ApiOperation({ summary: 'Soumettre le questionnaire intelligent (Onboarding)' })
  async submitOnboarding(@Req() req: Request, @Body() data: any) {
    const userId = (req.user as any).userId;
    return this.aiCoachingService.processOnboarding(userId, data);
  }

  // Les coins bornent le nombre total de messages, jamais la cadence : avec 500 coins
  // on pouvait en envoyer 50 en dix secondes et saturer l'IA pour les autres.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('chat')
  @ApiOperation({ summary: 'Discuter avec le Coach IA' })
  @ApiResponse({ status: 402, description: 'Coins insuffisants ou quota mensuel épuisé.' })
  async chat(@Req() req: Request, @Body() body: ChatDto) {
    const userId = (req.user as any).userId;

    // Les coins bornent les comptes gratuits ; ils ne s'appliquent pas aux abonnés.
    // Avant, si : un abonné payait 9,99 €/mois pour un « accès illimité » et se
    // retrouvait quand même arrêté au bout de cinq messages, avec pour seule issue
    // d'aller valider des routines. On vendait une promesse que le serveur refusait
    // de tenir. La cadence, elle, reste bornée par @Throttle pour tout le monde.
    const abonne = await this.aiQuota.isSubscribed(userId);

    // Les tout premiers messages ne coûtent rien : voir MESSAGES_DECOUVERTE. On ne
    // pose même pas la question pour un abonné, qui ne paie de toute façon pas.
    const decouverte = abonne ? false : await this.coins.estEnDecouverte(userId);
    const gratuit = abonne || decouverte;

    const debit = gratuit ? null : await this.coins.spend(userId);
    await this.aiQuota.consumeAiCredit(userId, 'chat');

    // Débiter avant l'appel est nécessaire (sinon deux requêtes simultanées passent
    // avec le même solde), mais l'IA peut échouer ensuite — saturation du fournisseur
    // en tête. On rend alors ce qui a été prélevé : un compte gratuit n'a que dix
    // messages par mois, les lui brûler sur une panne n'est pas défendable.
    try {
      const reponse = await this.aiCoachingService.chatWithAi(userId, body.prompt, body.context);
      if ((reponse as any)?.erreur) {
        await this.rembourser(userId, gratuit);
        // Après remboursement, le solde n'est plus celui du débit : on le relit.
        return { ...reponse, coins: await this.coins.getBalance(userId) };
      }
      // Le solde accompagne la réponse : sans lui, l'app tenait sa propre
      // comptabilité en parallèle de la base, et les deux chiffres divergeaient.
      // Un abonné n'a rien dépensé, mais l'app affiche quand même un compteur.
      return { ...reponse, coins: debit ? debit.solde : await this.coins.getBalance(userId) };
    } catch (e) {
      await this.rembourser(userId, gratuit);
      throw e;
    }
  }

  /**
   * Le remboursement ne doit jamais masquer l'erreur d'origine.
   *
   * Un abonné n'a pas été débité de coins : lui en rendre lui en offrirait dix à
   * chaque panne du fournisseur d'IA. Il en va de même des messages de découverte,
   * qui n'ont rien prélevé non plus — d'où `gratuit` et non `abonne`.
   */
  private async rembourser(userId: string, gratuit: boolean) {
    await Promise.all([
      gratuit ? Promise.resolve() : this.coins.refund(userId).catch(() => {}),
      this.aiQuota.refundAiCredit(userId, 'chat').catch(() => {}),
    ]);
  }

  @Get('history')
  @ApiOperation({ summary: 'Récupérer l\'historique des conversations avec l\'IA' })
  async getHistory(@Req() req: Request) {
    const userId = (req.user as any)?.userId;
    return this.aiCoachingService.getChatHistory(userId);
  }

  // Chaque appel part chez OpenAI et se facture : c'est la route la plus chère.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('tts')
  @ApiOperation({ summary: 'Générer de la voix avec OpenAI TTS' })
  @ApiResponse({ status: 402, description: 'Réservé aux abonnés.' })
  async generateSpeech(@Req() req: Request, @Body() body: { text: string }) {
    await this.aiQuota.assertSubscribed((req.user as any).userId);
    return this.aiCoachingService.generateSpeech(body.text);
  }
}
