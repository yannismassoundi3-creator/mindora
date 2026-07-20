import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller()
export class AppController {
  
  @Get('health')
  @ApiOperation({ summary: 'Vérifie que l\'API fonctionne' })
  checkHealth() {
    return {
      status: 'ok',
      message: 'Mindora API is operational',
      timestamp: new Date().toISOString()
    };
  }
}
