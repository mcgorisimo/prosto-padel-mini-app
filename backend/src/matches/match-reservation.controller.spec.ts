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
import { CourtReservationId } from '../reservations/reservation.types';
import { MatchReservationApiService } from './match-reservation-api.service';
import { LinkMatchReservationApiResult } from './match-reservation-api.types';
import { MatchReservationController } from './match-reservation.controller';
import { MatchId } from './match.types';

const CREDENTIAL = Buffer.alloc(32, 0x72).toString('base64url');
const ACCOUNT_ID = deterministicUuid('d3-controller-account') as AccountId;
const MATCH_ID = deterministicUuid('d3-controller-match') as MatchId;
const RESERVATION_ID = deterministicUuid(
  'd3-controller-reservation',
) as CourtReservationId;
const REQUEST_KEY = deterministicUuid('d3-controller-request');
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_D3_LINK_VALUE';

interface Harness {
  readonly app: NestFastifyApplication;
  readonly link: jest.Mock<Promise<LinkMatchReservationApiResult>, [unknown]>;
  readonly logs: readonly unknown[][];
}

async function createHarness(): Promise<Harness> {
  const link = jest
    .fn<Promise<LinkMatchReservationApiResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'linked',
      persistence: 'applied',
      courtBooking: {
        courtBookingStatus: 'confirmed',
        courtBookingStale: false,
        courtReservationId: RESERVATION_ID,
        courtBookingTarget: {
          serviceId: 11,
          courtId: 22,
          startsAt: '2027-01-17T10:00:00+03:00',
          endsAt: '2027-01-17T11:30:00+03:00',
        },
      },
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
    controllers: [MatchReservationController],
    providers: [
      SessionBearerGuard,
      { provide: MatchReservationApiService, useValue: { link } },
      { provide: SessionAuthenticationService, useValue: { authenticate } },
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
  return { app, link, logs };
}

describe('MatchReservationController', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('links through the bearer-protected exact request and returns no-store', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/reservation-link`,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
      payload: { requestKey: REQUEST_KEY, reservationId: RESERVATION_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.json()).toEqual({
      persistence: 'applied',
      courtBookingStatus: 'confirmed',
      courtBookingStale: false,
      courtReservationId: RESERVATION_ID,
      courtBookingTarget: {
        serviceId: 11,
        courtId: 22,
        startsAt: '2027-01-17T10:00:00+03:00',
        endsAt: '2027-01-17T11:30:00+03:00',
      },
    });
    expect(harness.link).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY, reservationId: RESERVATION_ID },
    });
  });

  it('rejects malformed input before the service without leaking the body', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/reservation-link`,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
      payload: {
        requestKey: REQUEST_KEY,
        reservationId: RESERVATION_ID,
        private: PRIVATE_MARKER,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(harness.link).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });
});
