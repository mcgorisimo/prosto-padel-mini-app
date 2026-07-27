import {
  UnixEpochSeconds,
  isUnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import { isCanonicalSessionCredential } from './session-credential';

export const SESSION_LIFECYCLE_HTTP_CLOCK = Symbol(
  'SESSION_LIFECYCLE_HTTP_CLOCK',
);

export interface SessionLifecycleHttpClock {
  nowEpochSeconds(): UnixEpochSeconds;
}

export const SYSTEM_SESSION_LIFECYCLE_HTTP_CLOCK: SessionLifecycleHttpClock =
  Object.freeze({
    nowEpochSeconds(): UnixEpochSeconds {
      return unixEpochSeconds(Math.floor(Date.now() / 1_000));
    },
  });

export type SessionLifecycleHttpRequest = Readonly<{
  requestKey: string;
}>;

export type SessionRefreshHttpSuccessResponse = Readonly<{
  credential: string;
  expiresAt: UnixEpochSeconds;
}>;

export type SessionLifecyclePublicError = Readonly<{
  statusCode: number;
  code: string;
  message: string;
}>;

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

export function readSessionLifecycleHttpRequest(
  body: unknown,
): SessionLifecycleHttpRequest | undefined {
  if (
    !isRecord(body) ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, 'requestKey') ||
    !isInternalUuid(body.requestKey)
  ) {
    return undefined;
  }
  return Object.freeze({ requestKey: body.requestKey });
}

export function readSessionBearerCredential(
  authorization: unknown,
): string | undefined {
  if (typeof authorization !== 'string') {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);
  if (
    match === null ||
    !isCanonicalSessionCredential(match[1])
  ) {
    return undefined;
  }
  return match[1];
}

export function createSessionRefreshHttpSuccessResponse(
  credential: unknown,
  expiresAt: unknown,
  now: UnixEpochSeconds,
): SessionRefreshHttpSuccessResponse | undefined {
  if (
    !isCanonicalSessionCredential(credential) ||
    !isUnixEpochSeconds(expiresAt) ||
    expiresAt <= now
  ) {
    return undefined;
  }
  return Object.freeze({ credential, expiresAt });
}
