import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { MorningBriefService } from './morning-brief.service';
import { WeeklyReviewService } from './weekly-review.service';
import { PushController } from './push.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PushService, MorningBriefService, WeeklyReviewService],
  controllers: [PushController],
  exports: [PushService],
})
export class PushModule {}
