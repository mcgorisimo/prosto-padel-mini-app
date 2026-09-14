import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { TelegramBotWebhookController } from './telegram-bot-webhook.controller';
import {
  TelegramBotWebhookNotAvailableError,
  TelegramBotWebhookPersistenceError,
  TelegramBotWebhookService,
} from './telegram-bot-webhook.service';

const PRIVATE_MARKER = 'PRIVATE_WEBHOOK_MARKER';
const SECRET = 'BOT1_TEST_WEBHOOK_SECRET_1234567890';

describe('TelegramBotWebhookController', () => {
  let app: NestFastifyApplication;
  let accept: jest.Mock;
  let logs: unknown[][];

  beforeEach(async () => {
    accept = jest.fn().mockResolvedValue({ outcome: 'acknowledged' });
    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramBotWebhookController],
      providers: [
        {
          provide: TelegramBotWebhookService,
          useValue: { accept },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    logs = [];
    const capture = (...values: unknown[]) => logs.push(values);
    app.useLogger({
      log: capture,
      error: capture,
      warn: capture,
      debug: capture,
      verbose: capture,
      fatal: capture,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the safe webhook method response for one /start', async () => {
    accept.mockResolvedValueOnce({
      outcome: 'reply',
      response: {
        method: 'sendMessage',
        chat_id: '123456',
        text: 'Добро пожаловать в «Просто Падел». Откройте приложение, чтобы продолжить.',
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Открыть Просто Падел',
                web_app: { url: 'https://test-app.prostopdl.ru/' },
              },
            ],
          ],
        },
      },
    });
    const payload = {
      update_id: 100,
      message: {
        text: '/start',
        chat: { id: 123456, type: 'private' },
        from: { id: 123456, is_bot: false, first_name: PRIVATE_MARKER },
      },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      method: 'sendMessage',
      text: expect.stringContaining('Просто Падел'),
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(accept).toHaveBeenCalledWith(SECRET, payload);
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(logs)).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });

  it('returns an empty acknowledgement for ignored updates', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/integrations/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { update_id: 101 },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it.each([
    [
      new TelegramBotWebhookNotAvailableError(),
      404,
      'TELEGRAM_BOT_WEBHOOK_NOT_FOUND',
    ],
    [
      new TelegramBotWebhookPersistenceError(),
      503,
      'TELEGRAM_BOT_WEBHOOK_UNAVAILABLE',
    ],
  ])(
    'maps expected failures to a fixed safe response',
    async (error, status, code) => {
      accept.mockRejectedValueOnce(error);

      const response = await app.inject({
        method: 'POST',
        url: '/integrations/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': PRIVATE_MARKER },
        payload: { update_id: 102, private: PRIVATE_MARKER },
      });

      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code });
      expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
      expect(JSON.stringify(logs)).not.toContain(PRIVATE_MARKER);
    },
  );
});
