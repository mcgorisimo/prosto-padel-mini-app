import {
  YclientsAdminWriteClient,
  YclientsControlledAdminClientConfiguration,
  YclientsControlledFullRecordReader,
} from './yclients-controlled-admin.client';
import {
  buildYclientsControlledReschedulePayload,
  safeYclientsControlledRecordProjection,
  YclientsControlledFullRecordSnapshot,
} from './yclients-controlled-record';
import {
  YclientsConservativeRequestLimiter,
  YclientsRequestLimiterClock,
} from './yclients-request-limiter';

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

const OFF_NOTIFICATION = Object.freeze({
  smsBefore: 0,
  smsNow: false,
  smsNowText: '',
  emailNow: false,
  smsRemainHours: 0,
  emailRemainHours: 0,
  notified: false,
});

const UNSAFE_NOTIFICATION_STATES: ReadonlyArray<
  readonly [
    string,
    YclientsControlledFullRecordSnapshot['notification'],
  ]
> = Object.freeze([
  ['sms_before', Object.freeze({ ...OFF_NOTIFICATION, smsBefore: 1 })],
  ['sms_now', Object.freeze({ ...OFF_NOTIFICATION, smsNow: true })],
  [
    'sms_now_text',
    Object.freeze({ ...OFF_NOTIFICATION, smsNowText: 'provider observation' }),
  ],
  [
    'sms_now_text whitespace',
    Object.freeze({ ...OFF_NOTIFICATION, smsNowText: ' ' }),
  ],
  ['email_now', Object.freeze({ ...OFF_NOTIFICATION, emailNow: true })],
  [
    'sms_remain_hours',
    Object.freeze({ ...OFF_NOTIFICATION, smsRemainHours: 5 }),
  ],
  [
    'email_remain_hours',
    Object.freeze({ ...OFF_NOTIFICATION, emailRemainHours: 1 }),
  ],
  ['notified', Object.freeze({ ...OFF_NOTIFICATION, notified: true })],
]);

class ImmediateClock implements YclientsRequestLimiterClock {
  private now = 0;

  nowMilliseconds(): number {
    return this.now;
  }

  async sleep(milliseconds: number): Promise<void> {
    this.now += milliseconds;
  }
}

function fetchMock(): jest.MockedFunction<typeof globalThis.fetch> {
  return jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
}

function configuration(
  fetch: jest.MockedFunction<typeof globalThis.fetch>,
  enabled = true,
): YclientsControlledAdminClientConfiguration {
  return {
    enabled,
    baseUrl: 'https://api.example.test/vendor',
    companyId: COMPANY_ID,
    partnerToken: 'test-partner-credential',
    userToken: 'test-user-credential',
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

function providerRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    company_id: COMPANY_ID,
    staff_id: RESOURCE_A,
    services: [{ id: SERVICE_ID, cost: 4_000, discount: 10 }],
    datetime: DATETIME_A,
    seance_length: 3_600,
    attendance: 0,
    sms_before: 0,
    sms_now: 0,
    sms_now_text: '',
    email_now: 0,
    sms_remain_hours: 5,
    email_remain_hours: 1,
    notified: 0,
    api_id: String(API_ID),
    deleted: false,
    client: {
      phone: PRIVATE_PHONE,
      name: PRIVATE_NAME,
      surname: '',
      patronymic: '',
      email: PRIVATE_EMAIL,
    },
    record_hash: 'must-never-leave-provider-parser',
    ...overrides,
  };
}

function snapshot(): YclientsControlledFullRecordSnapshot {
  return Object.freeze({
    recordId: RECORD_ID,
    companyId: COMPANY_ID,
    resourceId: RESOURCE_A,
    services: Object.freeze([
      Object.freeze({ id: SERVICE_ID, cost: 4_000, discount: 10 }),
    ]),
    datetime: DATETIME_A,
    seanceLengthSeconds: 3_600,
    attendance: 0,
    notification: OFF_NOTIFICATION,
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

describe('YCLIENTS controlled full-record reader', () => {
  it('uses exact Partner+User GET and keeps PII outside the safe projection', async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(200, { success: true, data: providerRecord() }),
    );
    const result = await new YclientsControlledFullRecordReader(
      configuration(fetch),
    ).getRecordSnapshot(RECORD_ID);

    expect(result.outcome).toBe('found');
    if (result.outcome !== 'found') throw new Error('expected full snapshot');
    expect(result.snapshot.client).toEqual({
      phone: PRIVATE_PHONE,
      name: PRIVATE_NAME,
      surname: '',
      patronymic: '',
      email: PRIVATE_EMAIL,
    });
    expect(result.snapshot.apiId).toBe(API_ID);
    expect(result.snapshot.notification).toEqual({
      smsBefore: 0,
      smsNow: false,
      smsNowText: '',
      emailNow: false,
      smsRemainHours: 5,
      emailRemainHours: 1,
      notified: false,
    });
    const safe = JSON.stringify(
      safeYclientsControlledRecordProjection(result.snapshot),
    );
    expect(safe).not.toContain(PRIVATE_PHONE);
    expect(safe).not.toContain(PRIVATE_NAME);
    expect(safe).not.toContain(PRIVATE_EMAIL);
    expect(safe).not.toContain('record_hash');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    expect(String(input)).toBe(
      `https://api.example.test/vendor/api/v1/record/${COMPANY_ID}/${RECORD_ID}`,
    );
    expect(init?.method).toBe('GET');
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      'Bearer test-partner-credential, User test-user-credential',
    );
    expect(JSON.stringify(result)).not.toContain('credential');
  });

  it('parses documented non-off notification observations without making them write-safe', async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: providerRecord({
          sms_before: 6,
          sms_now: 1,
          sms_now_text: 'provider observation',
          email_now: 1,
          sms_remain_hours: 5,
          email_remain_hours: 1,
          notified: 1,
        }),
      }),
    );

    const result = await new YclientsControlledFullRecordReader(
      configuration(fetch),
    ).getRecordSnapshot(RECORD_ID);

    expect(result.outcome).toBe('found');
    if (result.outcome !== 'found') throw new Error('expected full snapshot');
    expect(result.snapshot.notification).toEqual({
      smsBefore: 6,
      smsNow: true,
      smsNowText: 'provider observation',
      emailNow: true,
      smsRemainHours: 5,
      emailRemainHours: 1,
      notified: true,
    });
  });

  it.each([
    providerRecord({ services: [{ id: SERVICE_ID }] }),
    providerRecord({ client: {} }),
    providerRecord({ sms_now: undefined }),
    providerRecord({ email_remain_hours: undefined }),
    providerRecord({ api_id: `0${API_ID}` }),
    providerRecord({ api_id: ` ${API_ID}` }),
    providerRecord({ api_id: '9007199254740992' }),
  ])('fails closed when a full-payload field is absent or unsafe', async (data) => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(200, { success: true, data }),
    );
    await expect(
      new YclientsControlledFullRecordReader(
        configuration(fetch),
      ).getRecordSnapshot(RECORD_ID),
    ).resolves.toEqual({ outcome: 'unknown' });
  });
});

describe('YclientsAdminWriteClient', () => {
  it('sends one allowlisted PUT with explicit notification-off choices', async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(201, { success: true, data: { id: RECORD_ID } }),
    );
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await new YclientsAdminWriteClient(
        configuration(fetch),
      ).reschedule(snapshot(), {
        resourceId: RESOURCE_B,
        datetime: DATETIME_B,
      });

      expect(result).toEqual({ outcome: 'accepted' });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      expect(String(input)).toBe(
        `https://api.example.test/vendor/api/v1/record/${COMPANY_ID}/${RECORD_ID}`,
      );
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(String(init?.body))).toEqual({
        staff_id: RESOURCE_B,
        services: [{ id: SERVICE_ID, cost: 4_000, discount: 10 }],
        client: {
          phone: PRIVATE_PHONE,
          name: PRIVATE_NAME,
          surname: '',
          patronymic: '',
          email: PRIVATE_EMAIL,
        },
        save_if_busy: false,
        datetime: DATETIME_B,
        seance_length: 3_600,
        send_sms: false,
        sms_remain_hours: 0,
        email_remain_hours: 0,
        attendance: 0,
        api_id: String(API_ID),
      });
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe(
        'Bearer test-partner-credential, User test-user-credential',
      );
      expect(JSON.stringify(result)).not.toContain(PRIVATE_PHONE);
      expect(JSON.stringify(result)).not.toContain(PRIVATE_NAME);
      expect(JSON.stringify(result)).not.toContain(PRIVATE_EMAIL);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it.each([404, 408, 425, 429, 500, 503])(
    'classifies uncertain PUT status %s without retry',
    async (status) => {
      const response = new Response('private-provider-body', { status });
      const cancel = jest.spyOn(response.body!, 'cancel');
      const fetch = fetchMock().mockResolvedValue(response);
      const result = await new YclientsAdminWriteClient(
        configuration(fetch),
      ).reschedule(snapshot(), {
        resourceId: RESOURCE_B,
        datetime: DATETIME_B,
      });

      expect(result.outcome).toBe('unknown');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('private-provider-body');
    },
  );

  it('treats invalid or ambiguous 201 body as unknown without retry', async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(201, { success: true, data: { id: RECORD_ID + 1 } }),
    );
    await expect(
      new YclientsAdminWriteClient(configuration(fetch)).reschedule(snapshot(), {
        resourceId: RESOURCE_B,
        datetime: DATETIME_B,
      }),
    ).resolves.toEqual({
      outcome: 'unknown',
      reason: 'invalid_or_ambiguous_response',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(UNSAFE_NOTIFICATION_STATES)(
    'refuses PUT before fetch when %s is not fully off',
    async (_field, notification) => {
      const fetch = fetchMock();
      const observed = Object.freeze({
        ...snapshot(),
        notification,
      });
      const target = Object.freeze({
        resourceId: RESOURCE_B,
        datetime: DATETIME_B,
      });

      expect(
        buildYclientsControlledReschedulePayload(observed, target),
      ).toBeUndefined();
      await expect(
        new YclientsAdminWriteClient(configuration(fetch)).reschedule(
          observed,
          target,
        ),
      ).resolves.toEqual({ outcome: 'invalid_request' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('sends exactly one DELETE and accepts only documented 204 with no body', async () => {
    const fetch = fetchMock().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await new YclientsAdminWriteClient(
      configuration(fetch),
    ).cancel(RECORD_ID);

    expect(result).toEqual({ outcome: 'deleted' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    expect(String(input)).toBe(
      `https://api.example.test/vendor/api/v1/record/${COMPANY_ID}/${RECORD_ID}`,
    );
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
  });

  it('does not retry DELETE after transport uncertainty', async () => {
    const fetch = fetchMock().mockRejectedValue(new Error('private transport'));
    await expect(
      new YclientsAdminWriteClient(configuration(fetch)).cancel(RECORD_ID),
    ).resolves.toEqual({
      outcome: 'unknown',
      reason: 'timeout_or_transport',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the controlled client disabled unless its explicit harness gate is on', async () => {
    const fetch = fetchMock();
    const client = new YclientsAdminWriteClient(configuration(fetch, false));
    await expect(client.cancel(RECORD_ID)).resolves.toEqual({
      outcome: 'disabled',
    });
    await expect(
      client.reschedule(snapshot(), {
        resourceId: RESOURCE_B,
        datetime: DATETIME_B,
      }),
    ).resolves.toEqual({ outcome: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
