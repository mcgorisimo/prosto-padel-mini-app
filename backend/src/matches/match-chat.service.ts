import { createHash } from 'node:crypto';
import {
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  encodeLengthPrefixedUtf8,
  uuidV5FromParts,
} from '../auth/crypto-encoding';
import { isUserGeneratedTextAllowed } from '../common/content-moderation';
import {
  MatchChatPersistenceError,
  MatchChatRepository,
  MatchChatSenderRecord,
} from '../database/match-chat.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  ListMatchMessagesApiInput,
  ListMatchMessagesApiResult,
  MatchChatApiActor,
  MatchChatApiRejection,
  MatchMessageResponse,
  MatchMessageSenderResponse,
  SendMatchMessageApiInput,
  SendMatchMessageApiResult,
} from './match-chat-api.types';
import {
  MatchMessageCommandId,
  MatchMessageId,
  MatchMessageRecord,
  MatchMessageRequestDigest,
  isCanonicalMatchMessageBody,
  isMatchMessageId,
  isMatchMessageRequestDigest,
} from './match-chat.types';
import { isMatchId } from './match.types';

const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const SEND_DOMAINS = Object.freeze({
  command: 'prosto-padel.match-chat.send.command.v1',
  message: 'prosto-padel.match-chat.send.message.v1',
  request: 'prosto-padel.match-chat.send.request.v1',
});

export interface MatchChatTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface MatchChatServiceDependencies {
  readonly transactions: MatchChatTransactionExecutor;
  readonly chat: MatchChatRepository;
  readonly clock: {
    nowEpochSeconds(): import('../auth/auth.types').UnixEpochSeconds;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validActor(value: unknown): value is MatchChatApiActor {
  return (
    isRecord(value) &&
    isAccountId(value.accountId) &&
    typeof value.role === 'string' &&
    USER_ROLES.includes(value.role as (typeof USER_ROLES)[number])
  );
}

function requestKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function rejected(reason: MatchChatApiRejection) {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function mapPersistence(error: unknown): MatchChatApiRejection {
  if (!(error instanceof MatchChatPersistenceError)) {
    return 'internal_failure';
  }
  switch (error.reason) {
    case 'invalid_input':
      return 'invalid_request';
    case 'database_unavailable':
    case 'transaction_conflict':
      return 'temporary_unavailable';
    case 'command_conflict':
      return 'request_conflict';
    case 'invalid_persisted_state':
    case 'permission_denied':
    case 'message_conflict':
    case 'referential_integrity':
    case 'storage_failure':
      return 'internal_failure';
  }
}

function mapRepositoryRejection(reason: string): MatchChatApiRejection {
  switch (reason) {
    case 'match_not_found':
    case 'match_closed':
      return reason;
    case 'command_reuse_conflict':
      return 'request_conflict';
    default:
      return 'internal_failure';
  }
}

function bindingUuid(domain: string, parts: readonly string[]) {
  return uuidV5FromParts(UUID_URL_NAMESPACE, [domain, ...parts]);
}

function sendDigest(parts: readonly string[]): MatchMessageRequestDigest {
  const digest = createHash('sha256')
    .update(
      encodeLengthPrefixedUtf8([SEND_DOMAINS.request, ...parts]),
    )
    .digest('hex');
  if (!isMatchMessageRequestDigest(digest)) {
    throw new TypeError('Match chat request binding is invalid');
  }
  return digest;
}

function safeSender(
  value: MatchChatSenderRecord,
): MatchMessageSenderResponse | undefined {
  if (
    isAccountId(value.senderAccountId) &&
    value.availability === 'unavailable'
  ) {
    return Object.freeze({ unavailable: true as const });
  }
  if (
    !isAccountId(value.senderAccountId) ||
    value.availability !== 'available' ||
    typeof value.firstName !== 'string' ||
    value.firstName.length < 1 ||
    typeof value.rating !== 'number' ||
    !Number.isFinite(value.rating) ||
    typeof value.isVerified !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    playerId: value.senderAccountId,
    firstName: value.firstName,
    ...(typeof value.lastName === 'string'
      ? { lastName: value.lastName }
      : {}),
    ...(typeof value.username === 'string'
      ? { username: value.username }
      : {}),
    rating: value.rating,
    isVerified: value.isVerified,
  });
}

async function enrichMessages(
  chat: Pick<MatchChatRepository, 'readSenders'>,
  transaction: PostgresTransaction,
  messages: readonly MatchMessageRecord[],
): Promise<readonly MatchMessageResponse[]> {
  const playerIds = [
    ...new Set(messages.map((message) => message.senderAccountId)),
  ];
  if (playerIds.length === 0) return Object.freeze([]);
  const found = await chat.readSenders(transaction, {
    senderAccountIds: playerIds,
  });
  const safe = found.senders.map((sender) => ({
    senderAccountId: sender.senderAccountId,
    response: safeSender(sender),
  }));
  if (
    safe.some(({ response }) => response === undefined) ||
    safe.length !== playerIds.length
  ) {
    throw new MatchChatPersistenceError('invalid_persisted_state');
  }
  const byId = new Map(
    safe.map(({ senderAccountId, response }) => [
      senderAccountId,
      response!,
    ] as const),
  );
  if (
    byId.size !== playerIds.length ||
    playerIds.some((playerId) => !byId.has(playerId))
  ) {
    throw new MatchChatPersistenceError('invalid_persisted_state');
  }
  return Object.freeze(
    messages.map((message) => {
      const sender = byId.get(message.senderAccountId);
      if (sender === undefined) {
        throw new MatchChatPersistenceError(
          'invalid_persisted_state',
        );
      }
      return Object.freeze({
        messageId: message.messageId,
        matchId: message.matchId,
        sender,
        body: message.body,
        createdAt: message.createdAt,
      });
    }),
  );
}

export class MatchChatService {
  constructor(readonly dependencies: MatchChatServiceDependencies) {}

  async list(
    input: ListMatchMessagesApiInput,
  ): Promise<ListMatchMessagesApiResult> {
    if (
      !validActor(input) ||
      !isMatchId(input.matchId) ||
      !Number.isInteger(input.request?.limit) ||
      input.request.limit < 1 ||
      input.request.limit > 50 ||
      (input.request.before !== undefined &&
        (!isUnixEpochSeconds(input.request.before.createdAt) ||
          !isMatchMessageId(input.request.before.messageId)))
    ) {
      return rejected('invalid_request');
    }
    try {
      return await this.dependencies.transactions.run(
        async (transaction) => {
          const result = await this.dependencies.chat.list(
            transaction,
            {
              matchId: input.matchId,
              actorAccountId: input.accountId,
              limit: input.request.limit,
              ...(input.request.before === undefined
                ? {}
                : { before: input.request.before }),
            },
          );
          if (result.outcome === 'rejected') {
            return rejected(mapRepositoryRejection(result.reason));
          }
          const messages = await enrichMessages(
            this.dependencies.chat,
            transaction,
            result.messages,
          );
          return Object.freeze({
            outcome: 'found' as const,
            messages,
            ...(result.nextCursor === undefined
              ? {}
              : { nextCursor: result.nextCursor }),
          });
        },
      );
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  async send(
    input: SendMatchMessageApiInput,
  ): Promise<SendMatchMessageApiResult> {
    if (
      !validActor(input) ||
      !isMatchId(input.matchId) ||
      !requestKey(input.request?.requestKey) ||
      !isCanonicalMatchMessageBody(input.request.body)
    ) {
      return rejected('invalid_request');
    }
    if (!isUserGeneratedTextAllowed(input.request.body)) {
      return rejected('content_not_allowed');
    }
    const parts = [
      input.request.requestKey,
      input.matchId,
      input.accountId,
    ];
    try {
      return await this.dependencies.transactions.run(
        async (transaction) => {
          const result = await this.dependencies.chat.send(
            transaction,
            {
              commandId: bindingUuid(
                SEND_DOMAINS.command,
                parts,
              ) as MatchMessageCommandId,
              messageId: bindingUuid(
                SEND_DOMAINS.message,
                parts,
              ) as MatchMessageId,
              matchId: input.matchId,
              actorAccountId: input.accountId,
              requestDigest: sendDigest([
                ...parts,
                input.request.body,
              ]),
              body: input.request.body,
              now: this.dependencies.clock.nowEpochSeconds(),
            },
          );
          if (result.outcome === 'rejected') {
            return rejected(mapRepositoryRejection(result.reason));
          }
          const [message] = await enrichMessages(
            this.dependencies.chat,
            transaction,
            [result.message],
          );
          if (message === undefined) {
            throw new MatchChatPersistenceError(
              'invalid_persisted_state',
            );
          }
          return Object.freeze({
            outcome: 'message_sent' as const,
            message,
          });
        },
      );
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }
}
