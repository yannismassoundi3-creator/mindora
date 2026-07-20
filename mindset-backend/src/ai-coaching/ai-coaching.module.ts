import { Module } from '@nestjs/common';
import { AiCoachingService } from './ai-coaching.service';
import { AiCoachingController } from './ai-coaching.controller';

@Module({
  controllers: [AiCoachingController],
  providers: [AiCoachingService],
  exports: [AiCoachingService],
})
export class AiCoachingModule {}
