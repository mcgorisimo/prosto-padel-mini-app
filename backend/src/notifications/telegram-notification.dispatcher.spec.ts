import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { PostgresTransaction } from '../database/postgres-transaction';
import { TelegramNotificationOutboxRepository } from '../database/telegram-notification-outbox.repository';
import { MatchId } from '../matches/match.types';
import {
  TelegramNotificationOutboxId,
} from './telegram-notification.types';
import { TelegramNotificationDispatcher } from './telegram-notification.dispatcher';

const NOW = unixEpochSeconds(1_800_000_000);
const OUTBOX_ID = deterministicUuid('telegram-outbox') as TelegramNotificationOutboxId;
const ACCOUNT_ID = deterministicUuid('telegram-recipient') as AccountId;
const MATCH_ID = deterministicUuid('telegram-match') as MatchId;
const transaction = Object.freeze({ query: jest.fn() }) as unknown as PostgresTransaction;

function outbox(): jest.Mocked<TelegramNotificationOutboxRepository> {
  return {
    enqueueMatchNotification: jest.fn(),
    enqueueInvitation: jest.fn(),
    claimNext: jest.fn(),
    markSent: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    scheduleRetry: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    abandon: jest.fn().mockResolvedValue({ outcome: 'applied' }),
  };
}

function claimed(hasDestination = true) {
  return Object.freeze({
    outcome: 'claimed' as const,
    notification: Object.freeze({
      outboxId: OUTBOX_ID,
      claimVersion: 2,
      attemptCount: 1,
      recipientAccountId: ACCOUNT_ID,
      ...(hasDestination
        ? { telegramChatId: '123456', destinationVersion: 3 }
        : {}),
      matchId: MATCH_ID,
      matchStartsAt: unixEpochSeconds(Number(NOW) + 3_600),
      courtName: 'Корт 1',
      sourceType: 'match_invitation' as const,
    }),
  });
}

function harness() {
  const repository = outbox();
  let insideTransaction = false;
  const sendMessage = jest.fn().mockImplementation(async () => {
    expect(insideTransaction).toBe(false);
    return { outcome: 'sent' as const, telegramMessageId: '42' };
  });
  const dispatcher = new TelegramNotificationDispatcher({
    enabled: false,
    pollIntervalMilliseconds: 1_000,
    visibilityLeaseSeconds: 15,
    transactions: {
      runInTransaction: async (operation) => {
        expect(insideTransaction).toBe(false);
        insideTransaction = true;
        try {
          return await operation(transaction);
        } finally {
          insideTransaction = false;
        }
      },
    },
    outbox: repository,
    telegram: { sendMessage },
    clock: { nowEpochSeconds: () => NOW },
  });
  return { dispatcher, repository, sendMessage };
}

describe('TelegramNotificationDispatcher', () => {
  it('commits the claim before HTTP and finalizes success with the claim version', async () => {
    const test = harness();
    test.repository.claimNext.mockResolvedValue(claimed());

    await expect(test.dispatcher.dispatchOne()).resolves.toBe(true);

    expect(test.repository.claimNext).toHaveBeenCalledWith(transaction, {
      now: NOW,
      leaseUntil: Number(NOW) + 15,
    });
    expect(test.sendMessage).toHaveBeenCalledWith({
      telegramChatId: '123456',
      text: expect.stringContaining('Вас пригласили в матч.'),
    });
    expect(test.repository.markSent).toHaveBeenCalledWith(transaction, {
      outboxId: OUTBOX_ID,
      claimVersion: 2,
      now: NOW,
      telegramMessageId: '42',
    });
  });

  it('abandons a delivery without HTTP when no enabled destination exists', async () => {
    const test = harness();
    test.repository.claimNext.mockResolvedValue(claimed(false));

    await expect(test.dispatcher.dispatchOne()).resolves.toBe(true);

    expect(test.sendMessage).not.toHaveBeenCalled();
    expect(test.repository.abandon).toHaveBeenCalledWith(transaction, {
      outboxId: OUTBOX_ID,
      claimVersion: 2,
      now: NOW,
      failure: 'destination_unavailable',
    });
  });

  it('persists retry backoff and a Telegram retry hint', async () => {
    const test = harness();
    test.repository.claimNext.mockResolvedValue(claimed());
    test.sendMessage.mockResolvedValue({
      outcome: 'retry',
      failure: 'telegram_rate_limited',
      retryAfterSeconds: 27,
    });

    await expect(test.dispatcher.dispatchOne()).resolves.toBe(true);

    expect(test.repository.scheduleRetry).toHaveBeenCalledWith(transaction, {
      outboxId: OUTBOX_ID,
      claimVersion: 2,
      now: NOW,
      availableAt: Number(NOW) + 27,
      failure: 'telegram_rate_limited',
    });
  });

  it('atomically abandons and disables a forbidden destination', async () => {
    const test = harness();
    test.repository.claimNext.mockResolvedValue(claimed());
    test.sendMessage.mockResolvedValue({
      outcome: 'abandoned',
      failure: 'telegram_forbidden',
      disableDestination: 'telegram_forbidden',
    });

    await expect(test.dispatcher.dispatchOne()).resolves.toBe(true);

    expect(test.repository.abandon).toHaveBeenCalledWith(transaction, {
      outboxId: OUTBOX_ID,
      claimVersion: 2,
      now: NOW,
      failure: 'telegram_forbidden',
      disableDestination: 'telegram_forbidden',
      destinationVersion: 3,
    });
  });

  it('does not call Telegram when no work is available', async () => {
    const test = harness();
    test.repository.claimNext.mockResolvedValue({ outcome: 'none_available' });

    await expect(test.dispatcher.dispatchOne()).resolves.toBe(false);
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
});
