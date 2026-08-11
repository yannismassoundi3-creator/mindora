import { Module } from '@nestjs/common';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { CoinLedgerService } from './coin-ledger.service';
import { CoachMemoryService } from './coach-memory.service';
import { AiCoachingController } from './ai-coaching.controller';

@Module({
  controllers: [AiCoachingController],
  providers: [AiCoachingService, AiQuotaService, CoinLedgerService, CoachMemoryService],
  exports: [AiCoachingService, AiQuotaService, CoinLedgerService, CoachMemoryService],
})
export class AiCoachingModule {}
