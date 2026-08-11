import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { MorningBriefService } from './morning-brief.service';
import { PushController } from './push.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PushService, MorningBriefService],
  controllers: [PushController],
  exports: [PushService],
})
export class PushModule {}
