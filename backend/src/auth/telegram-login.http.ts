import { isInternalUuid } from '../common/internal-uuid';
import {
  UnixEpochSeconds,
  isUnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';

export const TELEGRAM_LOGIN_HTTP_CLOCK = Symbol(
  'TELEGRAM_LOGIN_HTTP_CLOCK',
);
export const TELEGRAM_SESSION_COOKIE_NAME =
  '__Host-prosto_padel_session';
export const TELEGRAM_INIT_DATA_MAX_UTF8_BYTES = 16_384;

export interface TelegramLoginHttpClock {
  nowEpochSeconds(): UnixEpochSeconds;
}

export type TelegramLoginHttpRequest = Readonly<{
  initData: string;
  requestKey: string;
}>;

export type TelegramLoginHttpSuccessResponse = Readonly<{
  authenticated: true;
  sessionExpiresAt: UnixEpochSeconds;
}>;

export type TelegramLoginPublicError = Readonly<{
  statusCode: number;
  code: string;
  message: string;
}>;

export type TelegramSessionCookie = Readonly<{
  credential: string;
  expires: Date;
  maxAge: number;
}>;

export const SYSTEM_TELEGRAM_LOGIN_HTTP_CLOCK: TelegramLoginHttpClock =
  Object.freeze({
    nowEpochSeconds(): UnixEpochSeconds {
      return unixEpochSeconds(Math.floor(Date.now() / 1_000));
    },
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readTelegramLoginHttpRequest(
  body: unknown,
  idempotencyKeyHeader: string | readonly string[] | undefined,
): TelegramLoginHttpRequest | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const keys = Object.keys(body);
  if (
    keys.length !== 1 ||
    keys[0] !== 'initData' ||
    typeof body.initData !== 'string' ||
    body.initData.length === 0 ||
    Buffer.byteLength(body.initData, 'utf8') >
      TELEGRAM_INIT_DATA_MAX_UTF8_BYTES ||
    typeof idempotencyKeyHeader !== 'string' ||
    !isInternalUuid(idempotencyKeyHeader)
  ) {
    return undefined;
  }

  return Object.freeze({
    initData: body.initData,
    requestKey: idempotencyKeyHeader,
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

export function createTelegramSessionCookie(
  credential: unknown,
  expiresAt: unknown,
  now: UnixEpochSeconds,
): TelegramSessionCookie | undefined {
  if (
    !isCanonicalSessionCredential(credential) ||
    !isUnixEpochSeconds(expiresAt) ||
    expiresAt <= now
  ) {
    return undefined;
  }

  const maxAge = expiresAt - now;
  const expiresAtMilliseconds = expiresAt * 1_000;
  if (
    !Number.isSafeInteger(maxAge) ||
    maxAge <= 0 ||
    !Number.isSafeInteger(expiresAtMilliseconds)
  ) {
    return undefined;
  }

  const expires = new Date(expiresAtMilliseconds);
  if (!Number.isFinite(expires.getTime())) {
    return undefined;
  }

  return Object.freeze({
    credential,
    expires,
    maxAge,
  });
}
