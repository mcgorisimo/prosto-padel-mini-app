import type { YclientsBoundedAdminRecordsQuery } from './yclients-admin-read.client';
import type {
  YclientsAdminWriteClient,
  YclientsControlledCleanupExactResult,
  YclientsControlledCleanupRecordReader,
} from './yclients-controlled-admin.client';
import type { YclientsCreateBookingCommand } from './yclients-api.client';
import type { YclientsControlledCleanupRecordExpectation } from './yclients-controlled-cleanup-record';
import {
  scanBoundedYclientsCandidates,
  YclientsAdminRecordReader,
  YclientsBoundedCandidateScanResult,
} from './yclients-read-reconciliation';

const HARD_REQUEST_BUDGET = 4;
const MAX_LIST_COUNT = 50;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

export type YclientsControlledCleanupInput = Readonly<{
  companyId: number;
  recordId: number;
  appointmentId: number;
  apiId: number;
  identityBinding: string;
  client: YclientsCreateBookingCommand['client'];
  slotA: Readonly<{
    alias: 'A';
    serviceId: number;
    resourceId: number;
    datetime: string;
  }>;
  deletedListA: YclientsBoundedAdminRecordsQuery;
}>;

export type YclientsControlledCleanupEvidenceEvent = Readonly<{
  step: 1 | 2 | 3 | 4;
  requestCount: number;
  occurredAt: string;
  action:
    | 'pre_delete_exact'
    | 'cancel_once'
    | 'post_delete_exact'
    | 'post_delete_list';
  status:
    | 'pass'
    | 'unauthorized'
    | 'rejected'
    | 'unavailable'
    | 'invalid'
    | 'unknown';
  effect?: Readonly<{
    recordId: number;
    slot: 'A';
    deleted: boolean;
    effectMatches: true;
    identityMatches?: true;
  }>;
}>;

export interface YclientsControlledCleanupEvidenceSink {
  record(
    event: YclientsControlledCleanupEvidenceEvent,
  ): void | Promise<void>;
}

export interface YclientsControlledCleanupClock {
  nowMilliseconds(): number;
}

type ExactReader = Pick<
  YclientsControlledCleanupRecordReader,
  'verifyRecord'
>;
type CancelWriter = Pick<YclientsAdminWriteClient, 'cancel'>;

export type YclientsControlledCleanupLifecycleResult = Readonly<{
  outcome:
    | 'cancelled_confirmed'
    | 'cancelled_confirmed_after_uncertain_response'
    | 'cleanup_required'
    | 'unknown';
  reason:
    | 'canonical_cancel_proof'
    | 'canonical_cancel_proof_after_uncertain_response'
    | 'invalid_plan'
    | 'pre_delete_unverified'
    | 'cancel_rejected'
    | 'cancel_proof_incomplete'
    | 'evidence_unavailable';
  requestCount: number;
  holds: ReadonlyArray<'A'>;
}>;

export interface YclientsControlledCleanupLifecycleDependencies {
  readonly exactReader: ExactReader;
  readonly safeReader: YclientsAdminRecordReader;
  readonly writer: CancelWriter;
  readonly evidence: YclientsControlledCleanupEvidenceSink;
  readonly clock: YclientsControlledCleanupClock;
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

export function isValidYclientsControlledCleanupInput(
  value: YclientsControlledCleanupInput,
): boolean {
  const slot = value?.slotA;
  const query = value?.deletedListA;
  const client = value?.client;
  return (
    positiveSafeInteger(value?.companyId) &&
    positiveSafeInteger(value?.recordId) &&
    positiveSafeInteger(value?.appointmentId) &&
    positiveSafeInteger(value?.apiId) &&
    typeof value?.identityBinding === 'string' &&
    /^[a-z0-9][a-z0-9._-]{2,63}$/u.test(value.identityBinding) &&
    typeof client?.phone === 'string' &&
    /^\d{10,15}$/u.test(client.phone) &&
    client.phone.trim() === client.phone &&
    typeof client?.fullName === 'string' &&
    client.fullName.length > 0 &&
    client.fullName.trim() === client.fullName &&
    Buffer.byteLength(client.fullName, 'utf8') <= 256 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(client.fullName) &&
    typeof client?.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(client.email) &&
    client.email.trim() === client.email &&
    Buffer.byteLength(client.email, 'utf8') <= 320 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(client.email) &&
    slot?.alias === 'A' &&
    positiveSafeInteger(slot.serviceId) &&
    positiveSafeInteger(slot.resourceId) &&
    validIsoDatetime(slot.datetime) &&
    query?.page === 1 &&
    positiveSafeInteger(query.count) &&
    query.count <= MAX_LIST_COUNT &&
    query.resourceId === slot.resourceId &&
    query.dateFrom === slot.datetime.slice(0, 10) &&
    query.dateTo === query.dateFrom &&
    query.withDeleted === true
  );
}

function expectation(
  input: YclientsControlledCleanupInput,
  deleted: boolean,
): YclientsControlledCleanupRecordExpectation {
  return Object.freeze({
    companyId: input.companyId,
    recordId: input.recordId,
    apiId: input.apiId,
    resourceId: input.slotA.resourceId,
    serviceId: input.slotA.serviceId,
    datetime: input.slotA.datetime,
    deleted,
    client: input.client,
  });
}

function result(
  outcome: YclientsControlledCleanupLifecycleResult['outcome'],
  reason: YclientsControlledCleanupLifecycleResult['reason'],
  requestCount: number,
  holds: ReadonlyArray<'A'>,
): YclientsControlledCleanupLifecycleResult {
  return Object.freeze({
    outcome,
    reason,
    requestCount,
    holds: Object.freeze(holds.slice()),
  });
}

function statusOf(value: { outcome: string }) {
  if (
    value.outcome === 'matched' ||
    value.outcome === 'deleted' ||
    value.outcome === 'candidate'
  ) {
    return 'pass' as const;
  }
  if (value.outcome === 'unauthorized') return 'unauthorized' as const;
  if (value.outcome === 'rejected') return 'rejected' as const;
  if (value.outcome === 'rate_limited' || value.outcome === 'unavailable') {
    return 'unavailable' as const;
  }
  if (value.outcome === 'disabled' || value.outcome === 'invalid_request') {
    return 'invalid' as const;
  }
  return 'unknown' as const;
}

export class YclientsControlledCleanupLifecycle {
  private requestCount = 0;
  private inFlight = false;

  constructor(
    private readonly dependencies: YclientsControlledCleanupLifecycleDependencies,
  ) {}

  private async request<T extends { outcome: string }>(
    step: 1 | 2 | 3 | 4,
    action: YclientsControlledCleanupEvidenceEvent['action'],
    operation: () => Promise<T>,
    effect?: (value: T) =>
      | YclientsControlledCleanupEvidenceEvent['effect']
      | undefined,
  ): Promise<T> {
    if (this.inFlight || this.requestCount >= HARD_REQUEST_BUDGET) {
      throw new TypeError('Controlled cleanup request budget violated');
    }
    this.inFlight = true;
    let operationResult: T;
    try {
      this.requestCount += 1;
      operationResult = await operation();
    } finally {
      this.inFlight = false;
    }
    const now = this.dependencies.clock.nowMilliseconds();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new TypeError('Controlled cleanup evidence clock unavailable');
    }
    const safeEffect = effect?.(operationResult);
    await this.dependencies.evidence.record(
      Object.freeze({
        step,
        requestCount: this.requestCount,
        occurredAt: new Date(now).toISOString(),
        action,
        status: statusOf(operationResult),
        ...(safeEffect === undefined ? {} : { effect: safeEffect }),
      }),
    );
    return operationResult;
  }

  async run(
    input: YclientsControlledCleanupInput,
  ): Promise<YclientsControlledCleanupLifecycleResult> {
    if (!isValidYclientsControlledCleanupInput(input)) {
      return result('cleanup_required', 'invalid_plan', 0, ['A']);
    }
    let writeAttempted = false;
    try {
      const preDelete = await this.request(
        1,
        'pre_delete_exact',
        () => this.dependencies.exactReader.verifyRecord(expectation(input, false)),
        (value: YclientsControlledCleanupExactResult) =>
          value.outcome === 'matched'
            ? Object.freeze({
                recordId: input.recordId,
                slot: 'A' as const,
                deleted: false,
                effectMatches: true as const,
                identityMatches: true as const,
              })
            : undefined,
      );
      if (preDelete.outcome !== 'matched') {
        return result(
          'cleanup_required',
          'pre_delete_unverified',
          this.requestCount,
          ['A'],
        );
      }

      writeAttempted = true;
      const cancelled = await this.request(
        2,
        'cancel_once',
        () => this.dependencies.writer.cancel(input.recordId),
      );
      if (cancelled.outcome !== 'deleted' && cancelled.outcome !== 'unknown') {
        return result(
          'cleanup_required',
          'cancel_rejected',
          this.requestCount,
          ['A'],
        );
      }

      const exactDeleted = await this.request(
        3,
        'post_delete_exact',
        () => this.dependencies.exactReader.verifyRecord(expectation(input, true)),
        (value: YclientsControlledCleanupExactResult) =>
          value.outcome === 'matched'
            ? Object.freeze({
                recordId: input.recordId,
                slot: 'A' as const,
                deleted: true,
                effectMatches: true as const,
                identityMatches: true as const,
              })
            : undefined,
      );
      const listedDeleted = await this.request(
        4,
        'post_delete_list',
        () =>
          scanBoundedYclientsCandidates(
            this.dependencies.safeReader,
            input.deletedListA,
            Object.freeze({
              apiId: input.apiId,
              resourceId: input.slotA.resourceId,
              serviceIds: Object.freeze([input.slotA.serviceId]),
              datetime: input.slotA.datetime,
              deleted: true,
            }),
          ),
        (value: YclientsBoundedCandidateScanResult) =>
          value.outcome === 'candidate' &&
          value.record.recordId === input.recordId
            ? Object.freeze({
                recordId: input.recordId,
                slot: 'A' as const,
                deleted: true,
                effectMatches: true as const,
              })
            : undefined,
      );
      const proof =
        exactDeleted.outcome === 'matched' &&
        listedDeleted.outcome === 'candidate' &&
        listedDeleted.record.recordId === input.recordId;
      if (!proof) {
        return result(
          'unknown',
          'cancel_proof_incomplete',
          this.requestCount,
          ['A'],
        );
      }
      return cancelled.outcome === 'deleted'
        ? result(
            'cancelled_confirmed',
            'canonical_cancel_proof',
            this.requestCount,
            [],
          )
        : result(
            'cancelled_confirmed_after_uncertain_response',
            'canonical_cancel_proof_after_uncertain_response',
            this.requestCount,
            [],
          );
    } catch {
      return result(
        writeAttempted ? 'unknown' : 'cleanup_required',
        'evidence_unavailable',
        this.requestCount,
        ['A'],
      );
    }
  }
}
