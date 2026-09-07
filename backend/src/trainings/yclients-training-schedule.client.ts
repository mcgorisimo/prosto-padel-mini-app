import { createHash } from 'node:crypto';
import type { YclientsApiConfiguration } from '../config/yclients-api.config';
import type { YclientsConservativeRequestLimiter } from '../integrations/yclients/yclients-request-limiter';
import { TRAINING_SCHEDULE_POLICY } from './training-schedule.policy';
import type { TrainingScheduleSession } from './training-schedule.types';

const MAX_RESPONSE_BYTES = 65_536;
const MAX_LABEL_LENGTH = 160;
const MAX_PRICE_RUBLES = 10_000_000;
const MAX_CAPACITY = 1_000;
const DAY_MILLISECONDS = 86_400_000;
const YCLIENTS_ACCEPT = 'application/vnd.yclients.v2+json';
const COURT_LABEL = /^Корт\s*№?\s*\d+$/iu;

type ProviderTrainingSession = TrainingScheduleSession &
  Readonly<{ singleVisitPriceRubles?: number }>;

export type YclientsTrainingScheduleResult =
  | Readonly<{
      outcome: 'loaded';
      sessions: readonly ProviderTrainingSession[];
    }>
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export interface YclientsTrainingScheduleClientConfiguration {
  readonly runtime: YclientsApiConfiguration;
  readonly requestTimeoutMilliseconds: number;
  readonly fetch: typeof globalThis.fetch;
  readonly limiter: Pick<YclientsConservativeRequestLimiter, 'run'>;
}

type SearchRow = Readonly<{
  providerEventId: number;
  serviceId: number;
  title: string;
  startsAtEpochSeconds: number;
  durationSeconds: number;
  capacity: number;
  courtName?: string;
  coachName?: string;
  singleVisitPriceRubles?: number;
}>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const boundedCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CAPACITY;
const safeLabel = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_LABEL_LENGTH &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const finitePrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE_RUBLES;

function opaqueEventId(companyId: number, providerEventId: number): string {
  const bytes = createHash('sha256')
    .update(`${TRAINING_SCHEDULE_POLICY.opaqueIdNamespace}:${companyId}:${providerEventId}`, 'utf8')
    .digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function moscowDate(nowMilliseconds: number, additionalDays: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TRAINING_SCHEDULE_POLICY.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMilliseconds + additionalDays * DAY_MILLISECONDS));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseSearchRow(value: unknown, expectedCompanyId: number): SearchRow | undefined {
  if (!isObject(value) || value.company_id !== expectedCompanyId || !positiveInteger(value.id) ||
      !positiveInteger(value.service_id) || !TRAINING_SCHEDULE_POLICY.serviceIds.includes(value.service_id as 30_920_295) ||
      !positiveInteger(value.staff_id) || !positiveInteger(value.timestamp) || value.timestamp > 253_402_300_799 ||
      !positiveInteger(value.length) || value.length > 86_400 ||
      !positiveInteger(value.capacity) || value.capacity > MAX_CAPACITY ||
      !isObject(value.service) || value.service.id !== value.service_id || !safeLabel(value.service.title) ||
      !isObject(value.staff) || value.staff.id !== value.staff_id || !safeLabel(value.staff.name)) return undefined;

  const resources = value.resource_instances ?? [];
  if (!Array.isArray(resources) || resources.length > 4 ||
      resources.some((resource) => !isObject(resource) || !safeLabel(resource.title))) return undefined;
  const resourceNames = resources.map((resource) => String((resource as Record<string, unknown>).title).trim());
  const staffName = value.staff.name.trim();
  const courtName = resourceNames.length === 1 ? resourceNames[0]
    : resourceNames.length === 0 && COURT_LABEL.test(staffName) ? staffName : undefined;
  const coachName = resourceNames.length > 0 && !COURT_LABEL.test(staffName) ? staffName : undefined;
  const price = finitePrice(value.service.price_min) && finitePrice(value.service.price_max) &&
    value.service.price_min === value.service.price_max ? value.service.price_min : undefined;

  return Object.freeze({
    providerEventId: value.id,
    serviceId: value.service_id,
    title: value.service.title.trim(),
    startsAtEpochSeconds: value.timestamp,
    durationSeconds: value.length,
    capacity: value.capacity,
    ...(courtName === undefined ? {} : { courtName }),
    ...(coachName === undefined ? {} : { coachName }),
    ...(price === undefined ? {} : { singleVisitPriceRubles: price }),
  });
}

function readJsonBody(text: string): Record<string, unknown> | undefined {
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export class YclientsTrainingScheduleClient {
  constructor(private readonly configuration: YclientsTrainingScheduleClientConfiguration) {}

  async read(nowMilliseconds: number): Promise<YclientsTrainingScheduleResult> {
    const runtime = this.configuration.runtime;
    if (!runtime.enabled || runtime.companyId !== TRAINING_SCHEDULE_POLICY.companyId ||
        runtime.baseUrl.length === 0 || runtime.partnerToken.length === 0 || runtime.userToken.length === 0) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }

    const searchUrl = new URL(`api/v1/activity/${runtime.companyId}/search/`, `${runtime.baseUrl}/`);
    searchUrl.searchParams.set('from', moscowDate(nowMilliseconds, 0));
    searchUrl.searchParams.set('till', moscowDate(nowMilliseconds, TRAINING_SCHEDULE_POLICY.horizonDays));
    searchUrl.searchParams.set('service_ids[]', String(TRAINING_SCHEDULE_POLICY.serviceIds[0]));
    searchUrl.searchParams.set('page', '1');
    searchUrl.searchParams.set('count', String(TRAINING_SCHEDULE_POLICY.maximumSessions));

    const authorization = `Bearer ${runtime.partnerToken}, User ${runtime.userToken}`;
    const search = await this.get(searchUrl, authorization, [200]);
    if (search.outcome !== 'loaded') return search;
    const body = search.body;
    if (body.success !== true || !Array.isArray(body.data) || !isObject(body.meta) ||
        !boundedCount(body.meta.count) || body.meta.count > TRAINING_SCHEDULE_POLICY.maximumSessions ||
        body.data.length !== body.meta.count) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }

    const rows: SearchRow[] = [];
    const providerIds = new Set<number>();
    for (const value of body.data) {
      const row = parseSearchRow(value, runtime.companyId);
      if (row === undefined || providerIds.has(row.providerEventId)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }
      providerIds.add(row.providerEventId);
      if (row.startsAtEpochSeconds * 1_000 > nowMilliseconds) rows.push(row);
    }

    const exact = await Promise.all(rows.map((row) => this.readExact(runtime.baseUrl, runtime.companyId!, row, authorization)));
    const failure = exact.find((result) => result.outcome !== 'loaded');
    if (failure !== undefined) return failure;
    const sessions = exact
      .map((result) => (result as Extract<typeof result, { outcome: 'loaded' }>).session)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id));
    return Object.freeze({ outcome: 'loaded' as const, sessions: Object.freeze(sessions) });
  }

  private async readExact(
    baseUrl: string,
    companyId: number,
    row: SearchRow,
    authorization: string,
  ): Promise<Readonly<{ outcome: 'loaded'; session: ProviderTrainingSession }> |
    Exclude<YclientsTrainingScheduleResult, { outcome: 'loaded' | 'disabled' }>> {
    const url = new URL(`api/v2/companies/${companyId}/activities/${row.providerEventId}`, `${baseUrl}/`);
    const result = await this.get(url, authorization, [200, 201]);
    if (result.outcome !== 'loaded') return result;
    const data = result.body.data;
    if (!isObject(data) || String(data.id) !== String(row.providerEventId) || !isObject(data.attributes)) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }
    const attributes = data.attributes;
    if (attributes.service_id !== row.serviceId || attributes.timestamp !== row.startsAtEpochSeconds ||
        attributes.length !== row.durationSeconds || attributes.capacity !== row.capacity ||
        !boundedCount(attributes.clients_count)) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }
    const occupied = attributes.clients_count;
    return Object.freeze({
      outcome: 'loaded' as const,
      session: Object.freeze({
        id: opaqueEventId(companyId, row.providerEventId),
        title: row.title,
        startsAt: new Date(row.startsAtEpochSeconds * 1_000).toISOString(),
        durationSeconds: row.durationSeconds,
        ...(row.courtName === undefined ? {} : { courtName: row.courtName }),
        ...(row.coachName === undefined ? {} : { coachName: row.coachName }),
        capacity: row.capacity,
        occupied,
        remaining: Math.max(row.capacity - occupied, 0),
        ...(row.singleVisitPriceRubles === undefined ? {} : { singleVisitPriceRubles: row.singleVisitPriceRubles }),
      }),
    });
  }

  private async get(
    url: URL,
    authorization: string,
    successStatuses: readonly number[],
  ): Promise<Readonly<{ outcome: 'loaded'; body: Record<string, unknown> }> |
    Exclude<YclientsTrainingScheduleResult, { outcome: 'loaded' | 'disabled' }>> {
    try {
      const response = await this.configuration.limiter.run(() => this.configuration.fetch(url, {
        method: 'GET',
        headers: { accept: YCLIENTS_ACCEPT, 'content-type': 'application/json', authorization },
        signal: AbortSignal.timeout(this.configuration.requestTimeoutMilliseconds),
      }));
      if (response.status === 401 || response.status === 403) return Object.freeze({ outcome: 'unauthorized' as const });
      if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
      if (!successStatuses.includes(response.status)) return Object.freeze({ outcome: 'invalid_response' as const });
      const body = readJsonBody(await response.text());
      return body === undefined ? Object.freeze({ outcome: 'invalid_response' as const })
        : Object.freeze({ outcome: 'loaded' as const, body });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }
}
