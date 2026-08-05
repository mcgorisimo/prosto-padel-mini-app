import type { YclientsApiConfiguration } from '../../config/yclients-api.config';

const MAX_RESPONSE_BYTES = 65_536;
const MAX_BOOKING_DATE_RANGE_DAYS = 31;
const MAX_SERVICE_FILTER_IDS = 64;
const MAX_SEANCE_LENGTH_SECONDS = 86_400;
const DAY_MILLISECONDS = 86_400_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/u;
const YCLIENTS_ACCEPT = 'application/vnd.yclients.v2+json';

export type YclientsCompanyProbeResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{ outcome: 'verified'; companyId: number; title?: string }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'company_not_found' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export type YclientsBookableService = Readonly<{
  id: number;
  title: string;
  categoryId: number;
  active: boolean;
}>;

export type YclientsBookableServicesResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{
      outcome: 'loaded';
      services: ReadonlyArray<YclientsBookableService>;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export type YclientsBookableResource = Readonly<{
  id: number;
  name: string;
  specialization: string;
  positionTitle?: string;
  bookable: boolean;
}>;

export type YclientsBookableResourcesResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{
      outcome: 'loaded';
      resources: ReadonlyArray<YclientsBookableResource>;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export type YclientsBookableDatesQuery = Readonly<{
  serviceIds: ReadonlyArray<number>;
  resourceId: number;
  dateFrom: string;
  dateTo: string;
}>;

export type YclientsBookableDatesResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{
      outcome: 'loaded';
      workingDates: ReadonlyArray<string>;
      bookingDates: ReadonlyArray<string>;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export type YclientsBookableTimesQuery = Readonly<{
  serviceIds: ReadonlyArray<number>;
  resourceId: number;
  date: string;
}>;

export type YclientsBookableTime = Readonly<{
  time: string;
  seanceLengthSeconds: number;
  datetime: string;
}>;

export type YclientsBookableTimesResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{
      outcome: 'loaded';
      times: ReadonlyArray<YclientsBookableTime>;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export interface YclientsApiClientConfiguration {
  readonly runtime: YclientsApiConfiguration;
  readonly requestTimeoutMilliseconds: number;
  readonly fetch: typeof globalThis.fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBody(text: string): Record<string, unknown> | undefined {
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readBookableService(
  value: unknown,
): YclientsBookableService | undefined {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    Number(value.id) <= 0 ||
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    !Number.isSafeInteger(value.category_id) ||
    Number(value.category_id) <= 0 ||
    (value.active !== 0 && value.active !== 1)
  ) {
    return undefined;
  }

  return Object.freeze({
    id: Number(value.id),
    title: value.title.trim().slice(0, 256),
    categoryId: Number(value.category_id),
    active: value.active === 1,
  });
}

function readBookableResource(
  value: unknown,
): YclientsBookableResource | undefined {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    Number(value.id) <= 0 ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    typeof value.specialization !== 'string' ||
    typeof value.bookable !== 'boolean'
  ) {
    return undefined;
  }

  const positionTitle =
    isRecord(value.position) &&
    typeof value.position.title === 'string' &&
    value.position.title.trim().length > 0
      ? value.position.title.trim().slice(0, 256)
      : undefined;

  return Object.freeze({
    id: Number(value.id),
    name: value.name.trim().slice(0, 256),
    specialization: value.specialization.trim().slice(0, 256),
    ...(positionTitle === undefined ? {} : { positionTitle }),
    bookable: value.bookable,
  });
}

function readIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return undefined;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    return undefined;
  }
  return value;
}

function readIsoDateList(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const dates = value.map(readIsoDate);
  if (dates.some((date) => date === undefined)) return undefined;
  return Object.freeze([...new Set(dates as ReadonlyArray<string>)]);
}

function readBookableTime(
  value: unknown,
  expectedDate: string,
): YclientsBookableTime | undefined {
  if (!isRecord(value) || typeof value.time !== 'string') {
    return undefined;
  }
  const timeMatch = TIME_PATTERN.exec(value.time);
  const hour = Number(timeMatch?.[1]);
  const minute = Number(timeMatch?.[2]);
  const normalizedTime = timeMatch === null || hour > 23 || minute > 59
    ? undefined
    : `${String(hour).padStart(2, '0')}:${timeMatch[2]}`;
  if (
    normalizedTime === undefined ||
    !Number.isSafeInteger(value.seance_length) ||
    Number(value.seance_length) <= 0 ||
    Number(value.seance_length) > MAX_SEANCE_LENGTH_SECONDS ||
    typeof value.datetime !== 'string' ||
    !ISO_DATETIME_PATTERN.test(value.datetime) ||
    !value.datetime.startsWith(`${expectedDate}T`) ||
    value.datetime.slice(11, 16) !== normalizedTime ||
    !Number.isFinite(Date.parse(value.datetime))
  ) {
    return undefined;
  }

  return Object.freeze({
    time: normalizedTime,
    seanceLengthSeconds: Number(value.seance_length),
    datetime: value.datetime,
  });
}

export class YclientsApiClient {
  constructor(private readonly configuration: YclientsApiClientConfiguration) {}

  async listBookableTimes(
    query: YclientsBookableTimesQuery,
  ): Promise<YclientsBookableTimesResult> {
    const runtime = this.configuration.runtime;
    if (!runtime.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const companyId = runtime.companyId;
    const date = readIsoDate(query?.date);
    if (
      runtime.baseUrl.length === 0 ||
      typeof companyId !== 'number' ||
      !Number.isSafeInteger(companyId) ||
      companyId <= 0 ||
      runtime.partnerToken.length === 0 ||
      !Array.isArray(query?.serviceIds) ||
      query.serviceIds.length === 0 ||
      query.serviceIds.length > MAX_SERVICE_FILTER_IDS ||
      query.serviceIds.some(
        (serviceId) =>
          !Number.isSafeInteger(serviceId) || Number(serviceId) <= 0,
      ) ||
      !Number.isSafeInteger(query?.resourceId) ||
      Number(query.resourceId) <= 0 ||
      date === undefined
    ) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }

    try {
      const url = new URL(
        `api/v1/book_times/${companyId}/${query.resourceId}/${date}`,
        `${runtime.baseUrl}/`,
      );
      for (const serviceId of new Set(query.serviceIds)) {
        url.searchParams.append('service_ids[]', String(serviceId));
      }
      const response = await this.configuration.fetch(url, {
        method: 'GET',
        headers: {
          accept: YCLIENTS_ACCEPT,
          authorization: `Bearer ${runtime.partnerToken}`,
        },
        signal: AbortSignal.timeout(
          this.configuration.requestTimeoutMilliseconds,
        ),
      });

      if (response.status === 401 || response.status === 403) {
        return Object.freeze({ outcome: 'unauthorized' as const });
      }
      if (response.status === 429 || response.status >= 500) {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
      if (response.status < 200 || response.status >= 300) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      const body = readBody(await response.text());
      if (body?.success !== true || !Array.isArray(body.data)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }
      const times = body.data.map((value) => readBookableTime(value, date));
      if (times.some((time) => time === undefined)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      return Object.freeze({
        outcome: 'loaded' as const,
        times: Object.freeze(times as ReadonlyArray<YclientsBookableTime>),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }

  async listBookableDates(
    query: YclientsBookableDatesQuery,
  ): Promise<YclientsBookableDatesResult> {
    const runtime = this.configuration.runtime;
    if (!runtime.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const companyId = runtime.companyId;
    const dateFromTimestamp = readIsoDate(query?.dateFrom);
    const dateToTimestamp = readIsoDate(query?.dateTo);
    const dateFromMilliseconds =
      dateFromTimestamp === undefined
        ? Number.NaN
        : Date.parse(`${dateFromTimestamp}T00:00:00.000Z`);
    const dateToMilliseconds =
      dateToTimestamp === undefined
        ? Number.NaN
        : Date.parse(`${dateToTimestamp}T00:00:00.000Z`);
    const rangeDays =
      (dateToMilliseconds - dateFromMilliseconds) / DAY_MILLISECONDS + 1;
    if (
      runtime.baseUrl.length === 0 ||
      typeof companyId !== 'number' ||
      !Number.isSafeInteger(companyId) ||
      companyId <= 0 ||
      runtime.partnerToken.length === 0 ||
      !Array.isArray(query?.serviceIds) ||
      query.serviceIds.length === 0 ||
      query.serviceIds.length > MAX_SERVICE_FILTER_IDS ||
      query.serviceIds.some(
        (serviceId) =>
          !Number.isSafeInteger(serviceId) || Number(serviceId) <= 0,
      ) ||
      !Number.isSafeInteger(query?.resourceId) ||
      Number(query.resourceId) <= 0 ||
      dateFromTimestamp === undefined ||
      dateToTimestamp === undefined ||
      !Number.isInteger(rangeDays) ||
      rangeDays <= 0 ||
      rangeDays > MAX_BOOKING_DATE_RANGE_DAYS
    ) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }

    try {
      const url = new URL(
        `api/v1/book_dates/${companyId}`,
        `${runtime.baseUrl}/`,
      );
      for (const serviceId of new Set(query.serviceIds)) {
        url.searchParams.append('service_ids[]', String(serviceId));
      }
      url.searchParams.set('staff_id', String(query.resourceId));
      url.searchParams.set('date_from', dateFromTimestamp);
      url.searchParams.set('date_to', dateToTimestamp);
      const response = await this.configuration.fetch(url, {
        method: 'GET',
        headers: {
          accept: YCLIENTS_ACCEPT,
          authorization: `Bearer ${runtime.partnerToken}`,
        },
        signal: AbortSignal.timeout(
          this.configuration.requestTimeoutMilliseconds,
        ),
      });

      if (response.status === 401 || response.status === 403) {
        return Object.freeze({ outcome: 'unauthorized' as const });
      }
      if (response.status === 429 || response.status >= 500) {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
      if (response.status < 200 || response.status >= 300) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      const body = readBody(await response.text());
      if (body?.success !== true || !isRecord(body.data)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }
      const workingDates = readIsoDateList(body.data.working_dates);
      const bookingDates = readIsoDateList(body.data.booking_dates);
      if (workingDates === undefined || bookingDates === undefined) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      return Object.freeze({
        outcome: 'loaded' as const,
        workingDates,
        bookingDates,
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }

  async listBookableResources(
    serviceIds: ReadonlyArray<number> = [],
  ): Promise<YclientsBookableResourcesResult> {
    const runtime = this.configuration.runtime;
    if (!runtime.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const companyId = runtime.companyId;
    if (
      runtime.baseUrl.length === 0 ||
      typeof companyId !== 'number' ||
      !Number.isSafeInteger(companyId) ||
      companyId <= 0 ||
      runtime.partnerToken.length === 0 ||
      !Array.isArray(serviceIds) ||
      serviceIds.length > MAX_SERVICE_FILTER_IDS ||
      serviceIds.some(
        (serviceId) =>
          !Number.isSafeInteger(serviceId) || Number(serviceId) <= 0,
      )
    ) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }

    try {
      const url = new URL(
        `api/v1/book_staff/${companyId}`,
        `${runtime.baseUrl}/`,
      );
      for (const serviceId of new Set(serviceIds)) {
        url.searchParams.append('service_ids[]', String(serviceId));
      }
      const response = await this.configuration.fetch(url, {
        method: 'GET',
        headers: {
          accept: YCLIENTS_ACCEPT,
          authorization: `Bearer ${runtime.partnerToken}`,
        },
        signal: AbortSignal.timeout(
          this.configuration.requestTimeoutMilliseconds,
        ),
      });

      if (response.status === 401 || response.status === 403) {
        return Object.freeze({ outcome: 'unauthorized' as const });
      }
      if (response.status === 429 || response.status >= 500) {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
      if (response.status < 200 || response.status >= 300) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      const body = readBody(await response.text());
      if (body?.success !== true || !Array.isArray(body.data)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      const resources = body.data.map(readBookableResource);
      if (resources.some((resource) => resource === undefined)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      return Object.freeze({
        outcome: 'loaded' as const,
        resources: Object.freeze(
          resources as ReadonlyArray<YclientsBookableResource>,
        ),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }

  async listBookableServices(): Promise<YclientsBookableServicesResult> {
    const runtime = this.configuration.runtime;
    if (!runtime.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const companyId = runtime.companyId;
    if (
      runtime.baseUrl.length === 0 ||
      typeof companyId !== 'number' ||
      !Number.isSafeInteger(companyId) ||
      companyId <= 0 ||
      runtime.partnerToken.length === 0
    ) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }

    try {
      const url = new URL(
        `api/v1/book_services/${companyId}`,
        `${runtime.baseUrl}/`,
      );
      const response = await this.configuration.fetch(url, {
        method: 'GET',
        headers: {
          accept: YCLIENTS_ACCEPT,
          authorization: `Bearer ${runtime.partnerToken}`,
        },
        signal: AbortSignal.timeout(
          this.configuration.requestTimeoutMilliseconds,
        ),
      });

      if (response.status === 401 || response.status === 403) {
        return Object.freeze({ outcome: 'unauthorized' as const });
      }
      if (response.status === 429 || response.status >= 500) {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
      if (response.status < 200 || response.status >= 300) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      const body = readBody(await response.text());
      if (
        body?.success !== true ||
        !isRecord(body.data) ||
        !Array.isArray(body.data.services)
      ) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      const services = body.data.services.map(readBookableService);
      if (services.some((service) => service === undefined)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      return Object.freeze({
        outcome: 'loaded' as const,
        services: Object.freeze(
          services as ReadonlyArray<YclientsBookableService>,
        ),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }

  async probeConfiguredCompany(): Promise<YclientsCompanyProbeResult> {
    const runtime = this.configuration.runtime;
    if (!runtime.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const companyId = runtime.companyId;
    if (
      runtime.baseUrl.length === 0 ||
      typeof companyId !== 'number' ||
      !Number.isSafeInteger(companyId) ||
      companyId <= 0 ||
      runtime.partnerToken.length === 0 ||
      runtime.userToken.length === 0
    ) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }

    try {
      const url = new URL('api/v1/companies', `${runtime.baseUrl}/`);
      url.searchParams.set('my', '1');
      const response = await this.configuration.fetch(url, {
        method: 'GET',
        headers: {
          accept: YCLIENTS_ACCEPT,
          authorization: `Bearer ${runtime.partnerToken}, User ${runtime.userToken}`,
        },
        signal: AbortSignal.timeout(
          this.configuration.requestTimeoutMilliseconds,
        ),
      });

      if (response.status === 401 || response.status === 403) {
        return Object.freeze({ outcome: 'unauthorized' as const });
      }
      if (response.status === 429 || response.status >= 500) {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
      if (response.status < 200 || response.status >= 300) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      const body = readBody(await response.text());
      if (body?.success !== true || !Array.isArray(body.data)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }
      const company = body.data.find(
        (value) =>
          isRecord(value) &&
          Number.isSafeInteger(value.id) &&
          Number(value.id) === companyId,
      );
      if (!isRecord(company)) {
        return Object.freeze({ outcome: 'company_not_found' as const });
      }
      const title =
        typeof company.title === 'string' && company.title.length > 0
          ? company.title.slice(0, 256)
          : undefined;
      return Object.freeze({
        outcome: 'verified' as const,
        companyId,
        ...(title === undefined ? {} : { title }),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }
}
