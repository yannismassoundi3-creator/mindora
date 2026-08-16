import { Module } from '@nestjs/common';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';
import { CoachMemoryService } from './coach-memory.service';
import { CoachOuvertureService } from './coach-ouverture.service';
import { ObservationService } from './observation.service';
import { WeeklyReviewService } from '../push/weekly-review.service';
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
