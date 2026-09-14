import { timingSafeEqual } from 'node:crypto';
import { isUnixEpochSeconds, UnixEpochSeconds } from '../../auth/auth.types';
import { TelegramBotWebhookConfiguration } from '../../config/telegram-bot-webhook.config';
import { PostgresTelegramBotUpdateRepository } from '../../database/postgres-telegram-bot-update.repository';
import { TelegramNotificationDestinationRepository } from '../../database/telegram-notification-destination.repository';
import { PostgresTransactionRunner } from '../../database/postgres-transaction';
import { TelegramBotOwnerIdentityResolver } from './telegram-bot-owner-identity.resolver';

const TELEGRAM_PRIVATE_ID_MAXIMUM = 4_503_599_627_370_495;
const TELEGRAM_START_MAX_AGE_SECONDS = 5 * 60;
const TELEGRAM_START_FUTURE_SKEW_SECONDS = 30;

export const TELEGRAM_BOT_WELCOME_TEXT =
  'Добро пожаловать в «Просто Падел». Откройте приложение, чтобы продолжить.';
export const TELEGRAM_BOT_OPEN_BUTTON_TEXT = 'Открыть Просто Падел';

export type TelegramBotWebhookMethodResponse = Readonly<{
  method: 'sendMessage';
  chat_id: string;
  text: string;
  link_preview_options: Readonly<{ is_disabled: true }>;
  reply_markup: Readonly<{
    inline_keyboard: readonly [
      readonly [
        Readonly<{
          text: string;
          web_app: Readonly<{ url: string }>;
        }>,
      ],
    ];
  }>;
}>;

export type TelegramBotWebhookOutcome =
  | Readonly<{
      outcome: 'reply';
      response: TelegramBotWebhookMethodResponse;
    }>
  | Readonly<{ outcome: 'acknowledged' }>;

export interface TelegramBotWebhookClock {
  nowEpochSeconds(): UnixEpochSeconds;
}

export class TelegramBotWebhookNotAvailableError extends Error {}
export class TelegramBotWebhookPersistenceError extends Error {}

interface StartUpdate {
  readonly updateId: number;
  readonly telegramChatId: string;
  readonly messageDate: UnixEpochSeconds;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isTelegramPrivateId(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > 0 &&
    Number(value) <= TELEGRAM_PRIVATE_ID_MAXIMUM
  );
}

function readStartUpdate(value: unknown): StartUpdate | undefined {
  if (
    !isPlainRecord(value) ||
    !Number.isSafeInteger(value.update_id) ||
    Number(value.update_id) < 0 ||
    Number(value.update_id) > 2_147_483_647 ||
    !isPlainRecord(value.message)
  ) {
    return undefined;
  }

  const message = value.message;
  if (
    message.text !== '/start' ||
    !isUnixEpochSeconds(message.date) ||
    !isPlainRecord(message.chat) ||
    message.chat.type !== 'private' ||
    !isTelegramPrivateId(message.chat.id) ||
    !isPlainRecord(message.from) ||
    message.from.is_bot !== false ||
    !isTelegramPrivateId(message.from.id) ||
    message.from.id !== message.chat.id
  ) {
    return undefined;
  }

  return Object.freeze({
    updateId: Number(value.update_id),
    telegramChatId: String(message.chat.id),
    messageDate: message.date,
  });
}

function isFreshStart(
  messageDate: UnixEpochSeconds,
  now: UnixEpochSeconds,
): boolean {
  if (messageDate > now) {
    return messageDate - now <= TELEGRAM_START_FUTURE_SKEW_SECONDS;
  }
  return now - messageDate <= TELEGRAM_START_MAX_AGE_SECONDS;
}

function secretsMatch(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  try {
    return (
      expectedBytes.length === providedBytes.length &&
      timingSafeEqual(expectedBytes, providedBytes)
    );
  } finally {
    expectedBytes.fill(0);
    providedBytes.fill(0);
  }
}

function response(
  telegramChatId: string,
  miniAppUrl: string,
): TelegramBotWebhookMethodResponse {
  return Object.freeze({
    method: 'sendMessage' as const,
    chat_id: telegramChatId,
    text: TELEGRAM_BOT_WELCOME_TEXT,
    link_preview_options: Object.freeze({ is_disabled: true as const }),
    reply_markup: Object.freeze({
      inline_keyboard: Object.freeze([
        Object.freeze([
          Object.freeze({
            text: TELEGRAM_BOT_OPEN_BUTTON_TEXT,
            web_app: Object.freeze({ url: miniAppUrl }),
          }),
        ]),
      ]) as TelegramBotWebhookMethodResponse['reply_markup']['inline_keyboard'],
    }),
  });
}

export class TelegramBotWebhookService {
  constructor(
    private readonly configuration: TelegramBotWebhookConfiguration,
    private readonly transactions: PostgresTransactionRunner,
    private readonly updates: PostgresTelegramBotUpdateRepository,
    private readonly owners: TelegramBotOwnerIdentityResolver,
    private readonly destinations: TelegramNotificationDestinationRepository,
    private readonly clock: TelegramBotWebhookClock = {
      nowEpochSeconds: () => Math.floor(Date.now() / 1_000) as UnixEpochSeconds,
    },
  ) {}

  async accept(
    secretHeader: unknown,
    rawUpdate: unknown,
  ): Promise<TelegramBotWebhookOutcome> {
    const configuration = this.configuration;
    if (!configuration.enabled) {
      throw new TelegramBotWebhookNotAvailableError();
    }
    if (!secretsMatch(configuration.secret, secretHeader)) {
      throw new TelegramBotWebhookNotAvailableError();
    }

    const update = readStartUpdate(rawUpdate);
    if (update === undefined) {
      return Object.freeze({ outcome: 'acknowledged' as const });
    }

    const receivedAt = this.clock.nowEpochSeconds();
    if (!isUnixEpochSeconds(receivedAt)) {
      throw new TelegramBotWebhookPersistenceError();
    }
    const fresh = isFreshStart(update.messageDate, receivedAt);

    let claim;
    try {
      claim = await this.transactions.runInTransaction(async (transaction) => {
        const isOwner = await this.owners.matches(transaction, {
          allowedAccountId: configuration.allowedAccountId,
          telegramChatId: update.telegramChatId,
        });
        if (!isOwner) return 'unmatched' as const;
        if (!fresh) {
          const replay = await this.updates.exists(transaction, {
            updateId: update.updateId,
            botNamespace: configuration.botNamespace,
          });
          return replay ? ('replayed' as const) : ('stale' as const);
        }
        const updateClaim = await this.updates.claim(transaction, {
          updateId: update.updateId,
          receivedAt,
          botNamespace: configuration.botNamespace,
        });
        if (updateClaim === 'ignored') return updateClaim;
        if (updateClaim !== 'claimed') {
          throw new TelegramBotWebhookPersistenceError();
        }
        const destination = await this.destinations.synchronize(transaction, {
          accountId: configuration.allowedAccountId,
          permission: Object.freeze({
            status: 'granted' as const,
            telegramChatId: update.telegramChatId,
          }),
          observedAt: update.messageDate,
        });
        if (
          destination.outcome !== 'synchronized' ||
          destination.accountId !== configuration.allowedAccountId ||
          destination.state !== 'enabled'
        ) {
          throw new TelegramBotWebhookPersistenceError();
        }
        return updateClaim;
      });
    } catch {
      throw new TelegramBotWebhookPersistenceError();
    }
    if (claim === 'unmatched' || claim === 'stale') {
      return Object.freeze({ outcome: 'acknowledged' as const });
    }
    if (claim !== 'claimed' && claim !== 'ignored' && claim !== 'replayed') {
      throw new TelegramBotWebhookPersistenceError();
    }

    return Object.freeze({
      outcome: 'reply' as const,
      response: response(update.telegramChatId, configuration.miniAppUrl),
    });
  }
}
