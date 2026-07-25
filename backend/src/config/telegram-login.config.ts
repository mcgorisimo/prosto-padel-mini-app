export const TELEGRAM_LOGIN_CONFIG_KEYS = Object.freeze({
  lookupPepperBase64: 'TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64',
  workflowHmacSecretBase64:
    'TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64',
  uuidNamespace: 'TELEGRAM_LOGIN_UUID_NAMESPACE',
  digestVersion: 'TELEGRAM_LOOKUP_DIGEST_VERSION',
  pepperVersion: 'TELEGRAM_LOOKUP_PEPPER_VERSION',
  operationTtlSeconds: 'TELEGRAM_AUTH_OPERATION_TTL_SECONDS',
  sessionTtlSeconds: 'TELEGRAM_SESSION_TTL_SECONDS',
});

export const TELEGRAM_LOOKUP_DIGEST_VERSION = 1;
export const TELEGRAM_LOOKUP_PEPPER_VERSION = 1;
export const TELEGRAM_AUTH_OPERATION_TTL_SECONDS = 300;
export const TELEGRAM_SESSION_TTL_SECONDS = 2_592_000;
export const TELEGRAM_CRYPTO_SECRET_MINIMUM_BYTES = 32;

export function decodeTelegramCryptoSecret(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Telegram login crypto configuration is invalid');
  }

  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length < TELEGRAM_CRYPTO_SECRET_MINIMUM_BYTES ||
    decoded.toString('base64') !== value
  ) {
    decoded.fill(0);
    throw new Error('Telegram login crypto configuration is invalid');
  }

  return decoded;
}
