import type {
  YclientsBoundedAdminRecordsResult,
  YclientsExactAdminRecordResult,
  YclientsSafeAdminRecord,
} from './yclients-admin-read.client';
import type {
  YclientsControlledCancelResult,
  YclientsControlledCleanupExactResult,
} from './yclients-controlled-admin.client';
import type {
  YclientsControlledCleanupBindingChecks,
  YclientsControlledCleanupRecordExpectation,
} from './yclients-controlled-cleanup-record';
import {
  YclientsControlledCleanupEvidenceEvent,
  YclientsControlledCleanupInput,
  YclientsControlledCleanupLifecycle,
} from './yclients-controlled-cleanup-lifecycle';

const COMPANY_ID = 2_079_564;
const RECORD_ID = 1_891_713_981;
const API_ID = 184_993_463_877_968;
const SERVICE_ID = 30_539_679;
const RESOURCE_ID = 5_730_531;
const DATETIME = '2026-08-17T12:00:00+03:00';
const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Disposable Test';
const PRIVATE_EMAIL = 'disposable@example.test';

function bindingChecks(): YclientsControlledCleanupBindingChecks {
  const matched = Object.freeze({ present: true, typeValid: true, equal: true });
  return Object.freeze({
    recordId: matched,
    companyId: matched,
    resourceId: matched,
    services: matched,
    datetime: matched,
    deleted: matched,
    apiId: matched,
    clientPhone: matched,
    clientFullName: matched,
    clientEmail: Object.freeze({
      present: true,
      typeValid: true,
      equal: false,
    }),
  });
}

const MISMATCH = Object.freeze({
  outcome: 'mismatch' as const,
  diagnostic: Object.freeze({
    kind: 'binding_mismatch' as const,
    checks: bindingChecks(),
  }),
});
const NOT_FOUND = Object.freeze({
  outcome: 'not_found' as const,
  diagnostic: Object.freeze({
    kind: 'http_not_found' as const,
    httpStatus: 404 as const,
  }),
});
const UNKNOWN = Object.freeze({
  outcome: 'unknown' as const,
  diagnostic: Object.freeze({
    kind: 'body_invalid' as const,
    reason: 'invalid_json' as const,
  }),
});

function input(): YclientsControlledCleanupInput {
  return Object.freeze({
    companyId: COMPANY_ID,
    recordId: RECORD_ID,
    appointmentId: 1,
    apiId: API_ID,
    identityBinding: 'd2-disposable-identity-v1',
    client: Object.freeze({
      phone: PRIVATE_PHONE,
      fullName: PRIVATE_NAME,
      email: PRIVATE_EMAIL,
    }),
    slotA: Object.freeze({
      alias: 'A' as const,
      serviceId: SERVICE_ID,
      resourceId: RESOURCE_ID,
      datetime: DATETIME,
    }),
    deletedListA: Object.freeze({
      page: 1,
      count: 50,
      resourceId: RESOURCE_ID,
      dateFrom: '2026-08-17',
      dateTo: '2026-08-17',
      withDeleted: true,
    }),
  });
}

function safeRecord(deleted: boolean, recordId = RECORD_ID): YclientsSafeAdminRecord {
  return Object.freeze({
    recordId,
    companyId: COMPANY_ID,
    resourceId: RESOURCE_ID,
    serviceIds: Object.freeze([SERVICE_ID]),
    datetime: DATETIME,
    deleted,
    apiId: API_ID,
  });
}

function loadedList(
  records: ReadonlyArray<YclientsSafeAdminRecord> = [safeRecord(true)],
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

function harness(overrides: {
  exact?: ReadonlyArray<YclientsControlledCleanupExactResult>;
  cancel?: YclientsControlledCancelResult;
  list?: YclientsBoundedAdminRecordsResult;
  evidenceFailureAt?: number;
} = {}) {
  const exactQueue = [
    ...(overrides.exact ?? [
      { outcome: 'matched' as const, record: safeRecord(false) },
      { outcome: 'matched' as const, record: safeRecord(true) },
    ]),
  ];
  const verifyRecord = jest.fn(async (
    _expectation: YclientsControlledCleanupRecordExpectation,
  ) =>
    exactQueue.shift() ?? UNKNOWN,
  );
  const cancel = jest.fn(async () =>
    overrides.cancel ?? ({ outcome: 'deleted' as const }),
  );
  const listRecords = jest.fn(async () => overrides.list ?? loadedList());
  const getRecord = jest.fn(async (): Promise<YclientsExactAdminRecordResult> => ({
    outcome: 'unknown',
  }));
  const events: YclientsControlledCleanupEvidenceEvent[] = [];
  const record = jest.fn(async (event: YclientsControlledCleanupEvidenceEvent) => {
    if (events.length + 1 === overrides.evidenceFailureAt) {
      throw new Error('private evidence failure');
    }
    events.push(event);
  });
  const lifecycle = new YclientsControlledCleanupLifecycle({
    exactReader: { verifyRecord },
    writer: { cancel },
    safeReader: { getRecord, listRecords },
    evidence: { record },
    clock: { nowMilliseconds: () => 1_786_080_000_000 },
  });
  return {
    lifecycle,
    verifyRecord,
    cancel,
    listRecords,
    getRecord,
    events,
    record,
  };
}

describe('record-specific controlled cleanup lifecycle', () => {
  it('uses four requests, one DELETE, and releases A only on exact plus list proof', async () => {
    const setup = harness();

    await expect(setup.lifecycle.run(input())).resolves.toEqual({
      outcome: 'cancelled_confirmed',
      reason: 'canonical_cancel_proof',
      requestCount: 4,
      holds: [],
    });
    expect(setup.verifyRecord).toHaveBeenCalledTimes(2);
    expect(setup.verifyRecord.mock.calls[0][0]).toMatchObject({
      recordId: RECORD_ID,
      deleted: false,
      client: input().client,
    });
    expect(setup.verifyRecord.mock.calls[1][0]).toMatchObject({
      recordId: RECORD_ID,
      deleted: true,
      client: input().client,
    });
    expect(setup.cancel).toHaveBeenCalledTimes(1);
    expect(setup.cancel).toHaveBeenCalledWith(RECORD_ID);
    expect(setup.listRecords).toHaveBeenCalledTimes(1);
    expect(setup.events.map((event) => event.step)).toEqual([1, 2, 3, 4]);
    const serialized = JSON.stringify(setup.events);
    for (const forbidden of [PRIVATE_PHONE, PRIVATE_NAME, PRIVATE_EMAIL]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    [MISMATCH, 'mismatch'],
    [NOT_FOUND, 'not_found'],
    [{ outcome: 'unauthorized' as const }, 'unauthorized'],
    [UNKNOWN, 'unknown'],
  ] as const)('blocks DELETE for %s and preserves safe status', async (preDelete, status) => {
    const setup = harness({ exact: [preDelete] });

    await expect(setup.lifecycle.run(input())).resolves.toEqual({
      outcome: 'cleanup_required',
      reason: 'pre_delete_unverified',
      requestCount: 1,
      holds: ['A'],
    });
    expect(setup.cancel).not.toHaveBeenCalled();
    expect(setup.listRecords).not.toHaveBeenCalled();
    expect(setup.events).toHaveLength(1);
    expect(setup.events[0]).toMatchObject({
      action: 'pre_delete_exact',
      status,
      ...(preDelete.outcome === 'mismatch' ||
      preDelete.outcome === 'not_found' ||
      preDelete.outcome === 'unknown'
        ? { diagnostic: preDelete.diagnostic }
        : {}),
    });
    const serialized = JSON.stringify(setup.events);
    for (const forbidden of [PRIVATE_PHONE, PRIVATE_NAME, PRIVATE_EMAIL]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('permits only the two planned readbacks after an uncertain DELETE', async () => {
    const setup = harness({
      cancel: { outcome: 'unknown', reason: 'timeout_or_transport' },
    });

    await expect(setup.lifecycle.run(input())).resolves.toEqual({
      outcome: 'cancelled_confirmed_after_uncertain_response',
      reason: 'canonical_cancel_proof_after_uncertain_response',
      requestCount: 4,
      holds: [],
    });
    expect(setup.cancel).toHaveBeenCalledTimes(1);
    expect(setup.verifyRecord).toHaveBeenCalledTimes(2);
    expect(setup.listRecords).toHaveBeenCalledTimes(1);
  });

  it('keeps A held when exact 404 is followed by a deleted list row', async () => {
    const setup = harness({
      exact: [
        { outcome: 'matched', record: safeRecord(false) },
        NOT_FOUND,
      ],
      cancel: { outcome: 'unknown', reason: 'provider_unavailable' },
    });

    await expect(setup.lifecycle.run(input())).resolves.toEqual({
      outcome: 'unknown',
      reason: 'cancel_proof_incomplete',
      requestCount: 4,
      holds: ['A'],
    });
    expect(setup.cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps A held when bounded list has an ambiguous external reference', async () => {
    const duplicate = Object.freeze({
      ...safeRecord(true, RECORD_ID + 1),
    });
    const setup = harness({
      list: loadedList([safeRecord(true), duplicate]),
    });

    await expect(setup.lifecycle.run(input())).resolves.toMatchObject({
      outcome: 'unknown',
      reason: 'cancel_proof_incomplete',
      requestCount: 4,
      holds: ['A'],
    });
    expect(setup.cancel).toHaveBeenCalledTimes(1);
  });

  it('stops after a classified non-uncertain cancel failure', async () => {
    const setup = harness({ cancel: { outcome: 'unauthorized' } });

    await expect(setup.lifecycle.run(input())).resolves.toEqual({
      outcome: 'cleanup_required',
      reason: 'cancel_rejected',
      requestCount: 2,
      holds: ['A'],
    });
    expect(setup.cancel).toHaveBeenCalledTimes(1);
    expect(setup.verifyRecord).toHaveBeenCalledTimes(1);
    expect(setup.listRecords).not.toHaveBeenCalled();
  });

  it('fails closed after evidence loss and never retries DELETE', async () => {
    const setup = harness({ evidenceFailureAt: 2 });

    await expect(setup.lifecycle.run(input())).resolves.toEqual({
      outcome: 'unknown',
      reason: 'evidence_unavailable',
      requestCount: 2,
      holds: ['A'],
    });
    expect(setup.cancel).toHaveBeenCalledTimes(1);
    expect(setup.verifyRecord).toHaveBeenCalledTimes(1);
    expect(setup.listRecords).not.toHaveBeenCalled();
  });

  it('rejects an invalid plan with zero provider calls', async () => {
    const setup = harness();
    const invalid = {
      ...input(),
      deletedListA: { ...input().deletedListA, withDeleted: false },
    } as YclientsControlledCleanupInput;

    await expect(setup.lifecycle.run(invalid)).resolves.toEqual({
      outcome: 'cleanup_required',
      reason: 'invalid_plan',
      requestCount: 0,
      holds: ['A'],
    });
    expect(setup.verifyRecord).not.toHaveBeenCalled();
    expect(setup.cancel).not.toHaveBeenCalled();
    expect(setup.listRecords).not.toHaveBeenCalled();
  });
});
