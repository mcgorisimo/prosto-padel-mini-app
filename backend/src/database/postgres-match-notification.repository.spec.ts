import { QueryResult, QueryResultRow } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchNotificationId,
} from '../matches/match-notification.types';
import { MatchWaitlistEntryId } from '../matches/match-waitlist.types';
import { MatchId } from '../matches/match.types';
import {
  CreateWaitlistPromotionNotificationInput,
} from './match-notification.repository';
import { PostgresMatchNotificationRepository } from './postgres-match-notification.repository';
import { PostgresTransaction } from './postgres-transaction';

const RECIPIENT_ID = deterministicUuid(
  'notification-recipient',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'notification-other-account',
) as AccountId;
const MATCH_ID = deterministicUuid('notification-match') as MatchId;
const ENTRY_ID = deterministicUuid(
  'notification-entry',
) as MatchWaitlistEntryId;
const NOTIFICATION_ID = deterministicUuid(
  'notification-id',
) as MatchNotificationId;
const OLDER_NOTIFICATION_ID = deterministicUuid(
  'notification-older-id',
) as MatchNotificationId;
const NOW = unixEpochSeconds(1_800_000_000);

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

function notificationRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: NOTIFICATION_ID,
    waitlist_entry_id: ENTRY_ID,
    match_id: MATCH_ID,
    recipient_account_id: RECIPIENT_ID,
    notification_type: 'waitlist_promoted',
    created_at: String(NOW),
    read_at: null,
    version: '1',
    previous_service_id: null,
    previous_resource_id: null,
    previous_datetime_text: null,
    previous_end_datetime_text: null,
    current_service_id: null,
    current_resource_id: null,
    current_datetime_text: null,
    current_end_datetime_text: null,
    ...overrides,
  };
}

function createInput(
  overrides: Partial<CreateWaitlistPromotionNotificationInput> = {},
): CreateWaitlistPromotionNotificationInput {
  return {
    notificationId: NOTIFICATION_ID,
    waitlistEntryId: ENTRY_ID,
    matchId: MATCH_ID,
    recipientAccountId: RECIPIENT_ID,
    now: NOW,
    ...overrides,
  };
}

describe('PostgresMatchNotificationRepository', () => {
  it('reads a recipient-only descending keyset page and unread count', async () => {
    const transaction = new FakeTransaction([
      result([
        notificationRow({ unread_count: '2' }),
        notificationRow({
          id: OLDER_NOTIFICATION_ID,
          created_at: String(Number(NOW) - 1),
          unread_count: '2',
        }),
      ]),
    ]);

    await expect(
      new PostgresMatchNotificationRepository().list(transaction, {
        recipientAccountId: RECIPIENT_ID,
        limit: 1,
      }),
    ).resolves.toEqual({
      outcome: 'found',
      notifications: [
        {
          notificationId: NOTIFICATION_ID,
          waitlistEntryId: ENTRY_ID,
          matchId: MATCH_ID,
          recipientAccountId: RECIPIENT_ID,
          notificationType: 'waitlist_promoted',
          createdAt: NOW,
        },
      ],
      unreadCount: 2,
      nextCursor: {
        createdAt: NOW,
        notificationId: NOTIFICATION_ID,
      },
    });
    expect(transaction.calls[0].text).toContain(
      'notifications.recipient_account_id = $1',
    );
    expect(transaction.calls[0].text).toContain(
      '(notifications.created_at, notifications.id)',
    );
    expect(transaction.calls[0].values).toEqual([
      RECIPIENT_ID,
      null,
      null,
      2,
    ]);
  });

  it('returns an empty page while preserving the unread count', async () => {
    const transaction = new FakeTransaction([
      result([
        notificationRow({
          id: null,
          waitlist_entry_id: null,
          match_id: null,
          recipient_account_id: null,
          notification_type: null,
          created_at: null,
          read_at: null,
          version: null,
          unread_count: '0',
        }),
      ]),
    ]);
    await expect(
      new PostgresMatchNotificationRepository().list(transaction, {
        recipientAccountId: RECIPIENT_ID,
        limit: 50,
      }),
    ).resolves.toEqual({
      outcome: 'found',
      notifications: [],
      unreadCount: 0,
    });
  });

  it('marks only the recipient notification and preserves idempotent read time', async () => {
    const applied = new FakeTransaction([
      result([
        notificationRow({
          read_at: String(NOW),
          version: '2',
          was_updated: true,
        }),
      ], 'UPDATE'),
    ]);
    const retryReadAt = NOW;
    const retryNow = unixEpochSeconds(Number(NOW) + 10);
    const retry = new FakeTransaction([
      result([
        notificationRow({
          read_at: String(retryReadAt),
          version: '2',
          was_updated: false,
        }),
      ]),
    ]);
    const repository = new PostgresMatchNotificationRepository();

    await expect(repository.markRead(applied, {
      notificationId: NOTIFICATION_ID,
      recipientAccountId: RECIPIENT_ID,
      now: NOW,
    })).resolves.toMatchObject({
      outcome: 'notification_read',
      persistence: 'applied',
      notification: { readAt: NOW },
    });
    await expect(repository.markRead(retry, {
      notificationId: NOTIFICATION_ID,
      recipientAccountId: RECIPIENT_ID,
      now: retryNow,
    })).resolves.toMatchObject({
      outcome: 'notification_read',
      persistence: 'idempotent_retry',
      notification: { readAt: retryReadAt },
    });
    expect(applied.calls[0].text).toContain(
      'notifications.recipient_account_id = $2',
    );
    expect(applied.calls[0].values).toEqual([
      NOTIFICATION_ID,
      RECIPIENT_ID,
      NOW,
    ]);
  });

  it('hides an absent or foreign notification as not found', async () => {
    const transaction = new FakeTransaction([result([]), result([])]);
    await expect(
      new PostgresMatchNotificationRepository().markRead(transaction, {
        notificationId: NOTIFICATION_ID,
        recipientAccountId: OTHER_ACCOUNT_ID,
        now: NOW,
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'notification_not_found',
    });
  });

  it('lists and marks a court move lifecycle notification for one recipient', async () => {
    const lifecycleRow = notificationRow({
      id: OLDER_NOTIFICATION_ID,
      waitlist_entry_id: null,
      notification_type: 'court_moved',
      previous_service_id: '11',
      previous_resource_id: '22',
      previous_datetime_text: '2027-01-17T10:00:00+03:00',
      previous_end_datetime_text: '2027-01-17T11:30:00+03:00',
      current_service_id: '11',
      current_resource_id: '55',
      current_datetime_text: '2027-01-18T12:00:00+03:00',
      current_end_datetime_text: '2027-01-18T13:30:00+03:00',
      unread_count: '1',
    });
    const listed = new FakeTransaction([result([lifecycleRow])]);
    const marked = new FakeTransaction([
      result([]),
      result([{ ...lifecycleRow, read_at: String(NOW), version: '2', was_updated: true }]),
    ]);
    const repository = new PostgresMatchNotificationRepository();

    await expect(repository.list(listed, {
      recipientAccountId: RECIPIENT_ID,
      limit: 50,
    })).resolves.toMatchObject({
      notifications: [{
        notificationType: 'court_moved',
        previousTarget: { courtId: 22 },
        currentTarget: { courtId: 55 },
      }],
      unreadCount: 1,
    });
    await expect(repository.markRead(marked, {
      notificationId: OLDER_NOTIFICATION_ID,
      recipientAccountId: RECIPIENT_ID,
      now: NOW,
    })).resolves.toMatchObject({
      outcome: 'notification_read',
      persistence: 'applied',
      notification: { notificationType: 'court_moved', readAt: NOW },
    });
  });

  it('creates a waitlist promotion notification and safely replays it', async () => {
    const originalCreatedAt = unixEpochSeconds(Number(NOW) - 10);
    const readAt = unixEpochSeconds(Number(NOW) - 5);
    const applied = new FakeTransaction([
      result([notificationRow()], 'INSERT'),
    ]);
    const retry = new FakeTransaction([
      result([], 'INSERT'),
      result([notificationRow({
        created_at: String(originalCreatedAt),
        read_at: String(readAt),
        version: '2',
      })]),
    ]);
    const repository = new PostgresMatchNotificationRepository();

    await expect(
      repository.createWaitlistPromotion(applied, createInput()),
    ).resolves.toMatchObject({
      outcome: 'notification_created',
      persistence: 'applied',
    });
    await expect(
      repository.createWaitlistPromotion(retry, createInput()),
    ).resolves.toMatchObject({
      outcome: 'notification_created',
      persistence: 'idempotent_retry',
      notification: {
        createdAt: originalCreatedAt,
        readAt,
      },
    });
    expect(applied.calls[0].text).toContain(
      'ON CONFLICT (waitlist_entry_id) DO NOTHING',
    );
    expect(applied.calls[0].values).toEqual([
      NOTIFICATION_ID,
      ENTRY_ID,
      MATCH_ID,
      RECIPIENT_ID,
      NOW,
    ]);
  });

  it('fails closed when an idempotent row has another binding', async () => {
    const transaction = new FakeTransaction([
      result([], 'INSERT'),
      result([
        notificationRow({ recipient_account_id: OTHER_ACCOUNT_ID }),
      ]),
    ]);
    await expect(
      new PostgresMatchNotificationRepository()
        .createWaitlistPromotion(transaction, createInput()),
    ).rejects.toMatchObject({
      reason: 'notification_conflict',
    });
  });

  it('maps privilege failures without exposing database details', async () => {
    const postgresError = Object.assign(new Error('private detail'), {
      code: '42501',
    });
    const transaction = new FakeTransaction([postgresError]);
    await expect(
      new PostgresMatchNotificationRepository().list(transaction, {
        recipientAccountId: RECIPIENT_ID,
        limit: 20,
      }),
    ).rejects.toMatchObject({
      reason: 'permission_denied',
      message: 'Match notification persistence failed',
    });
  });
});
