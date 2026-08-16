import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { MorningBriefService } from './morning-brief.service';
import { WeeklyReviewService } from './weekly-review.service';
import { CoupDePouceService } from './coup-de-pouce.service';
import { BilanHebdoService } from './bilan-hebdo.service';
import { PushController } from './push.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    PushService,
    MorningBriefService,
    WeeklyReviewService,
    CoupDePouceService,
    BilanHebdoService,
  ],
  controllers: [PushController],
  exports: [PushService],
})
export class PushModule {}
