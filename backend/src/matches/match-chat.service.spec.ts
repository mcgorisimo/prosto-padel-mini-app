import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchChatPersistenceError,
  MatchChatRepository,
} from '../database/match-chat.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  MatchMessageId,
  MatchMessageRecord,
} from './match-chat.types';
import { MatchChatService } from './match-chat.service';
import { MatchId } from './match.types';

const ACTOR_ID = deterministicUuid('chat-service-actor') as AccountId;
const OTHER_ID = deterministicUuid('chat-service-other') as AccountId;
const MATCH_ID = deterministicUuid('chat-service-match') as MatchId;
const MESSAGE_ID = deterministicUuid(
  'chat-service-message',
) as MatchMessageId;
const REQUEST_KEY = deterministicUuid('chat-service-request');
const NOW = unixEpochSeconds(1_800_000_000);
const BODY = 'A deterministic message';
const transaction = Object.freeze({
  query: jest.fn(),
}) as unknown as PostgresTransaction;

function message(
  overrides: Partial<MatchMessageRecord> = {},
): MatchMessageRecord {
  return Object.freeze({
    messageId: MESSAGE_ID,
    matchId: MATCH_ID,
    senderAccountId: ACTOR_ID,
    body: BODY,
    createdAt: NOW,
    ...overrides,
  });
}

function repository(): jest.Mocked<MatchChatRepository> {
  return {
    list: jest.fn(),
    readSenders: jest.fn().mockImplementation(
      async (
        _transaction: PostgresTransaction,
        input: { readonly senderAccountIds: readonly AccountId[] },
      ) => ({
        outcome: 'found' as const,
        senders: input.senderAccountIds.map((senderAccountId) => ({
          senderAccountId,
          availability: 'available' as const,
          firstName:
            senderAccountId === ACTOR_ID ? 'Alice' : 'Bob',
          rating: 3,
          isVerified: false,
        })),
      }),
    ),
    send: jest.fn(),
  };
}

function harness(chat = repository()) {
  return {
    chat,
    service: new MatchChatService({
      transactions: {
        run: (operation) => operation(transaction),
      },
      chat,
      clock: { nowEpochSeconds: () => NOW },
    }),
  };
}

function actorInput() {
  return {
    accountId: ACTOR_ID,
    role: 'player' as const,
    matchId: MATCH_ID,
  };
}

describe('MatchChatService', () => {
  it('lists an enriched keyset page in one transaction', async () => {
    const test = harness();
    const otherMessage = message({
      messageId: deterministicUuid(
        'chat-service-other-message',
      ) as MatchMessageId,
      senderAccountId: OTHER_ID,
      createdAt: unixEpochSeconds(Number(NOW) - 1),
    });
    test.chat.list.mockResolvedValue({
      outcome: 'found',
      messages: [message(), otherMessage],
      nextCursor: {
        createdAt: otherMessage.createdAt,
        messageId: otherMessage.messageId,
      },
    });

    await expect(
      test.service.list({
        ...actorInput(),
        request: { limit: 2 },
      }),
    ).resolves.toEqual({
      outcome: 'found',
      messages: [
        {
          messageId: MESSAGE_ID,
          matchId: MATCH_ID,
          sender: {
            playerId: ACTOR_ID,
            firstName: 'Alice',
            rating: 3,
            isVerified: false,
          },
          body: BODY,
          createdAt: NOW,
        },
        {
          messageId: otherMessage.messageId,
          matchId: MATCH_ID,
          sender: {
            playerId: OTHER_ID,
            firstName: 'Bob',
            rating: 3,
            isVerified: false,
          },
          body: BODY,
          createdAt: otherMessage.createdAt,
        },
      ],
      nextCursor: {
        createdAt: otherMessage.createdAt,
        messageId: otherMessage.messageId,
      },
    });
    expect(test.chat.list).toHaveBeenCalledWith(transaction, {
      matchId: MATCH_ID,
      actorAccountId: ACTOR_ID,
      limit: 2,
    });
    expect(test.chat.readSenders).toHaveBeenCalledWith(
      transaction,
      { senderAccountIds: [ACTOR_ID, OTHER_ID] },
    );
  });

  it('creates deterministic command/message bindings and a body-bound digest', async () => {
    const test = harness();
    test.chat.send.mockResolvedValue({
      outcome: 'message_sent',
      persistence: 'applied',
      message: message(),
    });
    const input = {
      ...actorInput(),
      request: { requestKey: REQUEST_KEY, body: BODY },
    };

    await expect(test.service.send(input)).resolves.toMatchObject({
      outcome: 'message_sent',
      persistence: 'applied',
      message: {
        messageId: MESSAGE_ID,
        sender: { playerId: ACTOR_ID, firstName: 'Alice' },
      },
    });
    await test.service.send(input);

    const first = test.chat.send.mock.calls[0][1];
    const retry = test.chat.send.mock.calls[1][1];
    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      matchId: MATCH_ID,
      actorAccountId: ACTOR_ID,
      body: BODY,
      now: NOW,
    });
    expect(first.commandId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first.messageId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first.commandId).not.toBe(first.messageId);
    expect(first.requestDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('preserves an idempotent repository result for operational logging', async () => {
    const test = harness();
    test.chat.send.mockResolvedValue({
      outcome: 'message_sent',
      persistence: 'idempotent_retry',
      message: message(),
    });

    await expect(
      test.service.send({
        ...actorInput(),
        request: { requestKey: REQUEST_KEY, body: BODY },
      }),
    ).resolves.toMatchObject({
      outcome: 'message_sent',
      persistence: 'idempotent_retry',
    });
  });

  it('keeps command identity but changes the digest when the body changes', async () => {
    const test = harness();
    test.chat.send.mockResolvedValue({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
    });
    await test.service.send({
      ...actorInput(),
      request: { requestKey: REQUEST_KEY, body: BODY },
    });
    await test.service.send({
      ...actorInput(),
      request: { requestKey: REQUEST_KEY, body: `${BODY}!` },
    });
    const first = test.chat.send.mock.calls[0][1];
    const changed = test.chat.send.mock.calls[1][1];
    expect(changed.commandId).toBe(first.commandId);
    expect(changed.messageId).toBe(first.messageId);
    expect(changed.requestDigest).not.toBe(first.requestDigest);
  });

  it.each([
    ['match_not_found', 'match_not_found'],
    ['match_closed', 'match_closed'],
    ['command_reuse_conflict', 'request_conflict'],
  ] as const)(
    'maps repository rejection %s to %s',
    async (reason, expected) => {
      const test = harness();
      test.chat.send.mockResolvedValue({
        outcome: 'rejected',
        reason,
      });
      await expect(
        test.service.send({
          ...actorInput(),
          request: { requestKey: REQUEST_KEY, body: BODY },
        }),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: expected,
      });
      expect(test.chat.readSenders).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['command_conflict', 'request_conflict'],
    ['permission_denied', 'internal_failure'],
  ] as const)(
    'maps persistence %s to safe %s',
    async (reason, expected) => {
      const test = harness();
      test.chat.list.mockRejectedValue(
        new MatchChatPersistenceError(reason),
      );
      await expect(
        test.service.list({
          ...actorInput(),
          request: { limit: 20 },
        }),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: expected,
      });
    },
  );

  it('uses a privacy-safe tombstone for an unavailable sender', async () => {
    const chat = repository();
    chat.readSenders.mockResolvedValue({
      outcome: 'found',
      senders: [
        {
          senderAccountId: ACTOR_ID,
          availability: 'unavailable',
        },
      ],
    });
    const test = harness(chat);
    test.chat.list.mockResolvedValue({
      outcome: 'found',
      messages: [message()],
    });
    const result = await test.service.list({
      ...actorInput(),
      request: { limit: 20 },
    });
    expect(result).toEqual({
      outcome: 'found',
      messages: [
        {
          messageId: MESSAGE_ID,
          matchId: MATCH_ID,
          sender: { unavailable: true },
          body: BODY,
          createdAt: NOW,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(ACTOR_ID);
  });

  it('fails closed when a sender projection is missing', async () => {
    const chat = repository();
    chat.readSenders.mockResolvedValue({
      outcome: 'found',
      senders: [],
    });
    const test = harness(chat);
    test.chat.list.mockResolvedValue({
      outcome: 'found',
      messages: [message()],
    });
    await expect(
      test.service.list({
        ...actorInput(),
        request: { limit: 20 },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it.each([
    [{ requestKey: REQUEST_KEY, body: ` ${BODY}` }],
    [{ requestKey: REQUEST_KEY, body: '' }],
    [{ requestKey: 'not-a-request-key', body: BODY }],
  ])('rejects invalid send input before persistence', async (request) => {
    const test = harness();
    await expect(
      test.service.send({
        ...actorInput(),
        request,
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(test.chat.send).not.toHaveBeenCalled();
  });

  it.each([
    'х у й',
    'f.u.c.k',
  ])('rejects disallowed language before persistence', async (body) => {
    const test = harness();
    await expect(
      test.service.send({
        ...actorInput(),
        request: { requestKey: REQUEST_KEY, body },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'content_not_allowed',
    });
    expect(test.chat.send).not.toHaveBeenCalled();
    expect(test.chat.readSenders).not.toHaveBeenCalled();
  });
});
