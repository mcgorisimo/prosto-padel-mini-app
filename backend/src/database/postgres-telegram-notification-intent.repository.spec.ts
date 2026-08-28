import { QueryResult } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchId } from '../matches/match.types';
import { PostgresTelegramNotificationIntentRepository } from './postgres-telegram-notification-intent.repository';
import { PostgresTransaction } from './postgres-transaction';

const NOW = unixEpochSeconds(1_800_000_000);
const MATCH_ID = deterministicUuid('intent-match') as MatchId;
const ACCOUNT_ID = deterministicUuid('intent-account') as AccountId;
const SOURCE_ID = deterministicUuid('intent-source');

function result(rows: readonly Record<string, unknown>[]): QueryResult {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function transaction(...results: QueryResult[]) {
  return {
    query: jest.fn(async () => {
      const next = results.shift();
      if (next === undefined) throw new Error('unexpected query');
      return next;
    }),
  } as unknown as PostgresTransaction & { query: jest.Mock };
}

function base() {
  return {
    eventKey: `participant_joined:${SOURCE_ID}`,
    eventType: 'participant_joined' as const,
    category: 'match_activity' as const,
    sourceId: SOURCE_ID,
    sourceVersion: 2,
    matchId: MATCH_ID,
    occurredAt: NOW,
  };
}

function persisted(inserted = true) {
  return {
    event_key: base().eventKey,
    event_type: base().eventType,
    category: base().category,
    source_id: SOURCE_ID,
    source_version: '2',
    recipient_account_id: ACCOUNT_ID,
    match_id: MATCH_ID,
    reservation_id: null,
    occurred_at: String(NOW),
    inserted,
  };
}

describe('PostgresTelegramNotificationIntentRepository', () => {
  const repository = new PostgresTelegramNotificationIntentRepository();

  it('persists one immutable recipient intent and accepts an exact replay', async () => {
    const tx = transaction(result([persisted(false)]));
    await expect(
      repository.enqueueDirect(tx, {
        ...base(),
        recipientAccountId: ACCOUNT_ID,
      }),
    ).resolves.toBeUndefined();
    const sql = tx.query.mock.calls[0][0] as string;
    expect(sql).toContain(
      'ON CONFLICT (event_key, recipient_account_id) DO NOTHING',
    );
    expect(sql).not.toContain('phone');
    expect(sql).not.toContain('message_body');
  });

  it('allows an empty audience after chat-author exclusion', async () => {
    const tx = transaction(result([]));
    await expect(
      repository.enqueueMatchAudience(tx, {
        ...base(),
        eventKey: `chat_message_created:${SOURCE_ID}`,
        eventType: 'chat_message_created',
        category: 'chat_messages',
        sourceVersion: 1,
        excludeAccountId: ACCOUNT_ID,
      }),
    ).resolves.toBe(0);
    expect(tx.query.mock.calls[0][0]).toContain('account_id <> $9');
  });

  it('claims with preference, staleness, global budget and SKIP LOCKED guards', async () => {
    const claimed = {
      ...persisted(),
      attempt_count: 1,
      version: 2,
      telegram_chat_id: '123456',
      destination_version: 3,
      terminal_reason: null,
    };
    const tx = transaction(result([]), result([]), result([claimed]));
    await expect(
      repository.claimNext(tx, {
        now: NOW,
        leaseUntil: unixEpochSeconds(Number(NOW) + 15),
      }),
    ).resolves.toMatchObject({
      outcome: 'claimed',
      intent: {
        eventKey: base().eventKey,
        recipientAccountId: ACCOUNT_ID,
        deepLink: { screen: 'match', matchId: MATCH_ID },
      },
    });
    const sql = tx.query.mock.calls[2][0] as string;
    expect(sql).toContain('telegram_match_notifications_enabled');
    expect(sql).toContain('telegram_match_activity_enabled');
    expect(sql).toContain('telegram_delivery_rate_budget');
    expect(sql).toContain('FOR UPDATE OF intent, rate SKIP LOCKED');
  });

  it('schedules durable 24h/2h eligibility without starving work behind the match limit', async () => {
    const tx = transaction(result([{ inserted_count: '4' }]));
    await expect(
      repository.enqueueDueReminders(tx, {
        now: NOW,
        matchLimit: 50,
      }),
    ).resolves.toBe(4);
    const [sql, values] = tx.query.mock.calls[0];
    expect(sql).toContain('starts_at - 86400');
    expect(sql).toContain('starts_at - 7200');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('telegram_delivery_intents AS existing');
    expect(sql.indexOf('NOT EXISTS')).toBeLessThan(sql.indexOf('LIMIT $2'));
    expect(sql).toContain('FOR UPDATE OF matches SKIP LOCKED');
    expect(values).toEqual([String(NOW), 50]);
  });
});
