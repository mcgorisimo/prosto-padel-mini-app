import { AccountId, isAccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';

declare const courtReservationIdBrand: unique symbol;
declare const reservationOperationIdBrand: unique symbol;
declare const reservationIdempotencyKeyBrand: unique symbol;
declare const reservationRequestDigestBrand: unique symbol;
declare const reservationProviderRejectionReasonBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const OFFSET_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const PROVIDER_REJECTION_REASON_PATTERN = /^[a-z][a-z0-9_]{0,127}$/u;
const CLIENT_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type CourtReservationId = InternalUuid & {
  readonly [courtReservationIdBrand]: 'CourtReservationId';
};

export type ReservationOperationId = InternalUuid & {
  readonly [reservationOperationIdBrand]: 'ReservationOperationId';
};

export type ReservationIdempotencyKey = InternalUuid & {
  readonly [reservationIdempotencyKeyBrand]: 'ReservationIdempotencyKey';
};

export type ReservationRequestDigest = string & {
  readonly [reservationRequestDigestBrand]: 'ReservationRequestDigest';
};

export type ReservationProviderRejectionReason = string & {
  readonly [reservationProviderRejectionReasonBrand]:
    'ReservationProviderRejectionReason';
};

export const RESERVATION_STATUSES = Object.freeze([
  'unbooked',
  'pending_confirmation',
  'confirmed',
  'reschedule_pending',
  'cancel_pending',
  'cancelled',
  'rejected',
  'unknown',
] as const);

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_OPERATION_TYPES = Object.freeze([
  'create',
  'reschedule',
  'cancel',
] as const);

export type ReservationOperationType =
  (typeof RESERVATION_OPERATION_TYPES)[number];

export interface ReservationTarget {
  readonly serviceId: number;
  readonly courtId: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface YclientsReservationExternalReference {
  readonly apiId: number;
}

export interface ReservationClientSnapshot {
  readonly phone: string;
  readonly fullName: string;
  readonly email: string;
}

export interface YclientsReservationBinding {
  readonly provider: 'yclients';
  readonly appointmentId: number;
  readonly recordId: number;
  readonly recordHash: string;
}

export interface CourtReservation {
  readonly reservationId: CourtReservationId;
  readonly ownerAccountId: AccountId;
  readonly status: ReservationStatus;
  readonly target: ReservationTarget;
  readonly providerBinding?: YclientsReservationBinding;
  readonly createdAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly version: number;
}

interface ReservationOperationRequestBase {
  readonly reservationId: CourtReservationId;
  readonly ownerAccountId: AccountId;
  readonly type: ReservationOperationType;
  readonly externalReference: YclientsReservationExternalReference;
  readonly client: ReservationClientSnapshot;
}

export interface CreateReservationRequest
  extends ReservationOperationRequestBase {
  readonly type: 'create';
  readonly target: ReservationTarget;
}

export interface RescheduleReservationRequest
  extends ReservationOperationRequestBase {
  readonly type: 'reschedule';
  readonly target: ReservationTarget;
}

export interface CancelReservationRequest
  extends ReservationOperationRequestBase {
  readonly type: 'cancel';
}

export type ReservationOperationRequest =
  | CreateReservationRequest
  | RescheduleReservationRequest
  | CancelReservationRequest;

interface ReservationOperationBase {
  readonly operationId: ReservationOperationId;
  readonly reservationId: CourtReservationId;
  readonly ownerAccountId: AccountId;
  readonly actorAccountId: AccountId;
  readonly type: ReservationOperationType;
  readonly idempotencyKey: ReservationIdempotencyKey;
  readonly requestDigest: ReservationRequestDigest;
  readonly request: ReservationOperationRequest;
  readonly previousReservationStatus: ReservationStatus;
  readonly createdAt: UnixEpochSeconds;
}

export interface PendingReservationOperation
  extends ReservationOperationBase {
  readonly status: 'pending';
}

export interface UnknownReservationOperation
  extends ReservationOperationBase {
  readonly status: 'unknown';
  readonly uncertainAt: UnixEpochSeconds;
}

export interface ConfirmedReservationOperation
  extends ReservationOperationBase {
  readonly status: 'confirmed';
  readonly terminalAt: UnixEpochSeconds;
  readonly providerBinding?: YclientsReservationBinding;
}

export interface RejectedReservationOperation
  extends ReservationOperationBase {
  readonly status: 'rejected';
  readonly terminalAt: UnixEpochSeconds;
  readonly reason: ReservationProviderRejectionReason;
}

export type ReservationReconciliationResult =
  | Readonly<{
      outcome: 'confirmed';
      providerBinding?: YclientsReservationBinding;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: ReservationProviderRejectionReason;
    }>;

export interface ReconciledReservationOperation
  extends ReservationOperationBase {
  readonly status: 'reconciled';
  readonly uncertainAt: UnixEpochSeconds;
  readonly terminalAt: UnixEpochSeconds;
  readonly result: ReservationReconciliationResult;
}

export type TerminalReservationOperation =
  | ConfirmedReservationOperation
  | RejectedReservationOperation
  | ReconciledReservationOperation;

export type ReservationOperation =
  | PendingReservationOperation
  | UnknownReservationOperation
  | TerminalReservationOperation;

export function isCourtReservationId(
  value: unknown,
): value is CourtReservationId {
  return isInternalUuid(value);
}

export function courtReservationId(value: string): CourtReservationId {
  if (!isCourtReservationId(value)) {
    throw new TypeError('Court reservation ID is invalid');
  }
  return value;
}

export function newCourtReservationId(): CourtReservationId {
  return newInternalUuid() as CourtReservationId;
}

export function isReservationOperationId(
  value: unknown,
): value is ReservationOperationId {
  return isInternalUuid(value);
}

export function reservationOperationId(
  value: string,
): ReservationOperationId {
  if (!isReservationOperationId(value)) {
    throw new TypeError('Reservation operation ID is invalid');
  }
  return value;
}

export function newReservationOperationId(): ReservationOperationId {
  return newInternalUuid() as ReservationOperationId;
}

export function isReservationIdempotencyKey(
  value: unknown,
): value is ReservationIdempotencyKey {
  return isInternalUuid(value);
}

export function reservationIdempotencyKey(
  value: string,
): ReservationIdempotencyKey {
  if (!isReservationIdempotencyKey(value)) {
    throw new TypeError('Reservation idempotency key is invalid');
  }
  return value;
}

export function isReservationRequestDigest(
  value: unknown,
): value is ReservationRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function reservationRequestDigest(
  value: string,
): ReservationRequestDigest {
  if (!isReservationRequestDigest(value)) {
    throw new TypeError('Reservation request digest is invalid');
  }
  return value;
}

export function reservationProviderRejectionReason(
  value: string,
): ReservationProviderRejectionReason {
  if (!PROVIDER_REJECTION_REASON_PATTERN.test(value)) {
    throw new TypeError('Reservation provider rejection reason is invalid');
  }
  return value as ReservationProviderRejectionReason;
}

export function isReservationStatus(
  value: unknown,
): value is ReservationStatus {
  return (
    typeof value === 'string' &&
    (RESERVATION_STATUSES as readonly string[]).includes(value)
  );
}

export function isReservationOperationType(
  value: unknown,
): value is ReservationOperationType {
  return (
    typeof value === 'string' &&
    (RESERVATION_OPERATION_TYPES as readonly string[]).includes(value)
  );
}

export function isReservationTarget(
  value: unknown,
): value is ReservationTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const date =
    typeof candidate.startsAt === 'string'
      ? candidate.startsAt.slice(0, 10)
      : '';
  const dateTimestamp = Date.parse(`${date}T00:00:00.000Z`);
  return (
    Object.keys(candidate).length === 4 &&
    Number.isSafeInteger(candidate.serviceId) &&
    Number(candidate.serviceId) > 0 &&
    Number.isSafeInteger(candidate.courtId) &&
    Number(candidate.courtId) > 0 &&
    typeof candidate.startsAt === 'string' &&
    OFFSET_DATE_TIME_PATTERN.test(candidate.startsAt) &&
    Number.isFinite(dateTimestamp) &&
    new Date(dateTimestamp).toISOString().slice(0, 10) === date &&
    !Number.isNaN(Date.parse(candidate.startsAt)) &&
    typeof candidate.endsAt === 'string' &&
    OFFSET_DATE_TIME_PATTERN.test(candidate.endsAt) &&
    !Number.isNaN(Date.parse(candidate.endsAt)) &&
    Date.parse(candidate.endsAt) > Date.parse(candidate.startsAt)
  );
}

export function isYclientsReservationExternalReference(
  value: unknown,
): value is YclientsReservationExternalReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 1 &&
    Number.isSafeInteger(candidate.apiId) &&
    Number(candidate.apiId) > 0
  );
}

function isCanonicalClientText(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !CLIENT_CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export function isReservationClientSnapshot(
  value: unknown,
): value is ReservationClientSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 3 &&
    isCanonicalClientText(candidate.phone, 32) &&
    /^\+[1-9]\d{6,14}$/u.test(candidate.phone) &&
    isCanonicalClientText(candidate.fullName, 256) &&
    isCanonicalClientText(candidate.email, 320) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate.email)
  );
}

export function isYclientsReservationBinding(
  value: unknown,
): value is YclientsReservationBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 4 &&
    candidate.provider === 'yclients' &&
    Number.isSafeInteger(candidate.appointmentId) &&
    Number(candidate.appointmentId) > 0 &&
    Number.isSafeInteger(candidate.recordId) &&
    Number(candidate.recordId) > 0 &&
    typeof candidate.recordHash === 'string' &&
    candidate.recordHash.length > 0 &&
    candidate.recordHash.length <= 512 &&
    candidate.recordHash.trim() === candidate.recordHash &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(candidate.recordHash)
  );
}

export function isReservationOperationRequest(
  value: unknown,
): value is ReservationOperationRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isCourtReservationId(candidate.reservationId) ||
    !isAccountId(candidate.ownerAccountId) ||
    !isReservationOperationType(candidate.type) ||
    !isYclientsReservationExternalReference(candidate.externalReference) ||
    !isReservationClientSnapshot(candidate.client)
  ) {
    return false;
  }
  if (candidate.type === 'cancel') {
    return Object.keys(candidate).length === 5;
  }
  return (
    Object.keys(candidate).length === 6 &&
    isReservationTarget(candidate.target)
  );
}
