import type {
  YclientsBoundedAdminRecordsQuery,
  YclientsSafeAdminRecord,
} from './yclients-admin-read.client';
import type {
  YclientsAdminWriteClient,
  YclientsControlledCancelResult,
  YclientsControlledFullRecordReader,
  YclientsControlledRescheduleResult,
} from './yclients-controlled-admin.client';
import {
  safeYclientsControlledRecordProjection,
  YclientsControlledFullRecordSnapshot,
} from './yclients-controlled-record';
import type {
  YclientsApiClient,
  YclientsCreateBookingCommand,
  YclientsCreateBookingResult,
} from './yclients-api.client';
import type {
  YclientsAvailabilityService,
  YclientsAvailableTimesResult,
  YclientsBookingPreflightResult,
} from './yclients-availability.service';
import {
  scanBoundedYclientsCandidates,
  YclientsAdminRecordReader,
} from './yclients-read-reconciliation';

const HARD_REQUEST_BUDGET = 14;
const MINIMUM_REQUEST_INTERVAL_MILLISECONDS = 1_000;
const DAY_MILLISECONDS = 86_400_000;
const MAX_LIST_RANGE_DAYS = 7;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

type SlotAlias = 'A' | 'B';

export type YclientsControlledSlot = Readonly<{
  alias: SlotAlias;
  serviceId: number;
  resourceId: number;
  datetime: string;
}>;

export type YclientsControlledLifecycleInput = Readonly<{
  apiId: number;
  client: YclientsCreateBookingCommand['client'];
  slotA: YclientsControlledSlot & Readonly<{ alias: 'A' }>;
  slotB: YclientsControlledSlot & Readonly<{ alias: 'B' }>;
  visibleListA: YclientsBoundedAdminRecordsQuery;
  deletedListB: YclientsBoundedAdminRecordsQuery;
}>;

export type YclientsControlledEvidenceAction =
  | 'availability_A'
  | 'preflight_A'
  | 'availability_B'
  | 'preflight_B'
  | 'create_A'
  | 'exact_get_A'
  | 'bounded_list_A'
  | 'reschedule_B'
  | 'exact_get_B'
  | 'cancel_first'
  | 'exact_get_deleted'
  | 'bounded_list_deleted'
  | 'cancel_repeat'
  | 'bounded_list_final';

export type YclientsControlledEvidenceStatus =
  | 'pass'
  | 'rejected'
  | 'unauthorized'
  | 'unavailable'
  | 'unknown'
  | 'invalid';

export type YclientsControlledEvidenceEvent = Readonly<{
  step: number;
  requestCount: number;
  occurredAt: string;
  action: YclientsControlledEvidenceAction;
  status: YclientsControlledEvidenceStatus;
  effect?: 'A' | 'B' | 'deleted' | 'ambiguous';
}>;

export interface YclientsControlledEvidenceSink {
  record(event: YclientsControlledEvidenceEvent): void | Promise<void>;
}

export interface YclientsControlledLifecycleClock {
  nowMilliseconds(): number;
  sleep(milliseconds: number): Promise<void>;
}

type AvailabilityPort = Pick<
  YclientsAvailabilityService,
  'listAvailableTimes' | 'preflightBooking'
>;
type CreatePort = Pick<YclientsApiClient, 'createBookingRecord'>;
type FullReaderPort = Pick<
  YclientsControlledFullRecordReader,
  'getRecordSnapshot'
>;
type WritePort = Pick<YclientsAdminWriteClient, 'reschedule' | 'cancel'>;

export interface YclientsControlledLifecycleDependencies {
  readonly availability: AvailabilityPort;
  /** Existing guarded create client; one call means one provider POST. */
  readonly create: CreatePort;
  readonly fullReader: FullReaderPort;
  readonly safeReader: YclientsAdminRecordReader;
  readonly writer: WritePort;
  readonly clock: YclientsControlledLifecycleClock;
  readonly evidence: YclientsControlledEvidenceSink;
}

export type YclientsControlledLifecycleResult = Readonly<{
  outcome:
    | 'passed'
    | 'stopped'
    | 'unknown'
    | 'cleanup_required'
    | 'cancelled_confirmed_after_uncertain_response';
  reason:
    | 'complete'
    | 'invalid_plan'
    | 'read_or_preflight_failed'
    | 'create_rejected'
    | 'create_unknown'
    | 'snapshot_incomplete'
    | 'visibility_unproven'
    | 'reschedule_rejected'
    | 'reschedule_unknown'
    | 'reschedule_effect_unproven'
    | 'cancel_rejected'
    | 'cancel_unknown'
    | 'cancel_effect_unproven'
    | 'repeat_delete_accepted'
    | 'repeat_delete_rejected'
    | 'repeat_delete_unknown'
    | 'evidence_unavailable';
  requestCount: number;
  holds: ReadonlyArray<SlotAlias>;
}>;

class EvidenceUnavailableError extends Error {}

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

function readIsoDate(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return undefined;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : undefined;
}

function validListQuery(
  value: YclientsBoundedAdminRecordsQuery,
  slot: YclientsControlledSlot,
  withDeleted: boolean,
): boolean {
  const dateFrom = readIsoDate(value?.dateFrom);
  const dateTo = readIsoDate(value?.dateTo);
  const rangeDays =
    dateFrom === undefined || dateTo === undefined
      ? Number.NaN
      : (dateTo - dateFrom) / DAY_MILLISECONDS + 1;
  return (
    value?.page === 1 &&
    positiveSafeInteger(value.count) &&
    value.count <= 50 &&
    value.resourceId === slot.resourceId &&
    value.withDeleted === withDeleted &&
    dateFrom !== undefined &&
    dateTo !== undefined &&
    Number.isInteger(rangeDays) &&
    rangeDays > 0 &&
    rangeDays <= MAX_LIST_RANGE_DAYS &&
    value.dateFrom <= slot.datetime.slice(0, 10) &&
    value.dateTo >= slot.datetime.slice(0, 10)
  );
}

function validInput(value: YclientsControlledLifecycleInput): boolean {
  const client = value?.client;
  return (
    positiveSafeInteger(value?.apiId) &&
    value.slotA?.alias === 'A' &&
    value.slotB?.alias === 'B' &&
    positiveSafeInteger(value.slotA.serviceId) &&
    value.slotA.serviceId === value.slotB.serviceId &&
    positiveSafeInteger(value.slotA.resourceId) &&
    positiveSafeInteger(value.slotB.resourceId) &&
    validIsoDatetime(value.slotA.datetime) &&
    validIsoDatetime(value.slotB.datetime) &&
    (value.slotA.resourceId !== value.slotB.resourceId ||
      value.slotA.datetime !== value.slotB.datetime) &&
    typeof client?.phone === 'string' &&
    typeof client?.fullName === 'string' &&
    typeof client?.email === 'string' &&
    validListQuery(value.visibleListA, value.slotA, false) &&
    validListQuery(value.deletedListB, value.slotB, true)
  );
}

function sameEffect(
  record: YclientsSafeAdminRecord,
  input: YclientsControlledLifecycleInput,
  slot: YclientsControlledSlot,
  deleted: boolean,
): boolean {
  return (
    record.apiId === input.apiId &&
    record.resourceId === slot.resourceId &&
    record.datetime === slot.datetime &&
    record.deleted === deleted &&
    record.serviceIds.length === 1 &&
    record.serviceIds[0] === slot.serviceId
  );
}

function sameClient(
  snapshot: YclientsControlledFullRecordSnapshot,
  expected: YclientsCreateBookingCommand['client'],
): boolean {
  const fullName = [
    snapshot.client.name,
    snapshot.client.surname,
    snapshot.client.patronymic,
  ]
    .filter((part) => part.length > 0)
    .join(' ');
  return (
    snapshot.client.phone === expected.phone.trim() &&
    snapshot.client.email === expected.email.trim() &&
    fullName === expected.fullName.trim()
  );
}

function effectExpectation(
  input: YclientsControlledLifecycleInput,
  slot: YclientsControlledSlot,
  deleted: boolean,
) {
  return Object.freeze({
    apiId: input.apiId,
    resourceId: slot.resourceId,
    serviceIds: Object.freeze([slot.serviceId]),
    datetime: slot.datetime,
    deleted,
  });
}

function result(
  outcome: YclientsControlledLifecycleResult['outcome'],
  reason: YclientsControlledLifecycleResult['reason'],
  requestCount: number,
  holds: ReadonlyArray<SlotAlias>,
): YclientsControlledLifecycleResult {
  return Object.freeze({
    outcome,
    reason,
    requestCount,
    holds: Object.freeze(holds.slice()),
  });
}

function readStatus(value: { outcome: string }): YclientsControlledEvidenceStatus {
  if (
    value.outcome === 'bookable' ||
    value.outcome === 'loaded' ||
    value.outcome === 'created' ||
    value.outcome === 'found' ||
    value.outcome === 'candidate' ||
    value.outcome === 'accepted' ||
    value.outcome === 'deleted'
  ) {
    return 'pass';
  }
  if (value.outcome === 'unauthorized') return 'unauthorized';
  if (value.outcome === 'unavailable' || value.outcome === 'rate_limited') {
    return 'unavailable';
  }
  if (value.outcome === 'rejected' || value.outcome === 'not_bookable') {
    return 'rejected';
  }
  if (
    value.outcome === 'invalid_request' ||
    value.outcome === 'invalid_response' ||
    value.outcome === 'disabled' ||
    value.outcome === 'write_disabled'
  ) {
    return 'invalid';
  }
  return 'unknown';
}

export class YclientsControlledLifecycle {
  private requestCount = 0;
  private inFlight = false;
  private lastRequestStartedAt: number | undefined;

  constructor(
    private readonly dependencies: YclientsControlledLifecycleDependencies,
  ) {}

  private async request<T extends { outcome: string }>(
    step: number,
    action: YclientsControlledEvidenceAction,
    operation: () => Promise<T>,
    effectFromResult?: (
      result: T,
    ) => YclientsControlledEvidenceEvent['effect'] | undefined,
  ): Promise<T> {
    if (this.inFlight || this.requestCount >= HARD_REQUEST_BUDGET) {
      throw new TypeError('Controlled YCLIENTS request budget violated');
    }
    this.inFlight = true;
    let operationResult: T;
    try {
      const beforeWait = this.dependencies.clock.nowMilliseconds();
      if (!Number.isSafeInteger(beforeWait) || beforeWait < 0) {
        throw new EvidenceUnavailableError();
      }
      const waitMilliseconds =
        this.lastRequestStartedAt === undefined
          ? 0
          : Math.max(
              this.lastRequestStartedAt +
                MINIMUM_REQUEST_INTERVAL_MILLISECONDS -
                beforeWait,
              0,
            );
      if (waitMilliseconds > 0) {
        await this.dependencies.clock.sleep(waitMilliseconds);
      }
      const startedAt = this.dependencies.clock.nowMilliseconds();
      if (
        !Number.isSafeInteger(startedAt) ||
        startedAt < beforeWait + waitMilliseconds
      ) {
        throw new EvidenceUnavailableError();
      }
      this.lastRequestStartedAt = startedAt;
      this.requestCount += 1;
      operationResult = await operation();
    } finally {
      this.inFlight = false;
    }
    const occurredAt = new Date(
      this.dependencies.clock.nowMilliseconds(),
    ).toISOString();
    try {
      const effect = effectFromResult?.(operationResult);
      await this.dependencies.evidence.record(
        Object.freeze({
          step,
          requestCount: this.requestCount,
          occurredAt,
          action,
          status: readStatus(operationResult),
          ...(effect === undefined ? {} : { effect }),
        }),
      );
    } catch {
      throw new EvidenceUnavailableError();
    }
    return operationResult;
  }

  private async availability(
    step: 1 | 3,
    slot: YclientsControlledSlot,
  ): Promise<boolean> {
    let loaded: YclientsAvailableTimesResult;
    try {
      loaded = await this.request(
        step,
        slot.alias === 'A' ? 'availability_A' : 'availability_B',
        () =>
          this.dependencies.availability.listAvailableTimes({
            serviceId: slot.serviceId,
            courtId: slot.resourceId,
            date: slot.datetime.slice(0, 10),
          }),
      );
    } catch (error) {
      if (error instanceof EvidenceUnavailableError) throw error;
      return false;
    }
    return (
      loaded.outcome === 'loaded' &&
      loaded.times.some((time) => time.datetime === slot.datetime)
    );
  }

  private async preflight(
    step: 2 | 4,
    slot: YclientsControlledSlot,
  ): Promise<boolean> {
    let checked: YclientsBookingPreflightResult;
    try {
      checked = await this.request(
        step,
        slot.alias === 'A' ? 'preflight_A' : 'preflight_B',
        () =>
          this.dependencies.availability.preflightBooking({
            serviceId: slot.serviceId,
            courtId: slot.resourceId,
            datetime: slot.datetime,
          }),
      );
    } catch (error) {
      if (error instanceof EvidenceUnavailableError) throw error;
      return false;
    }
    return checked.outcome === 'bookable';
  }

  async run(
    input: YclientsControlledLifecycleInput,
  ): Promise<YclientsControlledLifecycleResult> {
    if (this.requestCount !== 0 || !validInput(input)) {
      return result('stopped', 'invalid_plan', this.requestCount, ['A', 'B']);
    }
    try {
      if (!(await this.availability(1, input.slotA))) {
        return result(
          'stopped',
          'read_or_preflight_failed',
          this.requestCount,
          ['A', 'B'],
        );
      }
      if (!(await this.preflight(2, input.slotA))) {
        return result(
          'stopped',
          'read_or_preflight_failed',
          this.requestCount,
          ['A', 'B'],
        );
      }
      if (!(await this.availability(3, input.slotB))) {
        return result(
          'stopped',
          'read_or_preflight_failed',
          this.requestCount,
          ['A', 'B'],
        );
      }
      if (!(await this.preflight(4, input.slotB))) {
        return result(
          'stopped',
          'read_or_preflight_failed',
          this.requestCount,
          ['A', 'B'],
        );
      }

      const created: YclientsCreateBookingResult = await this.request(
        5,
        'create_A',
        () =>
          this.dependencies.create.createBookingRecord({
            apiId: input.apiId,
            serviceId: input.slotA.serviceId,
            resourceId: input.slotA.resourceId,
            datetime: input.slotA.datetime,
            client: input.client,
          }),
      );
      if (created.outcome === 'unknown_outcome') {
        const candidate = await this.request(
          7,
          'bounded_list_A',
          () =>
            scanBoundedYclientsCandidates(
              this.dependencies.safeReader,
              input.visibleListA,
              effectExpectation(input, input.slotA, false),
            ),
          (value) => (value.outcome === 'candidate' ? 'A' : 'ambiguous'),
        );
        return candidate.outcome === 'candidate'
          ? result(
              'cleanup_required',
              'create_unknown',
              this.requestCount,
              ['A'],
            )
          : result('unknown', 'create_unknown', this.requestCount, ['A']);
      }
      if (created.outcome !== 'created') {
        return result(
          'stopped',
          'create_rejected',
          this.requestCount,
          ['A', 'B'],
        );
      }
      const recordId = created.recordId;

      const full = await this.request(
        6,
        'exact_get_A',
        () => this.dependencies.fullReader.getRecordSnapshot(recordId),
        (value) =>
          value.outcome === 'found' &&
          sameEffect(
            safeYclientsControlledRecordProjection(value.snapshot),
            input,
            input.slotA,
            false,
          )
            ? 'A'
            : 'ambiguous',
      );
      if (
        full.outcome !== 'found' ||
        !sameEffect(
          safeYclientsControlledRecordProjection(full.snapshot),
          input,
          input.slotA,
          false,
        ) ||
        !sameClient(full.snapshot, input.client)
      ) {
        return result(
          'cleanup_required',
          'snapshot_incomplete',
          this.requestCount,
          ['A'],
        );
      }

      const visible = await this.request(
        7,
        'bounded_list_A',
        () =>
          scanBoundedYclientsCandidates(
            this.dependencies.safeReader,
            input.visibleListA,
            effectExpectation(input, input.slotA, false),
          ),
        (value) => (value.outcome === 'candidate' ? 'A' : 'ambiguous'),
      );
      if (visible.outcome !== 'candidate' || visible.record.recordId !== recordId) {
        return result(
          'cleanup_required',
          'visibility_unproven',
          this.requestCount,
          ['A'],
        );
      }

      const rescheduled: YclientsControlledRescheduleResult = await this.request(
        8,
        'reschedule_B',
        () =>
          this.dependencies.writer.reschedule(full.snapshot, {
            resourceId: input.slotB.resourceId,
            datetime: input.slotB.datetime,
          }),
      );
      if (rescheduled.outcome === 'unknown') {
        await this.request(
          9,
          'exact_get_B',
          () => this.dependencies.safeReader.getRecord(recordId),
          (value) =>
            value.outcome === 'found' &&
            sameEffect(value.record, input, input.slotB, false)
              ? 'B'
              : value.outcome === 'found' &&
                  sameEffect(value.record, input, input.slotA, false)
                ? 'A'
                : 'ambiguous',
        );
        return result(
          'unknown',
          'reschedule_unknown',
          this.requestCount,
          ['A', 'B'],
        );
      }
      if (rescheduled.outcome !== 'accepted') {
        return result(
          'cleanup_required',
          'reschedule_rejected',
          this.requestCount,
          ['A'],
        );
      }

      const rescheduleProof = await this.request(
        9,
        'exact_get_B',
        () => this.dependencies.safeReader.getRecord(recordId),
        (value) =>
          value.outcome === 'found' &&
          sameEffect(value.record, input, input.slotB, false)
            ? 'B'
            : 'ambiguous',
      );
      if (
        rescheduleProof.outcome !== 'found' ||
        !sameEffect(rescheduleProof.record, input, input.slotB, false)
      ) {
        return result(
          'unknown',
          'reschedule_effect_unproven',
          this.requestCount,
          ['A', 'B'],
        );
      }

      const firstCancel: YclientsControlledCancelResult = await this.request(
        10,
        'cancel_first',
        () => this.dependencies.writer.cancel(recordId),
      );
      if (firstCancel.outcome !== 'deleted' && firstCancel.outcome !== 'unknown') {
        return result(
          'cleanup_required',
          'cancel_rejected',
          this.requestCount,
          ['B'],
        );
      }

      const exactDeleted = await this.request(
        11,
        'exact_get_deleted',
        () => this.dependencies.safeReader.getRecord(recordId),
        (value) =>
          value.outcome === 'found' &&
          sameEffect(value.record, input, input.slotB, true)
            ? 'deleted'
            : 'ambiguous',
      );
      const exactProof =
        exactDeleted.outcome === 'found' &&
        sameEffect(exactDeleted.record, input, input.slotB, true);
      const listedDeleted = await this.request(
        12,
        'bounded_list_deleted',
        () =>
          scanBoundedYclientsCandidates(
            this.dependencies.safeReader,
            input.deletedListB,
            effectExpectation(input, input.slotB, true),
          ),
        (value) =>
          value.outcome === 'candidate' ? 'deleted' : 'ambiguous',
      );
      const listProof =
        listedDeleted.outcome === 'candidate' &&
        listedDeleted.record.recordId === recordId;

      if (firstCancel.outcome === 'unknown') {
        return exactProof && listProof
          ? result(
              'cancelled_confirmed_after_uncertain_response',
              'cancel_unknown',
              this.requestCount,
              [],
            )
          : result('unknown', 'cancel_unknown', this.requestCount, ['B']);
      }
      if (!exactProof || !listProof) {
        return result(
          'unknown',
          'cancel_effect_unproven',
          this.requestCount,
          ['B'],
        );
      }

      const repeated = await this.request(13, 'cancel_repeat', () =>
        this.dependencies.writer.cancel(recordId),
      );
      const finalDeleted = await this.request(
        14,
        'bounded_list_final',
        () =>
          scanBoundedYclientsCandidates(
            this.dependencies.safeReader,
            input.deletedListB,
            effectExpectation(input, input.slotB, true),
          ),
        (value) =>
          value.outcome === 'candidate' ? 'deleted' : 'ambiguous',
      );
      const finalProof =
        finalDeleted.outcome === 'candidate' &&
        finalDeleted.record.recordId === recordId;
      if (!finalProof) {
        return result(
          'unknown',
          repeated.outcome === 'unknown'
            ? 'repeat_delete_unknown'
            : 'cancel_effect_unproven',
          this.requestCount,
          [],
        );
      }
      if (repeated.outcome === 'unknown') {
        return result(
          'unknown',
          'repeat_delete_unknown',
          this.requestCount,
          [],
        );
      }
      if (repeated.outcome !== 'deleted' && repeated.outcome !== 'rejected') {
        return result(
          'unknown',
          'repeat_delete_unknown',
          this.requestCount,
          [],
        );
      }
      return result(
        'passed',
        repeated.outcome === 'deleted'
          ? 'repeat_delete_accepted'
          : 'repeat_delete_rejected',
        this.requestCount,
        [],
      );
    } catch (error) {
      return error instanceof EvidenceUnavailableError
        ? result(
            'unknown',
            'evidence_unavailable',
            this.requestCount,
            ['A', 'B'],
          )
        : result('unknown', 'read_or_preflight_failed', this.requestCount, [
            'A',
            'B',
          ]);
    }
  }
}
