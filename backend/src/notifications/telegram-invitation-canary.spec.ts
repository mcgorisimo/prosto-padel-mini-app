import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { TelegramNotificationIntentRepository } from '../database/telegram-notification-intent.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { MatchId } from '../matches/match.types';
import { TelegramInvitationCanary } from './telegram-invitation-canary';

const NOW = unixEpochSeconds(1_800_000_000);
const RECIPIENT = deterministicUuid('canary-recipient') as AccountId;
const OTHER_RECIPIENT = deterministicUuid('canary-other') as AccountId;
const SOURCE_ID = deterministicUuid('canary-invitation');
const EVENT_KEY = `match_invited:${SOURCE_ID}`;
const MATCH_ID = deterministicUuid('canary-match') as MatchId;
const transaction = {} as PostgresTransaction;

function repository(): jest.Mocked<TelegramNotificationIntentRepository> {
  return {
    enqueueDirect: jest.fn(),
    enqueueMatchOwner: jest.fn(),
    enqueueMatchAudience: jest.fn(),
    enqueueDueReminders: jest.fn(),
    claimNext: jest.fn(),
    claimExactInvitationCanary: jest.fn(),
    markSent: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    scheduleRetry: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    abandon: jest.fn().mockResolvedValue({ outcome: 'applied' }),
  };
}

function claimed(override: Record<string, unknown> = {}) {
  return {
    eventKey: EVENT_KEY,
    eventType: 'match_invited' as const,
    category: 'match_activity' as const,
    sourceVersion: 1,
    recipientAccountId: RECIPIENT,
    claimVersion: 2,
    attemptCount: 1,
    occurredAt: NOW,
    telegramChatId: '123456',
    destinationVersion: 3,
    deepLink: { screen: 'match' as const, matchId: MATCH_ID },
    ...override,
  };
}

function harness() {
  const intents = repository();
  const sendMessage = jest.fn().mockResolvedValue({
    outcome: 'sent',
    telegramMessageId: '42',
  });
  const canary = new TelegramInvitationCanary({
    visibilityLeaseSeconds: 15,
    transactions: { runInTransaction: (operation) => operation(transaction) },
    intents,
    telegram: { sendMessage },
    clock: { nowEpochSeconds: () => NOW },
  });
  return { canary, intents, sendMessage };
}

describe('TelegramInvitationCanary', () => {
  it('claims and sends only the exact invitation recipient once', async () => {
    const h = harness();
    h.intents.claimExactInvitationCanary.mockResolvedValue({
      outcome: 'claimed',
      intent: claimed(),
    });

    await expect(
      h.canary.run({ eventKey: EVENT_KEY, recipientAccountId: RECIPIENT }),
    ).resolves.toEqual({ outcome: 'sent' });
    await expect(
      h.canary.run({ eventKey: EVENT_KEY, recipientAccountId: RECIPIENT }),
    ).resolves.toEqual({ outcome: 'already_run' });

    expect(h.intents.claimExactInvitationCanary).toHaveBeenCalledWith(
      transaction,
      {
        eventKey: EVENT_KEY,
        recipientAccountId: RECIPIENT,
        now: NOW,
        leaseUntil: Number(NOW) + 15,
      },
    );
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.sendMessage).toHaveBeenCalledWith({
      telegramChatId: '123456',
      text: 'Вас пригласили в матч. Откройте «Просто Падел», чтобы посмотреть детали.',
      deepLink: { screen: 'match', matchId: MATCH_ID },
    });
    expect(h.intents.markSent).toHaveBeenCalledTimes(1);
  });

  it('does not call Telegram when the exact row is not sendable', async () => {
    const h = harness();
    h.intents.claimExactInvitationCanary.mockResolvedValue({
      outcome: 'none_available',
    });
    await expect(
      h.canary.run({ eventKey: EVENT_KEY, recipientAccountId: RECIPIENT }),
    ).resolves.toEqual({ outcome: 'not_sendable' });
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a repository target mismatch before Telegram', async () => {
    const h = harness();
    h.intents.claimExactInvitationCanary.mockResolvedValue({
      outcome: 'claimed',
      intent: claimed({ recipientAccountId: OTHER_RECIPIENT }),
    });
    await expect(
      h.canary.run({ eventKey: EVENT_KEY, recipientAccountId: RECIPIENT }),
    ).resolves.toEqual({ outcome: 'target_rejected' });
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.intents.abandon).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ failure: 'delivery_unknown' }),
    );
  });

  it('never retries a canary rate limit response', async () => {
    const h = harness();
    h.intents.claimExactInvitationCanary.mockResolvedValue({
      outcome: 'claimed',
      intent: claimed(),
    });
    h.sendMessage.mockResolvedValue({
      outcome: 'retry',
      failure: 'telegram_rate_limited',
      retryAfterSeconds: 20,
    });
    await expect(
      h.canary.run({ eventKey: EVENT_KEY, recipientAccountId: RECIPIENT }),
    ).resolves.toEqual({ outcome: 'provider_rejected' });
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.intents.scheduleRetry).not.toHaveBeenCalled();
    expect(h.intents.abandon).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ failure: 'retry_exhausted' }),
    );
  });

  it('records an ambiguous thrown delivery without a second send', async () => {
    const h = harness();
    h.intents.claimExactInvitationCanary.mockResolvedValue({
      outcome: 'claimed',
      intent: claimed(),
    });
    h.sendMessage.mockRejectedValue(new Error('synthetic transport failure'));
    await expect(
      h.canary.run({ eventKey: EVENT_KEY, recipientAccountId: RECIPIENT }),
    ).resolves.toEqual({ outcome: 'delivery_unknown' });
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.intents.abandon).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ failure: 'delivery_unknown' }),
    );
  });
});
