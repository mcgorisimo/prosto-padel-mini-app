import { Controller, Get } from '@nestjs/common';

type HealthResponse = {
  status: 'ok';
  service: 'prosto-padel-backend';
};

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'prosto-padel-backend',
    };
  }
}
