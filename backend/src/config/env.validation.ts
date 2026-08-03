import Joi from 'joi';
import {
  TELEGRAM_AUTH_OPERATION_TTL_SECONDS,
  TELEGRAM_CRYPTO_SECRET_MINIMUM_BYTES,
  TELEGRAM_LOGIN_CONFIG_KEYS,
  TELEGRAM_LOOKUP_DIGEST_VERSION,
  TELEGRAM_LOOKUP_PEPPER_VERSION,
  TELEGRAM_SESSION_TTL_SECONDS,
} from './telegram-login.config';
import { TELEGRAM_NOTIFICATION_CONFIG_KEYS } from './telegram-notification.config';

const canonicalBase64Secret = Joi.string()
  .base64()
  .custom((value: string, helpers) => {
    const decoded = Buffer.from(value, 'base64');
    const valid =
      decoded.length >= TELEGRAM_CRYPTO_SECRET_MINIMUM_BYTES &&
      decoded.toString('base64') === value;
    decoded.fill(0);
    return valid ? value : helpers.error('string.base64Secret');
  })
  .messages({
    'string.base64Secret': '{{#label}} must be a canonical base64 secret of at least 32 bytes',
  });

const telegramBotToken = Joi.string()
  .custom((value: string, helpers) =>
    /^[1-9][0-9]{0,19}:[A-Za-z0-9_-]+$/u.test(value)
      ? value
      : helpers.error('string.telegramBotToken'),
  )
  .messages({
    'string.telegramBotToken':
      '{{#label}} must be a canonical Telegram bot token',
  });

function requiredWhenTelegramEnabled(schema: Joi.StringSchema) {
  return Joi.when('TELEGRAM_AUTH_ENABLED', {
    is: true,
    then: schema.required(),
    otherwise: Joi.string().allow('').default(''),
  });
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  HOST: Joi.string().hostname().default('127.0.0.1'),
  PORT: Joi.number().port().default(3000),
  CRM_PROVIDER: Joi.string().valid('disabled').default('disabled'),
  DATABASE_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  DATABASE_URL: Joi.when('DATABASE_ENABLED', {
    is: true,
    then: Joi.string()
      .uri({ scheme: ['postgres', 'postgresql'] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ['postgres', 'postgresql'] })
      .allow('')
      .default(''),
  }),
  TELEGRAM_AUTH_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false)
    .when('DATABASE_ENABLED', {
      is: false,
      then: Joi.valid(false).messages({
        'any.only':
          'TELEGRAM_AUTH_ENABLED requires DATABASE_ENABLED to be enabled',
      }),
    }),
  TELEGRAM_BOT_TOKEN: Joi.when('TELEGRAM_AUTH_ENABLED', {
    is: true,
    then: telegramBotToken.required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: Joi.when('TELEGRAM_AUTH_ENABLED', {
    is: true,
    then: Joi.number().integer().positive().max(86400).required(),
    otherwise: Joi.number()
      .integer()
      .positive()
      .max(86400)
      .allow('')
      .default(''),
  }),
  [TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled]: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false)
    .when('TELEGRAM_AUTH_ENABLED', {
      is: false,
      then: Joi.valid(false).messages({
        'any.only':
          'TELEGRAM_OUTBOUND_NOTIFICATIONS_ENABLED requires TELEGRAM_AUTH_ENABLED to be enabled',
      }),
    }),
  [TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl]: Joi.when(
    TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled,
    {
      is: true,
      then: Joi.string().uri({ scheme: ['https'] }).required(),
      otherwise: Joi.string().allow('').default(''),
    },
  ),
  [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]:
    requiredWhenTelegramEnabled(canonicalBase64Secret),
  [TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64]:
    requiredWhenTelegramEnabled(canonicalBase64Secret),
  [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]: Joi.when(
    'TELEGRAM_AUTH_ENABLED',
    {
      is: true,
      then: Joi.string()
        .pattern(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        )
        .required(),
      otherwise: Joi.string().allow('').default(''),
    },
  ),
  [TELEGRAM_LOGIN_CONFIG_KEYS.digestVersion]: Joi.number()
    .integer()
    .valid(TELEGRAM_LOOKUP_DIGEST_VERSION)
    .default(TELEGRAM_LOOKUP_DIGEST_VERSION),
  [TELEGRAM_LOGIN_CONFIG_KEYS.pepperVersion]: Joi.number()
    .integer()
    .valid(TELEGRAM_LOOKUP_PEPPER_VERSION)
    .default(TELEGRAM_LOOKUP_PEPPER_VERSION),
  [TELEGRAM_LOGIN_CONFIG_KEYS.operationTtlSeconds]: Joi.number()
    .integer()
    .valid(TELEGRAM_AUTH_OPERATION_TTL_SECONDS)
    .default(TELEGRAM_AUTH_OPERATION_TTL_SECONDS),
  [TELEGRAM_LOGIN_CONFIG_KEYS.sessionTtlSeconds]: Joi.number()
    .integer()
    .valid(TELEGRAM_SESSION_TTL_SECONDS)
    .default(TELEGRAM_SESSION_TTL_SECONDS),
});
