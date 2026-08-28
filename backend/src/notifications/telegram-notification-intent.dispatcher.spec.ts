import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { TelegramNotificationIntentRepository } from '../database/telegram-notification-intent.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { MatchId } from '../matches/match.types';
import { TelegramNotificationIntentDispatcher } from './telegram-notification-intent.dispatcher';

const NOW = unixEpochSeconds(1_800_000_000);
const ACCOUNT_ID = deterministicUuid('intent-dispatch-account') as AccountId;
const MATCH_ID = deterministicUuid('intent-dispatch-match') as MatchId;
const transaction = {} as PostgresTransaction;

function repository(): jest.Mocked<TelegramNotificationIntentRepository> {
  return {
    enqueueDirect: jest.fn(),
    enqueueMatchOwner: jest.fn(),
    enqueueMatchAudience: jest.fn(),
    enqueueDueReminders: jest.fn(),
    claimNext: jest.fn(),
    markSent: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    scheduleRetry: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    abandon: jest.fn().mockResolvedValue({ outcome: 'applied' }),
  };
}

function intent(override: Record<string, unknown> = {}) {
  return {
    eventKey: `chat_message_created:${deterministicUuid('intent-dispatch-source')}`,
    eventType: 'chat_message_created' as const,
    category: 'chat_messages' as const,
    sourceVersion: 1,
    recipientAccountId: ACCOUNT_ID,
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
  const dispatcher = new TelegramNotificationIntentDispatcher({
    enabled: false,
    pollIntervalMilliseconds: 1_000,
    visibilityLeaseSeconds: 15,
    transactions: { runInTransaction: (operation) => operation(transaction) },
    intents,
    telegram: { sendMessage },
    clock: { nowEpochSeconds: () => NOW },
  });
  return { dispatcher, intents, sendMessage };
}

describe('TelegramNotificationIntentDispatcher', () => {
  it('sends a fixed chat notice without the chat body and finalizes once', async () => {
    const h = harness();
    h.intents.claimNext.mockResolvedValue({
      outcome: 'claimed',
      intent: intent(),
    });
    await expect(h.dispatcher.dispatchOne()).resolves.toBe(true);
    expect(h.sendMessage).toHaveBeenCalledWith({
      telegramChatId: '123456',
      text: 'В чате матча новое сообщение. Откройте «Просто Падел», чтобы прочитать его.',
      deepLink: { screen: 'match', matchId: MATCH_ID },
    });
    expect(JSON.stringify(h.sendMessage.mock.calls)).not.toContain(
      'PRIVATE_CHAT_BODY',
    );
    expect(h.intents.markSent).toHaveBeenCalledTimes(1);
  });

  it.each([
    'preference_disabled',
    'destination_unavailable',
    'stale_event',
  ] as const)(
    'does not call Telegram for terminal claim %s',
    async (terminalReason) => {
      const h = harness();
      h.intents.claimNext.mockResolvedValue({
        outcome: 'claimed',
        intent: intent({ terminalReason }),
      });
      await h.dispatcher.dispatchOne();
      expect(h.sendMessage).not.toHaveBeenCalled();
      expect(h.intents.abandon).toHaveBeenCalledWith(
        transaction,
        expect.objectContaining({ failure: terminalReason }),
      );
    },
  );

  it('retries only an explicit 429 and preserves the claim identity', async () => {
    const h = harness();
    h.intents.claimNext.mockResolvedValue({
      outcome: 'claimed',
      intent: intent(),
    });
    h.sendMessage.mockResolvedValue({
      outcome: 'retry',
      failure: 'telegram_rate_limited',
      retryAfterSeconds: 27,
    });
    await h.dispatcher.dispatchOne();
    expect(h.intents.scheduleRetry).toHaveBeenCalledWith(transaction, {
      eventKey: intent().eventKey,
      recipientAccountId: ACCOUNT_ID,
      claimVersion: 2,
      now: NOW,
      availableAt: Number(NOW) + 27,
      failure: 'telegram_rate_limited',
    });
  });

  it('opens a local circuit after a bot authentication failure', async () => {
    const h = harness();
    h.intents.claimNext.mockResolvedValue({
      outcome: 'claimed',
      intent: intent(),
    });
    h.sendMessage.mockResolvedValue({
      outcome: 'abandoned',
      failure: 'telegram_unauthorized',
    });
    await expect(h.dispatcher.dispatchOne()).resolves.toBe(true);
    await expect(h.dispatcher.dispatchOne()).resolves.toBe(false);
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.intents.claimNext).toHaveBeenCalledTimes(1);
  });
});
