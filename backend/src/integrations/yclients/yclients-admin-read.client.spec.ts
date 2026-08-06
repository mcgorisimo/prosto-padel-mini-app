import type { YclientsApiConfiguration } from '../../config/yclients-api.config';
import {
  YclientsAdminReadClient,
  YclientsBoundedAdminRecordsQuery,
} from './yclients-admin-read.client';
import {
  YclientsConservativeRequestLimiter,
  YclientsRequestLimiterClock,
} from './yclients-request-limiter';

const COMPANY_ID = 2_079_564;
const RECORD_ID = 2_820_023;
const RESOURCE_ID = 5_730_531;
const SERVICE_ID = 30_539_679;
const API_ID = 7_770_001;

class ImmediateClock implements YclientsRequestLimiterClock {
  private now = 0;

  nowMilliseconds(): number {
    return this.now;
  }

  async sleep(milliseconds: number): Promise<void> {
    this.now += milliseconds;
  }
}

function runtime(
  overrides: Partial<YclientsApiConfiguration> = {},
): YclientsApiConfiguration {
  return {
    enabled: true,
    bookingWriteEnabled: false,
    baseUrl: 'https://api.example.test/vendor',
    companyId: COMPANY_ID,
    partnerToken: 'test-partner-credential',
    userToken: 'test-user-credential',
    ...overrides,
  };
}

function fetchMock(): jest.MockedFunction<typeof globalThis.fetch> {
  return jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(
  fetch: jest.MockedFunction<typeof globalThis.fetch>,
  apiRuntime: YclientsApiConfiguration = runtime(),
  limiter: YclientsConservativeRequestLimiter =
    new YclientsConservativeRequestLimiter({
      clock: new ImmediateClock(),
    }),
): YclientsAdminReadClient {
  return new YclientsAdminReadClient({
    runtime: apiRuntime,
    requestTimeoutMilliseconds: 5_000,
    fetch,
    limiter,
  });
}

function providerRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    company_id: COMPANY_ID,
    staff_id: RESOURCE_ID,
    services: [{ id: SERVICE_ID, title: 'ignored service title' }],
    datetime: '2026-08-05T16:30:00+03:00',
    deleted: false,
    api_id: API_ID,
    last_change_date: '2026-08-05 15:00:00',
    client: {
      name: 'private-client-name',
      phone: 'private-client-phone',
      email: 'private-client-email',
    },
    record_hash: 'private-record-hash',
    ...overrides,
  };
}

const listQuery: YclientsBoundedAdminRecordsQuery = Object.freeze({
  page: 1,
  count: 50,
  resourceId: RESOURCE_ID,
  dateFrom: '2026-08-05',
  dateTo: '2026-08-06',
  withDeleted: true,
});

describe('YclientsAdminReadClient', () => {
  it('requires an explicitly shared request limiter', () => {
    expect(
      () =>
        new YclientsAdminReadClient({
          runtime: runtime(),
          requestTimeoutMilliseconds: 5_000,
          fetch: fetchMock(),
        } as never),
    ).toThrow('Shared YCLIENTS request limiter is required');
  });

  it('serializes two client instances through the same limiter', async () => {
    const clock = new ImmediateClock();
    const limiter = new YclientsConservativeRequestLimiter({ clock });
    const starts: number[] = [];
    const firstFetch = fetchMock().mockImplementation(async () => {
      starts.push(clock.nowMilliseconds());
      return jsonResponse(200, { success: true, data: providerRecord() });
    });
    const secondFetch = fetchMock().mockImplementation(async () => {
      starts.push(clock.nowMilliseconds());
      return jsonResponse(200, { success: true, data: providerRecord() });
    });

    await expect(
      Promise.all([
        client(firstFetch, runtime(), limiter).getRecord(RECORD_ID),
        client(secondFetch, runtime(), limiter).getRecord(RECORD_ID),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ outcome: 'found' }),
      expect.objectContaining({ outcome: 'found' }),
    ]);
    expect(starts).toEqual([0, 1_000]);
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  describe('exact admin record', () => {
    it('is disabled and unreachable without an explicit enabled configuration', async () => {
      const fetch = fetchMock();

      await expect(
        client(fetch, runtime({ enabled: false })).getRecord(RECORD_ID),
      ).resolves.toEqual({ outcome: 'disabled' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('uses exact admin URL and both auth schemes while returning safe fields only', async () => {
      const fetch = fetchMock().mockResolvedValue(
        jsonResponse(200, { success: true, data: providerRecord() }),
      );

      const result = await client(fetch).getRecord(RECORD_ID);

      expect(result).toEqual({
        outcome: 'found',
        record: {
          recordId: RECORD_ID,
          companyId: COMPANY_ID,
          resourceId: RESOURCE_ID,
          serviceIds: [SERVICE_ID],
          datetime: '2026-08-05T16:30:00+03:00',
          deleted: false,
          apiId: API_ID,
          lastChangeDate: '2026-08-05 15:00:00',
        },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      expect(String(input)).toBe(
        'https://api.example.test/vendor/api/v1/record/2079564/2820023',
      );
      expect(init?.method).toBe('GET');
      const headers = init?.headers as Record<string, string>;
      expect(headers.accept).toBe('application/vnd.yclients.v2+json');
      expect(headers.authorization.startsWith('Bearer ')).toBe(true);
      expect(headers.authorization.includes(', User ')).toBe(true);
      expect(String(input).includes('credential')).toBe(false);
      const safeResult = JSON.stringify(result);
      expect(safeResult.includes('private-client')).toBe(false);
      expect(safeResult.includes('private-record-hash')).toBe(false);
    });

    it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid record id %s before fetch',
      async (recordId) => {
        const fetch = fetchMock();

        await expect(client(fetch).getRecord(recordId)).resolves.toEqual({
          outcome: 'invalid_request',
        });
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it.each([
      [{ partnerToken: '' }, 'invalid_request'],
      [{ userToken: '' }, 'invalid_request'],
      [{ baseUrl: 'http://api.example.test' }, 'invalid_request'],
      [{ companyId: undefined }, 'invalid_request'],
    ] satisfies ReadonlyArray<
      readonly [Partial<YclientsApiConfiguration>, 'invalid_request']
    >)(
      'fails closed for incomplete configuration %#',
      async (overrides, outcome) => {
        const fetch = fetchMock();

        await expect(
          client(fetch, runtime(overrides)).getRecord(RECORD_ID),
        ).resolves.toEqual({ outcome });
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it.each([
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [404, 'not_found'],
      [400, 'rejected'],
      [409, 'rejected'],
      [422, 'rejected'],
      [429, 'rate_limited'],
      [408, 'unavailable'],
      [425, 'unavailable'],
      [500, 'unavailable'],
      [201, 'unknown'],
    ] as const)('classifies status %s as %s without provider body', async (status, outcome) => {
      const fetch = fetchMock().mockResolvedValue(
        jsonResponse(status, { private: 'provider-body-marker' }),
      );

      await expect(client(fetch).getRecord(RECORD_ID)).resolves.toEqual({
        outcome,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      { success: false, data: providerRecord() },
      { success: true, data: [] },
      { success: true, data: providerRecord({ id: RECORD_ID + 1 }) },
      { success: true, data: providerRecord({ deleted: 0 }) },
      { success: true, data: providerRecord({ api_id: 'not-a-number' }) },
      { success: true, data: providerRecord({ datetime: '2026-02-30T16:30:00+03:00' }) },
      { success: true, data: providerRecord({ services: [] }) },
      {
        success: true,
        data: providerRecord({ company_id: COMPANY_ID + 1 }),
      },
      {
        success: true,
        data: providerRecord({
          company_id: 'invalid',
          company: { id: COMPANY_ID },
        }),
      },
    ])('maps invalid success body %# to unknown', async (body) => {
      const fetch = fetchMock().mockResolvedValue(jsonResponse(200, body));

      await expect(client(fetch).getRecord(RECORD_ID)).resolves.toEqual({
        outcome: 'unknown',
      });
    });

    it('maps timeout/transport failure to unavailable without retry or fallback', async () => {
      const fetch = fetchMock().mockRejectedValue(
        new DOMException('opaque timeout', 'TimeoutError'),
      );

      await expect(client(fetch).getRecord(RECORD_ID)).resolves.toEqual({
        outcome: 'unavailable',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does not expose an invalid raw provider body', async () => {
      const fetch = fetchMock().mockResolvedValue(
        new Response('not-json-private-provider-marker', { status: 200 }),
      );

      const result = await client(fetch).getRecord(RECORD_ID);

      expect(result).toEqual({ outcome: 'unknown' });
      expect(JSON.stringify(result).includes('private-provider-marker')).toBe(
        false,
      );
    });
  });

  describe('bounded admin records page', () => {
    it('uses one capped page with narrow documented filters and no api_id lookup claim', async () => {
      const fetch = fetchMock().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          data: [providerRecord()],
          meta: { page: 1, count: 50, total_count: 1 },
        }),
      );

      const result = await client(fetch).listRecords(listQuery);

      expect(result).toEqual({
        outcome: 'loaded',
        page: 1,
        count: 50,
        totalCount: 1,
        exhaustive: true,
        records: [
          {
            recordId: RECORD_ID,
            companyId: COMPANY_ID,
            resourceId: RESOURCE_ID,
            serviceIds: [SERVICE_ID],
            datetime: '2026-08-05T16:30:00+03:00',
            deleted: false,
            apiId: API_ID,
            lastChangeDate: '2026-08-05 15:00:00',
          },
        ],
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      const url = new URL(String(input));
      expect(url.pathname).toBe('/vendor/api/v1/records/2079564');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        page: '1',
        count: '50',
        staff_id: String(RESOURCE_ID),
        start_date: '2026-08-05',
        end_date: '2026-08-06',
        with_deleted: '1',
      });
      expect(url.searchParams.has('api_id')).toBe(false);
      expect(init?.method).toBe('GET');
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization.startsWith('Bearer ')).toBe(true);
      expect(headers.authorization.includes(', User ')).toBe(true);
    });

    it('accepts only explicit bounded pagination and date ranges', async () => {
      const invalidQueries: YclientsBoundedAdminRecordsQuery[] = [
        { ...listQuery, page: 0 },
        { ...listQuery, page: 11 },
        { ...listQuery, count: 0 },
        { ...listQuery, count: 51 },
        { ...listQuery, resourceId: 0 },
        { ...listQuery, dateFrom: '2026-02-30' },
        { ...listQuery, dateFrom: '2026-08-07' },
        { ...listQuery, dateTo: '2026-08-20' },
      ];

      for (const query of invalidQueries) {
        const fetch = fetchMock();
        await expect(client(fetch).listRecords(query)).resolves.toEqual({
          outcome: 'invalid_request',
        });
        expect(fetch).not.toHaveBeenCalled();
      }
    });

    it('supports a caller-selected capped page without fetching another page', async () => {
      const fetch = fetchMock().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          data: [],
          meta: { page: 10, count: 1, total_count: 0 },
        }),
      );

      await expect(
        client(fetch).listRecords({ ...listQuery, page: 10, count: 1 }),
      ).resolves.toEqual({
        outcome: 'loaded',
        page: 10,
        count: 1,
        totalCount: 0,
        exhaustive: false,
        records: [],
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('page')).toBe(
        '10',
      );
    });

    it('marks a valid truncated first page as non-exhaustive', async () => {
      const fetch = fetchMock().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          data: [providerRecord()],
          meta: { page: 1, count: 1, total_count: 2 },
        }),
      );

      await expect(
        client(fetch).listRecords({ ...listQuery, count: 1 }),
      ).resolves.toEqual({
        outcome: 'loaded',
        page: 1,
        count: 1,
        totalCount: 2,
        exhaustive: false,
        records: [
          {
            recordId: RECORD_ID,
            companyId: COMPANY_ID,
            resourceId: RESOURCE_ID,
            serviceIds: [SERVICE_ID],
            datetime: '2026-08-05T16:30:00+03:00',
            deleted: false,
            apiId: API_ID,
            lastChangeDate: '2026-08-05 15:00:00',
          },
        ],
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      undefined,
      { page: 2, count: 1, total_count: 1 },
      { page: 1, count: 2, total_count: 1 },
      { page: 1, count: 1, total_count: 0 },
      { page: 1, count: 1, total_count: -1 },
    ])('rejects absent or inconsistent pagination metadata %#', async (meta) => {
      const fetch = fetchMock().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          data: [providerRecord()],
          ...(meta === undefined ? {} : { meta }),
        }),
      );

      await expect(
        client(fetch).listRecords({ ...listQuery, count: 1 }),
      ).resolves.toEqual({ outcome: 'unknown' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [404, 'rejected'],
      [422, 'rejected'],
      [429, 'rate_limited'],
      [408, 'unavailable'],
      [500, 'unavailable'],
      [206, 'unknown'],
    ] as const)('classifies list status %s as %s', async (status, outcome) => {
      const fetch = fetchMock().mockResolvedValue(
        jsonResponse(status, { private: 'provider-body-marker' }),
      );

      await expect(client(fetch).listRecords(listQuery)).resolves.toEqual({
        outcome,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      { success: false, data: [] },
      { success: true, data: {} },
      {
        success: true,
        data: [providerRecord(), providerRecord()],
      },
      {
        success: true,
        data: [providerRecord({ staff_id: 0 })],
      },
    ])('fails closed for invalid/ambiguous page body %#', async (body) => {
      const fetch = fetchMock().mockResolvedValue(jsonResponse(200, body));

      await expect(
        client(fetch).listRecords({ ...listQuery, count: 1 }),
      ).resolves.toEqual({ outcome: 'unknown' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('rejects duplicate record ids within an otherwise bounded page', async () => {
      const fetch = fetchMock().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          data: [providerRecord(), providerRecord()],
          meta: { page: 1, count: 2, total_count: 2 },
        }),
      );

      await expect(
        client(fetch).listRecords({ ...listQuery, count: 2 }),
      ).resolves.toEqual({ outcome: 'unknown' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('rejects a success body above the response cap', async () => {
      const fetch = fetchMock().mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: [], padding: 'x'.repeat(70_000) }),
          { status: 200 },
        ),
      );

      await expect(client(fetch).listRecords(listQuery)).resolves.toEqual({
        outcome: 'unknown',
      });
    });

    it('rejects oversized content-length before acquiring a body reader', async () => {
      const cancel = jest.fn().mockResolvedValue(undefined);
      const getReader = jest.fn(() => {
        throw new Error('body reader must not be acquired');
      });
      const fetch = fetchMock().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-length': '65537' }),
        body: { cancel, getReader },
      } as unknown as Response);

      await expect(client(fetch).listRecords(listQuery)).resolves.toEqual({
        outcome: 'unknown',
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(getReader).not.toHaveBeenCalled();
    });

    it('cancels a streamed body immediately after it exceeds the byte cap', async () => {
      const read = jest
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(40_000) })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(40_000) });
      const cancel = jest.fn().mockResolvedValue(undefined);
      const releaseLock = jest.fn();
      const text = jest.fn().mockRejectedValue(new Error('text must not be used'));
      const fetch = fetchMock().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: {
          getReader: jest.fn(() => ({ read, cancel, releaseLock })),
        },
        text,
      } as unknown as Response);

      await expect(client(fetch).listRecords(listQuery)).resolves.toEqual({
        outcome: 'unknown',
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(releaseLock).toHaveBeenCalledTimes(1);
      expect(text).not.toHaveBeenCalled();
    });
  });
});
