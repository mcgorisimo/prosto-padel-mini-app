import { deterministicUuid } from '../../test/deterministic-uuid';
import { MatchId } from '../matches/match.types';
import {
  buildTelegramMiniAppUrl,
  TelegramBotClient,
} from './telegram-bot.client';

const TOKEN = '123456789:TEST_ONLY_TOKEN';
const URL = 'https://app.prostopdl.ru/';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(fetch: jest.MockedFunction<typeof globalThis.fetch>) {
  return new TelegramBotClient({
    botToken: TOKEN,
    miniAppUrl: URL,
    requestTimeoutMilliseconds: 5_000,
    fetch,
  });
}

function fetchMock(): jest.MockedFunction<typeof globalThis.fetch> {
  return jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
}

describe('TelegramBotClient', () => {
  it('sends a private message with a Mini App button and returns the message id', async () => {
    const fetch = fetchMock().mockResolvedValue(
      response(200, { ok: true, result: { message_id: 42 } }),
    );

    await expect(
      client(fetch).sendMessage({ telegramChatId: '123456', text: 'Safe text' }),
    ).resolves.toEqual({ outcome: 'sent', telegramMessageId: '42' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    );
    const init = fetch.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        chat_id: '123456',
        text: 'Safe text',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Открыть приложение', web_app: { url: URL } }],
          ],
        },
      }),
    );
  });

  it('builds an HTTPS-only event-specific Mini App deep link', () => {
    const matchId = deterministicUuid('telegram-bot-link') as MatchId;
    expect(buildTelegramMiniAppUrl(URL, { screen: 'match', matchId })).toBe(
      `${URL}?pp_screen=match&pp_match_id=${matchId}`,
    );
    expect(() => buildTelegramMiniAppUrl('http://unsafe.example/')).toThrow(
      'unsafe',
    );
    expect(() => buildTelegramMiniAppUrl(`${URL}?pp_screen=admin`)).toThrow(
      'unsafe',
    );
    expect(() =>
      buildTelegramMiniAppUrl(`${URL}?token=must-not-leave-runtime`),
    ).toThrow('unsafe');
  });

  it('retries rate limits using a bounded Telegram retry hint', async () => {
    const fetch = fetchMock().mockResolvedValue(
      response(429, {
        ok: false,
        parameters: { retry_after: 27 },
      }),
    );

    await expect(
      client(fetch).sendMessage({ telegramChatId: '123456', text: 'Safe text' }),
    ).resolves.toEqual({
      outcome: 'retry',
      failure: 'telegram_rate_limited',
      retryAfterSeconds: 27,
    });
  });

  it('disables a forbidden destination without exposing the response body', async () => {
    const fetch = fetchMock().mockResolvedValue(
      response(403, { ok: false, description: 'sensitive marker' }),
    );

    await expect(
      client(fetch).sendMessage({ telegramChatId: '123456', text: 'Safe text' }),
    ).resolves.toEqual({
      outcome: 'abandoned',
      failure: 'telegram_forbidden',
      disableDestination: 'telegram_forbidden',
    });
  });

  it('disables only known invalid-destination bad requests', async () => {
    const invalid = fetchMock().mockResolvedValue(
      response(400, { ok: false, description: 'Bad Request: chat not found' }),
    );
    const other = fetchMock().mockResolvedValue(
      response(400, { ok: false, description: 'Bad Request: other' }),
    );

    await expect(
      client(invalid).sendMessage({ telegramChatId: '123456', text: 'Safe text' }),
    ).resolves.toEqual({
      outcome: 'abandoned',
      failure: 'telegram_bad_request',
      disableDestination: 'invalid_destination',
    });
    await expect(
      client(other).sendMessage({ telegramChatId: '123456', text: 'Safe text' }),
    ).resolves.toEqual({
      outcome: 'abandoned',
      failure: 'telegram_bad_request',
    });
  });

  it.each([
    [500, { ok: false }],
    [200, { ok: true, result: {} }],
  ] as const)('fails closed for ambiguous status %s', async (status, body) => {
    const fetch = fetchMock().mockResolvedValue(response(status, body));

    await expect(
      client(fetch).sendMessage({ telegramChatId: '123456', text: 'Safe text' }),
    ).resolves.toEqual({ outcome: 'abandoned', failure: 'delivery_unknown' });
  });

  it('maps transport failures without leaking the exception', async () => {
    const fetch = fetchMock().mockRejectedValue(
      new Error('secret network marker'),
    );

    await expect(
      client(fetch).sendMessage({ telegramChatId: '123456', text: 'Safe text' }),
    ).resolves.toEqual({
      outcome: 'abandoned',
      failure: 'delivery_unknown',
    });
  });

  it('treats an invalid bot token as a terminal authentication failure', async () => {
    const fetch = fetchMock().mockResolvedValue(response(401, { ok: false }));
    await expect(
      client(fetch).sendMessage({
        telegramChatId: '123456',
        text: 'Safe text',
      }),
    ).resolves.toEqual({
      outcome: 'abandoned',
      failure: 'telegram_unauthorized',
    });
  });

  it('rejects an oversized response before buffering it', async () => {
    const oversized = new Response('{}', {
      status: 200,
      headers: { 'content-length': '65537' },
    });
    const fetch = fetchMock().mockResolvedValue(oversized);
    await expect(
      client(fetch).sendMessage({
        telegramChatId: '123456',
        text: 'Safe text',
      }),
    ).resolves.toEqual({
      outcome: 'abandoned',
      failure: 'delivery_unknown',
    });
  });
});
