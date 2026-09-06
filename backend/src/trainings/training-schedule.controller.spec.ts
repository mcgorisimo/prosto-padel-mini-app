import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { unixEpochSeconds } from '../auth/auth.types';
import { SessionBearerGuard, SESSION_AUTHENTICATION_CLOCK } from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { TrainingScheduleController } from './training-schedule.controller';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL = Buffer.alloc(32, 0x61).toString('base64url');
const NOW = unixEpochSeconds(1_900_000_000);

describe('TrainingScheduleController authenticated closed publication boundary', () => {
  let app: NestFastifyApplication;
  let authenticate: jest.Mock;
  const logs: unknown[][] = [];
  beforeEach(async () => {
    authenticate = jest.fn().mockResolvedValue({ outcome: 'authenticated', principal: {
      accountId: ACCOUNT, role: 'player', expiresAt: unixEpochSeconds(NOW + 3600),
    } });
    const module = await Test.createTestingModule({
      controllers: [TrainingScheduleController],
      providers: [SessionBearerGuard,
        { provide: SessionAuthenticationService, useValue: { authenticate } },
        { provide: SESSION_AUTHENTICATION_CLOCK, useValue: { nowEpochSeconds: () => NOW } },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const capture = (...values: unknown[]) => logs.push(values);
    logs.length = 0;
    app.useLogger({ log: capture, error: capture, warn: capture });
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterEach(async () => { await app.close(); });

  it('requires a valid session; auth outage never exposes schedule data', async () => {
    for (const authorization of [undefined, 'Bearer invalid']) {
      const result = await app.inject({ method: 'GET', url: '/api/v1/trainings/schedule', headers: authorization ? { authorization } : {} });
      expect(result.statusCode).toBe(401);
      expect(result.headers['cache-control']).toBe('no-store');
    }
    expect(authenticate).not.toHaveBeenCalled();
    authenticate.mockResolvedValue({ outcome: 'rejected', reason: 'temporary_unavailable' });
    const result = await app.inject({ method: 'GET', url: '/api/v1/trainings/schedule', headers: { authorization: `Bearer ${CREDENTIAL}` } });
    expect(result.statusCode).toBe(503);
    expect(result.json()).not.toHaveProperty('sessions');
  });

  it('returns only not_configured for different authenticated owners, without provider access', async () => {
    for (const accountId of [ACCOUNT, '22222222-2222-4222-8222-222222222222']) {
      authenticate.mockResolvedValue({ outcome: 'authenticated', principal: { accountId, role: 'player', expiresAt: unixEpochSeconds(NOW + 3600) } });
      const result = await app.inject({ method: 'GET', url: '/api/v1/trainings/schedule', headers: { authorization: `Bearer ${CREDENTIAL}` } });
      expect(result.statusCode).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers.pragma).toBe('no-cache');
      expect(result.json()).toEqual({ outcome: 'not_configured', sessions: [] });
      expect(result.body).not.toContain(accountId);
    }
  });

  it('rejects query ownership/filter overrides and has no write endpoint', async () => {
    for (const query of ['phone=SYNTHETIC_PRIVATE_MARKER', 'clientId=123', 'companyId=456', 'service_ids=789', 'enabled=true']) {
      const result = await app.inject({ method: 'GET', url: `/api/v1/trainings/schedule?${query}`, headers: { authorization: `Bearer ${CREDENTIAL}` } });
      expect(result.statusCode).toBe(400);
      expect(result.body).not.toContain('SYNTHETIC_PRIVATE_MARKER');
    }
    expect(JSON.stringify(logs)).not.toContain('SYNTHETIC_PRIVATE_MARKER');
    const result = await app.inject({ method: 'POST', url: '/api/v1/trainings/schedule', headers: { authorization: `Bearer ${CREDENTIAL}` } });
    expect(result.statusCode).toBe(404);
  });
});
