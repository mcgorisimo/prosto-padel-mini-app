import { isCanonicalSessionCredential } from './sessionCredential';

const BOOKINGS_PATH = '/api/v1/bookings';
const SERVICES_PATH = `${BOOKINGS_PATH}/services`;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BODY_BYTES = 262_144;
const MAX_SERVICES = 128;
const MAX_COURTS = 128;
const MAX_DATES = 31;
const MAX_TIMES = 288;
const DAY_MILLISECONDS = 86_400_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PHONE_PATTERN = /^\d{10,15}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

class InvalidResponseBodyError extends Error {}

function frozen(outcome, extra = {}) {
  return Object.freeze({ outcome, ...extra });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function readIsoDateMilliseconds(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return undefined;
  }
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== value
  ) {
    return undefined;
  }
  return milliseconds;
}

function isSafeLabel(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 160 &&
    value.trim() === value
  );
}

function readServices(body) {
  if (!hasExactKeys(body, ['services']) || !Array.isArray(body.services)) {
    return undefined;
  }
  if (body.services.length > MAX_SERVICES) return undefined;
  const seenIds = new Set();
  const services = [];
  for (const value of body.services) {
    if (
      !hasExactKeys(value, ['id', 'title', 'categoryId']) ||
      !isPositiveSafeInteger(value.id) ||
      !isSafeLabel(value.title) ||
      !isPositiveSafeInteger(value.categoryId) ||
      seenIds.has(value.id)
    ) {
      return undefined;
    }
    seenIds.add(value.id);
    services.push(Object.freeze({
      id: value.id,
      title: value.title,
      categoryId: value.categoryId,
    }));
  }
  return frozen('services_loaded', { services: Object.freeze(services) });
}

function readCourts(body) {
  if (!hasExactKeys(body, ['courts']) || !Array.isArray(body.courts)) {
    return undefined;
  }
  if (body.courts.length > MAX_COURTS) return undefined;
  const seenIds = new Set();
  const courts = [];
  for (const value of body.courts) {
    if (
      !hasExactKeys(value, ['id', 'name']) ||
      !isPositiveSafeInteger(value.id) ||
      !isSafeLabel(value.name) ||
      seenIds.has(value.id)
    ) {
      return undefined;
    }
    seenIds.add(value.id);
    courts.push(Object.freeze({ id: value.id, name: value.name }));
  }
  return frozen('courts_loaded', { courts: Object.freeze(courts) });
}

function readDates(body) {
  if (!hasExactKeys(body, ['dates']) || !Array.isArray(body.dates)) {
    return undefined;
  }
  if (body.dates.length > MAX_DATES) return undefined;
  const dates = [];
  for (const value of body.dates) {
    if (
      readIsoDateMilliseconds(value) === undefined ||
      (dates.length > 0 && dates[dates.length - 1] >= value)
    ) {
      return undefined;
    }
    dates.push(value);
  }
  return frozen('dates_loaded', { dates: Object.freeze(dates) });
}

function readTimes(body, expectedDate) {
  if (!hasExactKeys(body, ['times']) || !Array.isArray(body.times)) {
    return undefined;
  }
  if (body.times.length > MAX_TIMES) return undefined;
  const times = [];
  for (const value of body.times) {
    if (
      !hasExactKeys(value, ['time', 'durationSeconds', 'datetime']) ||
      typeof value.time !== 'string' ||
      !TIME_PATTERN.test(value.time) ||
      !isPositiveSafeInteger(value.durationSeconds) ||
      value.durationSeconds > 86_400 ||
      typeof value.datetime !== 'string' ||
      !value.datetime.startsWith(`${expectedDate}T${value.time}:`) ||
      !Number.isFinite(Date.parse(value.datetime)) ||
      (times.length > 0 && times[times.length - 1].time >= value.time)
    ) {
      return undefined;
    }
    times.push(Object.freeze({
      time: value.time,
      durationSeconds: value.durationSeconds,
      datetime: value.datetime,
    }));
  }
  return frozen('times_loaded', { times: Object.freeze(times) });
}

function readCreatedBooking(body) {
  if (
    !hasExactKeys(body, ['recordId']) ||
    !isPositiveSafeInteger(body.recordId)
  ) {
    return undefined;
  }
  return frozen('booking_created', { recordId: body.recordId });
}

function readCreateBookingCommand(value) {
  if (
    !hasExactKeys(value, [
      'requestKey',
      'serviceId',
      'courtId',
      'datetime',
      'client',
    ]) ||
    typeof value.requestKey !== 'string' ||
    !UUID_PATTERN.test(value.requestKey) ||
    !isPositiveSafeInteger(value.serviceId) ||
    !isPositiveSafeInteger(value.courtId) ||
    typeof value.datetime !== 'string' ||
    !ISO_DATETIME_PATTERN.test(value.datetime) ||
    !Number.isFinite(Date.parse(value.datetime)) ||
    !hasExactKeys(value.client, ['phone', 'fullName', 'email']) ||
    typeof value.client.phone !== 'string' ||
    !PHONE_PATTERN.test(value.client.phone) ||
    typeof value.client.fullName !== 'string' ||
    value.client.fullName.length === 0 ||
    value.client.fullName.length > 256 ||
    value.client.fullName.trim() !== value.client.fullName ||
    typeof value.client.email !== 'string' ||
    value.client.email.length > 320 ||
    value.client.email.trim() !== value.client.email ||
    !EMAIL_PATTERN.test(value.client.email)
  ) {
    return undefined;
  }
  return Object.freeze({
    requestKey: value.requestKey.toLowerCase(),
    serviceId: value.serviceId,
    courtId: value.courtId,
    datetime: value.datetime,
    client: Object.freeze({
      phone: value.client.phone,
      fullName: value.client.fullName,
      email: value.client.email,
    }),
  });
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:;|$)/iu.test(contentType)) {
    throw new InvalidResponseBodyError();
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_RESPONSE_BODY_BYTES)
  ) {
    throw new InvalidResponseBodyError();
  }

  const reader = response.body?.getReader();
  if (reader === undefined) throw new InvalidResponseBodyError();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
      await reader.cancel();
      throw new InvalidResponseBodyError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new InvalidResponseBodyError();
  }
}

function rejected(reason) {
  return frozen('rejected', { reason });
}

function mapHttpFailure(status) {
  if (status === 400) return rejected('invalid_request');
  if (status === 401) return rejected('invalid');
  if (status === 502) return rejected('invalid_response');
  if (status === 503) return rejected('unavailable');
  return rejected('internal_error');
}

export function createBookingAvailabilityClient(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const requestTimeoutMs =
    dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const setTimer = dependencies.setTimer ?? globalThis.setTimeout;
  const clearTimer = dependencies.clearTimer ?? globalThis.clearTimeout;

  async function request(credential, path, parse, options = {}) {
    if (!isCanonicalSessionCredential(credential)) {
      return rejected('invalid');
    }
    if (typeof fetchImpl !== 'function' || !isPositiveSafeInteger(requestTimeoutMs)) {
      return rejected('internal_error');
    }
    if (options.signal?.aborted) return frozen('cancelled');

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });

    try {
      const response = await fetchImpl(path, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credential}`,
        },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status !== 200) return mapHttpFailure(response.status);
      const result = parse(await readResponseBody(response));
      return result ?? rejected('invalid_response');
    } catch (error) {
      if (options.signal?.aborted) return frozen('cancelled');
      if (timedOut) return rejected('request_timeout');
      if (error instanceof InvalidResponseBodyError) {
        return rejected('invalid_response');
      }
      return rejected('network_failure');
    } finally {
      clearTimer(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async function createRequest(credential, command, options = {}) {
    if (!isCanonicalSessionCredential(credential)) {
      return rejected('invalid');
    }
    const body = readCreateBookingCommand(command);
    if (body === undefined) return rejected('invalid_request');
    if (typeof fetchImpl !== 'function' || !isPositiveSafeInteger(requestTimeoutMs)) {
      return rejected('internal_error');
    }
    if (options.signal?.aborted) return frozen('cancelled');

    const controller = new AbortController();
    const timeout = setTimer(() => controller.abort(), requestTimeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    let requestStarted = false;

    try {
      requestStarted = true;
      const response = await fetchImpl(BOOKINGS_PATH, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 201) {
        const result = readCreatedBooking(await readResponseBody(response));
        return result ?? rejected('unknown_outcome');
      }
      if (response.status === 400) return rejected('invalid_request');
      if (response.status === 401) return rejected('invalid');
      if (response.status === 409) return rejected('not_bookable');
      if (response.status === 422) return rejected('provider_rejected');
      if (response.status === 503) return rejected('unavailable');
      return rejected('unknown_outcome');
    } catch {
      return requestStarted
        ? rejected('unknown_outcome')
        : rejected('internal_error');
    } finally {
      clearTimer(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  return Object.freeze({
    listServices(credential, options) {
      return request(credential, SERVICES_PATH, readServices, options);
    },
    listCourts(credential, serviceId, options) {
      if (!isPositiveSafeInteger(serviceId)) {
        return Promise.resolve(rejected('invalid_request'));
      }
      return request(
        credential,
        `${SERVICES_PATH}/${serviceId}/courts`,
        readCourts,
        options,
      );
    },
    listDates(credential, query, options) {
      const dateFromMilliseconds = readIsoDateMilliseconds(query?.dateFrom);
      const dateToMilliseconds = readIsoDateMilliseconds(query?.dateTo);
      const rangeDays =
        dateFromMilliseconds === undefined || dateToMilliseconds === undefined
          ? Number.NaN
          : (dateToMilliseconds - dateFromMilliseconds) / DAY_MILLISECONDS + 1;
      if (
        !isPositiveSafeInteger(query?.serviceId) ||
        !isPositiveSafeInteger(query?.courtId) ||
        dateFromMilliseconds === undefined ||
        dateToMilliseconds === undefined ||
        !Number.isInteger(rangeDays) ||
        rangeDays < 1 ||
        rangeDays > MAX_DATES
      ) {
        return Promise.resolve(rejected('invalid_request'));
      }
      const parameters = new URLSearchParams({
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      });
      return request(
        credential,
        `${SERVICES_PATH}/${query.serviceId}/courts/${query.courtId}/dates?${parameters}`,
        readDates,
        options,
      );
    },
    listTimes(credential, query, options) {
      if (
        !isPositiveSafeInteger(query?.serviceId) ||
        !isPositiveSafeInteger(query?.courtId) ||
        readIsoDateMilliseconds(query?.date) === undefined
      ) {
        return Promise.resolve(rejected('invalid_request'));
      }
      const parameters = new URLSearchParams({ date: query.date });
      return request(
        credential,
        `${SERVICES_PATH}/${query.serviceId}/courts/${query.courtId}/times?${parameters}`,
        (body) => readTimes(body, query.date),
        options,
      );
    },
    createBooking(credential, command, options) {
      return createRequest(credential, command, options);
    },
  });
}

export const bookingAvailabilityClient = createBookingAvailabilityClient();
