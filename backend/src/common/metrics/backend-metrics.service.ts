import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SERVICE = 'prosto-padel-backend';
const HTTP_DURATION_BUCKETS_MS = [
  5,
  10,
  25,
  50,
  100,
  250,
  500,
  1_000,
  2_500,
  5_000,
] as const;
const RELEASE_PATTERN = /^(?:local|[0-9a-f]{40})$/u;
const METRIC_LABEL_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';

export type BackendHttpMetric = Readonly<{
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  outcome: 'success' | 'rejected' | 'failure';
}>;

export type BackendDomainMetric = Readonly<{
  domain: string;
  action: string;
  outcome: string;
  reason?: string;
}>;

type CounterSeries = {
  readonly labels: Readonly<Record<string, string>>;
  value: number;
};

type HistogramSeries = {
  readonly labels: Readonly<Record<string, string>>;
  readonly buckets: number[];
  count: number;
  sum: number;
};

function escapeLabel(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"');
}

function labelsText(labels: Readonly<Record<string, string>>): string {
  const values = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}="${escapeLabel(value)}"`);
  return values.length === 0 ? '' : `{${values.join(',')}}`;
}

function seriesKey(labels: Readonly<Record<string, string>>): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}\u0000${value}`)
    .join('\u0001');
}

function safeEnvironment(value: unknown): string {
  return value === 'development' || value === 'test' || value === 'production'
    ? value
    : 'unknown';
}

function safeRelease(value: unknown): string {
  return typeof value === 'string' && RELEASE_PATTERN.test(value)
    ? value
    : 'unavailable';
}

function safeMetricLabel(value: unknown): string | undefined {
  return typeof value === 'string' && METRIC_LABEL_PATTERN.test(value)
    ? value
    : undefined;
}

function safeRoute(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 256 &&
    (value === 'unmatched' || /^\/[A-Za-z0-9_./:-]+$/u.test(value))
    ? value
    : undefined;
}

function incrementCounter(
  series: Map<string, CounterSeries>,
  labels: Readonly<Record<string, string>>,
): void {
  const key = seriesKey(labels);
  const current = series.get(key);
  if (current === undefined) {
    series.set(key, { labels: Object.freeze({ ...labels }), value: 1 });
    return;
  }
  current.value += 1;
}

function renderCounter(
  output: string[],
  name: string,
  help: string,
  series: ReadonlyMap<string, CounterSeries>,
): void {
  output.push(`# HELP ${name} ${help}`);
  output.push(`# TYPE ${name} counter`);
  for (const item of [...series.values()].sort((left, right) =>
    seriesKey(left.labels).localeCompare(seriesKey(right.labels)),
  )) {
    output.push(`${name}${labelsText(item.labels)} ${item.value}`);
  }
}

@Injectable()
export class BackendMetricsService {
  private readonly environment: string;
  private readonly release: string;
  private readonly httpRequests = new Map<string, CounterSeries>();
  private readonly domainOperations = new Map<string, CounterSeries>();
  private readonly httpDurations = new Map<string, HistogramSeries>();

  constructor(config: ConfigService) {
    this.environment = safeEnvironment(config.get('NODE_ENV'));
    this.release = safeRelease(config.get('APP_RELEASE'));
  }

  recordHttp(input: BackendHttpMetric): void {
    const route = safeRoute(input.route);
    if (
      route === undefined ||
      typeof input.method !== 'string' ||
      !/^[A-Z]{2,10}$/u.test(input.method) ||
      !Number.isInteger(input.statusCode) ||
      input.statusCode < 100 ||
      input.statusCode > 599 ||
      !Number.isFinite(input.durationMs) ||
      input.durationMs < 0 ||
      !['success', 'rejected', 'failure'].includes(input.outcome)
    ) {
      return;
    }

    incrementCounter(this.httpRequests, {
      method: input.method,
      route,
      status_code: String(input.statusCode),
      outcome: input.outcome,
    });

    const histogramLabels = Object.freeze({ method: input.method, route });
    const key = seriesKey(histogramLabels);
    let histogram = this.httpDurations.get(key);
    if (histogram === undefined) {
      histogram = {
        labels: histogramLabels,
        buckets: HTTP_DURATION_BUCKETS_MS.map(() => 0),
        count: 0,
        sum: 0,
      };
      this.httpDurations.set(key, histogram);
    }
    histogram.count += 1;
    histogram.sum += input.durationMs;
    HTTP_DURATION_BUCKETS_MS.forEach((bucket, index) => {
      if (input.durationMs <= bucket) histogram.buckets[index] += 1;
    });
  }

  recordDomain(input: BackendDomainMetric): void {
    const domain = safeMetricLabel(input.domain);
    const action = safeMetricLabel(input.action);
    const outcome = safeMetricLabel(input.outcome);
    const reason =
      input.reason === undefined ? 'none' : safeMetricLabel(input.reason);
    if (
      domain === undefined ||
      action === undefined ||
      outcome === undefined ||
      reason === undefined
    ) {
      return;
    }
    incrementCounter(this.domainOperations, {
      domain,
      action,
      outcome,
      reason,
    });
  }

  render(): string {
    const output: string[] = [];
    output.push(
      '# HELP prosto_padel_backend_build_info Static backend build information',
      '# TYPE prosto_padel_backend_build_info gauge',
      `prosto_padel_backend_build_info${labelsText({
        environment: this.environment,
        release: this.release,
        service: SERVICE,
      })} 1`,
    );

    renderCounter(
      output,
      'prosto_padel_http_requests_total',
      'Completed backend HTTP requests',
      this.httpRequests,
    );

    output.push(
      '# HELP prosto_padel_http_request_duration_milliseconds Backend HTTP request duration in milliseconds',
      '# TYPE prosto_padel_http_request_duration_milliseconds histogram',
    );
    for (const histogram of [...this.httpDurations.values()].sort(
      (left, right) =>
        seriesKey(left.labels).localeCompare(seriesKey(right.labels)),
    )) {
      HTTP_DURATION_BUCKETS_MS.forEach((bucket, index) => {
        output.push(
          `prosto_padel_http_request_duration_milliseconds_bucket${labelsText({
            ...histogram.labels,
            le: String(bucket),
          })} ${histogram.buckets[index]}`,
        );
      });
      output.push(
        `prosto_padel_http_request_duration_milliseconds_bucket${labelsText({
          ...histogram.labels,
          le: '+Inf',
        })} ${histogram.count}`,
        `prosto_padel_http_request_duration_milliseconds_sum${labelsText(
          histogram.labels,
        )} ${histogram.sum}`,
        `prosto_padel_http_request_duration_milliseconds_count${labelsText(
          histogram.labels,
        )} ${histogram.count}`,
      );
    }

    renderCounter(
      output,
      'prosto_padel_domain_operations_total',
      'Completed bounded backend domain operations',
      this.domainOperations,
    );

    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    output.push(
      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${memory.rss}`,
      '# HELP nodejs_heap_size_used_bytes Process heap size used in bytes',
      '# TYPE nodejs_heap_size_used_bytes gauge',
      `nodejs_heap_size_used_bytes ${memory.heapUsed}`,
      '# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds',
      '# TYPE process_cpu_user_seconds_total counter',
      `process_cpu_user_seconds_total ${cpu.user / 1_000_000}`,
      '# HELP process_cpu_system_seconds_total Total system CPU time spent in seconds',
      '# TYPE process_cpu_system_seconds_total counter',
      `process_cpu_system_seconds_total ${cpu.system / 1_000_000}`,
      '# HELP process_uptime_seconds Process uptime in seconds',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${process.uptime()}`,
    );

    return `${output.join('\n')}\n`;
  }
}
