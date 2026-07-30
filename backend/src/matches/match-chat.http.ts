import { isUnixEpochSeconds } from '../auth/auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  ListMatchMessagesRequest,
  SendMatchMessageRequest,
} from './match-chat-api.types';
import {
  isCanonicalMatchMessageBody,
  isMatchMessageId,
} from './match-chat.types';
import { isMatchId } from './match.types';

const REQUEST_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function readEpoch(value: unknown) {
  if (
    typeof value !== 'string' ||
    !INTEGER_PATTERN.test(value)
  ) {
    return undefined;
  }
  const parsed = Number(value);
  return isUnixEpochSeconds(parsed) ? parsed : undefined;
}

export function readMatchMessagesRequest(
  value: unknown,
): ListMatchMessagesRequest | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        !['limit', 'beforeCreatedAt', 'beforeMessageId'].includes(key),
    )
  ) {
    return undefined;
  }

  const rawLimit = value.limit ?? '50';
  if (
    typeof rawLimit !== 'string' ||
    !/^(?:[1-9]|[1-4][0-9]|50)$/u.test(rawLimit)
  ) {
    return undefined;
  }

  const hasCreatedAt = value.beforeCreatedAt !== undefined;
  const hasMessageId = value.beforeMessageId !== undefined;
  if (hasCreatedAt !== hasMessageId) return undefined;
  if (!hasCreatedAt) {
    return Object.freeze({ limit: Number(rawLimit) });
  }

  const createdAt = readEpoch(value.beforeCreatedAt);
  if (
    createdAt === undefined ||
    !isMatchMessageId(value.beforeMessageId)
  ) {
    return undefined;
  }

  return Object.freeze({
    limit: Number(rawLimit),
    before: Object.freeze({
      createdAt,
      messageId: value.beforeMessageId,
    }),
  });
}

export function readSendMatchMessageRequest(
  value: unknown,
): SendMatchMessageRequest | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['requestKey', 'body']) ||
    typeof value.requestKey !== 'string' ||
    !REQUEST_KEY_PATTERN.test(value.requestKey) ||
    !isCanonicalMatchMessageBody(value.body)
  ) {
    return undefined;
  }
  return Object.freeze({
    requestKey: value.requestKey,
    body: value.body,
  });
}

export function readChatMatchId(value: unknown) {
  return isInternalUuid(value) && isMatchId(value) ? value : undefined;
}
