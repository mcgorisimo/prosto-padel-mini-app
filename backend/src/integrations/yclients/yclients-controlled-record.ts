import type { YclientsSafeAdminRecord } from './yclients-admin-read.client';

const MAX_SERVICES = 64;
const MAX_SEANCE_LENGTH_SECONDS = 86_400;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

export type YclientsControlledServiceSnapshot = Readonly<{
  id: number;
  cost: number;
  discount: number;
}>;

export type YclientsControlledClientSnapshot = Readonly<{
  phone: string;
  name: string;
  surname: string;
  patronymic: string;
  email: string;
}>;

/**
 * PII-bearing snapshot for the non-runtime controlled harness only. It must
 * never be returned by the ordinary safe read client or written to evidence.
 */
export type YclientsControlledFullRecordSnapshot = Readonly<{
  recordId: number;
  companyId: number;
  resourceId: number;
  services: ReadonlyArray<YclientsControlledServiceSnapshot>;
  datetime: string;
  seanceLengthSeconds: number;
  attendance: -1 | 0 | 1 | 2;
  notification: Readonly<{
    sendSms: boolean;
    smsRemainHours: number;
    emailRemainHours: number;
    notified: boolean;
  }>;
  apiId: number;
  deleted: boolean;
  client: YclientsControlledClientSnapshot;
}>;

export type YclientsControlledRescheduleTarget = Readonly<{
  resourceId: number;
  datetime: string;
}>;

export type YclientsControlledReschedulePayload = Readonly<{
  staff_id: number;
  services: ReadonlyArray<
    Readonly<{ id: number; cost: number; discount: number }>
  >;
  client: Readonly<{
    phone: string;
    name: string;
    surname: string;
    patronymic: string;
    email: string;
  }>;
  save_if_busy: false;
  datetime: string;
  seance_length: number;
  send_sms: boolean;
  sms_remain_hours: number;
  email_remain_hours: number;
  attendance: -1 | 0 | 1 | 2;
  api_id: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
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

function providerText(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): string | undefined {
  if (typeof value !== 'string' || value.length > maximumLength) {
    return undefined;
  }
  const normalized = value.trim();
  if (
    (!allowEmpty && normalized.length === 0) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return undefined;
  }
  return normalized;
}

function money(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1_000_000_000
    ? value
    : undefined;
}

function percentage(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : undefined;
}

function booleanFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return undefined;
}

function consistentId(
  value: Record<string, unknown>,
  directKey: string,
  nestedKey: string,
): number | undefined {
  const directValue = value[directKey];
  const direct =
    directValue === undefined || directValue === null
      ? undefined
      : positiveSafeInteger(directValue)
        ? Number(directValue)
        : Number.NaN;
  const nestedValue = value[nestedKey];
  const nested =
    nestedValue === undefined || nestedValue === null
      ? undefined
      : isRecord(nestedValue) && positiveSafeInteger(nestedValue.id)
        ? Number(nestedValue.id)
        : Number.NaN;
  if (Number.isNaN(direct) || Number.isNaN(nested)) return undefined;
  if (direct !== undefined && nested !== undefined && direct !== nested) {
    return undefined;
  }
  return direct ?? nested;
}

function readServices(
  value: unknown,
): ReadonlyArray<YclientsControlledServiceSnapshot> | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SERVICES) {
    return undefined;
  }
  const services = value.map((candidate) => {
    if (!isRecord(candidate) || !positiveSafeInteger(candidate.id)) {
      return undefined;
    }
    const cost = money(candidate.cost);
    const discount = percentage(candidate.discount);
    return cost === undefined || discount === undefined
      ? undefined
      : Object.freeze({ id: Number(candidate.id), cost, discount });
  });
  if (
    services.some((service) => service === undefined) ||
    new Set(services.map((service) => service?.id)).size !== services.length
  ) {
    return undefined;
  }
  return Object.freeze(
    (services as YclientsControlledServiceSnapshot[]).slice(),
  );
}

function readClient(
  value: unknown,
): YclientsControlledClientSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const phone = providerText(value.phone, 32);
  const name = providerText(value.name, 256);
  const surname = providerText(value.surname, 256, true);
  const patronymic = providerText(value.patronymic, 256, true);
  const email = providerText(value.email, 320);
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
  return Object.freeze({ phone, name, surname, patronymic, email });
}

export function readYclientsControlledFullRecord(
  value: unknown,
  expectedCompanyId: number,
  expectedRecordId: number,
): YclientsControlledFullRecordSnapshot | undefined {
  if (
    !isRecord(value) ||
    !positiveSafeInteger(expectedCompanyId) ||
    !positiveSafeInteger(expectedRecordId) ||
    value.id !== expectedRecordId
  ) {
    return undefined;
  }
  const companyId = consistentId(value, 'company_id', 'company');
  const resourceId = consistentId(value, 'staff_id', 'staff');
  const services = readServices(value.services);
  const client = readClient(value.client);
  const attendance =
    value.attendance === -1 ||
    value.attendance === 0 ||
    value.attendance === 1 ||
    value.attendance === 2
      ? value.attendance
      : undefined;
  const sendSms = booleanFlag(value.send_sms);
  const notified = booleanFlag(value.notified);
  if (
    companyId !== expectedCompanyId ||
    resourceId === undefined ||
    services === undefined ||
    !validIsoDatetime(value.datetime) ||
    !positiveSafeInteger(value.seance_length) ||
    Number(value.seance_length) > MAX_SEANCE_LENGTH_SECONDS ||
    attendance === undefined ||
    sendSms === undefined ||
    !nonNegativeSafeInteger(value.sms_remain_hours) ||
    !nonNegativeSafeInteger(value.email_remain_hours) ||
    notified === undefined ||
    !positiveSafeInteger(value.api_id) ||
    typeof value.deleted !== 'boolean' ||
    client === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    recordId: expectedRecordId,
    companyId,
    resourceId,
    services,
    datetime: value.datetime,
    seanceLengthSeconds: Number(value.seance_length),
    attendance,
    notification: Object.freeze({
      sendSms,
      smsRemainHours: Number(value.sms_remain_hours),
      emailRemainHours: Number(value.email_remain_hours),
      notified,
    }),
    apiId: Number(value.api_id),
    deleted: value.deleted,
    client,
  });
}

export function safeYclientsControlledRecordProjection(
  snapshot: YclientsControlledFullRecordSnapshot,
): YclientsSafeAdminRecord {
  return Object.freeze({
    recordId: snapshot.recordId,
    companyId: snapshot.companyId,
    resourceId: snapshot.resourceId,
    serviceIds: Object.freeze(
      snapshot.services
        .map((service) => service.id)
        .sort((left, right) => left - right),
    ),
    datetime: snapshot.datetime,
    deleted: snapshot.deleted,
    apiId: snapshot.apiId,
  });
}

export function buildYclientsControlledReschedulePayload(
  snapshot: YclientsControlledFullRecordSnapshot,
  target: YclientsControlledRescheduleTarget,
): YclientsControlledReschedulePayload | undefined {
  const verified = readYclientsControlledFullRecord(
    {
      id: snapshot?.recordId,
      company_id: snapshot?.companyId,
      staff_id: snapshot?.resourceId,
      services: snapshot?.services,
      datetime: snapshot?.datetime,
      seance_length: snapshot?.seanceLengthSeconds,
      attendance: snapshot?.attendance,
      send_sms: snapshot?.notification?.sendSms,
      sms_remain_hours: snapshot?.notification?.smsRemainHours,
      email_remain_hours: snapshot?.notification?.emailRemainHours,
      notified: snapshot?.notification?.notified,
      api_id: snapshot?.apiId,
      deleted: snapshot?.deleted,
      client: snapshot?.client,
    },
    snapshot?.companyId,
    snapshot?.recordId,
  );
  if (
    verified === undefined ||
    verified.deleted ||
    verified.notification.sendSms ||
    verified.notification.smsRemainHours !== 0 ||
    verified.notification.emailRemainHours !== 0 ||
    verified.notification.notified ||
    !positiveSafeInteger(target?.resourceId) ||
    !validIsoDatetime(target?.datetime)
  ) {
    return undefined;
  }
  return Object.freeze({
    staff_id: target.resourceId,
    services: Object.freeze(
      verified.services.map((service) =>
        Object.freeze({
          id: service.id,
          cost: service.cost,
          discount: service.discount,
        }),
      ),
    ),
    client: Object.freeze({ ...verified.client }),
    save_if_busy: false as const,
    datetime: target.datetime,
    seance_length: verified.seanceLengthSeconds,
    send_sms: verified.notification.sendSms,
    sms_remain_hours: verified.notification.smsRemainHours,
    email_remain_hours: verified.notification.emailRemainHours,
    attendance: verified.attendance,
    api_id: String(verified.apiId),
  });
}
