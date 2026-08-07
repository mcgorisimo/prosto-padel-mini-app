import {
  YclientsControlledAdminClientConfiguration,
  YclientsControlledCleanupRecordReader,
} from './yclients-controlled-admin.client';
import {
  inspectYclientsControlledCleanupRecord,
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
    ['record', { id: RECORD_ID + 1 }, 'recordId'],
    ['company', { company_id: COMPANY_ID + 1 }, 'companyId'],
    ['resource', { staff_id: RESOURCE_ID + 1 }, 'resourceId'],
    ['service', { services: [{ id: SERVICE_ID + 1 }] }, 'services'],
    [
      'datetime',
      { datetime: '2026-08-17T13:00:00+03:00' },
      'datetime',
    ],
    ['active state', { deleted: true }, 'deleted'],
    ['api id', { api_id: `0${API_ID}` }, 'apiId'],
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
      'clientPhone',
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
      'clientFullName',
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
      'clientEmail',
    ],
  ] as const)(
    'fails closed on %s mismatch with boolean-only diagnostics',
    async (_field, override, check) => {
      const fetch = jest
        .fn()
        .mockResolvedValue(
          jsonResponse(200, {
            success: true,
            data: providerRecord(override),
          }),
        ) as jest.MockedFunction<typeof globalThis.fetch>;

      const result = await new YclientsControlledCleanupRecordReader(
        configuration(fetch),
      ).verifyRecord(expectation());

      expect(result).toMatchObject({
        outcome: 'mismatch',
        diagnostic: { kind: 'binding_mismatch' },
      });
      if (result.outcome !== 'mismatch') throw new Error('expected mismatch');
      expect(result.diagnostic.checks[check].equal).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(PRIVATE_PHONE);
      expect(serialized).not.toContain(PRIVATE_NAME);
      expect(serialized).not.toContain(PRIVATE_EMAIL);
      expect(serialized).not.toContain('record_hash');
      expect(serialized).not.toContain('secret');
    },
  );

  it.each([
    [401, 'unauthorized'],
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

  it('preserves exact 404 as an allowlisted not_found diagnostic', async () => {
    const response = new Response('private-provider-body', { status: 404 });
    const cancel = jest.spyOn(response.body!, 'cancel');
    const fetch = jest.fn().mockResolvedValue(response) as jest.MockedFunction<
      typeof globalThis.fetch
    >;

    await expect(
      new YclientsControlledCleanupRecordReader(
        configuration(fetch),
      ).verifyRecord(expectation()),
    ).resolves.toEqual({
      outcome: 'not_found',
      diagnostic: { kind: 'http_not_found', httpStatus: 404 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('preserves an unexpected HTTP status without reading or logging its body', async () => {
    const response = new Response('private-provider-body', { status: 201 });
    const cancel = jest.spyOn(response.body!, 'cancel');
    const fetch = jest.fn().mockResolvedValue(response) as jest.MockedFunction<
      typeof globalThis.fetch
    >;

    const result = await new YclientsControlledCleanupRecordReader(
      configuration(fetch),
    ).verifyRecord(expectation());

    expect(result).toEqual({
      outcome: 'unknown',
      diagnostic: { kind: 'unexpected_http_status', httpStatus: 201 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private-provider-body');
  });

  it.each([
    [
      'invalid_content_length',
      () =>
        new Response('private-provider-body', {
          status: 200,
          headers: { 'content-length': 'invalid' },
        }),
    ],
    [
      'body_limit_exceeded',
      () =>
        new Response('private-provider-body', {
          status: 200,
          headers: { 'content-length': '262145' },
        }),
    ],
    ['body_missing', () => new Response(null, { status: 200 })],
    [
      'body_stream_error',
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error('private stream error'));
            },
          }),
          { status: 200 },
        ),
    ],
    [
      'invalid_utf8',
      () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }),
    ],
    ['invalid_json', () => new Response('{', { status: 200 })],
    ['body_not_object', () => new Response('[]', { status: 200 })],
  ] as const)('classifies body failure %s without retry', async (reason, createResponse) => {
    const fetch = jest
      .fn()
      .mockResolvedValue(createResponse()) as jest.MockedFunction<
      typeof globalThis.fetch
    >;

    const result = await new YclientsControlledCleanupRecordReader(
      configuration(fetch),
    ).verifyRecord(expectation());

    expect(result).toEqual({
      outcome: 'unknown',
      diagnostic: { kind: 'body_invalid', reason },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('record_hash');
    expect(serialized).not.toContain('secret');
  });

  it('caps a streamed body even without a content-length header', async () => {
    const fetch = jest.fn().mockResolvedValue(
      new Response(new Uint8Array(262_145), { status: 200 }),
    ) as jest.MockedFunction<typeof globalThis.fetch>;

    await expect(
      new YclientsControlledCleanupRecordReader(
        configuration(fetch),
      ).verifyRecord(expectation()),
    ).resolves.toEqual({
      outcome: 'unknown',
      diagnostic: {
        kind: 'body_invalid',
        reason: 'body_limit_exceeded',
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['success_not_true', { success: false, data: providerRecord() }],
    ['data_not_object', { success: true, data: null }],
  ] as const)('classifies envelope failure %s without retry', async (reason, body) => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, body)) as jest.MockedFunction<
      typeof globalThis.fetch
    >;

    const result = await new YclientsControlledCleanupRecordReader(
      configuration(fetch),
    ).verifyRecord(expectation());

    expect(result).toEqual({
      outcome: 'unknown',
      diagnostic: { kind: 'envelope_invalid', reason },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PHONE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_NAME);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_EMAIL);
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

  it('returns only boolean flags for a PII binding mismatch', () => {
    const inspection = inspectYclientsControlledCleanupRecord(
      providerRecord({
        client: {
          phone: PRIVATE_PHONE,
          name: 'Another',
          surname: 'Person',
          patronymic: '',
          email: PRIVATE_EMAIL,
        },
      }),
      expectation(),
    );

    expect(inspection?.record).toBeUndefined();
    expect(inspection?.checks.clientFullName).toEqual({
      present: true,
      typeValid: true,
      equal: false,
    });
    const serialized = JSON.stringify(inspection?.checks);
    expect(serialized).not.toContain(PRIVATE_PHONE);
    expect(serialized).not.toContain(PRIVATE_NAME);
    expect(serialized).not.toContain(PRIVATE_EMAIL);
    expect(serialized).not.toContain('Another');
    expect(serialized).not.toContain('record_hash');
  });

  it('distinguishes missing and invalid provider fields without returning values', () => {
    const missing = inspectYclientsControlledCleanupRecord(
      providerRecord({
        client: {
          phone: PRIVATE_PHONE,
          name: 'Disposable',
          surname: 'Test',
          email: PRIVATE_EMAIL,
        },
      }),
      expectation(),
    );
    const invalid = inspectYclientsControlledCleanupRecord(
      providerRecord({ api_id: `0${API_ID}` }),
      expectation(),
    );

    expect(missing?.checks.clientFullName).toEqual({
      present: false,
      typeValid: false,
      equal: false,
    });
    expect(invalid?.checks.apiId).toEqual({
      present: true,
      typeValid: false,
      equal: false,
    });
    const serialized = JSON.stringify({
      missing: missing?.checks,
      invalid: invalid?.checks,
    });
    expect(serialized).not.toContain(PRIVATE_PHONE);
    expect(serialized).not.toContain(PRIVATE_NAME);
    expect(serialized).not.toContain(PRIVATE_EMAIL);
  });
});
