import {
  UnixEpochSeconds,
  isUnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';

export const TELEGRAM_LOGIN_HTTP_CLOCK = Symbol(
  'TELEGRAM_LOGIN_HTTP_CLOCK',
);
export const TELEGRAM_INIT_DATA_MAX_UTF8_BYTES = 16_384;
export const TELEGRAM_LOGIN_REQUEST_KEY_MAX_LENGTH = 256;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export interface TelegramLoginHttpClock {
  nowEpochSeconds(): UnixEpochSeconds;
}

export type TelegramLoginHttpRequest = Readonly<{
  initData: string;
  requestKey: string;
}>;

export type TelegramLoginHttpSuccessResponse = Readonly<{
  credential: string;
  expiresAt: UnixEpochSeconds;
  accountKind: 'existing' | 'new';
}>;

export type TelegramLoginPublicError = Readonly<{
  statusCode: number;
  code: string;
  message: string;
}>;

export const SYSTEM_TELEGRAM_LOGIN_HTTP_CLOCK: TelegramLoginHttpClock =
  Object.freeze({
    nowEpochSeconds(): UnixEpochSeconds {
      return unixEpochSeconds(Math.floor(Date.now() / 1_000));
    },
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function readTelegramLoginHttpRequest(
  body: unknown,
): TelegramLoginHttpRequest | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const keys = Object.keys(body);
  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(body, 'initData') ||
    !Object.prototype.hasOwnProperty.call(body, 'requestKey') ||
    typeof body.initData !== 'string' ||
    body.initData.length === 0 ||
    Buffer.byteLength(body.initData, 'utf8') >
      TELEGRAM_INIT_DATA_MAX_UTF8_BYTES ||
    typeof body.requestKey !== 'string' ||
    body.requestKey.length === 0 ||
    body.requestKey.length > TELEGRAM_LOGIN_REQUEST_KEY_MAX_LENGTH ||
    body.requestKey.trim() !== body.requestKey ||
    CONTROL_CHARACTER_PATTERN.test(body.requestKey)
  ) {
    return undefined;
  }

  return Object.freeze({
    initData: body.initData,
    requestKey: body.requestKey,
  });
}

function isCanonicalSessionCredential(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value)
  ) {
    return false;
  }

  const decoded = Buffer.from(value, 'base64url');
  const valid =
    decoded.length === 32 && decoded.toString('base64url') === value;
  decoded.fill(0);
  return valid;
}

export function createTelegramLoginHttpSuccessResponse(
  credential: unknown,
  expiresAt: unknown,
  accountKind: unknown,
  now: UnixEpochSeconds,
): TelegramLoginHttpSuccessResponse | undefined {
  if (
    !isCanonicalSessionCredential(credential) ||
    !isUnixEpochSeconds(expiresAt) ||
    expiresAt <= now ||
    (accountKind !== 'existing' && accountKind !== 'new')
  ) {
    return undefined;
  }

  return Object.freeze({
    credential,
    expiresAt,
    accountKind,
  });
}
