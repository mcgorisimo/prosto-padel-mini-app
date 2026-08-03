import {
  TelegramDestinationDisableReason,
  TelegramNotificationRetryFailure,
  TelegramNotificationTerminalFailure,
} from './telegram-notification.types';

const MAX_RESPONSE_BYTES = 65_536;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const MAX_TELEGRAM_MESSAGE_ID_TEXT = '9007199254740991';

export type TelegramBotSendResult =
  | {
      readonly outcome: 'sent';
      readonly telegramMessageId: string;
    }
  | {
      readonly outcome: 'retry';
      readonly failure: TelegramNotificationRetryFailure;
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly outcome: 'abandoned';
      readonly failure: TelegramNotificationTerminalFailure;
      readonly disableDestination?: TelegramDestinationDisableReason;
    };

export interface TelegramBotClientConfiguration {
  readonly botToken: string;
  readonly miniAppUrl: string;
  readonly requestTimeoutMilliseconds: number;
  readonly fetch: typeof globalThis.fetch;
}

interface TelegramApiResponse {
  readonly ok?: unknown;
  readonly description?: unknown;
  readonly result?: unknown;
  readonly parameters?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validMessageId(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > 0 &&
    String(value).length <= MAX_TELEGRAM_MESSAGE_ID_TEXT.length
  );
}

function readResponseBody(text: string): TelegramApiResponse | undefined {
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readRetryAfter(body: TelegramApiResponse | undefined): number | undefined {
  if (!isRecord(body?.parameters)) return undefined;
  const value = body.parameters.retry_after;
  return Number.isSafeInteger(value) &&
    Number(value) > 0 &&
    Number(value) <= MAX_RETRY_AFTER_SECONDS
    ? Number(value)
    : undefined;
}

function invalidDestination(body: TelegramApiResponse | undefined): boolean {
  if (typeof body?.description !== 'string') return false;
  const description = body.description.toLowerCase();
  return (
    description === 'bad request: chat not found' ||
    description === 'bad request: user not found'
  );
}

export class TelegramBotClient {
  constructor(readonly configuration: TelegramBotClientConfiguration) {}

  async sendMessage(input: {
    readonly telegramChatId: string;
    readonly text: string;
  }): Promise<TelegramBotSendResult> {
    try {
      const response = await this.configuration.fetch(
        `https://api.telegram.org/bot${this.configuration.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: input.telegramChatId,
            text: input.text,
            link_preview_options: { is_disabled: true },
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: 'Открыть приложение',
                    web_app: { url: this.configuration.miniAppUrl },
                  },
                ],
              ],
            },
          }),
          signal: AbortSignal.timeout(
            this.configuration.requestTimeoutMilliseconds,
          ),
        },
      );
      const body = readResponseBody(await response.text());
      if (response.status === 429) {
        const retryAfterSeconds = readRetryAfter(body);
        return Object.freeze({
          outcome: 'retry' as const,
          failure: 'telegram_rate_limited' as const,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        });
      }
      if (response.status >= 500) {
        return Object.freeze({
          outcome: 'retry' as const,
          failure: 'telegram_unavailable' as const,
        });
      }
      if (response.status === 403) {
        return Object.freeze({
          outcome: 'abandoned' as const,
          failure: 'telegram_forbidden' as const,
          disableDestination: 'telegram_forbidden' as const,
        });
      }
      if (response.status === 400) {
        return Object.freeze({
          outcome: 'abandoned' as const,
          failure: 'telegram_bad_request' as const,
          ...(invalidDestination(body)
            ? { disableDestination: 'invalid_destination' as const }
            : {}),
        });
      }
      if (
        response.status < 200 ||
        response.status >= 300 ||
        body?.ok !== true ||
        !isRecord(body.result) ||
        !validMessageId(body.result.message_id)
      ) {
        return Object.freeze({
          outcome: 'retry' as const,
          failure: 'invalid_response' as const,
        });
      }
      return Object.freeze({
        outcome: 'sent' as const,
        telegramMessageId: String(body.result.message_id),
      });
    } catch {
      return Object.freeze({
        outcome: 'retry' as const,
        failure: 'network_error' as const,
      });
    }
  }
}
