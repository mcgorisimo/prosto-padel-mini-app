import { QueryResult } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchNotificationId } from '../matches/match-notification.types';
import { MatchId, MatchInvitationId } from '../matches/match.types';
import { TelegramNotificationOutboxId } from '../notifications/telegram-notification.types';
import { PostgresTelegramNotificationOutboxRepository } from './postgres-telegram-notification-outbox.repository';
import { PostgresTransaction } from './postgres-transaction';

const NOW = unixEpochSeconds(1_800_000_000);
const OUTBOX_ID = deterministicUuid('outbox-row') as TelegramNotificationOutboxId;
const NOTIFICATION_ID = deterministicUuid('notification-row') as MatchNotificationId;
const INVITATION_ID = deterministicUuid('invitation-row') as MatchInvitationId;
const ACCOUNT_ID = deterministicUuid('recipient-row') as AccountId;
const MATCH_ID = deterministicUuid('match-row') as MatchId;

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
    query: jest.fn().mockImplementation(async () => {
      const next = results.shift();
      if (next === undefined) throw new Error('Unexpected query');
      return next;
    }),
  } as unknown as PostgresTransaction & { query: jest.Mock };
}

function enqueued(sourceType: 'match_notification' | 'match_invitation') {
  return {
    id: OUTBOX_ID,
    source_type: sourceType,
    match_notification_id:
      sourceType === 'match_notification' ? NOTIFICATION_ID : null,
    invitation_id: sourceType === 'match_invitation' ? INVITATION_ID : null,
    created_at: String(NOW),
    available_at: String(NOW),
    status: 'pending',
    attempt_count: 0,
    version: 1,
    inserted: true,
  };
}

function claimed() {
  return {
    id: OUTBOX_ID,
    source_type: 'match_invitation',
    match_notification_id: null,
    invitation_id: INVITATION_ID,
    attempt_count: 1,
    version: 2,
    recipient_account_id: ACCOUNT_ID,
    telegram_chat_id: '123456',
    destination_version: 3,
    preference_enabled: true,
    match_id: MATCH_ID,
    starts_at: String(Number(NOW) + 3_600),
    court_name: 'Корт 1',
  };
}

describe('PostgresTelegramNotificationOutboxRepository', () => {
  const repository = new PostgresTelegramNotificationOutboxRepository();

  it('enqueues a match notification using only migration 030 INSERT columns', async () => {
    const tx = transaction(result([enqueued('match_notification')]));

    await repository.enqueueMatchNotification(tx, {
      outboxId: OUTBOX_ID,
      matchNotificationId: NOTIFICATION_ID,
      now: NOW,
    });

    const [sql, values] = tx.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO backend_match.telegram_notification_outbox');
    expect(sql).toContain("VALUES ($1, 'match_notification', $2, $3, $3, 'pending', 0, $3, 1)");
    expect(sql).not.toContain('sent_at,');
    expect(sql).not.toContain('failure_code,');
    expect(values).toEqual([OUTBOX_ID, NOTIFICATION_ID, String(NOW)]);
  });

  it('enqueues invitations idempotently and rejects a conflicting source binding', async () => {
    const retry = { ...enqueued('match_invitation'), inserted: false };
    const tx = transaction(result([retry]));

    await expect(
      repository.enqueueInvitation(tx, {
        outboxId: OUTBOX_ID,
        invitationId: INVITATION_ID,
        now: NOW,
      }),
    ).resolves.toBeUndefined();

    const conflict = transaction(
      result([{ ...retry, id: deterministicUuid('different-outbox') }]),
    );
    await expect(
      repository.enqueueInvitation(conflict, {
        outboxId: OUTBOX_ID,
        invitationId: INVITATION_ID,
        now: NOW,
      }),
    ).rejects.toMatchObject({ reason: 'source_conflict' });
  });

  it('claims in queue order with SKIP LOCKED and a version ownership token', async () => {
    const tx = transaction(result([]), result([]), result([claimed()]));

    await expect(
      repository.claimNext(tx, {
        now: NOW,
        leaseUntil: unixEpochSeconds(Number(NOW) + 15),
      }),
    ).resolves.toEqual({
      outcome: 'claimed',
      notification: {
        outboxId: OUTBOX_ID,
        claimVersion: 2,
        attemptCount: 1,
        recipientAccountId: ACCOUNT_ID,
        telegramChatId: '123456',
        destinationVersion: 3,
        matchId: MATCH_ID,
        matchStartsAt: Number(NOW) + 3_600,
        courtName: 'Корт 1',
        sourceType: 'match_invitation',
        preferenceEnabled: true,
      },
    });

    const claimSql = tx.query.mock.calls[2][0] as string;
    expect(claimSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimSql).toContain('ORDER BY pending.available_at, pending.created_at, pending.id');
    expect(claimSql).toContain('attempt_count = outbox.attempt_count + 1');
    expect(claimSql).toContain('version = outbox.version + 1');
    expect(tx.query.mock.calls[2][1]).toEqual([
      String(NOW),
      String(Number(NOW) + 15),
    ]);
  });

  it('abandons an exhausted row without another delivery claim', async () => {
    const tx = transaction(result([]), result([{ id: OUTBOX_ID }]));

    await expect(
      repository.claimNext(tx, {
        now: NOW,
        leaseUntil: unixEpochSeconds(Number(NOW) + 15),
      }),
    ).resolves.toEqual({ outcome: 'retry_exhausted' });

    expect(tx.query).toHaveBeenCalledTimes(2);
    expect(tx.query.mock.calls[1][0]).toContain("failure_code = 'retry_exhausted'");
  });

  it('finalizes by id, pending status, and the exact claim version', async () => {
    const sent = transaction(result([{ id: OUTBOX_ID }]));
    await expect(
      repository.markSent(sent, {
        outboxId: OUTBOX_ID,
        claimVersion: 2,
        now: NOW,
        telegramMessageId: '42',
      }),
    ).resolves.toEqual({ outcome: 'applied' });
    const sql = sent.query.mock.calls[0][0] as string;
    expect(sql).toContain("outbox.status = 'pending'");
    expect(sql).toContain('outbox.version = $2');

    const stale = transaction(result([]));
    await expect(
      repository.markSent(stale, {
        outboxId: OUTBOX_ID,
        claimVersion: 2,
        now: NOW,
        telegramMessageId: '42',
      }),
    ).resolves.toEqual({ outcome: 'stale_claim' });
  });

  it('disables a destination only when the CAS finalization succeeds', async () => {
    const tx = transaction(result([{ applied: true }]));

    await expect(
      repository.abandon(tx, {
        outboxId: OUTBOX_ID,
        claimVersion: 2,
        now: NOW,
        failure: 'telegram_forbidden',
        disableDestination: 'telegram_forbidden',
        destinationVersion: 3,
      }),
    ).resolves.toEqual({ outcome: 'applied' });

    const sql = tx.query.mock.calls[0][0] as string;
    expect(sql).toContain('WITH finalized AS MATERIALIZED');
    expect(sql).toContain('FROM recipient');
    expect(sql).toContain('destination.status = \'enabled\'');
    expect(tx.query.mock.calls[0][1]).toEqual([
      OUTBOX_ID,
      2,
      String(NOW),
      'telegram_forbidden',
      'telegram_forbidden',
      3,
    ]);
  });
});
