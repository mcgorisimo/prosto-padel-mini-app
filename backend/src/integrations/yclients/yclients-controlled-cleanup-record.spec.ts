import {
  YclientsControlledAdminClientConfiguration,
  YclientsControlledCleanupRecordReader,
} from './yclients-controlled-admin.client';
import {
  readYclientsControlledCleanupRecord,
  YclientsControlledCleanupRecordExpectation,
} from './yclients-controlled-cleanup-record';
import { YclientsConservativeRequestLimiter } from './yclients-request-limiter';

const COMPANY_ID = 2_079_564;
const RECORD_ID = 1_891_713_981;
const API_ID = 184_993_463_877_968;
const SERVICE_ID = 30_539_679;
const RESOURCE_ID = 5_730_531;
const DATETIME = '2026-08-17T12:00:00+03:00';
const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Disposable Test';
const PRIVATE_EMAIL = 'disposable@example.test';

class ImmediateClock {
  private now = 0;
  nowMilliseconds(): number {
    return this.now;
  }
  async sleep(milliseconds: number): Promise<void> {
    this.now += milliseconds;
  }
}

function expectation(
  deleted = false,
): YclientsControlledCleanupRecordExpectation {
  return Object.freeze({
    companyId: COMPANY_ID,
    recordId: RECORD_ID,
    apiId: API_ID,
    resourceId: RESOURCE_ID,
    serviceId: SERVICE_ID,
    datetime: DATETIME,
    deleted,
    client: Object.freeze({
      phone: PRIVATE_PHONE,
      fullName: PRIVATE_NAME,
      email: PRIVATE_EMAIL,
    }),
  });
}

function providerRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    company_id: COMPANY_ID,
    staff_id: RESOURCE_ID,
    services: [{ id: SERVICE_ID }],
    datetime: DATETIME,
    deleted: false,
    api_id: String(API_ID),
    client: {
      phone: PRIVATE_PHONE,
      name: 'Disposable',
      surname: 'Test',
      patronymic: '',
      email: PRIVATE_EMAIL,
    },
    record_hash: 'must-never-leave-provider-parser',
    ...overrides,
  };
}

function configuration(
  fetch: jest.MockedFunction<typeof globalThis.fetch>,
): YclientsControlledAdminClientConfiguration {
  return {
    enabled: true,
    baseUrl: 'https://api.example.test/vendor',
    companyId: COMPANY_ID,
    partnerToken: 'partner-secret',
    userToken: 'user-secret',
    requestTimeoutMilliseconds: 5_000,
    fetch,
    limiter: new YclientsConservativeRequestLimiter({
      clock: new ImmediateClock(),
    }),
  };
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('YCLIENTS record-specific cleanup exact reader', () => {
  it('matches the official-shaped exact record without reschedule notification fields', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: true, data: providerRecord() }),
      ) as jest.MockedFunction<typeof globalThis.fetch>;
    const result = await new YclientsControlledCleanupRecordReader(
      configuration(fetch),
    ).verifyRecord(expectation());

    expect(result).toEqual({
      outcome: 'matched',
      record: {
        recordId: RECORD_ID,
        companyId: COMPANY_ID,
        resourceId: RESOURCE_ID,
        serviceIds: [SERVICE_ID],
        datetime: DATETIME,
        deleted: false,
        apiId: API_ID,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    expect(String(input)).toBe(
      `https://api.example.test/vendor/api/v1/record/${COMPANY_ID}/${RECORD_ID}`,
    );
    expect(init?.method).toBe('GET');
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PHONE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_NAME);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_EMAIL);
    expect(JSON.stringify(result)).not.toContain('record_hash');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it.each([
    ['record', { id: RECORD_ID + 1 }],
    ['company', { company_id: COMPANY_ID + 1 }],
    ['resource', { staff_id: RESOURCE_ID + 1 }],
    ['service', { services: [{ id: SERVICE_ID + 1 }] }],
    ['datetime', { datetime: '2026-08-17T13:00:00+03:00' }],
    ['active state', { deleted: true }],
    ['api id', { api_id: `0${API_ID}` }],
    [
      'phone',
      {
        client: {
          phone: '78880000000',
          name: 'Disposable',
          surname: 'Test',
          patronymic: '',
          email: PRIVATE_EMAIL,
        },
      },
    ],
    [
      'full name',
      {
        client: {
          phone: PRIVATE_PHONE,
          name: 'Another',
          surname: 'Client',
          patronymic: '',
          email: PRIVATE_EMAIL,
        },
      },
    ],
    [
      'email',
      {
        client: {
          phone: PRIVATE_PHONE,
          name: 'Disposable',
          surname: 'Test',
          patronymic: '',
          email: 'another@example.test',
        },
      },
    ],
  ])('fails closed on %s mismatch without exposing PII', async (_field, override) => {
    const fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, {
          success: true,
          data: providerRecord(override),
        }),
      ) as jest.MockedFunction<typeof globalThis.fetch>;

    await expect(
      new YclientsControlledCleanupRecordReader(
        configuration(fetch),
      ).verifyRecord(expectation()),
    ).resolves.toEqual({ outcome: 'mismatch' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'unauthorized'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ])('cancels non-200 body for %s without retry', async (status, outcome) => {
    const response = new Response('private-provider-body', { status });
    const cancel = jest.spyOn(response.body!, 'cancel');
    const fetch = jest
      .fn()
      .mockResolvedValue(response) as jest.MockedFunction<
      typeof globalThis.fetch
    >;

    await expect(
      new YclientsControlledCleanupRecordReader(
        configuration(fetch),
      ).verifyRecord(expectation()),
    ).resolves.toEqual({ outcome });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed expectation before fetch', async () => {
    const fetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
    const invalid = {
      ...expectation(),
      companyId: COMPANY_ID + 1,
    };

    await expect(
      new YclientsControlledCleanupRecordReader(
        configuration(fetch),
      ).verifyRecord(invalid),
    ).resolves.toEqual({ outcome: 'invalid_request' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed expected client before fetch', async () => {
    const fetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
    const invalid = {
      ...expectation(),
      client: { ...expectation().client, email: 'invalid-email' },
    };

    await expect(
      new YclientsControlledCleanupRecordReader(
        configuration(fetch),
      ).verifyRecord(invalid),
    ).resolves.toEqual({ outcome: 'invalid_request' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns no PII-bearing object from the pure parser', () => {
    const record = readYclientsControlledCleanupRecord(
      providerRecord(),
      expectation(),
    );
    expect(record).toBeDefined();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(PRIVATE_PHONE);
    expect(serialized).not.toContain(PRIVATE_NAME);
    expect(serialized).not.toContain(PRIVATE_EMAIL);
  });
});
