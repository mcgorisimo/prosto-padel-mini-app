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
import { BackendDomainEventLogger } from '../common/logging/backend-domain-event.logger';
import { YclientsAvailabilityService } from '../integrations/yclients/yclients-availability.service';
import { BookingReservationService } from './booking-reservation.service';
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
  readonly listBookings: jest.Mock;
  readonly readBooking: jest.Mock;
  readonly readBookingByRequestKey: jest.Mock;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [unknown]
  >;
  readonly domainEvents: jest.Mock;
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
  const reservation = {
    reservationId: deterministicUuid('booking-controller-reservation'),
    status: 'confirmed', serviceId: 30_539_679, courtId: 5_730_531,
    startsAt: '2026-08-06T07:00:00+03:00',
    endsAt: '2026-08-06T08:00:00+03:00', stale: false,
  };
  const createBooking = jest.fn().mockResolvedValue({ outcome: 'created', reservation });
  const listBookings = jest.fn().mockResolvedValue({ outcome: 'loaded', reservations: [reservation] });
  const readBooking = jest.fn().mockResolvedValue({ outcome: 'found', reservation });
  const readBookingByRequestKey = jest.fn().mockResolvedValue({ outcome: 'found', reservation });
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
  const domainEvents = jest.fn();
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
        provide: BookingReservationService,
        useValue: { create: createBooking, list: listBookings, read: readBooking, readByRequestKey: readBookingByRequestKey },
      },
      {
        provide: SESSION_AUTHENTICATION_CLOCK,
        useValue: { nowEpochSeconds: () => NOW },
      },
      {
        provide: BackendDomainEventLogger,
        useValue: { record: domainEvents },
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
    listBookings,
    readBooking,
    readBookingByRequestKey,
    authenticate,
    domainEvents,
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
        email: 'test@example.test',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ reservationId: expect.any(String), status: 'confirmed', stale: false });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(harness.createBooking).toHaveBeenCalledTimes(1);
    expect(harness.createBooking).toHaveBeenCalledWith(ACCOUNT_ID, {
      requestKey,
      serviceId: 30_539_679,
      courtId: 5_730_531,
      datetime: '2026-08-06T07:00:00+03:00',
      email: 'test@example.test',
    });
    expect(JSON.stringify(response.json())).not.toContain('record-hash');
    expect(harness.domainEvents).toHaveBeenCalledWith({
      domain: 'private_booking',
      action: 'create',
      outcome: 'created',
      reservationId: expect.any(String),
      reservationStatus: 'confirmed',
    });
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
        email: PRIVATE_MARKER,
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
    ['provider_rejected', 422, 'booking_creation_rejected'],
    ['contact_incomplete', 422, 'booking_contact_incomplete'],
    ['conflict', 409, 'booking_idempotency_conflict'],
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
          email: 'test@example.test',
        },
      });

      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toMatchObject({ statusCode, code });
      expect(harness.createBooking).toHaveBeenCalledTimes(1);
    },
  );

  it('returns a safe persisted handle with 202 for an unknown create outcome', async () => {
    const reservationId = deterministicUuid('booking-controller-reservation');
    harness.createBooking.mockResolvedValueOnce({
      outcome: 'unknown',
      reservation: {
        reservationId, status: 'unknown', serviceId: 30_539_679,
        courtId: 5_730_531, startsAt: '2026-08-06T07:00:00+03:00',
        endsAt: '2026-08-06T08:00:00+03:00', stale: true,
      },
    });
    const response = await harness.app.inject({
      method: 'POST', url: '/bookings', headers: headers(),
      payload: { requestKey: deterministicUuid('booking-controller-unknown'), serviceId: 30_539_679, courtId: 5_730_531, datetime: '2026-08-06T07:00:00+03:00', email: 'test@example.test' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ reservationId, status: 'unknown', stale: true });
    expect(harness.domainEvents).toHaveBeenCalledWith({
      domain: 'private_booking',
      action: 'create',
      outcome: 'unknown',
      reservationId,
      reservationStatus: 'unknown',
    });
  });

  it('lists owner reservations and resolves an uncertain request key without a write route', async () => {
    const requestKey = deterministicUuid('booking-controller-request-lookup');
    const listed = await harness.app.inject({ method: 'GET', url: '/bookings', headers: headers() });
    const recovered = await harness.app.inject({ method: 'GET', url: `/bookings/requests/${requestKey}`, headers: headers() });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().reservations).toHaveLength(1);
    expect(recovered.statusCode).toBe(200);
    expect(harness.listBookings).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(harness.readBookingByRequestKey).toHaveBeenCalledWith(ACCOUNT_ID, requestKey);
  });

  it('reads only the authenticated owner reservation through the read-only service', async () => {
    const reservationId = deterministicUuid('booking-controller-reservation');
    const response = await harness.app.inject({ method: 'GET', url: `/bookings/${reservationId}`, headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(harness.readBooking).toHaveBeenCalledWith(ACCOUNT_ID, reservationId);
    expect(response.json()).toMatchObject({ reservationId, status: 'confirmed' });
  });

  it('publishes no cancel or reschedule route', async () => {
    const reservationId = deterministicUuid('booking-controller-reservation');
    for (const request of [
      { method: 'DELETE' as const, url: `/bookings/${reservationId}` },
      { method: 'PUT' as const, url: `/bookings/${reservationId}` },
      { method: 'POST' as const, url: `/bookings/${reservationId}/cancel` },
      { method: 'POST' as const, url: `/bookings/${reservationId}/reschedule` },
    ]) {
      const response = await harness.app.inject({ ...request, headers: headers() });
      expect(response.statusCode).toBe(404);
    }
  });

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
