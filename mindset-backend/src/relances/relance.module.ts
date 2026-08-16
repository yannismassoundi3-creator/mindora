import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RelanceEmailService } from './relance-email.service';
import { RelanceEmailController } from './relance-email.controller';

@Module({
  imports: [PrismaModule],
  providers: [RelanceEmailService],
  controllers: [RelanceEmailController],
  exports: [RelanceEmailService],
})
export class RelanceModule {}
