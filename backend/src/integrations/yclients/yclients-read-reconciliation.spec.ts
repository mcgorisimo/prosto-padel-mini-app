import type {
  YclientsBoundedAdminRecordsQuery,
  YclientsSafeAdminRecord,
} from './yclients-admin-read.client';
import {
  reconcileKnownYclientsRecord,
  scanBoundedYclientsCandidates,
  YclientsAdminRecordReader,
} from './yclients-read-reconciliation';

const record: YclientsSafeAdminRecord = Object.freeze({
  recordId: 2_820_023,
  companyId: 2_079_564,
  resourceId: 5_730_531,
  serviceIds: Object.freeze([30_539_679]),
  datetime: '2026-08-05T16:30:00+03:00',
  deleted: false,
  apiId: 7_770_001,
  lastChangeDate: '2026-08-05 15:00:00',
});

const effect = Object.freeze({
  apiId: record.apiId as number,
  resourceId: record.resourceId,
  serviceIds: record.serviceIds,
  datetime: record.datetime,
  deleted: record.deleted,
});

const query: YclientsBoundedAdminRecordsQuery = Object.freeze({
  page: 1,
  count: 50,
  resourceId: record.resourceId,
  dateFrom: '2026-08-05',
  dateTo: '2026-08-05',
  withDeleted: false,
});

function reader(
  overrides: Partial<YclientsAdminRecordReader> = {},
): YclientsAdminRecordReader & {
  getRecord: jest.MockedFunction<YclientsAdminRecordReader['getRecord']>;
  listRecords: jest.MockedFunction<YclientsAdminRecordReader['listRecords']>;
} {
  return {
    getRecord: jest.fn().mockResolvedValue({ outcome: 'not_found' }),
    listRecords: jest.fn().mockResolvedValue({
      outcome: 'loaded',
      page: 1,
      count: 50,
      records: [],
    }),
    ...overrides,
  } as YclientsAdminRecordReader & {
    getRecord: jest.MockedFunction<YclientsAdminRecordReader['getRecord']>;
    listRecords: jest.MockedFunction<YclientsAdminRecordReader['listRecords']>;
  };
}

describe('YCLIENTS read-only reconciliation primitives', () => {
  it('matches one known record through exactly one exact read', async () => {
    const provider = reader({
      getRecord: jest.fn().mockResolvedValue({ outcome: 'found', record }),
    });

    await expect(
      reconcileKnownYclientsRecord(provider, {
        ...effect,
        recordId: record.recordId,
      }),
    ).resolves.toEqual({ outcome: 'matched', record });

    expect(provider.getRecord).toHaveBeenCalledTimes(1);
    expect(provider.getRecord).toHaveBeenCalledWith(record.recordId);
    expect(provider.listRecords).not.toHaveBeenCalled();
  });

  it('keeps a mismatched known effect unknown without list fallback', async () => {
    const provider = reader({
      getRecord: jest.fn().mockResolvedValue({ outcome: 'found', record }),
    });

    await expect(
      reconcileKnownYclientsRecord(provider, {
        ...effect,
        recordId: record.recordId,
        resourceId: record.resourceId + 1,
      }),
    ).resolves.toEqual({
      outcome: 'unknown',
      reason: 'effect_mismatch',
    });
    expect(provider.listRecords).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 'not_found'],
    ['unauthorized', 'unauthorized'],
    ['rejected', 'rejected'],
    ['rate_limited', 'rate_limited'],
    ['unavailable', 'unavailable'],
    ['unknown', 'provider_unknown'],
  ] as const)('keeps exact read outcome %s unknown as %s', async (outcome, reason) => {
    const provider = reader({
      getRecord: jest.fn().mockResolvedValue({ outcome }),
    });

    await expect(
      reconcileKnownYclientsRecord(provider, {
        ...effect,
        recordId: record.recordId,
      }),
    ).resolves.toEqual({ outcome: 'unknown', reason });
    expect(provider.getRecord).toHaveBeenCalledTimes(1);
    expect(provider.listRecords).not.toHaveBeenCalled();
  });

  it('rejects an invalid expectation without any provider read', async () => {
    const provider = reader();

    await expect(
      reconcileKnownYclientsRecord(provider, {
        ...effect,
        recordId: 0,
      }),
    ).resolves.toEqual({
      outcome: 'unknown',
      reason: 'invalid_expectation',
    });
    expect(provider.getRecord).not.toHaveBeenCalled();
    expect(provider.listRecords).not.toHaveBeenCalled();
  });

  it('maps an exact reader exception to unavailable without fallback', async () => {
    const provider = reader({
      getRecord: jest.fn().mockRejectedValue(new Error('opaque read failure')),
    });

    await expect(
      reconcileKnownYclientsRecord(provider, {
        ...effect,
        recordId: record.recordId,
      }),
    ).resolves.toEqual({ outcome: 'unknown', reason: 'unavailable' });
    expect(provider.getRecord).toHaveBeenCalledTimes(1);
    expect(provider.listRecords).not.toHaveBeenCalled();
  });

  it('returns one exact local api_id/effect candidate from one bounded page', async () => {
    const provider = reader({
      listRecords: jest.fn().mockResolvedValue({
        outcome: 'loaded',
        page: 1,
        count: 50,
        records: [record],
      }),
    });

    await expect(
      scanBoundedYclientsCandidates(provider, query, effect),
    ).resolves.toEqual({ outcome: 'candidate', record });
    expect(provider.listRecords).toHaveBeenCalledTimes(1);
    expect(provider.listRecords).toHaveBeenCalledWith(query);
    expect(provider.getRecord).not.toHaveBeenCalled();
  });

  it('keeps zero local candidates unknown without another page', async () => {
    const provider = reader();

    await expect(
      scanBoundedYclientsCandidates(provider, query, effect),
    ).resolves.toEqual({ outcome: 'unknown', reason: 'no_candidate' });
    expect(provider.listRecords).toHaveBeenCalledTimes(1);
    expect(provider.getRecord).not.toHaveBeenCalled();
  });

  it('keeps duplicate api_id candidates unknown even if one effect matches', async () => {
    const provider = reader({
      listRecords: jest.fn().mockResolvedValue({
        outcome: 'loaded',
        page: 1,
        count: 50,
        records: [
          record,
          Object.freeze({
            ...record,
            recordId: record.recordId + 1,
            resourceId: record.resourceId + 1,
          }),
        ],
      }),
    });

    await expect(
      scanBoundedYclientsCandidates(provider, query, effect),
    ).resolves.toEqual({
      outcome: 'unknown',
      reason: 'ambiguous_candidates',
    });
    expect(provider.listRecords).toHaveBeenCalledTimes(1);
  });

  it('keeps a single external-reference effect mismatch unknown', async () => {
    const provider = reader({
      listRecords: jest.fn().mockResolvedValue({
        outcome: 'loaded',
        page: 1,
        count: 50,
        records: [Object.freeze({ ...record, deleted: true })],
      }),
    });

    await expect(
      scanBoundedYclientsCandidates(provider, query, effect),
    ).resolves.toEqual({
      outcome: 'unknown',
      reason: 'effect_mismatch',
    });
  });

  it.each([
    ['disabled', 'disabled'],
    ['unauthorized', 'unauthorized'],
    ['rejected', 'rejected'],
    ['rate_limited', 'rate_limited'],
    ['unavailable', 'unavailable'],
    ['unknown', 'provider_unknown'],
  ] as const)('keeps bounded read outcome %s unknown as %s', async (outcome, reason) => {
    const provider = reader({
      listRecords: jest.fn().mockResolvedValue({ outcome }),
    });

    await expect(
      scanBoundedYclientsCandidates(provider, query, effect),
    ).resolves.toEqual({ outcome: 'unknown', reason });
    expect(provider.listRecords).toHaveBeenCalledTimes(1);
    expect(provider.getRecord).not.toHaveBeenCalled();
  });

  it('maps a bounded reader exception to unavailable without fallback', async () => {
    const provider = reader({
      listRecords: jest
        .fn()
        .mockRejectedValue(new Error('opaque bounded read failure')),
    });

    await expect(
      scanBoundedYclientsCandidates(provider, query, effect),
    ).resolves.toEqual({ outcome: 'unknown', reason: 'unavailable' });
    expect(provider.listRecords).toHaveBeenCalledTimes(1);
    expect(provider.getRecord).not.toHaveBeenCalled();
  });
});
