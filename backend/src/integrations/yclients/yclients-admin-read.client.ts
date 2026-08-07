import type { YclientsApiConfiguration } from '../../config/yclients-api.config';
import { normalizeYclientsSystemApiId } from './yclients-api-id';
import { YclientsConservativeRequestLimiter } from './yclients-request-limiter';

const MAX_EXACT_RESPONSE_BYTES = 262_144;
// YCLIENTS does not publish a maximum full-record size. One serialized page is
// capped at 1 MiB, leaving about 20 KiB per requested row at count=50.
const MAX_LIST_RESPONSE_BYTES = 1_048_576;
const MAX_RECORDS_PER_PAGE = 50;
const MAX_RECORD_PAGE = 10;
const MAX_RECORD_RANGE_DAYS = 7;
const MAX_SERVICE_IDS = 64;
const DAY_MILLISECONDS = 86_400_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const YCLIENTS_ACCEPT = 'application/vnd.yclients.v2+json';

export type YclientsSafeAdminRecord = Readonly<{
  recordId: number;
  companyId: number;
  resourceId: number;
  serviceIds: ReadonlyArray<number>;
  datetime: string;
  seanceLengthSeconds?: number;
  deleted: boolean;
  apiId?: number;
  lastChangeDate?: string;
}>;

export type YclientsExactAdminRecordResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{ outcome: 'invalid_request' }>
  | Readonly<{ outcome: 'found'; record: YclientsSafeAdminRecord }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'not_found' }>
  | Readonly<{ outcome: 'rejected' }>
  | Readonly<{ outcome: 'rate_limited' }>
  | Readonly<{ outcome: 'unavailable' }>
  | Readonly<{ outcome: 'unknown' }>;

export type YclientsBoundedAdminRecordsQuery = Readonly<{
  page: number;
  count: number;
  resourceId: number;
  dateFrom: string;
  dateTo: string;
  withDeleted: boolean;
}>;

export type YclientsBoundedAdminRecordsResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{ outcome: 'invalid_request' }>
  | Readonly<{
      outcome: 'loaded';
      page: number;
      count: number;
      totalCount: number;
      exhaustive: boolean;
      records: ReadonlyArray<YclientsSafeAdminRecord>;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'rejected' }>
  | Readonly<{ outcome: 'rate_limited' }>
  | Readonly<{ outcome: 'unavailable' }>
  | Readonly<{ outcome: 'unknown' }>;

export interface YclientsAdminReadClientConfiguration {
  readonly runtime: YclientsApiConfiguration;
  readonly requestTimeoutMilliseconds: number;
  readonly fetch: typeof globalThis.fetch;
  readonly limiter: YclientsConservativeRequestLimiter;
}

type ReadFailure = Exclude<
  YclientsExactAdminRecordResult,
  Readonly<{ outcome: 'found'; record: YclientsSafeAdminRecord }>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

async function cancelBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (body === null) return;
  try {
    await body.cancel();
  } catch {
    // A failed cancellation must not expose or retry the provider response.
  }
}

async function readBody(
  response: Response,
  maximumBytes: number,
): Promise<Record<string, unknown> | undefined> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    if (!/^\d+$/u.test(contentLengthHeader)) {
      await cancelBody(response.body);
      return undefined;
    }
    const contentLength = Number(contentLengthHeader);
    if (
      !nonNegativeSafeInteger(contentLength) ||
      contentLength > maximumBytes
    ) {
      await cancelBody(response.body);
      return undefined;
    }
  }

  if (response.body === null) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The response remains invalid even if stream cancellation fails.
        }
        return undefined;
      }
      chunks.push(chunk.value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The response remains invalid even if stream cancellation fails.
    }
    return undefined;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return undefined;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function readIsoDatetime(value: unknown): string | undefined {
  return typeof value === 'string' &&
    ISO_DATETIME_PATTERN.test(value) &&
    readIsoDate(value.slice(0, 10)) !== undefined &&
    Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

function readProviderText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= maximumLength &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    ? normalized
    : undefined;
}

function readConsistentId(
  value: Record<string, unknown>,
  directKey: string,
  nestedKey: string,
): number | undefined {
  const directValue = value[directKey];
  const directPresent = directValue !== undefined && directValue !== null;
  if (directPresent && !positiveSafeInteger(directValue)) return undefined;
  const direct = directPresent ? Number(directValue) : undefined;
  const nestedValue = value[nestedKey];
  const nestedPresent = nestedValue !== undefined && nestedValue !== null;
  if (
    nestedPresent &&
    (!isRecord(nestedValue) || !positiveSafeInteger(nestedValue.id))
  ) {
    return undefined;
  }
  const nested =
    nestedPresent && isRecord(nestedValue)
      ? Number(nestedValue.id)
      : undefined;
  if (direct !== undefined && nested !== undefined && direct !== nested) {
    return undefined;
  }
  return direct ?? nested;
}

function readServiceIds(value: unknown): ReadonlyArray<number> | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SERVICE_IDS) {
    return undefined;
  }
  const serviceIds = value.map((service) =>
    isRecord(service) && positiveSafeInteger(service.id)
      ? Number(service.id)
      : undefined,
  );
  if (
    serviceIds.some((serviceId) => serviceId === undefined) ||
    new Set(serviceIds).size !== serviceIds.length
  ) {
    return undefined;
  }
  return Object.freeze(
    (serviceIds as number[]).slice().sort((left, right) => left - right),
  );
}

function readSafeAdminRecord(
  value: unknown,
  expectedCompanyId: number,
): YclientsSafeAdminRecord | undefined {
  if (!isRecord(value)) return undefined;
  const recordId = positiveSafeInteger(value.id) ? Number(value.id) : undefined;
  const companyId = readConsistentId(value, 'company_id', 'company');
  const resourceId = readConsistentId(value, 'staff_id', 'staff');
  const serviceIds = readServiceIds(value.services);
  const datetime = readIsoDatetime(value.datetime);
  const seanceLengthSeconds = positiveSafeInteger(value.seance_length) && Number(value.seance_length) <= 86_400
    ? Number(value.seance_length)
    : undefined;
  const normalizedApiId = normalizeYclientsSystemApiId(value.api_id);
  const apiId =
    normalizedApiId.outcome === 'present' ? normalizedApiId.value : undefined;
  const lastChangeDate =
    value.last_change_date === undefined || value.last_change_date === null
      ? undefined
      : readProviderText(value.last_change_date, 64);
  if (
    recordId === undefined ||
    companyId !== expectedCompanyId ||
    resourceId === undefined ||
    serviceIds === undefined ||
    datetime === undefined ||
    (value.seance_length !== undefined && value.seance_length !== null && seanceLengthSeconds === undefined) ||
    typeof value.deleted !== 'boolean' ||
    normalizedApiId.outcome === 'invalid' ||
    (value.last_change_date !== undefined &&
      value.last_change_date !== null &&
      lastChangeDate === undefined)
  ) {
    return undefined;
  }

  return Object.freeze({
    recordId,
    companyId,
    resourceId,
    serviceIds,
    datetime,
    ...(seanceLengthSeconds === undefined ? {} : { seanceLengthSeconds }),
    deleted: value.deleted,
    ...(apiId === undefined ? {} : { apiId }),
    ...(lastChangeDate === undefined ? {} : { lastChangeDate }),
  });
}

function readPagination(
  value: unknown,
  expectedPage: number,
  expectedCount: number,
  rowCount: number,
): Readonly<{ totalCount: number; exhaustive: boolean }> | undefined {
  if (
    !isRecord(value) ||
    !positiveSafeInteger(value.page) ||
    Number(value.page) !== expectedPage ||
    (value.count !== undefined &&
      (!positiveSafeInteger(value.count) ||
        Number(value.count) !== expectedCount)) ||
    !nonNegativeSafeInteger(value.total_count)
  ) {
    return undefined;
  }
  const totalCount = Number(value.total_count);
  if (rowCount > expectedCount) return undefined;
  const offset = (expectedPage - 1) * expectedCount;
  const expectedRows = Math.min(
    expectedCount,
    Math.max(totalCount - offset, 0),
  );
  if (rowCount !== expectedRows) return undefined;
  return Object.freeze({
    totalCount,
    exhaustive: expectedPage === 1 && totalCount === rowCount,
  });
}

function safeBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return undefined;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, '')}`;
  } catch {
    return undefined;
  }
}

function configurationValues(
  configuration: YclientsAdminReadClientConfiguration,
):
  | Readonly<{
      baseUrl: string;
      companyId: number;
      authorization: string;
    }>
  | undefined {
  const runtime = configuration.runtime;
  const baseUrl = safeBaseUrl(runtime.baseUrl);
  if (
    baseUrl === undefined ||
    !positiveSafeInteger(runtime.companyId) ||
    runtime.partnerToken.length === 0 ||
    runtime.userToken.length === 0 ||
    !positiveSafeInteger(configuration.requestTimeoutMilliseconds)
  ) {
    return undefined;
  }
  return Object.freeze({
    baseUrl,
    companyId: runtime.companyId,
    authorization: `Bearer ${runtime.partnerToken}, User ${runtime.userToken}`,
  });
}

function classifyStatus(status: number, exact: boolean): ReadFailure | undefined {
  if (status === 401 || status === 403) {
    return Object.freeze({ outcome: 'unauthorized' as const });
  }
  if (exact && status === 404) {
    return Object.freeze({ outcome: 'not_found' as const });
  }
  if (status === 429) {
    return Object.freeze({ outcome: 'rate_limited' as const });
  }
  if (status === 408 || status === 425 || status >= 500) {
    return Object.freeze({ outcome: 'unavailable' as const });
  }
  if (status >= 400 && status < 500) {
    return Object.freeze({ outcome: 'rejected' as const });
  }
  return status === 200
    ? undefined
    : Object.freeze({ outcome: 'unknown' as const });
}

export class YclientsAdminReadClient {
  private readonly limiter: YclientsConservativeRequestLimiter;

  constructor(private readonly configuration: YclientsAdminReadClientConfiguration) {
    if (configuration.limiter === undefined) {
      throw new TypeError('Shared YCLIENTS request limiter is required');
    }
    this.limiter = configuration.limiter;
  }

  async getRecord(recordId: number): Promise<YclientsExactAdminRecordResult> {
    if (!this.configuration.runtime.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const configured = configurationValues(this.configuration);
    if (configured === undefined || !positiveSafeInteger(recordId)) {
      return Object.freeze({ outcome: 'invalid_request' as const });
    }

    return this.limiter.run(async () => {
      try {
        const url = new URL(
          `api/v1/record/${configured.companyId}/${recordId}`,
          `${configured.baseUrl}/`,
        );
        const response = await this.configuration.fetch(url, {
          method: 'GET',
          headers: {
            accept: YCLIENTS_ACCEPT,
            authorization: configured.authorization,
          },
          signal: AbortSignal.timeout(
            this.configuration.requestTimeoutMilliseconds,
          ),
        });
        const classified = classifyStatus(response.status, true);
        if (classified !== undefined) {
          await cancelBody(response.body);
          return classified;
        }

        const body = await readBody(response, MAX_EXACT_RESPONSE_BYTES);
        const record =
          body?.success === true
            ? readSafeAdminRecord(body.data, configured.companyId)
            : undefined;
        if (record === undefined || record.recordId !== recordId) {
          return Object.freeze({ outcome: 'unknown' as const });
        }
        return Object.freeze({ outcome: 'found' as const, record });
      } catch {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
    });
  }

  async listRecords(
    query: YclientsBoundedAdminRecordsQuery,
  ): Promise<YclientsBoundedAdminRecordsResult> {
    if (!this.configuration.runtime.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const configured = configurationValues(this.configuration);
    const dateFrom = readIsoDate(query?.dateFrom);
    const dateTo = readIsoDate(query?.dateTo);
    const fromMilliseconds =
      dateFrom === undefined
        ? Number.NaN
        : Date.parse(`${dateFrom}T00:00:00.000Z`);
    const toMilliseconds =
      dateTo === undefined
        ? Number.NaN
        : Date.parse(`${dateTo}T00:00:00.000Z`);
    const rangeDays =
      (toMilliseconds - fromMilliseconds) / DAY_MILLISECONDS + 1;
    if (
      configured === undefined ||
      !positiveSafeInteger(query?.page) ||
      query.page > MAX_RECORD_PAGE ||
      !positiveSafeInteger(query?.count) ||
      query.count > MAX_RECORDS_PER_PAGE ||
      !positiveSafeInteger(query?.resourceId) ||
      dateFrom === undefined ||
      dateTo === undefined ||
      !Number.isInteger(rangeDays) ||
      rangeDays <= 0 ||
      rangeDays > MAX_RECORD_RANGE_DAYS ||
      typeof query.withDeleted !== 'boolean'
    ) {
      return Object.freeze({ outcome: 'invalid_request' as const });
    }

    return this.limiter.run(async () => {
      try {
        const url = new URL(
          `api/v1/records/${configured.companyId}`,
          `${configured.baseUrl}/`,
        );
        url.searchParams.set('page', String(query.page));
        url.searchParams.set('count', String(query.count));
        url.searchParams.set('staff_id', String(query.resourceId));
        url.searchParams.set('start_date', dateFrom);
        url.searchParams.set('end_date', dateTo);
        url.searchParams.set('with_deleted', query.withDeleted ? '1' : '0');
        const response = await this.configuration.fetch(url, {
          method: 'GET',
          headers: {
            accept: YCLIENTS_ACCEPT,
            authorization: configured.authorization,
          },
          signal: AbortSignal.timeout(
            this.configuration.requestTimeoutMilliseconds,
          ),
        });
        const classified = classifyStatus(response.status, false);
        if (classified !== undefined) {
          await cancelBody(response.body);
          return classified.outcome === 'not_found'
            ? Object.freeze({ outcome: 'rejected' as const })
            : classified;
        }

        const body = await readBody(response, MAX_LIST_RESPONSE_BYTES);
        if (
          body?.success !== true ||
          !Array.isArray(body.data) ||
          body.data.length > query.count
        ) {
          return Object.freeze({ outcome: 'unknown' as const });
        }
        const pagination = readPagination(
          body.meta,
          query.page,
          query.count,
          body.data.length,
        );
        if (pagination === undefined) {
          return Object.freeze({ outcome: 'unknown' as const });
        }
        const records = body.data.map((value) =>
          readSafeAdminRecord(value, configured.companyId),
        );
        if (
          records.some((record) => record === undefined) ||
          new Set(records.map((record) => record?.recordId)).size !==
            records.length
        ) {
          return Object.freeze({ outcome: 'unknown' as const });
        }
        return Object.freeze({
          outcome: 'loaded' as const,
          page: query.page,
          count: query.count,
          totalCount: pagination.totalCount,
          exhaustive: pagination.exhaustive,
          records: Object.freeze(records as ReadonlyArray<YclientsSafeAdminRecord>),
        });
      } catch {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
    });
  }
}
