import { accountId } from '../../accounts/account.types';
import { internalUuid } from '../../common/internal-uuid';
import { TelegramBotWebhookConfiguration } from '../../config/telegram-bot-webhook.config';
import { PostgresTelegramBotUpdateRepository } from '../../database/postgres-telegram-bot-update.repository';
import { PostgresTransactionRunner } from '../../database/postgres-transaction';
import { TelegramNotificationDestinationRepository } from '../../database/telegram-notification-destination.repository';
import { unixEpochSeconds } from '../../auth/auth.types';
import {
  TELEGRAM_BOT_OPEN_BUTTON_TEXT,
  TELEGRAM_BOT_WELCOME_TEXT,
  TelegramBotWebhookNotAvailableError,
  TelegramBotWebhookPersistenceError,
  TelegramBotWebhookService,
} from './telegram-bot-webhook.service';
import { TelegramBotOwnerIdentityResolver } from './telegram-bot-owner-identity.resolver';

const SECRET = 'BOT1_TEST_WEBHOOK_SECRET_1234567890';
const ALLOWED_ACCOUNT_ID = accountId('11111111-1111-4111-8111-111111111111');
const BOT_NAMESPACE = internalUuid('22222222-2222-4222-8222-222222222222');
const MINI_APP_URL = 'https://test-app.prostopdl.ru/';
const PRIVATE_MARKER = 'PRIVATE_PROFILE_MARKER';
const NOW = 1_800_000_000;

const ENABLED_CONFIGURATION: TelegramBotWebhookConfiguration = Object.freeze({
  enabled: true,
  secret: SECRET,
  miniAppUrl: MINI_APP_URL,
  allowedAccountId: ALLOWED_ACCOUNT_ID,
  botNamespace: BOT_NAMESPACE,
});

function startUpdate(updateId = 100, messageDate = NOW) {
  return {
    update_id: updateId,
    message: {
      message_id: 7,
      date: messageDate,
      text: '/start',
      chat: { id: 123456, type: 'private', first_name: PRIVATE_MARKER },
      from: {
        id: 123456,
        is_bot: false,
        first_name: PRIVATE_MARKER,
        username: PRIVATE_MARKER,
      },
    },
  };
}

function harness(outcomes: Array<'claimed' | 'ignored'> = ['claimed']) {
  const claim = jest
    .fn()
    .mockImplementation(async () => outcomes.shift() ?? 'ignored');
  const exists = jest.fn().mockResolvedValue(false);
  const transaction = { query: jest.fn() };
  const runInTransaction = jest
    .fn()
    .mockImplementation(async (operation: (value: unknown) => unknown) =>
      operation(transaction),
    );
  const matches = jest.fn().mockResolvedValue(true);
  const synchronize = jest.fn().mockResolvedValue({
    outcome: 'synchronized',
    accountId: ALLOWED_ACCOUNT_ID,
    state: 'enabled',
    changed: true,
  });
  const service = new TelegramBotWebhookService(
    ENABLED_CONFIGURATION,
    { runInTransaction } as unknown as PostgresTransactionRunner,
    { claim, exists } as unknown as PostgresTelegramBotUpdateRepository,
    { matches } as unknown as TelegramBotOwnerIdentityResolver,
    { synchronize } as unknown as TelegramNotificationDestinationRepository,
    { nowEpochSeconds: () => unixEpochSeconds(NOW) },
  );
  return { service, claim, exists, matches, synchronize, runInTransaction };
}

describe('TelegramBotWebhookService', () => {
  it('claims an allowlisted private /start before returning a neutral reply', async () => {
    const subject = harness();

    const result = await subject.service.accept(SECRET, startUpdate());

    expect(subject.runInTransaction).toHaveBeenCalledTimes(1);
    expect(subject.matches).toHaveBeenCalledWith(expect.anything(), {
      allowedAccountId: ALLOWED_ACCOUNT_ID,
      telegramChatId: '123456',
    });
    expect(subject.claim).toHaveBeenCalledWith(expect.anything(), {
      updateId: 100,
      receivedAt: NOW,
      botNamespace: BOT_NAMESPACE,
    });
    expect(subject.synchronize).toHaveBeenCalledWith(expect.anything(), {
      accountId: ALLOWED_ACCOUNT_ID,
      permission: { status: 'granted', telegramChatId: '123456' },
      observedAt: NOW,
    });
    expect(subject.claim.mock.invocationCallOrder[0]).toBeLessThan(
      subject.synchronize.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      outcome: 'reply',
      response: {
        method: 'sendMessage',
        chat_id: '123456',
        text: TELEGRAM_BOT_WELCOME_TEXT,
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: TELEGRAM_BOT_OPEN_BUTTON_TEXT,
                web_app: { url: MINI_APP_URL },
              },
            ],
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_MARKER);
  });

  it('replies to a replay without a second destination synchronization', async () => {
    const subject = harness(['claimed', 'ignored']);

    const first = await subject.service.accept(SECRET, startUpdate());
    const replay = await subject.service.accept(SECRET, startUpdate());

    expect(first.outcome).toBe('reply');
    expect(replay).toEqual(first);
    expect(subject.claim).toHaveBeenCalledTimes(2);
    expect(subject.synchronize).toHaveBeenCalledTimes(1);
  });

  it('synchronizes once while concurrent delivery retries both receive a reply', async () => {
    const subject = harness();
    let claimed = false;
    subject.claim.mockImplementation(async () => {
      await Promise.resolve();
      if (claimed) return 'ignored';
      claimed = true;
      return 'claimed';
    });

    const outcomes = await Promise.all([
      subject.service.accept(SECRET, startUpdate()),
      subject.service.accept(SECRET, startUpdate()),
    ]);

    expect(outcomes.filter((item) => item.outcome === 'reply')).toHaveLength(2);
    expect(subject.synchronize).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing secret', undefined],
    ['wrong secret', 'X'.repeat(SECRET.length)],
    ['oversized secret', 'X'.repeat(300)],
  ])('rejects %s before transaction work', async (_label, secret) => {
    const subject = harness();

    await expect(
      subject.service.accept(secret, startUpdate()),
    ).rejects.toBeInstanceOf(TelegramBotWebhookNotAvailableError);
    expect(subject.runInTransaction).not.toHaveBeenCalled();
    expect(subject.synchronize).not.toHaveBeenCalled();
  });

  it.each([
    [
      'foreign command',
      {
        ...startUpdate(),
        message: { ...startUpdate().message, text: '/help' },
      },
    ],
    [
      'start payload',
      {
        ...startUpdate(),
        message: { ...startUpdate().message, text: '/start payload' },
      },
    ],
    [
      'group chat',
      {
        ...startUpdate(),
        message: {
          ...startUpdate().message,
          chat: { id: 123456, type: 'group' },
        },
      },
    ],
    [
      'sender mismatch',
      {
        ...startUpdate(),
        message: {
          ...startUpdate().message,
          from: { id: 654321, is_bot: false },
        },
      },
    ],
    [
      'bot sender',
      {
        ...startUpdate(),
        message: {
          ...startUpdate().message,
          from: { id: 123456, is_bot: true },
        },
      },
    ],
    ['invalid update id', { ...startUpdate(), update_id: -1 }],
    [
      'missing message date',
      {
        ...startUpdate(),
        message: { ...startUpdate().message, date: undefined },
      },
    ],
    ['missing message', { update_id: 100 }],
  ])('safely acknowledges %s without persistence', async (_label, update) => {
    const subject = harness();

    await expect(subject.service.accept(SECRET, update)).resolves.toEqual({
      outcome: 'acknowledged',
    });
    expect(subject.runInTransaction).not.toHaveBeenCalled();
    expect(subject.synchronize).not.toHaveBeenCalled();
  });

  it.each([
    ['stale', NOW - 301],
    ['too far in the future', NOW + 31],
  ])('fails closed for a %s /start message date', async (_label, date) => {
    const subject = harness();

    await expect(
      subject.service.accept(SECRET, startUpdate(100, date)),
    ).resolves.toEqual({ outcome: 'acknowledged' });
    expect(subject.runInTransaction).toHaveBeenCalledTimes(1);
    expect(subject.exists).toHaveBeenCalledWith(expect.anything(), {
      updateId: 100,
      botNamespace: BOT_NAMESPACE,
    });
    expect(subject.claim).not.toHaveBeenCalled();
    expect(subject.synchronize).not.toHaveBeenCalled();
  });

  it('re-emits the reply for a durable replay after the freshness window', async () => {
    const subject = harness();
    subject.exists.mockResolvedValueOnce(true);

    await expect(
      subject.service.accept(SECRET, startUpdate(100, NOW - 301)),
    ).resolves.toMatchObject({ outcome: 'reply' });
    expect(subject.exists).toHaveBeenCalledTimes(1);
    expect(subject.claim).not.toHaveBeenCalled();
    expect(subject.synchronize).not.toHaveBeenCalled();
  });

  it.each(['absent', 'disabled'])(
    'enables an owner destination that was %s',
    async () => {
      const subject = harness();

      await expect(
        subject.service.accept(SECRET, startUpdate()),
      ).resolves.toMatchObject({ outcome: 'reply' });
      expect(subject.synchronize).toHaveBeenCalledWith(expect.anything(), {
        accountId: ALLOWED_ACCOUNT_ID,
        permission: { status: 'granted', telegramChatId: '123456' },
        observedAt: NOW,
      });
    },
  );

  it('fails closed when the Telegram identity is not the allowlisted owner', async () => {
    const subject = harness();
    subject.matches.mockResolvedValueOnce(false);

    await expect(
      subject.service.accept(SECRET, startUpdate()),
    ).resolves.toEqual({ outcome: 'acknowledged' });
    expect(subject.claim).not.toHaveBeenCalled();
    expect(subject.synchronize).not.toHaveBeenCalled();
  });

  it('maps persistence failures without echoing provider data', async () => {
    const subject = harness();
    subject.runInTransaction.mockRejectedValueOnce(new Error(PRIVATE_MARKER));

    await expect(subject.service.accept(SECRET, startUpdate())).rejects.toEqual(
      new TelegramBotWebhookPersistenceError(),
    );
  });

  it('keeps the webhook unavailable when disabled', async () => {
    const subject = harness();
    const disabled = new TelegramBotWebhookService(
      { enabled: false, secret: '', miniAppUrl: '' },
      {
        runInTransaction: subject.runInTransaction,
      } as unknown as PostgresTransactionRunner,
      {
        claim: subject.claim,
        exists: subject.exists,
      } as unknown as PostgresTelegramBotUpdateRepository,
      {
        matches: subject.matches,
      } as unknown as TelegramBotOwnerIdentityResolver,
      {
        synchronize: subject.synchronize,
      } as unknown as TelegramNotificationDestinationRepository,
    );

    await expect(disabled.accept(SECRET, startUpdate())).rejects.toBeInstanceOf(
      TelegramBotWebhookNotAvailableError,
    );
    expect(subject.runInTransaction).not.toHaveBeenCalled();
  });
});
