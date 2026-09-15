import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { unixEpochSeconds } from '../auth/auth.types';
import { SESSION_AUTHENTICATION_CLOCK, SessionBearerGuard } from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { CrmBindingController } from './crm-binding.controller';
import { CrmBindingService } from './crm-binding.service';
import { ClosedCrmBindingStore } from './crm-binding.types';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL = Buffer.alloc(32, 0x61).toString('base64url');
const NOW = unixEpochSeconds(1_900_000_000);
const PATH = '/api/v1/profile/crm-binding';
describe('owner-scoped CRM HTTP contract', () => {
  let app: NestFastifyApplication;
  let authenticate: jest.Mock;
  let find: jest.Mock;
  const logs: unknown[][] = [];
  beforeAll(async () => {
    authenticate = jest.fn();
    find = jest.fn();
    const module = await Test.createTestingModule({ controllers: [CrmBindingController], providers: [
      SessionBearerGuard,
      { provide: SessionAuthenticationService, useValue: { authenticate } },
      { provide: SESSION_AUTHENTICATION_CLOCK, useValue: { nowEpochSeconds: () => NOW } },
      { provide: CrmBindingService, useValue: new CrmBindingService({ companyId: 17,
        store: new ClosedCrmBindingStore(), lookup: { find } }) },
    ] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const capture = (...items: unknown[]) => logs.push(items);
    app.useLogger({ log: capture, error: capture, warn: capture });
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => {
    authenticate.mockResolvedValue({ outcome: 'authenticated', principal: {
      accountId: ACCOUNT, role: 'player', expiresAt: unixEpochSeconds(NOW + 3600),
    } });
    logs.length = 0;
    find.mockClear();
  });
  afterAll(async () => { await app.close(); });
  it.each(['GET', 'POST'] as const)('requires a valid bearer for %s and disables caching', async method => {
    const response = await app.inject({ method, url: PATH });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(find).not.toHaveBeenCalled();
  });
  it.each(['GET', 'POST'] as const)('returns only closed state for owner %s', async method => {
    const response = await app.inject({ method, url: PATH, headers: { authorization: `Bearer ${CREDENTIAL}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'not_configured' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(find).not.toHaveBeenCalled();
  });
  it.each([
    { phone: '+79991112233', phoneVerified: true }, { clientId: 5 }, { companyId: 18 },
    { accountId: ACCOUNT }, { username: 'private-marker' }, { proof: 'private-marker' },
  ])('rejects caller-selected identity or proof %# without leaking input', async payload => {
    const response = await app.inject({ method: 'POST', url: PATH, payload,
      headers: { authorization: `Bearer ${CREDENTIAL}` } });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify([response.json(), logs])).not.toMatch(/79991112233|private-marker/);
    expect(find).not.toHaveBeenCalled();
  });
  it('rejects URL parameters, non-player sessions and invalid sessions', async () => {
    const headers = { authorization: `Bearer ${CREDENTIAL}` };
    const response = await app.inject({ method: 'GET', url: `${PATH}?phone=private-marker`, headers });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify([response.json(), logs])).not.toContain('private-marker');
    authenticate.mockResolvedValueOnce({ outcome: 'authenticated', principal: {
      accountId: ACCOUNT, role: 'club_admin', expiresAt: unixEpochSeconds(NOW + 3600),
    } });
    expect((await app.inject({ method: 'POST', url: PATH, headers })).statusCode).toBe(403);
    authenticate.mockResolvedValueOnce({ outcome: 'rejected', reason: 'session_invalid' });
    expect((await app.inject({ method: 'POST', url: PATH, headers })).statusCode).toBe(401);
  });
});
