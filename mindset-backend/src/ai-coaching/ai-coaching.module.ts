import { Module } from '@nestjs/common';
import { AiCoachingService } from './ai-coaching.service';
import { AiQuotaService } from './ai-quota.service';
import { AiCoachingController } from './ai-coaching.controller';

@Module({
  controllers: [AiCoachingController],
  providers: [AiCoachingService, AiQuotaService],
  exports: [AiCoachingService, AiQuotaService],
})
export class AiCoachingModule {}
