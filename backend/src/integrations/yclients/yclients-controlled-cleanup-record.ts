import type { YclientsSafeAdminRecord } from './yclients-admin-read.client';
import type { YclientsCreateBookingCommand } from './yclients-api.client';
import { normalizeYclientsSystemApiId } from './yclients-api-id';

const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_SERVICES = 64;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type YclientsControlledCleanupRecordExpectation = Readonly<{
  companyId: number;
  recordId: number;
  apiId: number;
  resourceId: number;
  serviceId: number;
  datetime: string;
  deleted: boolean;
  client: YclientsCreateBookingCommand['client'];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validIsoDatetime(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATETIME_PATTERN.test(value)) {
    return false;
  }
  const date = value.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  return (
    Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === date &&
    Number.isFinite(Date.parse(value))
  );
}

function canonicalText(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return undefined;
  }
  const normalized = value.trim();
  return allowEmpty || normalized.length > 0 ? normalized : undefined;
}

function canonicalClient(
  value: unknown,
): YclientsCreateBookingCommand['client'] | undefined {
  if (!isRecord(value)) return undefined;
  const phone = canonicalText(value.phone, 32);
  const name = canonicalText(value.name, 256);
  const surname = canonicalText(value.surname, 256, true);
  const patronymic = canonicalText(value.patronymic, 256, true);
  const email = canonicalText(value.email, 320);
  if (
    phone === undefined ||
    !/^\d{10,15}$/u.test(phone) ||
    name === undefined ||
    surname === undefined ||
    patronymic === undefined ||
    email === undefined ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    return undefined;
  }
  return Object.freeze({
    phone,
    fullName: [name, surname, patronymic]
      .filter((part) => part.length > 0)
      .join(' '),
    email,
  });
}

function consistentId(
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

function serviceIds(value: unknown): ReadonlyArray<number> | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SERVICES) {
    return undefined;
  }
  const ids = value.map((service) =>
    isRecord(service) && positiveSafeInteger(service.id)
      ? Number(service.id)
      : undefined,
  );
  if (
    ids.some((id) => id === undefined) ||
    new Set(ids).size !== ids.length
  ) {
    return undefined;
  }
  return Object.freeze(
    (ids as number[]).slice().sort((left, right) => left - right),
  );
}

export function isValidYclientsControlledCleanupExpectation(
  value: YclientsControlledCleanupRecordExpectation,
): boolean {
  const client = value?.client;
  return (
    positiveSafeInteger(value?.companyId) &&
    positiveSafeInteger(value?.recordId) &&
    positiveSafeInteger(value?.apiId) &&
    positiveSafeInteger(value?.resourceId) &&
    positiveSafeInteger(value?.serviceId) &&
    validIsoDatetime(value?.datetime) &&
    typeof value?.deleted === 'boolean' &&
    typeof client?.phone === 'string' &&
    client.phone.trim() === client.phone &&
    /^\d{10,15}$/u.test(client.phone) &&
    typeof client?.fullName === 'string' &&
    client.fullName.trim() === client.fullName &&
    client.fullName.length > 0 &&
    Buffer.byteLength(client.fullName, 'utf8') <= 256 &&
    !CONTROL_CHARACTER_PATTERN.test(client.fullName) &&
    typeof client?.email === 'string' &&
    client.email.trim() === client.email &&
    Buffer.byteLength(client.email, 'utf8') <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(client.email) &&
    !CONTROL_CHARACTER_PATTERN.test(client.email)
  );
}

/**
 * Strict PII-bearing comparison for the isolated cleanup harness. The returned
 * projection contains no client data, record hash or raw provider fields.
 */
export function readYclientsControlledCleanupRecord(
  value: unknown,
  expected: YclientsControlledCleanupRecordExpectation,
): YclientsSafeAdminRecord | undefined {
  if (
    !isValidYclientsControlledCleanupExpectation(expected) ||
    !isRecord(value) ||
    value.id !== expected.recordId
  ) {
    return undefined;
  }
  const companyId = consistentId(value, 'company_id', 'company');
  const resourceId = consistentId(value, 'staff_id', 'staff');
  const services = serviceIds(value.services);
  const apiId = normalizeYclientsSystemApiId(value.api_id);
  const client = canonicalClient(value.client);
  if (
    companyId !== expected.companyId ||
    resourceId !== expected.resourceId ||
    services?.length !== 1 ||
    services[0] !== expected.serviceId ||
    value.datetime !== expected.datetime ||
    !validIsoDatetime(value.datetime) ||
    value.deleted !== expected.deleted ||
    apiId.outcome !== 'present' ||
    apiId.value !== expected.apiId ||
    client?.phone !== expected.client.phone ||
    client?.fullName !== expected.client.fullName ||
    client?.email !== expected.client.email
  ) {
    return undefined;
  }
  return Object.freeze({
    recordId: expected.recordId,
    companyId,
    resourceId,
    serviceIds: services,
    datetime: expected.datetime,
    deleted: expected.deleted,
    apiId: expected.apiId,
  });
}
