import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { ManualBindingController } from './manual-binding.controller';
import { ManualBindingService } from './manual-binding.service';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const headers = { authorization: `Bearer ${'A'.repeat(43)}` };
describe('manual binding HTTP owner/admin boundary', () => {
  let app: NestFastifyApplication;
  const preview = jest.fn().mockResolvedValue({ outcome: 'forbidden' });
  const confirm = jest.fn().mockResolvedValue({ outcome: 'linked' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ManualBindingController],
      providers: [
        SessionBearerGuard,
        {
          provide: SessionAuthenticationService,
          useValue: {
            authenticate: async () => ({
              outcome: 'authenticated',
              principal: {
                accountId: A,
                role: 'player',
                expiresAt: unixEpochSeconds(1900003600),
              },
            }),
          },
        },
        {
          provide: SESSION_AUTHENTICATION_CLOCK,
          useValue: { nowEpochSeconds: () => unixEpochSeconds(1900000000) },
        },
        { provide: ManualBindingService, useValue: { preview, confirm } },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useLogger(false);
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => {
    preview.mockClear();
    confirm.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });
  const url = `/api/v1/admin/players/${B}/crm-binding`;
  it('takes actor only from session and lets capability service authorize player-role admins', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `${url}/preview`,
      headers,
      payload: { clientId: 5 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ outcome: 'forbidden' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(preview).toHaveBeenCalledWith(A, B, 5);
  });
  it.each([
    { clientId: 5, actorId: B },
    { clientId: 5, companyId: 18 },
    { phone: '+79991112233' },
    { clientId: '5' },
  ])('rejects spoofed request %#', async (payload) => {
    const r = await app.inject({
      method: 'POST',
      url: `${url}/preview`,
      headers,
      payload,
    });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('79991112233');
    expect(preview).not.toHaveBeenCalled();
  });
  it('requires bearer and true identity attestation with exact draft-only body', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/confirm`,
          payload: { draftId: D, identityChecked: true },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/confirm`,
          headers,
          payload: { draftId: D, identityChecked: false },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/confirm`,
          headers,
          payload: { draftId: D, identityChecked: true },
        })
      ).json(),
    ).toEqual({ outcome: 'linked' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(A, B, D, true);
  });
});
