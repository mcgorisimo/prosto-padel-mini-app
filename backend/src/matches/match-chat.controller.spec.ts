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
import {
  ListMatchMessagesApiResult,
  SendMatchMessageApiResult,
} from './match-chat-api.types';
import { MatchChatController } from './match-chat.controller';
import { MatchChatService } from './match-chat.service';
import { MatchMessageId } from './match-chat.types';
import { MatchId } from './match.types';

const CREDENTIAL = Buffer.alloc(32, 0x63).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'chat-controller-account',
) as AccountId;
const MATCH_ID = deterministicUuid(
  'chat-controller-match',
) as MatchId;
const MESSAGE_ID = deterministicUuid(
  'chat-controller-message',
) as MatchMessageId;
const REQUEST_KEY = deterministicUuid('chat-controller-request');
const NOW = unixEpochSeconds(1_800_000_000);
const BODY = 'Controller message';
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_CHAT_CREDENTIAL';

function responseMessage() {
  return {
    messageId: MESSAGE_ID,
    matchId: MATCH_ID,
    sender: {
      playerId: ACCOUNT_ID,
      firstName: 'Player',
      rating: 3,
      isVerified: false,
    },
    body: BODY,
    createdAt: NOW,
  };
}

interface Harness {
  readonly app: NestFastifyApplication;
  readonly list: jest.Mock<
    Promise<ListMatchMessagesApiResult>,
    [unknown]
  >;
  readonly send: jest.Mock<
    Promise<SendMatchMessageApiResult>,
    [unknown]
  >;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [unknown]
  >;
  readonly domainEvents: jest.Mock;
  readonly logs: readonly unknown[][];
}

async function createHarness(): Promise<Harness> {
  const list = jest
    .fn<Promise<ListMatchMessagesApiResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'found',
      messages: [responseMessage()],
      nextCursor: { createdAt: NOW, messageId: MESSAGE_ID },
    });
  const send = jest
    .fn<Promise<SendMatchMessageApiResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'message_sent',
      message: responseMessage(),
      persistence: 'applied',
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
  const domainEvents = jest.fn();
  const moduleRef = await Test.createTestingModule({
    controllers: [MatchChatController],
    providers: [
      SessionBearerGuard,
      { provide: MatchChatService, useValue: { list, send } },
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
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
  return { app, list, send, authenticate, domainEvents, logs };
}

function headers() {
  return { authorization: `Bearer ${CREDENTIAL}` };
}

describe('MatchChatController', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('serves bearer-protected keyset reads and idempotent sends with no-store headers', async () => {
    const listed = await harness.app.inject({
      method: 'GET',
      url:
        `/matches/${MATCH_ID}/messages?limit=20` +
        `&beforeCreatedAt=${NOW}&beforeMessageId=${MESSAGE_ID}`,
      headers: headers(),
    });
    const sent = await harness.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/messages`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY, body: BODY },
    });

    expect(listed.statusCode).toBe(200);
    expect(sent.statusCode).toBe(201);
    for (const response of [listed, sent]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
    }
    expect(harness.list).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: {
        limit: 20,
        before: { createdAt: NOW, messageId: MESSAGE_ID },
      },
    });
    expect(harness.send).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY, body: BODY },
    });
    expect(harness.authenticate).toHaveBeenCalledTimes(2);
    expect(harness.domainEvents).toHaveBeenCalledWith({
      domain: 'match_chat',
      action: 'send_message',
      outcome: 'sent',
      matchId: MATCH_ID,
      messageId: MESSAGE_ID,
    });
  });

  it('logs an idempotent send retry without reporting a new message', async () => {
    harness.send.mockResolvedValueOnce({
      outcome: 'message_sent',
      message: responseMessage(),
      persistence: 'idempotent_retry',
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/messages`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY, body: BODY },
    });

    expect(response.statusCode).toBe(201);
    expect(harness.domainEvents).toHaveBeenCalledWith({
      domain: 'match_chat',
      action: 'send_message',
      outcome: 'idempotent_retry',
      matchId: MATCH_ID,
      messageId: MESSAGE_ID,
    });
  });

  it('rejects missing bearer and malformed body/cursor before the service', async () => {
    const missing = await harness.app.inject({
      method: 'GET',
      url: `/matches/${MATCH_ID}/messages`,
    });
    const partialCursor = await harness.app.inject({
      method: 'GET',
      url: `/matches/${MATCH_ID}/messages?beforeCreatedAt=${NOW}`,
      headers: headers(),
    });
    const leakedBody = await harness.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/messages`,
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        body: BODY,
        credential: PRIVATE_MARKER,
      },
    });
    expect(missing.statusCode).toBe(401);
    expect(partialCursor.statusCode).toBe(400);
    expect(leakedBody.statusCode).toBe(400);
    expect(harness.list).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
    expect(JSON.stringify(leakedBody.json())).not.toContain(
      PRIVATE_MARKER,
    );
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });

  it('serializes an unavailable sender without identity fields', async () => {
    harness.list.mockResolvedValueOnce({
      outcome: 'found',
      messages: [
        {
          ...responseMessage(),
          sender: { unavailable: true },
        },
      ],
    });
    const response = await harness.app.inject({
      method: 'GET',
      url: `/matches/${MATCH_ID}/messages`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().messages[0].sender).toEqual({
      unavailable: true,
    });
    expect(
      JSON.stringify(response.json().messages[0].sender),
    ).not.toContain(ACCOUNT_ID);
  });

  it.each([
    [
      'content_not_allowed',
      422,
      'match_chat_content_not_allowed',
    ],
    ['match_not_found', 404, 'match_chat_not_found'],
    ['match_closed', 409, 'match_chat_closed'],
    ['request_conflict', 409, 'match_chat_request_conflict'],
    [
      'temporary_unavailable',
      503,
      'match_chat_service_unavailable',
    ],
    ['internal_failure', 500, 'match_chat_internal_error'],
  ] as const)(
    'maps %s to a safe public response',
    async (reason, statusCode, code) => {
      harness.send.mockResolvedValueOnce({
        outcome: 'rejected',
        reason,
      });
      const response = await harness.app.inject({
        method: 'POST',
        url: `/matches/${MATCH_ID}/messages`,
        headers: headers(),
        payload: { requestKey: REQUEST_KEY, body: BODY },
      });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toMatchObject({ statusCode, code });
      expect(JSON.stringify(response.json())).not.toContain(CREDENTIAL);
      expect(JSON.stringify(response.json())).not.toContain(BODY);
      expect(JSON.stringify(harness.logs)).not.toContain(BODY);
    },
  );
});
