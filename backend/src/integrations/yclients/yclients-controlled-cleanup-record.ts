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

export type YclientsControlledCleanupFieldCheck = Readonly<{
  present: boolean;
  typeValid: boolean;
  equal: boolean;
}>;

export type YclientsControlledCleanupBindingChecks = Readonly<{
  recordId: YclientsControlledCleanupFieldCheck;
  companyId: YclientsControlledCleanupFieldCheck;
  resourceId: YclientsControlledCleanupFieldCheck;
  services: YclientsControlledCleanupFieldCheck;
  datetime: YclientsControlledCleanupFieldCheck;
  deleted: YclientsControlledCleanupFieldCheck;
  apiId: YclientsControlledCleanupFieldCheck;
  clientPhone: YclientsControlledCleanupFieldCheck;
  clientFullName: YclientsControlledCleanupFieldCheck;
  clientEmail: YclientsControlledCleanupFieldCheck;
}>;

export type YclientsControlledCleanupBindingInspection = Readonly<{
  record?: YclientsSafeAdminRecord;
  checks: YclientsControlledCleanupBindingChecks;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function fieldCheck(
  isPresent: boolean,
  typeValid: boolean,
  equal: boolean,
): YclientsControlledCleanupFieldCheck {
  return Object.freeze({
    present: isPresent,
    typeValid,
    equal: typeValid && equal,
  });
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
 * Inspects the isolated cleanup binding without returning provider values.
 * Diagnostics contain presence/type/equality booleans only; PII stays in
 * local variables long enough to perform the exact comparison.
 */
export function inspectYclientsControlledCleanupRecord(
  value: unknown,
  expected: YclientsControlledCleanupRecordExpectation,
): YclientsControlledCleanupBindingInspection | undefined {
  if (!isValidYclientsControlledCleanupExpectation(expected) || !isRecord(value)) {
    return undefined;
  }

  const companyId = consistentId(value, 'company_id', 'company');
  const resourceId = consistentId(value, 'staff_id', 'staff');
  const services = serviceIds(value.services);
  const apiId = normalizeYclientsSystemApiId(value.api_id);
  const clientValue = isRecord(value.client) ? value.client : undefined;
  const client = canonicalClient(value.client);

  const phone =
    clientValue === undefined ? undefined : canonicalText(clientValue.phone, 32);
  const phoneTypeValid = phone !== undefined && /^\d{10,15}$/u.test(phone);

  const name =
    clientValue === undefined ? undefined : canonicalText(clientValue.name, 256);
  const surname =
    clientValue === undefined
      ? undefined
      : canonicalText(clientValue.surname, 256, true);
  const patronymic =
    clientValue === undefined
      ? undefined
      : canonicalText(clientValue.patronymic, 256, true);
  const fullNameTypeValid =
    name !== undefined && surname !== undefined && patronymic !== undefined;
  const fullName = fullNameTypeValid
    ? [name, surname, patronymic]
        .filter((part) => part.length > 0)
        .join(' ')
    : undefined;

  const email =
    clientValue === undefined ? undefined : canonicalText(clientValue.email, 320);
  const emailTypeValid =
    email !== undefined && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);

  const recordIdTypeValid = positiveSafeInteger(value.id);
  const datetimeTypeValid = validIsoDatetime(value.datetime);
  const deletedTypeValid = typeof value.deleted === 'boolean';
  const checks: YclientsControlledCleanupBindingChecks = Object.freeze({
    recordId: fieldCheck(
      present(value.id),
      recordIdTypeValid,
      value.id === expected.recordId,
    ),
    companyId: fieldCheck(
      present(value.company_id) || present(value.company),
      companyId !== undefined,
      companyId === expected.companyId,
    ),
    resourceId: fieldCheck(
      present(value.staff_id) || present(value.staff),
      resourceId !== undefined,
      resourceId === expected.resourceId,
    ),
    services: fieldCheck(
      present(value.services),
      services !== undefined,
      services?.length === 1 && services[0] === expected.serviceId,
    ),
    datetime: fieldCheck(
      present(value.datetime),
      datetimeTypeValid,
      value.datetime === expected.datetime,
    ),
    deleted: fieldCheck(
      present(value.deleted),
      deletedTypeValid,
      value.deleted === expected.deleted,
    ),
    apiId: fieldCheck(
      apiId.outcome !== 'missing',
      apiId.outcome === 'present',
      apiId.outcome === 'present' && apiId.value === expected.apiId,
    ),
    clientPhone: fieldCheck(
      clientValue !== undefined && present(clientValue.phone),
      phoneTypeValid,
      phone === expected.client.phone,
    ),
    clientFullName: fieldCheck(
      clientValue !== undefined &&
        present(clientValue.name) &&
        present(clientValue.surname) &&
        present(clientValue.patronymic),
      fullNameTypeValid,
      fullName === expected.client.fullName,
    ),
    clientEmail: fieldCheck(
      clientValue !== undefined && present(clientValue.email),
      emailTypeValid,
      email === expected.client.email,
    ),
  });

  const matched =
    recordIdTypeValid &&
    value.id === expected.recordId &&
    companyId === expected.companyId &&
    resourceId === expected.resourceId &&
    services?.length === 1 &&
    services[0] === expected.serviceId &&
    value.datetime === expected.datetime &&
    datetimeTypeValid &&
    value.deleted === expected.deleted &&
    deletedTypeValid &&
    apiId.outcome === 'present' &&
    apiId.value === expected.apiId &&
    client?.phone === expected.client.phone &&
    client?.fullName === expected.client.fullName &&
    client?.email === expected.client.email;

  return Object.freeze({
    ...(matched
      ? {
          record: Object.freeze({
            recordId: expected.recordId,
            companyId,
            resourceId,
            serviceIds: services,
            datetime: expected.datetime,
            deleted: expected.deleted,
            apiId: expected.apiId,
          }),
        }
      : {}),
    checks,
  });
}

/**
 * Strict PII-bearing comparison for the isolated cleanup harness. The returned
 * projection contains no client data, record hash or raw provider fields.
 */
export function readYclientsControlledCleanupRecord(
  value: unknown,
  expected: YclientsControlledCleanupRecordExpectation,
): YclientsSafeAdminRecord | undefined {
  return inspectYclientsControlledCleanupRecord(value, expected)?.record;
}
