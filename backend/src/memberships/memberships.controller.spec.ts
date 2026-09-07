import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { MembershipsController } from './memberships.controller';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL = Buffer.alloc(32, 0x61).toString('base64url');
const NOW = unixEpochSeconds(1_900_000_000);

describe('MembershipsController authenticated closed read boundary', () => {
  let app: NestFastifyApplication;
  let authenticate: jest.Mock;
  const logs: unknown[][] = [];

  beforeEach(async () => {
    authenticate = jest.fn().mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT,
        role: 'player',
        expiresAt: unixEpochSeconds(NOW + 3600),
      },
    });
    const module = await Test.createTestingModule({
      controllers: [MembershipsController],
      providers: [
        SessionBearerGuard,
        {
          provide: SessionAuthenticationService,
          useValue: { authenticate },
        },
        {
          provide: SESSION_AUTHENTICATION_CLOCK,
          useValue: { nowEpochSeconds: () => NOW },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    const capture = (...values: unknown[]) => logs.push(values);
    logs.length = 0;
    app.useLogger({ log: capture, error: capture, warn: capture });
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => { await app.close(); });

  it('requires a valid session and exposes no membership data during auth outage', async () => {
    for (const path of ['/api/v1/memberships/mine', '/api/v1/memberships/catalog']) {
      const missing = await app.inject({ method: 'GET', url: path });
      expect(missing.statusCode).toBe(401);
      expect(missing.headers['cache-control']).toBe('no-store');
    }
    expect(authenticate).not.toHaveBeenCalled();

    authenticate.mockResolvedValue({
      outcome: 'rejected',
      reason: 'temporary_unavailable',
    });
    const unavailable = await app.inject({
      method: 'GET',
      url: '/api/v1/memberships/mine',
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).not.toHaveProperty('memberships');
  });

  it('returns only closed states for different owners without provider or database access', async () => {
    for (const accountId of [ACCOUNT, '22222222-2222-4222-8222-222222222222']) {
      authenticate.mockResolvedValue({
        outcome: 'authenticated',
        principal: {
          accountId,
          role: 'player',
          expiresAt: unixEpochSeconds(NOW + 3600),
        },
      });
      const mine = await app.inject({
        method: 'GET',
        url: '/api/v1/memberships/mine',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });
      const catalog = await app.inject({
        method: 'GET',
        url: '/api/v1/memberships/catalog',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });
      expect(mine.statusCode).toBe(200);
      expect(mine.headers['cache-control']).toBe('no-store');
      expect(mine.json()).toEqual({ outcome: 'not_configured', memberships: [] });
      expect(catalog.statusCode).toBe(200);
      expect(catalog.json()).toEqual({ outcome: 'not_configured', products: [] });
      expect(`${mine.body}${catalog.body}`).not.toContain(accountId);
    }
  });

  it('rejects identity/catalog overrides, writes and PII-safe logging regressions', async () => {
    const marker = 'SYNTHETIC_PRIVATE_MARKER';
    for (const path of ['mine', 'catalog']) {
      for (const query of [`phone=${marker}`, `email=${marker}%40example.test`, 'clientId=123', 'companyId=456', 'enabled=true']) {
        const result = await app.inject({
          method: 'GET',
          url: `/api/v1/memberships/${path}?${query}`,
          headers: { authorization: `Bearer ${CREDENTIAL}` },
        });
        expect(result.statusCode).toBe(400);
        expect(result.body).not.toContain(marker);
      }
      const write = await app.inject({
        method: 'POST',
        url: `/api/v1/memberships/${path}`,
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });
      expect(write.statusCode).toBe(404);
    }
    expect(JSON.stringify(logs)).not.toContain(marker);
  });
});
