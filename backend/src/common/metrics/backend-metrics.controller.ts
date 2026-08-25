import { Controller, Get, Header } from '@nestjs/common';
import {
  BackendMetricsService,
  PROMETHEUS_CONTENT_TYPE,
} from './backend-metrics.service';

@Controller('metrics')
export class BackendMetricsController {
  constructor(private readonly metrics: BackendMetricsService) {}

  @Get()
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  @Header('Cache-Control', 'no-store')
  read(): string {
    return this.metrics.render();
  }
}
