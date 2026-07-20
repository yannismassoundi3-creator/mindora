import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { SyncService } from './sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('state')
  async getState(@Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.syncService.getSyncData(userId);
  }

  @Post('state')
  async updateState(@Req() req: Request, @Body() body: any) {
    const userId = (req.user as any).userId;
    return this.syncService.updateSyncData(userId, body);
  }
}
