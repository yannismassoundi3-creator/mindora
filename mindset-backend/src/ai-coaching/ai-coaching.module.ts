import { Module } from '@nestjs/common';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';
import { CoachMemoryService } from './coach-memory.service';
import { CoachOuvertureService } from './coach-ouverture.service';
import { ObservationService } from './observation.service';
import { WeeklyReviewService } from '../push/weekly-review.service';
import { BilanHebdoService } from '../push/bilan-hebdo.service';
import { AnalyseHabitudesService } from '../push/analyse-habitudes.service';
import { AiCoachingController } from './ai-coaching.controller';

@Module({
  controllers: [AiCoachingController],
  providers: [
    AiCoachingService,
    AiQuotaService,
    CoinLedgerService,
    CoachMemoryService,
    CoachOuvertureService,
    ObservationService,
    /*
      Fourni directement plutôt qu'importé du module push : ce service ne dépend
      de rien, et importer PushModule ici accrocherait l'envoi des notifications —
      crons compris — au module de coaching, pour un seul calcul de moyenne.
    */
    WeeklyReviewService,
    // Le cache de la lecture hebdomadaire, partagé avec le cron du dimanche soir.
    BilanHebdoService,
    // Le croisement habitudes x score, qui nourrit la lecture reservee aux abonnes.
    AnalyseHabitudesService,
  ],
  exports: [
    AiCoachingService,
    AiQuotaService,
    CoinLedgerService,
    CoachMemoryService,
    CoachOuvertureService,
    ObservationService,
  ],
})
export class AiCoachingModule {}
