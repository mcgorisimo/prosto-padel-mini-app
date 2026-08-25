import { ConfigService } from '@nestjs/config';
import { BackendMetricsService } from './backend-metrics.service';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';
const PRIVATE_MARKER = 'SYNTHETIC_METRICS_PRIVATE_MARKER';

function service(): BackendMetricsService {
  return new BackendMetricsService(
    new ConfigService({ NODE_ENV: 'test', APP_RELEASE: RELEASE }),
  );
}

describe('BackendMetricsService', () => {
  it('renders bounded HTTP counters, histograms and process metrics', () => {
    const metrics = service();
    metrics.recordHttp({
      method: 'GET',
      route: '/api/v1/matches/:matchId',
      statusCode: 200,
      durationMs: 7,
      outcome: 'success',
    });
    metrics.recordHttp({
      method: 'GET',
      route: '/api/v1/matches/:matchId',
      statusCode: 200,
      durationMs: 30,
      outcome: 'success',
    });

    const output = metrics.render();
    expect(output).toContain(
      `prosto_padel_backend_build_info{environment="test",release="${RELEASE}",service="prosto-padel-backend"} 1`,
    );
    expect(output).toContain(
      'prosto_padel_http_requests_total{method="GET",outcome="success",route="/api/v1/matches/:matchId",status_code="200"} 2',
    );
    expect(output).toContain(
      'prosto_padel_http_request_duration_milliseconds_bucket{le="10",method="GET",route="/api/v1/matches/:matchId"} 1',
    );
    expect(output).toContain(
      'prosto_padel_http_request_duration_milliseconds_bucket{le="50",method="GET",route="/api/v1/matches/:matchId"} 2',
    );
    expect(output).toContain('process_resident_memory_bytes ');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('counts only bounded domain labels and omits resource identifiers', () => {
    const metrics = service();
    metrics.recordDomain({
      domain: 'match_slot',
      action: 'join',
      outcome: 'rejected',
      reason: 'match_full',
      matchId: PRIVATE_MARKER,
    } as never);
    metrics.recordDomain({
      domain: PRIVATE_MARKER,
      action: 'join',
      outcome: 'rejected',
    });

    const output = metrics.render();
    expect(output).toContain(
      'prosto_padel_domain_operations_total{action="join",domain="match_slot",outcome="rejected",reason="match_full"} 1',
    );
    expect(output).not.toContain(PRIVATE_MARKER);
  });

  it('fails closed for a raw query route and invalid observations', () => {
    const metrics = service();
    metrics.recordHttp({
      method: 'GET',
      route: `/api/v1/matches?token=${PRIVATE_MARKER}`,
      statusCode: 200,
      durationMs: 1,
      outcome: 'success',
    });
    metrics.recordHttp({
      method: 'GET',
      route: '/api/v1/matches',
      statusCode: 999,
      durationMs: 1,
      outcome: 'success',
    });

    const output = metrics.render();
    expect(output).not.toContain('prosto_padel_http_requests_total{');
    expect(output).not.toContain(PRIVATE_MARKER);
  });
});
