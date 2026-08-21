import { AccountId, isAccountId } from '../accounts/account.types';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';
import {
  CourtReservationId,
  isCourtReservationId,
} from '../reservations/reservation.types';

declare const paymentOrderIdBrand: unique symbol;
declare const paymentAttemptIdBrand: unique symbol;
declare const paymentIdempotencyKeyBrand: unique symbol;
declare const acquiringRouteIdBrand: unique symbol;
declare const paymentRequestDigestBrand: unique symbol;
declare const paymentSnapshotDigestBrand: unique symbol;
declare const paymentContractVersionBrand: unique symbol;
declare const paymentAttemptFailureReasonBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const CONTRACT_VERSION_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const FAILURE_REASON_PATTERN = /^[a-z][a-z0-9_]{0,127}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type PaymentOrderId = InternalUuid & {
  readonly [paymentOrderIdBrand]: 'PaymentOrderId';
};

export type PaymentAttemptId = InternalUuid & {
  readonly [paymentAttemptIdBrand]: 'PaymentAttemptId';
};

export type PaymentIdempotencyKey = InternalUuid & {
  readonly [paymentIdempotencyKeyBrand]: 'PaymentIdempotencyKey';
};

/** Identifies a configured acquiring route without naming a provider brand. */
export type AcquiringRouteId = InternalUuid & {
  readonly [acquiringRouteIdBrand]: 'AcquiringRouteId';
};

export type PaymentRequestDigest = string & {
  readonly [paymentRequestDigestBrand]: 'PaymentRequestDigest';
};

/**
 * An opaque digest created by an approved privacy-aware snapshot adapter.
 * Domain code never hashes receipt contacts or other PII directly.
 */
export type PaymentSnapshotDigest = string & {
  readonly [paymentSnapshotDigestBrand]: 'PaymentSnapshotDigest';
};

export type PaymentContractVersion = string & {
  readonly [paymentContractVersionBrand]: 'PaymentContractVersion';
};

export type PaymentAttemptFailureReason = string & {
  readonly [paymentAttemptFailureReasonBrand]: 'PaymentAttemptFailureReason';
};

export interface PaymentMoney {
  readonly amountMinor: number;
  readonly currency: string;
}

export const PAYMENT_ORDER_STATUSES = Object.freeze([
  'pending',
  'authorized',
  'paid',
  'unknown',
] as const);

export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export interface AcquiringPaymentBinding {
  readonly acquiringRouteId: AcquiringRouteId;
  readonly paymentReference: string;
}

export interface PaymentOrder {
  readonly orderId: PaymentOrderId;
  readonly ownerAccountId: AccountId;
  readonly reservationId: CourtReservationId;
  readonly status: PaymentOrderStatus;
  readonly amount: PaymentMoney;
  readonly pricingContractVersion: PaymentContractVersion;
  readonly pricingSnapshotDigest: PaymentSnapshotDigest;
  readonly receiptContractVersion: PaymentContractVersion;
  readonly receiptContactSnapshotDigest: PaymentSnapshotDigest;
  readonly cancellationPolicyVersion: PaymentContractVersion;
  readonly activeAttemptId?: PaymentAttemptId;
  readonly paymentBinding?: AcquiringPaymentBinding;
  readonly createdAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly version: number;
}

export interface PaymentAttemptRequest {
  readonly type: 'initiate';
  readonly orderId: PaymentOrderId;
  readonly ownerAccountId: AccountId;
  readonly acquiringRouteId: AcquiringRouteId;
}

interface PaymentAttemptBase {
  readonly attemptId: PaymentAttemptId;
  readonly orderId: PaymentOrderId;
  readonly ownerAccountId: AccountId;
  readonly status:
    'pending' | 'unknown' | 'confirmed' | 'rejected' | 'reconciled';
  readonly type: 'initiate';
  readonly acquiringRouteId: AcquiringRouteId;
  readonly idempotencyKey: PaymentIdempotencyKey;
  readonly requestDigest: PaymentRequestDigest;
  readonly request: PaymentAttemptRequest;
  readonly previousOrderStatus: 'pending';
  readonly createdAt: UnixEpochSeconds;
}

export interface PendingPaymentAttempt extends PaymentAttemptBase {
  readonly status: 'pending';
}

export interface UnknownPaymentAttempt extends PaymentAttemptBase {
  readonly status: 'unknown';
  readonly uncertainAt: UnixEpochSeconds;
}

export type ConfirmedPaymentResult = Readonly<{
  readonly outcome: 'authorized' | 'paid';
  readonly paymentBinding: AcquiringPaymentBinding;
}>;

export type RejectedPaymentResult = Readonly<{
  readonly outcome: 'rejected';
  readonly reason: PaymentAttemptFailureReason;
}>;

export type PaymentReconciliationResult =
  ConfirmedPaymentResult | RejectedPaymentResult;

export interface ConfirmedPaymentAttempt extends PaymentAttemptBase {
  readonly status: 'confirmed';
  readonly terminalAt: UnixEpochSeconds;
  readonly result: ConfirmedPaymentResult;
}

export interface RejectedPaymentAttempt extends PaymentAttemptBase {
  readonly status: 'rejected';
  readonly terminalAt: UnixEpochSeconds;
  readonly reason: PaymentAttemptFailureReason;
}

export interface ReconciledPaymentAttempt extends PaymentAttemptBase {
  readonly status: 'reconciled';
  readonly uncertainAt: UnixEpochSeconds;
  readonly terminalAt: UnixEpochSeconds;
  readonly result: PaymentReconciliationResult;
}

export type TerminalPaymentAttempt =
  ConfirmedPaymentAttempt | RejectedPaymentAttempt | ReconciledPaymentAttempt;

export type PaymentAttempt =
  PendingPaymentAttempt | UnknownPaymentAttempt | TerminalPaymentAttempt;

export function isPaymentOrderId(value: unknown): value is PaymentOrderId {
  return isInternalUuid(value);
}

export function newPaymentOrderId(): PaymentOrderId {
  return newInternalUuid() as PaymentOrderId;
}

export function isPaymentAttemptId(value: unknown): value is PaymentAttemptId {
  return isInternalUuid(value);
}

export function newPaymentAttemptId(): PaymentAttemptId {
  return newInternalUuid() as PaymentAttemptId;
}

export function isPaymentIdempotencyKey(
  value: unknown,
): value is PaymentIdempotencyKey {
  return isInternalUuid(value);
}

export function isAcquiringRouteId(value: unknown): value is AcquiringRouteId {
  return isInternalUuid(value);
}

export function isPaymentRequestDigest(
  value: unknown,
): value is PaymentRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function paymentRequestDigest(value: string): PaymentRequestDigest {
  if (!isPaymentRequestDigest(value)) {
    throw new TypeError('Payment request digest is invalid');
  }
  return value;
}

export function isPaymentSnapshotDigest(
  value: unknown,
): value is PaymentSnapshotDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function paymentSnapshotDigest(value: string): PaymentSnapshotDigest {
  if (!isPaymentSnapshotDigest(value)) {
    throw new TypeError('Payment snapshot digest is invalid');
  }
  return value;
}

export function isPaymentContractVersion(
  value: unknown,
): value is PaymentContractVersion {
  return typeof value === 'string' && CONTRACT_VERSION_PATTERN.test(value);
}

export function paymentContractVersion(value: string): PaymentContractVersion {
  if (!isPaymentContractVersion(value)) {
    throw new TypeError('Payment contract version is invalid');
  }
  return value;
}

export function isPaymentAttemptFailureReason(
  value: unknown,
): value is PaymentAttemptFailureReason {
  return typeof value === 'string' && FAILURE_REASON_PATTERN.test(value);
}

export function paymentAttemptFailureReason(
  value: string,
): PaymentAttemptFailureReason {
  if (!isPaymentAttemptFailureReason(value)) {
    throw new TypeError('Payment attempt failure reason is invalid');
  }
  return value as PaymentAttemptFailureReason;
}

export function isPaymentMoney(value: unknown): value is PaymentMoney {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    Number.isSafeInteger(candidate.amountMinor) &&
    Number(candidate.amountMinor) > 0 &&
    typeof candidate.currency === 'string' &&
    CURRENCY_PATTERN.test(candidate.currency)
  );
}

export function isPaymentOrderStatus(
  value: unknown,
): value is PaymentOrderStatus {
  return (
    typeof value === 'string' &&
    (PAYMENT_ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export function isAcquiringPaymentBinding(
  value: unknown,
): value is AcquiringPaymentBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    isAcquiringRouteId(candidate.acquiringRouteId) &&
    typeof candidate.paymentReference === 'string' &&
    candidate.paymentReference.length > 0 &&
    candidate.paymentReference.length <= 256 &&
    candidate.paymentReference.trim() === candidate.paymentReference &&
    !CONTROL_CHARACTER_PATTERN.test(candidate.paymentReference)
  );
}

export function isPaymentAttemptRequest(
  value: unknown,
): value is PaymentAttemptRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 4 &&
    candidate.type === 'initiate' &&
    isPaymentOrderId(candidate.orderId) &&
    isAccountId(candidate.ownerAccountId) &&
    isAcquiringRouteId(candidate.acquiringRouteId)
  );
}

export function isConfirmedPaymentResult(
  value: unknown,
): value is ConfirmedPaymentResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    (candidate.outcome === 'authorized' || candidate.outcome === 'paid') &&
    isAcquiringPaymentBinding(candidate.paymentBinding)
  );
}

export function isRejectedPaymentResult(
  value: unknown,
): value is RejectedPaymentResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    candidate.outcome === 'rejected' &&
    isPaymentAttemptFailureReason(candidate.reason)
  );
}

export function isPaymentReconciliationResult(
  value: unknown,
): value is PaymentReconciliationResult {
  return isConfirmedPaymentResult(value) || isRejectedPaymentResult(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

const ORDER_BASE_KEYS = Object.freeze([
  'orderId',
  'ownerAccountId',
  'reservationId',
  'status',
  'amount',
  'pricingContractVersion',
  'pricingSnapshotDigest',
  'receiptContractVersion',
  'receiptContactSnapshotDigest',
  'cancellationPolicyVersion',
  'createdAt',
  'updatedAt',
  'version',
]);

export function isPaymentOrder(value: unknown): value is PaymentOrder {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isPaymentOrderId(candidate.orderId) ||
    !isAccountId(candidate.ownerAccountId) ||
    !isCourtReservationId(candidate.reservationId) ||
    !isPaymentOrderStatus(candidate.status) ||
    !isPaymentMoney(candidate.amount) ||
    !isPaymentContractVersion(candidate.pricingContractVersion) ||
    !isPaymentSnapshotDigest(candidate.pricingSnapshotDigest) ||
    !isPaymentContractVersion(candidate.receiptContractVersion) ||
    !isPaymentSnapshotDigest(candidate.receiptContactSnapshotDigest) ||
    !isPaymentContractVersion(candidate.cancellationPolicyVersion) ||
    !isUnixEpochSeconds(candidate.createdAt) ||
    !isUnixEpochSeconds(candidate.updatedAt) ||
    Number(candidate.updatedAt) < Number(candidate.createdAt) ||
    !Number.isSafeInteger(candidate.version) ||
    Number(candidate.version) < 1
  ) {
    return false;
  }

  if (candidate.status === 'pending') {
    const keys =
      candidate.activeAttemptId === undefined
        ? ORDER_BASE_KEYS
        : [...ORDER_BASE_KEYS, 'activeAttemptId'];
    return (
      hasExactKeys(candidate, keys) &&
      candidate.paymentBinding === undefined &&
      (candidate.activeAttemptId === undefined ||
        isPaymentAttemptId(candidate.activeAttemptId))
    );
  }

  if (candidate.status === 'unknown') {
    return (
      hasExactKeys(candidate, [...ORDER_BASE_KEYS, 'activeAttemptId']) &&
      isPaymentAttemptId(candidate.activeAttemptId) &&
      candidate.paymentBinding === undefined
    );
  }

  return (
    hasExactKeys(candidate, [...ORDER_BASE_KEYS, 'paymentBinding']) &&
    candidate.activeAttemptId === undefined &&
    isAcquiringPaymentBinding(candidate.paymentBinding)
  );
}

const ATTEMPT_BASE_KEYS = Object.freeze([
  'attemptId',
  'orderId',
  'ownerAccountId',
  'status',
  'type',
  'acquiringRouteId',
  'idempotencyKey',
  'requestDigest',
  'request',
  'previousOrderStatus',
  'createdAt',
]);

export function isPaymentAttempt(value: unknown): value is PaymentAttempt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isPaymentAttemptId(candidate.attemptId) ||
    !isPaymentOrderId(candidate.orderId) ||
    !isAccountId(candidate.ownerAccountId) ||
    candidate.type !== 'initiate' ||
    !isAcquiringRouteId(candidate.acquiringRouteId) ||
    !isPaymentIdempotencyKey(candidate.idempotencyKey) ||
    !isPaymentRequestDigest(candidate.requestDigest) ||
    !isPaymentAttemptRequest(candidate.request) ||
    candidate.request.orderId !== candidate.orderId ||
    candidate.request.ownerAccountId !== candidate.ownerAccountId ||
    candidate.request.acquiringRouteId !== candidate.acquiringRouteId ||
    candidate.previousOrderStatus !== 'pending' ||
    !isUnixEpochSeconds(candidate.createdAt)
  ) {
    return false;
  }

  if (candidate.status === 'pending') {
    return hasExactKeys(candidate, ATTEMPT_BASE_KEYS);
  }
  if (candidate.status === 'unknown') {
    return (
      hasExactKeys(candidate, [...ATTEMPT_BASE_KEYS, 'uncertainAt']) &&
      isUnixEpochSeconds(candidate.uncertainAt) &&
      Number(candidate.uncertainAt) >= Number(candidate.createdAt)
    );
  }
  if (candidate.status === 'confirmed') {
    return (
      hasExactKeys(candidate, [...ATTEMPT_BASE_KEYS, 'terminalAt', 'result']) &&
      isUnixEpochSeconds(candidate.terminalAt) &&
      Number(candidate.terminalAt) >= Number(candidate.createdAt) &&
      isConfirmedPaymentResult(candidate.result) &&
      candidate.result.paymentBinding.acquiringRouteId ===
        candidate.acquiringRouteId
    );
  }
  if (candidate.status === 'rejected') {
    return (
      hasExactKeys(candidate, [...ATTEMPT_BASE_KEYS, 'terminalAt', 'reason']) &&
      isUnixEpochSeconds(candidate.terminalAt) &&
      Number(candidate.terminalAt) >= Number(candidate.createdAt) &&
      isPaymentAttemptFailureReason(candidate.reason)
    );
  }
  if (candidate.status === 'reconciled') {
    return (
      hasExactKeys(candidate, [
        ...ATTEMPT_BASE_KEYS,
        'uncertainAt',
        'terminalAt',
        'result',
      ]) &&
      isUnixEpochSeconds(candidate.uncertainAt) &&
      isUnixEpochSeconds(candidate.terminalAt) &&
      Number(candidate.uncertainAt) >= Number(candidate.createdAt) &&
      Number(candidate.terminalAt) >= Number(candidate.uncertainAt) &&
      isPaymentReconciliationResult(candidate.result) &&
      (candidate.result.outcome === 'rejected' ||
        candidate.result.paymentBinding.acquiringRouteId ===
          candidate.acquiringRouteId)
    );
  }
  return false;
}
