import { ConfigService } from '@nestjs/config';
import { envValidationSchema } from './env.validation';
import {
  readTelegramBotWebhookConfiguration,
  TELEGRAM_BOT_WEBHOOK_CONFIG_KEYS,
} from './telegram-bot-webhook.config';
import { TELEGRAM_LOGIN_CONFIG_KEYS } from './telegram-login.config';
import { TELEGRAM_NOTIFICATION_CONFIG_KEYS } from './telegram-notification.config';

describe('readTelegramBotWebhookConfiguration', () => {
  it('restores the canonical root slash removed by environment normalization', () => {
    const secret = 'BOT1_TEST_WEBHOOK_SECRET_1234567890';
    const allowedAccountId = '11111111-1111-4111-8111-111111111111';
    const botNamespace = '12345678-1234-5678-9234-567812345678';
    const validation = envValidationSchema.validate(
      {
        DATABASE_ENABLED: 'true',
        DATABASE_URL: 'postgresql://test-only.invalid/prosto_padel',
        TELEGRAM_AUTH_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN:
          '123456789:AA_TEST_ONLY_FAKE_TELEGRAM_BOT_TOKEN',
        TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
        [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]: Buffer.alloc(
          32,
          0x11,
        ).toString('base64'),
        [TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64]: Buffer.alloc(
          32,
          0x22,
        ).toString('base64'),
        [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]: botNamespace,
        [TELEGRAM_BOT_WEBHOOK_CONFIG_KEYS.enabled]: 'true',
        [TELEGRAM_BOT_WEBHOOK_CONFIG_KEYS.secret]: secret,
        [TELEGRAM_BOT_WEBHOOK_CONFIG_KEYS.allowedAccountId]:
          allowedAccountId,
        [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]:
          'https://test-app.prostopdl.ru/',
        [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: 'false',
      },
      { abortEarly: false, allowUnknown: true },
    );

    expect(validation.error).toBeUndefined();
    expect(
      validation.value[TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl],
    ).toBe('https://test-app.prostopdl.ru');

    expect(
      readTelegramBotWebhookConfiguration(
        new ConfigService(validation.value),
      ),
    ).toEqual({
      enabled: true,
      secret,
      miniAppUrl: 'https://test-app.prostopdl.ru/',
      allowedAccountId,
      botNamespace,
    });
  });
});
