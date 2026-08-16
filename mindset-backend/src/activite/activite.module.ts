import { Module } from '@nestjs/common';
import { ActiviteController } from './activite.controller';
import { ActiviteService } from './activite.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ActiviteController],
  providers: [ActiviteService],
})
export class ActiviteModule {}
