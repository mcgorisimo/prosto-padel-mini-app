import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { SessionAuthenticationResult } from '../auth/session-authentication.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { ContentModerationController } from './content-moderation.controller';

const NOW = unixEpochSeconds(1_800_000_000);
const ACCOUNT_ID = deterministicUuid('moderation-controller-account') as AccountId;
const CREDENTIAL = Buffer.alloc(32, 0x61).toString('base64url');
const PRIVATE_TEXT = 'fuck PRIVATE_MODERATION_MARKER';

function expectNoStore(response: {
  readonly headers: Record<string, string | string[] | number | undefined>;
}): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers.pragma).toBe('no-cache');
}

describe('ContentModerationController', () => {
  let app: NestFastifyApplication;
  let authenticate: jest.Mock<Promise<SessionAuthenticationResult>, [unknown]>;
  let logs: unknown[][];

  beforeEach(async () => {
    authenticate = jest.fn().mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT_ID,
        role: 'player',
        expiresAt: unixEpochSeconds(NOW + 3_600),
      },
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [ContentModerationController],
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
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    logs = [];
    const capture = (...values: unknown[]): void => {
      logs.push(values);
    };
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
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows safe text without returning or logging it', async () => {
    const safeText = 'Friendly padel comment';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content/moderation',
      headers: {
        authorization: `Bearer ${CREDENTIAL}`,
        'content-type': 'application/json',
      },
      payload: { text: safeText },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expectNoStore(response);
    expect(JSON.stringify(logs)).not.toContain(safeText);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('rejects disallowed text with a fixed safe response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content/moderation',
      headers: {
        authorization: `Bearer ${CREDENTIAL}`,
        'content-type': 'application/json',
      },
      payload: { text: PRIVATE_TEXT },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      statusCode: 422,
      code: 'content_not_allowed',
      message: 'Content contains disallowed language',
    });
    expectNoStore(response);
    expect(response.body).not.toContain(PRIVATE_TEXT);
    expect(JSON.stringify(logs)).not.toContain(PRIVATE_TEXT);
  });

  it('strictly validates bearer and the exact body allowlist', async () => {
    const missingBearer = await app.inject({
      method: 'POST',
      url: '/api/v1/content/moderation',
      headers: { 'content-type': 'application/json' },
      payload: { text: 'Safe text' },
    });
    const invalidBody = await app.inject({
      method: 'POST',
      url: '/api/v1/content/moderation',
      headers: {
        authorization: `Bearer ${CREDENTIAL}`,
        'content-type': 'application/json',
      },
      payload: { text: 'Safe text', accountId: ACCOUNT_ID },
    });

    expect(missingBearer.statusCode).toBe(401);
    expect(invalidBody.statusCode).toBe(400);
    expectNoStore(missingBearer);
    expectNoStore(invalidBody);
    expect(invalidBody.json()).toMatchObject({
      code: 'content_moderation_invalid_request',
    });
  });
});
