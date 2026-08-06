import type {
  YclientsBoundedAdminRecordsQuery,
  YclientsBoundedAdminRecordsResult,
  YclientsExactAdminRecordResult,
  YclientsSafeAdminRecord,
} from './yclients-admin-read.client';
import type { YclientsControlledFullRecordSnapshot } from './yclients-controlled-record';
import {
  YclientsControlledEvidenceEvent,
  YclientsControlledLifecycle,
  YclientsControlledLifecycleDependencies,
  YclientsControlledLifecycleInput,
} from './yclients-controlled-lifecycle';

const COMPANY_ID = 2_079_564;
const RECORD_ID = 2_820_023;
const SERVICE_ID = 30_539_679;
const RESOURCE_A = 5_730_531;
const RESOURCE_B = 5_730_532;
const API_ID = 7_770_001;
const DATETIME_A = '2026-08-10T16:30:00+03:00';
const DATETIME_B = '2026-08-11T18:00:00+03:00';
const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Private Client';
const PRIVATE_EMAIL = 'private@example.test';
const PRIVATE_HASH = 'private-record-hash-must-not-enter-evidence';

function query(
  resourceId: number,
  datetime: string,
  withDeleted: boolean,
): YclientsBoundedAdminRecordsQuery {
  const date = datetime.slice(0, 10);
  return Object.freeze({
    page: 1,
    count: 50,
    resourceId,
    dateFrom: date,
    dateTo: date,
    withDeleted,
  });
}

const input: YclientsControlledLifecycleInput = Object.freeze({
  apiId: API_ID,
  client: Object.freeze({
    phone: PRIVATE_PHONE,
    fullName: PRIVATE_NAME,
    email: PRIVATE_EMAIL,
  }),
  slotA: Object.freeze({
    alias: 'A' as const,
    serviceId: SERVICE_ID,
    resourceId: RESOURCE_A,
    datetime: DATETIME_A,
  }),
  slotB: Object.freeze({
    alias: 'B' as const,
    serviceId: SERVICE_ID,
    resourceId: RESOURCE_B,
    datetime: DATETIME_B,
  }),
  visibleListA: query(RESOURCE_A, DATETIME_A, false),
  deletedListB: query(RESOURCE_B, DATETIME_B, true),
});

function safeRecord(
  slot: 'A' | 'B',
  deleted = false,
): YclientsSafeAdminRecord {
  return Object.freeze({
    recordId: RECORD_ID,
    companyId: COMPANY_ID,
    resourceId: slot === 'A' ? RESOURCE_A : RESOURCE_B,
    serviceIds: Object.freeze([SERVICE_ID]),
    datetime: slot === 'A' ? DATETIME_A : DATETIME_B,
    deleted,
    apiId: API_ID,
  });
}

function fullSnapshot(): YclientsControlledFullRecordSnapshot {
  return Object.freeze({
    recordId: RECORD_ID,
    companyId: COMPANY_ID,
    resourceId: RESOURCE_A,
    services: Object.freeze([
      Object.freeze({ id: SERVICE_ID, cost: 4_000, discount: 0 }),
    ]),
    datetime: DATETIME_A,
    seanceLengthSeconds: 3_600,
    attendance: 0,
    notification: Object.freeze({
      sendSms: false,
      smsRemainHours: 0,
      emailRemainHours: 0,
      notified: false,
    }),
    apiId: API_ID,
    deleted: false,
    client: Object.freeze({
      phone: PRIVATE_PHONE,
      name: PRIVATE_NAME,
      surname: '',
      patronymic: '',
      email: PRIVATE_EMAIL,
    }),
  });
}

function loaded(
  records: ReadonlyArray<YclientsSafeAdminRecord>,
): YclientsBoundedAdminRecordsResult {
  return Object.freeze({
    outcome: 'loaded' as const,
    page: 1,
    count: 50,
    totalCount: records.length,
    exhaustive: true,
    records: Object.freeze(records.slice()),
  });
}

type Harness = Readonly<{
  runner: YclientsControlledLifecycle;
  events: YclientsControlledEvidenceEvent[];
  listAvailableTimes: jest.Mock;
  preflightBooking: jest.Mock;
  createBookingRecord: jest.Mock;
  getRecordSnapshot: jest.Mock;
  getRecord: jest.Mock;
  listRecords: jest.Mock;
  reschedule: jest.Mock;
  cancel: jest.Mock;
}>;

function harness(
  overrides: Partial<{
    createResult: { outcome: string; [key: string]: unknown };
    fullResult: { outcome: string; [key: string]: unknown };
    exactResults: ReadonlyArray<YclientsExactAdminRecordResult>;
    listResults: ReadonlyArray<YclientsBoundedAdminRecordsResult>;
    rescheduleResult: { outcome: string; [key: string]: unknown };
    cancelResults: ReadonlyArray<{ outcome: string; [key: string]: unknown }>;
  }> = {},
): Harness {
  const events: YclientsControlledEvidenceEvent[] = [];
  let now = Date.parse('2026-08-07T12:00:00Z');
  const listAvailableTimes = jest.fn(async (request: { datetime?: string; date: string }) => ({
    outcome: 'loaded' as const,
    times: Object.freeze([
      Object.freeze({
        time: request.date === DATETIME_A.slice(0, 10) ? '16:30' : '18:00',
        durationSeconds: 3_600,
        datetime:
          request.date === DATETIME_A.slice(0, 10) ? DATETIME_A : DATETIME_B,
      }),
    ]),
  }));
  const preflightBooking = jest.fn(async () => ({ outcome: 'bookable' as const }));
  const createBookingRecord = jest.fn(async () =>
    overrides.createResult ?? {
      outcome: 'created' as const,
      appointmentId: 1,
      recordId: RECORD_ID,
      recordHash: PRIVATE_HASH,
    },
  );
  const getRecordSnapshot = jest.fn(async () =>
    overrides.fullResult ?? {
      outcome: 'found' as const,
      snapshot: fullSnapshot(),
    },
  );
  const exactQueue = [
    ...(overrides.exactResults ?? [
      { outcome: 'found' as const, record: safeRecord('B') },
      { outcome: 'found' as const, record: safeRecord('B', true) },
    ]),
  ];
  const getRecord = jest.fn(async () =>
    exactQueue.shift() ?? ({ outcome: 'unknown' as const } satisfies YclientsExactAdminRecordResult),
  );
  const listQueue = [
    ...(overrides.listResults ?? [
      loaded([safeRecord('A')]),
      loaded([safeRecord('B', true)]),
      loaded([safeRecord('B', true)]),
    ]),
  ];
  const listRecords = jest.fn(async () =>
    listQueue.shift() ?? loaded([]),
  );
  const reschedule = jest.fn(async () =>
    overrides.rescheduleResult ?? ({ outcome: 'accepted' as const }),
  );
  const cancelQueue = [
    ...(overrides.cancelResults ?? [
      { outcome: 'deleted' as const },
      { outcome: 'deleted' as const },
    ]),
  ];
  const cancel = jest.fn(async () =>
    cancelQueue.shift() ?? ({ outcome: 'unknown' as const, reason: 'timeout_or_transport' as const }),
  );

  const dependencies = {
    availability: { listAvailableTimes, preflightBooking },
    create: { createBookingRecord },
    fullReader: { getRecordSnapshot },
    safeReader: { getRecord, listRecords },
    writer: { reschedule, cancel },
    clock: {
      nowMilliseconds: () => now,
      sleep: async (milliseconds: number) => {
        now += milliseconds;
      },
    },
    evidence: {
      record: (event: YclientsControlledEvidenceEvent) => {
        events.push(event);
      },
    },
  } as unknown as YclientsControlledLifecycleDependencies;

  return Object.freeze({
    runner: new YclientsControlledLifecycle(dependencies),
    events,
    listAvailableTimes,
    preflightBooking,
    createBookingRecord,
    getRecordSnapshot,
    getRecord,
    listRecords,
    reschedule,
    cancel,
  });
}

describe('YclientsControlledLifecycle', () => {
  it('runs the successful path once, enforces the 14-request budget, and emits PII-safe evidence', async () => {
    const test = harness();
    const outcome = await test.runner.run(input);

    expect(outcome).toEqual({
      outcome: 'passed',
      reason: 'repeat_delete_accepted',
      requestCount: 14,
      holds: [],
    });
    expect(test.listAvailableTimes).toHaveBeenCalledTimes(2);
    expect(test.preflightBooking).toHaveBeenCalledTimes(2);
    expect(test.createBookingRecord).toHaveBeenCalledTimes(1);
    expect(test.getRecordSnapshot).toHaveBeenCalledTimes(1);
    expect(test.reschedule).toHaveBeenCalledTimes(1);
    expect(test.cancel).toHaveBeenCalledTimes(2);
    expect(test.getRecord).toHaveBeenCalledTimes(2);
    expect(test.listRecords).toHaveBeenCalledTimes(3);
    expect(test.events.map((event) => event.requestCount)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(
      test.events.map((event) => Date.parse(event.occurredAt)),
    ).toEqual(
      Array.from(
        { length: 14 },
        (_, index) => Date.parse('2026-08-07T12:00:00Z') + index * 1_000,
      ),
    );
    expect(test.events.map((event) => event.action)).toEqual([
      'availability_A',
      'preflight_A',
      'availability_B',
      'preflight_B',
      'create_A',
      'exact_get_A',
      'bounded_list_A',
      'reschedule_B',
      'exact_get_B',
      'cancel_first',
      'exact_get_deleted',
      'bounded_list_deleted',
      'cancel_repeat',
      'bounded_list_final',
    ]);
    const evidence = JSON.stringify(test.events);
    for (const forbidden of [
      PRIVATE_PHONE,
      PRIVATE_NAME,
      PRIVATE_EMAIL,
      PRIVATE_HASH,
      String(RECORD_ID),
      String(API_ID),
    ]) {
      expect(evidence).not.toContain(forbidden);
    }
  });

  it('C5 performs only the bounded list after uncertain create and never writes cleanup', async () => {
    const test = harness({
      createResult: { outcome: 'unknown_outcome' },
      listResults: [loaded([safeRecord('A')])],
    });
    await expect(test.runner.run(input)).resolves.toEqual({
      outcome: 'cleanup_required',
      reason: 'create_unknown',
      requestCount: 6,
      holds: ['A'],
    });
    expect(test.getRecordSnapshot).not.toHaveBeenCalled();
    expect(test.reschedule).not.toHaveBeenCalled();
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.events.map((event) => event.step)).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it.each([
    ['zero', loaded([])],
    ['more_than_one', loaded([safeRecord('A'), { ...safeRecord('A'), recordId: RECORD_ID + 1 }])],
  ])('C5 keeps %s candidates unknown without widening the list', async (_name, page) => {
    const test = harness({
      createResult: { outcome: 'unknown_outcome' },
      listResults: [page],
    });
    const outcome = await test.runner.run(input);
    expect(outcome.outcome).toBe('unknown');
    expect(outcome.reason).toBe('create_unknown');
    expect(test.listRecords).toHaveBeenCalledTimes(1);
    expect(test.cancel).not.toHaveBeenCalled();
  });

  it('C8 performs exact readback only, classifies effect, and leaves both holds', async () => {
    const test = harness({
      rescheduleResult: {
        outcome: 'unknown',
        reason: 'timeout_or_transport',
      },
      exactResults: [{ outcome: 'found', record: safeRecord('A') }],
      listResults: [loaded([safeRecord('A')])],
    });
    await expect(test.runner.run(input)).resolves.toEqual({
      outcome: 'unknown',
      reason: 'reschedule_unknown',
      requestCount: 9,
      holds: ['A', 'B'],
    });
    expect(test.reschedule).toHaveBeenCalledTimes(1);
    expect(test.getRecord).toHaveBeenCalledTimes(1);
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.events.at(-1)).toMatchObject({
      step: 9,
      action: 'exact_get_B',
      effect: 'A',
    });
  });

  it('C10 allows only exact/list proof after uncertain first cancel and never repeats DELETE', async () => {
    const test = harness({
      cancelResults: [
        { outcome: 'unknown', reason: 'provider_unavailable' },
      ],
    });
    await expect(test.runner.run(input)).resolves.toEqual({
      outcome: 'cancelled_confirmed_after_uncertain_response',
      reason: 'cancel_unknown',
      requestCount: 12,
      holds: [],
    });
    expect(test.cancel).toHaveBeenCalledTimes(1);
    expect(test.getRecord).toHaveBeenCalledTimes(2);
    expect(test.listRecords).toHaveBeenCalledTimes(2);
    expect(test.events.at(-1)?.step).toBe(12);
  });

  it('C13 performs final list only after uncertain repeat DELETE and makes no new write', async () => {
    const test = harness({
      cancelResults: [
        { outcome: 'deleted' },
        { outcome: 'unknown', reason: 'rate_limited' },
      ],
    });
    await expect(test.runner.run(input)).resolves.toEqual({
      outcome: 'unknown',
      reason: 'repeat_delete_unknown',
      requestCount: 14,
      holds: [],
    });
    expect(test.cancel).toHaveBeenCalledTimes(2);
    expect(test.events.at(-1)?.action).toBe('bounded_list_final');
  });

  it('does not turn a repeat-delete auth failure into a Basic PASS', async () => {
    const test = harness({
      cancelResults: [
        { outcome: 'deleted' },
        { outcome: 'unauthorized' },
      ],
    });
    await expect(test.runner.run(input)).resolves.toEqual({
      outcome: 'unknown',
      reason: 'repeat_delete_unknown',
      requestCount: 14,
      holds: [],
    });
    expect(test.cancel).toHaveBeenCalledTimes(2);
    expect(test.events.at(-1)?.action).toBe('bounded_list_final');
  });

  it('never performs repeat DELETE without first 204 and both canonical cancel proofs', async () => {
    const test = harness({
      exactResults: [
        { outcome: 'found', record: safeRecord('B') },
        { outcome: 'found', record: safeRecord('B', false) },
      ],
      listResults: [
        loaded([safeRecord('A')]),
        loaded([safeRecord('B', true)]),
      ],
      cancelResults: [{ outcome: 'deleted' }],
    });
    await expect(test.runner.run(input)).resolves.toEqual({
      outcome: 'unknown',
      reason: 'cancel_effect_unproven',
      requestCount: 12,
      holds: ['B'],
    });
    expect(test.cancel).toHaveBeenCalledTimes(1);
    expect(test.events.some((event) => event.step === 13)).toBe(false);
  });

  it('stops before cancel when reschedule is rejected and marks cleanup required', async () => {
    const test = harness({
      rescheduleResult: { outcome: 'rejected' },
      listResults: [loaded([safeRecord('A')])],
    });
    await expect(test.runner.run(input)).resolves.toEqual({
      outcome: 'cleanup_required',
      reason: 'reschedule_rejected',
      requestCount: 8,
      holds: ['A'],
    });
    expect(test.reschedule).toHaveBeenCalledTimes(1);
    expect(test.cancel).not.toHaveBeenCalled();
  });

  it('rejects an invalid plan without any provider action', async () => {
    const test = harness();
    const invalid = {
      ...input,
      slotB: { ...input.slotB, serviceId: SERVICE_ID + 1 },
    };
    await expect(test.runner.run(invalid)).resolves.toEqual({
      outcome: 'stopped',
      reason: 'invalid_plan',
      requestCount: 0,
      holds: ['A', 'B'],
    });
    expect(test.listAvailableTimes).not.toHaveBeenCalled();
    expect(test.createBookingRecord).not.toHaveBeenCalled();
  });

  it.each([
    {
      ...input.visibleListA,
      dateFrom: '2026-02-30',
      dateTo: '2026-02-30',
    },
    {
      ...input.visibleListA,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-10',
    },
  ])('rejects an invalid recovery-list window before provider calls', async (visibleListA) => {
    const test = harness();
    await expect(
      test.runner.run({ ...input, visibleListA }),
    ).resolves.toMatchObject({
      outcome: 'stopped',
      reason: 'invalid_plan',
      requestCount: 0,
    });
    expect(test.listAvailableTimes).not.toHaveBeenCalled();
    expect(test.createBookingRecord).not.toHaveBeenCalled();
    expect(test.listRecords).not.toHaveBeenCalled();
  });
});
