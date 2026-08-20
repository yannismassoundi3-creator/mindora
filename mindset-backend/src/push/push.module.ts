import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { BriefEmailService } from './brief-email.service';
import { MorningBriefService } from './morning-brief.service';
import { WeeklyReviewService } from './weekly-review.service';
import { CoupDePouceService } from './coup-de-pouce.service';
import { BilanHebdoService } from './bilan-hebdo.service';
import { AnalyseHabitudesService } from './analyse-habitudes.service';
import { RappelService } from '../ai-coaching/rappel.service';
import { PushController } from './push.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    PushService,
    BriefEmailService,
    MorningBriefService,
    WeeklyReviewService,
    CoupDePouceService,
    BilanHebdoService,
    AnalyseHabitudesService,
    // Les rappels dates que le coach pose lui-meme.
    RappelService,
  ],
  controllers: [PushController],
  exports: [PushService],
})
export class PushModule {}
