import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { AdminPlayerRatingController } from './admin-player-rating.controller';
import { AdminPlayerRatingService } from './admin-player-rating.service';
import { SESSION_AUTHENTICATION_CLOCK, SessionBearerGuard } from './session-authentication.guard';
import { SessionAuthenticationService } from './session-authentication.service';

const ADMIN_ID = deterministicUuid('admin-rating-controller-admin') as AccountId;
const PLAYER_ID = deterministicUuid('admin-rating-controller-player') as AccountId;
const REQUEST_KEY = deterministicUuid('admin-rating-controller-command');
const NOW = unixEpochSeconds(1_800_000_000);
const CREDENTIAL = Buffer.alloc(32, 0x61).toString('base64url');
const SEARCH_MARKER = 'SYNTHETIC_ADMIN_PLAYER_SEARCH';

async function createHarness(role: 'player' | 'club_admin' = 'club_admin') {
  const authenticate = jest.fn().mockResolvedValue({
    outcome: 'authenticated',
    principal: { accountId: ADMIN_ID, role, expiresAt: unixEpochSeconds(NOW + 3600) },
  });
  const list = jest.fn().mockImplementation((input) => Promise.resolve(
    input.role === 'club_admin'
      ? { outcome: 'listed', response: { players: [{
          accountId: PLAYER_ID, firstName: 'Player', lastName: null, username: null,
          phone: null, sidePreference: 'Both', rating: 3, isVerified: false,
        }], nextCursor: null } }
      : { outcome: 'rejected', reason: 'forbidden' },
  ));
  const setRatingState = jest.fn().mockImplementation((input) => Promise.resolve(
    input.role === 'club_admin'
      ? { outcome: 'applied', state: {
          commandId: REQUEST_KEY, targetAccountId: PLAYER_ID,
          resultType: 'rating_and_verification_updated', ratingBefore: 3, rating: 4,
          isVerifiedBefore: false, isVerified: true, appliedAt: NOW,
        } }
      : { outcome: 'rejected', reason: 'forbidden' },
  ));
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminPlayerRatingController],
    providers: [
      SessionBearerGuard,
      { provide: SessionAuthenticationService, useValue: { authenticate } },
      { provide: AdminPlayerRatingService, useValue: { list, setRatingState } },
      { provide: SESSION_AUTHENTICATION_CLOCK, useValue: { nowEpochSeconds: () => NOW } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
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
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, authenticate, list, setRatingState, logs };
}

describe('AdminPlayerRatingController HTTP boundary', () => {
  it('requires Bearer authentication and disables response caching', async () => {
    const subject = await createHarness();
    try {
      const response = await subject.app.inject({ method: 'GET', url: '/api/v1/admin/players' });
      expect(response.statusCode).toBe(401);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(subject.list).not.toHaveBeenCalled();
    } finally {
      await subject.app.close();
    }
  });

  it('returns the exact keyset player allowlist to a club admin', async () => {
    const subject = await createHarness();
    try {
      const response = await subject.app.inject({
        method: 'GET',
        url: '/api/v1/admin/players?verification=unverified&limit=20',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ players: [{
        accountId: PLAYER_ID, firstName: 'Player', lastName: null, username: null,
        phone: null, sidePreference: 'Both', rating: 3, isVerified: false,
      }], nextCursor: null });
      expect(subject.list).toHaveBeenCalledWith({
        accountId: ADMIN_ID,
        role: 'club_admin',
        request: { verification: 'unverified', limit: 20 },
      });
    } finally {
      await subject.app.close();
    }
  });

  it('accepts PII search only in an exact POST body and rejects the legacy GET query', async () => {
    const subject = await createHarness();
    try {
      const searched = await subject.app.inject({
        method: 'POST',
        url: '/api/v1/admin/players/search',
        headers: {
          authorization: `Bearer ${CREDENTIAL}`,
          'content-type': 'application/json',
        },
        payload: {
          search: SEARCH_MARKER,
          verification: 'all',
          limit: 20,
        },
      });
      expect(searched.statusCode).toBe(200);
      expect(subject.list).toHaveBeenLastCalledWith({
        accountId: ADMIN_ID,
        role: 'club_admin',
        request: {
          search: SEARCH_MARKER,
          verification: 'all',
          limit: 20,
        },
      });

      subject.list.mockClear();
      const legacy = await subject.app.inject({
        method: 'GET',
        url: `/api/v1/admin/players?search=${encodeURIComponent(SEARCH_MARKER)}`,
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });
      expect(legacy.statusCode).toBe(400);
      expect(subject.list).not.toHaveBeenCalled();
      expect(JSON.stringify(legacy.json())).not.toContain(SEARCH_MARKER);
      expect(JSON.stringify(subject.logs)).not.toContain(SEARCH_MARKER);
    } finally {
      await subject.app.close();
    }
  });

  it('returns forbidden for an authenticated player principal', async () => {
    const subject = await createHarness('player');
    try {
      const response = await subject.app.inject({
        method: 'GET', url: '/api/v1/admin/players',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('admin_player_rating_forbidden');
    } finally {
      await subject.app.close();
    }
  });

  it('accepts an exact idempotent command without exposing digest or actor internals', async () => {
    const subject = await createHarness();
    try {
      const response = await subject.app.inject({
        method: 'POST',
        url: `/api/v1/admin/players/${PLAYER_ID}/rating-state`,
        headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
        payload: { requestKey: REQUEST_KEY, rating: 4, isVerified: true },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ state: {
        commandId: REQUEST_KEY, targetAccountId: PLAYER_ID,
        resultType: 'rating_and_verification_updated', ratingBefore: 3, rating: 4,
        isVerifiedBefore: false, isVerified: true, appliedAt: NOW,
      } });
      expect(response.body).not.toContain('requestDigest');
      expect(response.body).not.toContain('actorAccountId');
    } finally {
      await subject.app.close();
    }
  });
});
