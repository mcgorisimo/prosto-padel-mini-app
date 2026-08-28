import {
  TelegramDestinationDisableReason,
  TelegramNotificationRetryFailure,
  TelegramNotificationTerminalFailure,
} from './telegram-notification.types';
import { TelegramNotificationDeepLink } from './telegram-notification-intent.types';

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

async function readBoundedResponseBody(
  response: Response,
): Promise<TelegramApiResponse | undefined> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (/^(?:0|[1-9][0-9]*)$/u.test(contentLength) === false ||
      Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const reader = response.body?.getReader();
  if (reader === undefined) return readResponseBody(await response.text());
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(part.value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return readResponseBody(
    new TextDecoder('utf-8', { fatal: true }).decode(combined),
  );
}

export function buildTelegramMiniAppUrl(
  baseUrl: string,
  deepLink?: TelegramNotificationDeepLink,
): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError('Telegram Mini App URL is invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.search !== ''
  ) {
    throw new TypeError('Telegram Mini App URL is unsafe');
  }
  if (deepLink?.screen === 'match') {
    url.searchParams.set('pp_screen', 'match');
    url.searchParams.set('pp_match_id', deepLink.matchId);
  } else if (deepLink?.screen === 'booking') {
    url.searchParams.set('pp_screen', 'booking');
    url.searchParams.set('pp_reservation_id', deepLink.reservationId);
  }
  return url.toString();
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
    readonly deepLink?: TelegramNotificationDeepLink;
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
                    web_app: {
                      url: buildTelegramMiniAppUrl(
                        this.configuration.miniAppUrl,
                        input.deepLink,
                      ),
                    },
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
      const body = await readBoundedResponseBody(response);
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
          outcome: 'abandoned' as const,
          failure: 'delivery_unknown' as const,
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
      if (response.status === 401 || response.status === 404) {
        return Object.freeze({
          outcome: 'abandoned' as const,
          failure: 'telegram_unauthorized' as const,
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
          outcome: 'abandoned' as const,
          failure: 'delivery_unknown' as const,
        });
      }
      return Object.freeze({
        outcome: 'sent' as const,
        telegramMessageId: String(body.result.message_id),
      });
    } catch {
      return Object.freeze({
        outcome: 'abandoned' as const,
        failure: 'delivery_unknown' as const,
      });
    }
  }
}
