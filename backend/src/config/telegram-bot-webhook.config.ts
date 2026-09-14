import { ConfigService } from '@nestjs/config';
import { AccountId, isAccountId } from '../accounts/account.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import { TELEGRAM_NOTIFICATION_CONFIG_KEYS } from './telegram-notification.config';
import { TELEGRAM_LOGIN_CONFIG_KEYS } from './telegram-login.config';

export const TELEGRAM_BOT_WEBHOOK_CONFIG_KEYS = Object.freeze({
  enabled: 'TELEGRAM_BOT_WEBHOOK_ENABLED',
  secret: 'TELEGRAM_BOT_WEBHOOK_SECRET',
  allowedAccountId: 'TELEGRAM_BOT_WEBHOOK_ALLOWED_ACCOUNT_ID',
} as const);

export const TELEGRAM_BOT_WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;

export type TelegramBotWebhookConfiguration =
  | Readonly<{
      enabled: false;
      secret: '';
      miniAppUrl: '';
    }>
  | Readonly<{
      enabled: true;
      secret: string;
      miniAppUrl: string;
      allowedAccountId: AccountId;
      botNamespace: InternalUuid;
    }>;

function normalizeCanonicalMiniAppUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return undefined;
    }

    const canonical = url.toString();
    const normalizedRootWithoutSlash =
      url.pathname === '/' && value === url.origin;
    return canonical === value || normalizedRootWithoutSlash
      ? canonical
      : undefined;
  } catch {
    return undefined;
  }
}

export function readTelegramBotWebhookConfiguration(
  config: ConfigService,
): TelegramBotWebhookConfiguration {
  const enabled =
    config.get<boolean>(TELEGRAM_BOT_WEBHOOK_CONFIG_KEYS.enabled) === true;
  if (!enabled) {
    return Object.freeze({ enabled: false, secret: '', miniAppUrl: '' });
  }

  const secret =
    config.get<string>(TELEGRAM_BOT_WEBHOOK_CONFIG_KEYS.secret) ?? '';
  const miniAppUrl =
    config.get<string>(TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl) ?? '';
  const canonicalMiniAppUrl = normalizeCanonicalMiniAppUrl(miniAppUrl);
  const allowedAccountId = config.get<string>(
    TELEGRAM_BOT_WEBHOOK_CONFIG_KEYS.allowedAccountId,
  );
  const botNamespace = config.get<string>(
    TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace,
  );
  if (
    !TELEGRAM_BOT_WEBHOOK_SECRET_PATTERN.test(secret) ||
    canonicalMiniAppUrl === undefined ||
    !isAccountId(allowedAccountId) ||
    !isInternalUuid(botNamespace)
  ) {
    throw new Error('Telegram bot webhook configuration is invalid');
  }

  return Object.freeze({
    enabled: true,
    secret,
    miniAppUrl: canonicalMiniAppUrl,
    allowedAccountId,
    botNamespace,
  });
}
