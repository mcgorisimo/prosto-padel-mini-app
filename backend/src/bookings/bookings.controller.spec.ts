import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { SessionAuthenticationResult } from '../auth/session-authentication.types';
import { YclientsAvailabilityService } from '../integrations/yclients/yclients-availability.service';
import { YclientsBookingService } from '../integrations/yclients/yclients-booking.service';
import { BookingsController } from './bookings.controller';

const CREDENTIAL = Buffer.alloc(32, 0x62).toString('base64url');
const ACCOUNT_ID = deterministicUuid('bookings-controller-account') as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_BOOKING_VALUE';

interface Harness {
  readonly app: NestFastifyApplication;
  readonly listActiveServices: jest.Mock;
  readonly listCourtsForService: jest.Mock;
  readonly listAvailableDates: jest.Mock;
  readonly listAvailableTimes: jest.Mock;
  readonly createBooking: jest.Mock;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [unknown]
  >;
  readonly logs: readonly unknown[][];
}

async function createHarness(): Promise<Harness> {
  const listActiveServices = jest.fn().mockResolvedValue({
    outcome: 'loaded',
    services: [
      { id: 30_539_679, title: 'Аренда корта 1ч.', categoryId: 27_980_310 },
    ],
  });
  const listCourtsForService = jest.fn().mockResolvedValue({
    outcome: 'loaded',
    courts: [{ id: 5_730_531, name: 'Корт №1' }],
  });
  const listAvailableDates = jest.fn().mockResolvedValue({
    outcome: 'loaded',
    dates: ['2026-08-05'],
  });
  const listAvailableTimes = jest.fn().mockResolvedValue({
    outcome: 'loaded',
    times: [
      {
        time: '16:30',
        durationSeconds: 3_600,
        datetime: '2026-08-05T16:30:00+03:00',
      },
    ],
  });
  const createBooking = jest.fn().mockResolvedValue({
    outcome: 'created',
    appointmentId: 1,
    recordId: 2_820_023,
    recordHash: 'private-record-hash',
  });
  const authenticate = jest
    .fn<Promise<SessionAuthenticationResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT_ID,
        role: 'player',
        expiresAt: unixEpochSeconds(Number(NOW) + 3_600),
      },
    });
  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      SessionBearerGuard,
      {
        provide: YclientsAvailabilityService,
        useValue: {
          listActiveServices,
          listCourtsForService,
          listAvailableDates,
          listAvailableTimes,
        },
      },
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: YclientsBookingService,
        useValue: { createBooking },
      },
      {
        provide: SESSION_AUTHENTICATION_CLOCK,
        useValue: { nowEpochSeconds: () => NOW },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  const logs: unknown[][] = [];
  const capture = (...values: unknown[]) => logs.push(values);
  app.useLogger({
    log: capture,
    error: capture,
    warn: capture,
    debug: capture,
    verbose: capture,
    fatal: capture,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    listActiveServices,
    listCourtsForService,
    listAvailableDates,
    listAvailableTimes,
    createBooking,
    authenticate,
    logs,
  };
}

function headers() {
  return { authorization: `Bearer ${CREDENTIAL}` };
}

describe('BookingsController', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('serves the complete bearer-protected read-only availability flow', async () => {
    const services = await harness.app.inject({
      method: 'GET',
      url: '/bookings/services',
      headers: headers(),
    });
    const courts = await harness.app.inject({
      method: 'GET',
      url: '/bookings/services/30539679/courts',
      headers: headers(),
    });
    const dates = await harness.app.inject({
      method: 'GET',
      url:
        '/bookings/services/30539679/courts/5730531/dates' +
        '?dateFrom=2026-08-05&dateTo=2026-08-18',
      headers: headers(),
    });
    const times = await harness.app.inject({
      method: 'GET',
      url:
        '/bookings/services/30539679/courts/5730531/times' +
        '?date=2026-08-05',
      headers: headers(),
    });

    expect(services.json()).toEqual({
      services: [
        { id: 30_539_679, title: 'Аренда корта 1ч.', categoryId: 27_980_310 },
      ],
    });
    expect(courts.json()).toEqual({
      courts: [{ id: 5_730_531, name: 'Корт №1' }],
    });
    expect(dates.json()).toEqual({ dates: ['2026-08-05'] });
    expect(times.json()).toEqual({
      times: [
        {
          time: '16:30',
          durationSeconds: 3_600,
          datetime: '2026-08-05T16:30:00+03:00',
        },
      ],
    });
    for (const response of [services, courts, dates, times]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
    }
    expect(harness.listActiveServices).toHaveBeenCalledWith();
    expect(harness.listCourtsForService).toHaveBeenCalledWith(30_539_679);
    expect(harness.listAvailableDates).toHaveBeenCalledWith({
      serviceId: 30_539_679,
      courtId: 5_730_531,
      dateFrom: '2026-08-05',
      dateTo: '2026-08-18',
    });
    expect(harness.listAvailableTimes).toHaveBeenCalledWith({
      serviceId: 30_539_679,
      courtId: 5_730_531,
      date: '2026-08-05',
    });
    expect(harness.authenticate).toHaveBeenCalledTimes(4);
  });

  it('rejects missing bearer before reading availability', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/bookings/services',
    });

    expect(response.statusCode).toBe(401);
    expect(harness.listActiveServices).not.toHaveBeenCalled();
  });

  it('creates one bearer-protected booking without exposing provider secrets', async () => {
    const requestKey = deterministicUuid('booking-controller-request');
    const response = await harness.app.inject({
      method: 'POST',
      url: '/bookings',
      headers: headers(),
      payload: {
        requestKey,
        serviceId: 30_539_679,
        courtId: 5_730_531,
        datetime: '2026-08-06T07:00:00+03:00',
        client: {
          phone: '79000000000',
          fullName: 'Test Player',
          email: 'test@example.test',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ recordId: 2_820_023 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(harness.createBooking).toHaveBeenCalledTimes(1);
    expect(harness.createBooking).toHaveBeenCalledWith({
      apiId: expect.any(Number),
      serviceId: 30_539_679,
      courtId: 5_730_531,
      datetime: '2026-08-06T07:00:00+03:00',
      client: {
        phone: '79000000000',
        fullName: 'Test Player',
        email: 'test@example.test',
      },
    });
    const command = harness.createBooking.mock.calls[0][0];
    expect(Number.isSafeInteger(command.apiId)).toBe(true);
    expect(command.apiId).toBeGreaterThan(0);
    expect(command.apiId).toBeLessThanOrEqual(2_147_483_647);
    expect(JSON.stringify(response.json())).not.toContain('record-hash');
  });

  it('rejects malformed booking creation before the write service', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/bookings',
      headers: headers(),
      payload: {
        requestKey: 'not-a-uuid',
        serviceId: 30_539_679,
        courtId: 5_730_531,
        datetime: '2026-08-06T07:00:00+03:00',
        client: {
          phone: PRIVATE_MARKER,
          fullName: 'Test Player',
          email: 'test@example.test',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'booking_creation_invalid_request',
    });
    expect(harness.createBooking).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });

  it.each([
    ['not_bookable', 409, 'booking_slot_not_bookable'],
    ['rejected', 422, 'booking_creation_rejected'],
    ['invalid_response', 502, 'booking_creation_invalid_response'],
    ['unknown_outcome', 502, 'booking_creation_unknown_outcome'],
    ['write_disabled', 503, 'booking_creation_unavailable'],
    ['unavailable', 503, 'booking_creation_unavailable'],
  ] as const)(
    'maps booking creation outcome %s to a safe public error',
    async (outcome, statusCode, code) => {
      harness.createBooking.mockResolvedValueOnce({ outcome });
      const response = await harness.app.inject({
        method: 'POST',
        url: '/bookings',
        headers: headers(),
        payload: {
          requestKey: deterministicUuid(`booking-controller-${outcome}`),
          serviceId: 30_539_679,
          courtId: 5_730_531,
          datetime: '2026-08-06T07:00:00+03:00',
          client: {
            phone: '79000000000',
            fullName: 'Test Player',
            email: 'test@example.test',
          },
        },
      });

      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toMatchObject({ statusCode, code });
      expect(harness.createBooking).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects malformed path and query inputs before service calls', async () => {
    const court = await harness.app.inject({
      method: 'GET',
      url: '/bookings/services/not-an-id/courts',
      headers: headers(),
    });
    const dates = await harness.app.inject({
      method: 'GET',
      url:
        '/bookings/services/30539679/courts/5730531/dates' +
        '?dateFrom=2026-08-05',
      headers: headers(),
    });
    const times = await harness.app.inject({
      method: 'GET',
      url:
        '/bookings/services/30539679/courts/5730531/times' +
        '?date=2026-08-05&private=' +
        PRIVATE_MARKER,
      headers: headers(),
    });

    for (const response of [court, dates, times]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'booking_availability_invalid_request',
      });
    }
    expect(harness.listCourtsForService).not.toHaveBeenCalled();
    expect(harness.listAvailableDates).not.toHaveBeenCalled();
    expect(harness.listAvailableTimes).not.toHaveBeenCalled();
    expect(JSON.stringify(times.json())).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });

  it.each([
    ['disabled', 503, 'booking_availability_unavailable'],
    ['unauthorized', 503, 'booking_availability_unavailable'],
    ['unavailable', 503, 'booking_availability_unavailable'],
    ['invalid_response', 502, 'booking_availability_invalid_response'],
  ] as const)('maps %s to a safe public error', async (outcome, statusCode, code) => {
    harness.listActiveServices.mockResolvedValueOnce({ outcome });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/bookings/services',
      headers: headers(),
    });

    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toMatchObject({ statusCode, code });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
  });

  it('maps unexpected service failures without leaking their details', async () => {
    harness.listActiveServices.mockRejectedValueOnce(
      new Error(PRIVATE_MARKER),
    );

    const response = await harness.app.inject({
      method: 'GET',
      url: '/bookings/services',
      headers: headers(),
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      statusCode: 500,
      code: 'booking_availability_internal_error',
    });
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });
});
