import { QueryResult, QueryResultRow } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchMessageCommandId,
  MatchMessageId,
  MatchMessageRequestDigest,
} from '../matches/match-chat.types';
import { MatchId } from '../matches/match.types';
import {
  MatchChatPersistenceError,
  SendMatchMessageInput,
} from './match-chat.repository';
import { PostgresMatchChatRepository } from './postgres-match-chat.repository';
import { PostgresTransaction } from './postgres-transaction';

const MATCH_ID = deterministicUuid('chat-match') as MatchId;
const ACTOR_ID = deterministicUuid('chat-actor') as AccountId;
const OWNER_ID = deterministicUuid('chat-owner') as AccountId;
const MESSAGE_ID = deterministicUuid('chat-message') as MatchMessageId;
const OLDER_MESSAGE_ID = deterministicUuid(
  'chat-message-older',
) as MatchMessageId;
const COMMAND_ID = deterministicUuid(
  'chat-command',
) as MatchMessageCommandId;
const DIGEST = 'a'.repeat(64) as MatchMessageRequestDigest;
const NOW = unixEpochSeconds(1_800_000_000);
const BODY = 'Hello from the backend chat';
const CURRENT_VISIBILITY_POLICY = Object.freeze({
  enabled: true,
  requiredConsents: Object.freeze([
    Object.freeze({
      kind: 'cancellation' as const,
      documentVersion: 'cancellation-2026-08-26-v1',
    }),
    Object.freeze({
      kind: 'personal_data_processing' as const,
      documentVersion: 'personal-data-consent-2026-08-26-v1',
    }),
    Object.freeze({
      kind: 'terms' as const,
      documentVersion: 'terms-2026-08-26-v1',
    }),
  ]),
});

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly queued: readonly (
      | QueryResult<QueryResultRow>
      | Error
    )[],
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const next = this.queued[this.calls.length - 1];
    if (next === undefined) throw new Error('Unexpected query');
    if (next instanceof Error) throw next;
    return next as QueryResult<Row>;
  }
}

function result<Row extends QueryResultRow>(
  rows: readonly Row[],
  command = 'SELECT',
  rowCount: number | null = rows.length,
): QueryResult<Row> {
  return {
    command,
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function listRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    authorized_match_id: MATCH_ID,
    message_id: MESSAGE_ID,
    match_id: MATCH_ID,
    sender_account_id: ACTOR_ID,
    body: BODY,
    created_at: String(NOW),
    ...overrides,
  };
}

function messageRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: MESSAGE_ID,
    match_id: MATCH_ID,
    sender_account_id: ACTOR_ID,
    body: BODY,
    created_at: String(NOW),
    ...overrides,
  };
}

function commandRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    command_id: COMMAND_ID,
    message_id: MESSAGE_ID,
    match_id: MATCH_ID,
    actor_account_id: ACTOR_ID,
    request_digest: Buffer.from(DIGEST, 'hex'),
    command_type: 'send_message',
    result_type: 'message_sent',
    applied_at: String(NOW),
    ...overrides,
  };
}

function sendInput(
  overrides: Partial<SendMatchMessageInput> = {},
): SendMatchMessageInput {
  return {
    commandId: COMMAND_ID,
    messageId: MESSAGE_ID,
    matchId: MATCH_ID,
    actorAccountId: ACTOR_ID,
    requestDigest: DIGEST,
    body: BODY,
    now: NOW,
    ...overrides,
  };
}

function lockRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: MATCH_ID,
    owner_account_id: OWNER_ID,
    status: 'open',
    ...overrides,
  };
}

function senderRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    sender_account_id: ACTOR_ID,
    role: 'player',
    status: 'active',
    visible_profile_account_id: ACTOR_ID,
    first_name: 'Alice',
    last_name: 'Player',
    username: 'alice',
    rating: '3.00',
    is_verified: false,
    ...overrides,
  };
}

describe('PostgresMatchChatRepository', () => {
  it('reads an authorized page with a strict descending keyset cursor', async () => {
    const transaction = new FakeTransaction([
      result([
        listRow(),
        listRow({
          message_id: OLDER_MESSAGE_ID,
          created_at: String(Number(NOW) - 1),
        }),
      ]),
    ]);

    await expect(
      new PostgresMatchChatRepository().list(transaction, {
        matchId: MATCH_ID,
        actorAccountId: ACTOR_ID,
        limit: 1,
      }),
    ).resolves.toEqual({
      outcome: 'found',
      messages: [
        {
          messageId: MESSAGE_ID,
          matchId: MATCH_ID,
          senderAccountId: ACTOR_ID,
          body: BODY,
          createdAt: NOW,
        },
      ],
      nextCursor: {
        createdAt: NOW,
        messageId: MESSAGE_ID,
      },
    });

    expect(transaction.calls[0].text).toContain(
      '(messages.created_at, messages.id) < ($3::bigint, $4::uuid)',
    );
    expect(transaction.calls[0].text).toContain(
      'ORDER BY messages.created_at DESC, messages.id DESC',
    );
    expect(transaction.calls[0].values).toEqual([
      MATCH_ID,
      ACTOR_ID,
      null,
      null,
      2,
    ]);
  });

  it('binds a non-null cursor to createdAt then messageId', async () => {
    const before = {
      createdAt: unixEpochSeconds(Number(NOW) - 10),
      messageId: OLDER_MESSAGE_ID,
    };
    const transaction = new FakeTransaction([
      result([
        listRow({
          message_id: null,
          match_id: null,
          sender_account_id: null,
          body: null,
          created_at: null,
        }),
      ]),
    ]);

    await expect(
      new PostgresMatchChatRepository().list(transaction, {
        matchId: MATCH_ID,
        actorAccountId: ACTOR_ID,
        limit: 10,
        before,
      }),
    ).resolves.toEqual({ outcome: 'found', messages: [] });
    expect(transaction.calls[0].values).toEqual([
      MATCH_ID,
      ACTOR_ID,
      before.createdAt,
      before.messageId,
      11,
    ]);
  });

  it('returns an empty page for an authorized match and hides unauthorized matches', async () => {
    const repository = new PostgresMatchChatRepository();
    const authorized = new FakeTransaction([
      result([
        listRow({
          message_id: null,
          match_id: null,
          sender_account_id: null,
          body: null,
          created_at: null,
        }),
      ]),
    ]);
    await expect(
      repository.list(authorized, {
        matchId: MATCH_ID,
        actorAccountId: ACTOR_ID,
        limit: 50,
      }),
    ).resolves.toEqual({ outcome: 'found', messages: [] });

    const hidden = new FakeTransaction([result([])]);
    await expect(
      repository.list(hidden, {
        matchId: MATCH_ID,
        actorAccountId: ACTOR_ID,
        limit: 50,
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'match_not_found',
    });
  });

  it('reads current and policy-hidden sender projections in one batch', async () => {
    const transaction = new FakeTransaction([
      result([
        senderRow(),
        senderRow({
          sender_account_id: OWNER_ID,
          status: 'active',
          visible_profile_account_id: null,
          first_name: null,
          last_name: null,
          username: null,
          rating: null,
          is_verified: null,
        }),
      ]),
    ]);

    await expect(
      new PostgresMatchChatRepository(
        CURRENT_VISIBILITY_POLICY,
      ).readSenders(transaction, {
        senderAccountIds: [ACTOR_ID, OWNER_ID],
      }),
    ).resolves.toEqual({
      outcome: 'found',
      senders: [
        {
          senderAccountId: ACTOR_ID,
          availability: 'available',
          firstName: 'Alice',
          lastName: 'Player',
          username: 'alice',
          rating: 3,
          isVerified: false,
        },
        {
          senderAccountId: OWNER_ID,
          availability: 'unavailable',
        },
      ],
    });
    expect(transaction.calls).toHaveLength(1);
    expect(transaction.calls[0].values).toEqual([
      [ACTOR_ID, OWNER_ID],
      true,
      [
        'cancellation',
        'personal_data_processing',
        'terms',
      ],
      [
        'cancellation-2026-08-26-v1',
        'personal-data-consent-2026-08-26-v1',
        'terms-2026-08-26-v1',
      ],
    ]);
    expect(transaction.calls[0].text).toContain(
      "AND accounts.status = 'active'",
    );
    expect(transaction.calls[0].text).toContain(
      "onboarding.status = 'completed'",
    );
    expect(transaction.calls[0].text).toContain(
      "onboarding.current_step = 'completed'",
    );
    expect(transaction.calls[0].text).toContain(
      'FROM backend_auth.account_consent_acceptances AS acceptances',
    );
    expect(transaction.calls[0].text).toContain(
      'acceptances.document_version = required_consents.document_version',
    );
    expect(transaction.calls[0].text).toContain(
      'accounts.id = ANY ($1::uuid[])',
    );
  });

  it('fails closed to an unavailable sender when visibility policy is disabled', async () => {
    const transaction = new FakeTransaction([
      result([senderRow({
        visible_profile_account_id: null,
        first_name: null,
        last_name: null,
        username: null,
        rating: null,
        is_verified: null,
      })]),
    ]);

    await expect(
      new PostgresMatchChatRepository().readSenders(transaction, {
        senderAccountIds: [ACTOR_ID],
      }),
    ).resolves.toEqual({
      outcome: 'found',
      senders: [{
        senderAccountId: ACTOR_ID,
        availability: 'unavailable',
      }],
    });
    expect(transaction.calls[0].values).toEqual([
      [ACTOR_ID],
      false,
      [],
      [],
    ]);
  });

  it('rejects missing or privacy-leaking sender projections', async () => {
    const repository = new PostgresMatchChatRepository(
      CURRENT_VISIBILITY_POLICY,
    );
    await expect(
      repository.readSenders(
        new FakeTransaction([result([])]),
        { senderAccountIds: [ACTOR_ID] },
      ),
    ).rejects.toEqual(
      new MatchChatPersistenceError('invalid_persisted_state'),
    );
    await expect(
      repository.readSenders(
        new FakeTransaction([
          result([
            senderRow({
              visible_profile_account_id: null,
              rating: null,
              is_verified: null,
            }),
          ]),
        ]),
        { senderAccountIds: [ACTOR_ID] },
      ),
    ).rejects.toEqual(
      new MatchChatPersistenceError('invalid_persisted_state'),
    );
  });

  it('locks the match before inserting one message and immutable command', async () => {
    const transaction = new FakeTransaction([
      result([lockRow()]),
      result([]),
      result([{ can_send: true }]),
      result([messageRow()], 'INSERT'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);

    await expect(
      new PostgresMatchChatRepository().send(
        transaction,
        sendInput(),
      ),
    ).resolves.toMatchObject({
      outcome: 'message_sent',
      persistence: 'applied',
      message: { messageId: MESSAGE_ID, body: BODY },
    });

    const operations = transaction.calls.map(({ text }) => {
      const sql = text.replace(/\s+/gu, ' ').trim();
      if (sql.includes('FOR UPDATE OF matches')) return 'lock';
      if (sql.includes('FROM backend_match.match_message_commands')) {
        return 'command_lookup';
      }
      if (sql.includes('FROM backend_match.match_participants')) {
        return 'access';
      }
      if (sql.startsWith('INSERT INTO backend_match.match_messages')) {
        return 'message_insert';
      }
      if (
        sql.startsWith(
          'INSERT INTO backend_match.match_message_commands',
        )
      ) {
        return 'command_insert';
      }
      return 'unexpected';
    });
    expect(operations).toEqual([
      'lock',
      'command_lookup',
      'access',
      'message_insert',
      'command_insert',
    ]);
    expect(transaction.calls[0].values).toEqual([MATCH_ID]);
    expect(transaction.calls[2].values).toEqual([
      MATCH_ID,
      ACTOR_ID,
      OWNER_ID,
    ]);
    expect(transaction.calls[3].values).toEqual([
      MESSAGE_ID,
      MATCH_ID,
      ACTOR_ID,
      BODY,
      NOW,
    ]);
    expect(transaction.calls[4].values[4]).toEqual(
      Buffer.from(DIGEST, 'hex'),
    );
  });

  it('replays the immutable original message without a second insert', async () => {
    const transaction = new FakeTransaction([
      result([lockRow({ status: 'completed' })]),
      result([commandRow()]),
      result([messageRow()]),
    ]);

    await expect(
      new PostgresMatchChatRepository().send(
        transaction,
        sendInput(),
      ),
    ).resolves.toMatchObject({
      outcome: 'message_sent',
      persistence: 'idempotent_retry',
      message: { messageId: MESSAGE_ID, body: BODY },
    });
    expect(transaction.calls).toHaveLength(3);
    expect(
      transaction.calls.some(({ text }) =>
        text.includes('INSERT INTO backend_match'),
      ),
    ).toBe(false);
  });

  it('rejects commandId reuse with a different digest without writing', async () => {
    const transaction = new FakeTransaction([
      result([lockRow()]),
      result([
        commandRow({
          request_digest: Buffer.from('b'.repeat(64), 'hex'),
        }),
      ]),
    ]);
    await expect(
      new PostgresMatchChatRepository().send(
        transaction,
        sendInput(),
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
    });
    expect(transaction.calls).toHaveLength(2);
  });

  it.each([
    ['open', false, 'match_not_found'],
    ['completed', true, 'match_closed'],
    ['cancelled', true, 'match_closed'],
  ])(
    'does not write when status=%s and access=%s',
    async (status, canSend, reason) => {
      const transaction = new FakeTransaction([
        result([lockRow({ status })]),
        result([]),
        result([{ can_send: canSend }]),
      ]);
      await expect(
        new PostgresMatchChatRepository().send(
          transaction,
          sendInput(),
        ),
      ).resolves.toEqual({ outcome: 'rejected', reason });
      expect(transaction.calls).toHaveLength(3);
    },
  );

  it.each([
    ['42501', 'permission_denied'],
    ['40001', 'transaction_conflict'],
    ['40P01', 'transaction_conflict'],
    ['08006', 'database_unavailable'],
  ])(
    'maps PostgreSQL %s without exposing database details',
    async (code, reason) => {
      const error = Object.assign(new Error('PRIVATE DATABASE DETAIL'), {
        code,
        schema: 'backend_match',
        table: 'match_messages',
      });
      const transaction = new FakeTransaction([error]);
      const promise = new PostgresMatchChatRepository().send(
        transaction,
        sendInput(),
      );
      await expect(promise).rejects.toMatchObject({
        name: 'MatchChatPersistenceError',
        reason,
        message: 'Match chat persistence failed',
      });
      await expect(promise).rejects.not.toThrow(
        'PRIVATE DATABASE DETAIL',
      );
    },
  );

  it('rejects malformed persisted message state safely', async () => {
    const transaction = new FakeTransaction([
      result([listRow({ body: ` ${BODY}` })]),
    ]);
    await expect(
      new PostgresMatchChatRepository().list(transaction, {
        matchId: MATCH_ID,
        actorAccountId: ACTOR_ID,
        limit: 10,
      }),
    ).rejects.toEqual(
      new MatchChatPersistenceError('invalid_persisted_state'),
    );
  });
});
