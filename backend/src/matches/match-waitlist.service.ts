import { createHash } from 'node:crypto';
import {
  AccountId,
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import { encodeLengthPrefixedUtf8, uuidV5FromParts } from '../auth/crypto-encoding';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchWaitlistPersistenceError,
  MatchWaitlistRepository,
  MatchWaitlistRejection,
} from '../database/match-waitlist.repository';
import { MatchNotificationRepository } from '../database/match-notification.repository';
import { TelegramNotificationIntentRepository } from '../database/telegram-notification-intent.repository';
import { MatchPersistenceError, MatchRepository } from '../database/match.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchRepository,
} from '../database/public-player-profile-search.repository';
import {
  ListMatchWaitlistApiInput,
  ListMatchWaitlistApiResult,
  MatchWaitlistApiActor,
  MatchWaitlistApiRejection,
  MatchWaitlistEntryResponse,
  MutateMatchWaitlistApiInput,
  MutateMatchWaitlistApiResult,
} from './match-waitlist-api.types';
import {
  MatchNotificationId,
} from './match-notification.types';
import {
  MatchWaitlistCommandId,
  MatchWaitlistEntryId,
  MatchWaitlistRequestDigest,
  isMatchWaitlistRequestDigest,
} from './match-waitlist.types';
import {
  MatchCommandId,
  MatchId,
  MatchParticipantId,
  MatchRequestDigest,
  isMatchId,
  isMatchRequestDigest,
} from './match.types';

const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const MAX_PROMOTION_ATTEMPTS = 8;
const DOMAINS = Object.freeze({
  join: Object.freeze({
    command: 'prosto-padel.match-waitlist.join.command.v1',
    entry: 'prosto-padel.match-waitlist.join.entry.v1',
    request: 'prosto-padel.match-waitlist.join.request.v1',
  }),
  leave: Object.freeze({
    command: 'prosto-padel.match-waitlist.leave.command.v1',
    request: 'prosto-padel.match-waitlist.leave.request.v1',
  }),
  promotion: Object.freeze({
    command: 'prosto-padel.match-waitlist.promotion.match-command.v1',
    notification:
      'prosto-padel.match-waitlist.promotion.notification.v1',
    participant: 'prosto-padel.match-waitlist.promotion.participant.v1',
    request: 'prosto-padel.match-waitlist.promotion.match-request.v1',
  }),
});

export interface MatchWaitlistTransactionExecutor {
  run<T>(operation: (transaction: PostgresTransaction) => Promise<T>): Promise<T>;
}

export interface MatchWaitlistServiceDependencies {
  readonly transactions: MatchWaitlistTransactionExecutor;
  readonly waitlist: MatchWaitlistRepository;
  readonly matches: MatchRepository;
  readonly notifications: Pick<
    MatchNotificationRepository,
    'createWaitlistPromotion'
  >;
  readonly notificationIntents: Pick<
    TelegramNotificationIntentRepository,
    'enqueueDirect' | 'enqueueMatchOwner'
  >;
  readonly publicProfiles: Pick<PublicPlayerProfileSearchRepository, 'findByPlayerIds'>;
  readonly clock: {
    nowEpochSeconds(): import('../auth/auth.types').UnixEpochSeconds;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: object, expected: readonly string[]) {
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === expected.length && expected.every((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  );
}

function validActor(value: unknown): value is MatchWaitlistApiActor {
  return isRecord(value) && isAccountId(value.accountId) &&
    typeof value.role === 'string' && USER_ROLES.includes(value.role as (typeof USER_ROLES)[number]);
}

function requestKey(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function bindingUuid(domain: string, parts: readonly string[]) {
  return uuidV5FromParts(UUID_URL_NAMESPACE, [domain, ...parts]);
}

function digest(domain: string, parts: readonly string[]) {
  return createHash('sha256')
    .update(encodeLengthPrefixedUtf8([domain, ...parts]))
    .digest('hex');
}

function waitlistDigest(domain: string, parts: readonly string[]): MatchWaitlistRequestDigest {
  const value = digest(domain, parts);
  if (!isMatchWaitlistRequestDigest(value)) throw new TypeError('Waitlist request binding is invalid');
  return value;
}

function matchDigest(domain: string, parts: readonly string[]): MatchRequestDigest {
  const value = digest(domain, parts);
  if (!isMatchRequestDigest(value)) throw new TypeError('Promotion request binding is invalid');
  return value;
}

function rejected(reason: MatchWaitlistApiRejection) {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function mapRepositoryRejection(reason: MatchWaitlistRejection): MatchWaitlistApiRejection {
  return reason === 'command_reuse_conflict' ? 'request_conflict' : reason;
}

function mapPersistence(error: unknown): MatchWaitlistApiRejection {
  if (error instanceof PublicPlayerProfileSearchPersistenceError) {
    return error.reason === 'database_unavailable' || error.reason === 'transaction_conflict'
      ? 'temporary_unavailable'
      : 'internal_failure';
  }
  if (error instanceof MatchPersistenceError) {
    return error.reason === 'database_unavailable' || error.reason === 'transaction_conflict'
      ? 'temporary_unavailable'
      : 'internal_failure';
  }
  if (!(error instanceof MatchWaitlistPersistenceError)) return 'internal_failure';
  switch (error.reason) {
    case 'invalid_input': return 'invalid_request';
    case 'database_unavailable':
    case 'transaction_conflict': return 'temporary_unavailable';
    case 'command_conflict': return 'request_conflict';
    case 'invalid_persisted_state':
    case 'entry_conflict':
    case 'referential_integrity':
    case 'permission_denied':
    case 'storage_failure': return 'internal_failure';
  }
}

function safePlayer(
  value: import('../database/public-player-profile-search.repository').PublicPlayerProfileRecord,
) {
  let safePhoto = value.photoUrl === undefined;
  if (typeof value.photoUrl === 'string' && value.photoUrl.length > 0 && [...value.photoUrl].length <= 2_048) {
    try {
      safePhoto = new URL(value.photoUrl).protocol === 'https:';
    } catch {
      safePhoto = false;
    }
  }
  if (
    !isAccountId(value.playerId) || typeof value.firstName !== 'string' || value.firstName.length < 1 ||
    typeof value.rating !== 'number' || !Number.isFinite(value.rating) || typeof value.isVerified !== 'boolean' ||
    !safePhoto
  ) return undefined;
  return Object.freeze({
    playerId: value.playerId,
    firstName: value.firstName,
    ...(typeof value.lastName === 'string' ? { lastName: value.lastName } : {}),
    ...(typeof value.username === 'string' ? { username: value.username } : {}),
    ...(typeof value.photoUrl === 'string' ? { photoUrl: value.photoUrl } : {}),
    rating: value.rating,
    isVerified: value.isVerified,
  });
}

export class MatchWaitlistService {
  constructor(readonly dependencies: MatchWaitlistServiceDependencies) {}

  async list(input: ListMatchWaitlistApiInput): Promise<ListMatchWaitlistApiResult> {
    if (
      !validActor(input) || !exactKeys(input, ['accountId', 'role', 'matchId', 'request']) ||
      !isMatchId(input.matchId) || !isRecord(input.request) ||
      !exactKeys(input.request, ['limit']) || !Number.isInteger(input.request.limit) ||
      input.request.limit < 1 || input.request.limit > 50
    ) return rejected('invalid_request');
    try {
      return await this.dependencies.transactions.run(async (transaction) => {
        const result = await this.dependencies.waitlist.list(transaction, {
          matchId: input.matchId,
          actorAccountId: input.accountId,
          limit: input.request.limit,
        });
        if (result.outcome === 'rejected') return rejected(mapRepositoryRejection(result.reason));
        const all = [...result.entries, ...(result.current === undefined ? [] : [result.current])];
        const uniqueIds = [...new Set(all.map((entry) => entry.accountId))];
        const profiles = uniqueIds.length === 0
          ? []
          : (await this.dependencies.publicProfiles.findByPlayerIds(transaction, { playerIds: uniqueIds })).players;
        const requestedIds = new Set(uniqueIds);
        const byId = new Map(profiles.map((profile) => [profile.playerId, safePlayer(profile)] as const));
        if (
          !Number.isSafeInteger(result.count) ||
          result.count < result.entries.length ||
          profiles.some(
            (profile) =>
              !requestedIds.has(profile.playerId) ||
              byId.get(profile.playerId) === undefined,
          ) ||
          byId.size !== profiles.length
        ) {
          throw new MatchWaitlistPersistenceError('invalid_persisted_state');
        }
        const response = (entry: (typeof all)[number]): MatchWaitlistEntryResponse => Object.freeze({
          entryId: entry.entryId,
          player: byId.get(entry.accountId) ?? Object.freeze({ unavailable: true as const }),
          queuePosition: entry.queuePosition,
          joinedAt: entry.joinedAt,
          isCurrentPlayer: entry.accountId === input.accountId,
        });
        const entries = result.entries.map(response);
        const current = result.current === undefined ? undefined : response(result.current);
        return Object.freeze({
          outcome: 'found' as const,
          entries: Object.freeze(entries),
          ...(current === undefined ? {} : { current }),
          count: result.count,
        });
      });
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  join(input: MutateMatchWaitlistApiInput): Promise<MutateMatchWaitlistApiResult> {
    return this.mutate('join', input);
  }

  leave(input: MutateMatchWaitlistApiInput): Promise<MutateMatchWaitlistApiResult> {
    return this.mutate('leave', input);
  }

  private async mutate(
    operation: 'join' | 'leave',
    input: MutateMatchWaitlistApiInput,
  ): Promise<MutateMatchWaitlistApiResult> {
    if (
      !validActor(input) || !exactKeys(input, ['accountId', 'role', 'matchId', 'request']) ||
      input.role !== 'player' || !isMatchId(input.matchId) || !isRecord(input.request) ||
      !exactKeys(input.request, ['requestKey']) || !requestKey(input.request.requestKey)
    ) return rejected(validActor(input) && input.role !== 'player' ? 'forbidden' : 'invalid_request');
    const parts = [input.accountId, input.matchId, input.request.requestKey];
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      const result = await this.dependencies.transactions.run((transaction) =>
        operation === 'join'
          ? this.dependencies.waitlist.join(transaction, {
              commandId: bindingUuid(DOMAINS.join.command, parts) as MatchWaitlistCommandId,
              entryId: bindingUuid(DOMAINS.join.entry, parts) as MatchWaitlistEntryId,
              matchId: input.matchId,
              actorAccountId: input.accountId,
              requestDigest: waitlistDigest(DOMAINS.join.request, parts),
              now,
            })
          : this.dependencies.waitlist.leave(transaction, {
              commandId: bindingUuid(DOMAINS.leave.command, parts) as MatchWaitlistCommandId,
              matchId: input.matchId,
              actorAccountId: input.accountId,
              requestDigest: waitlistDigest(DOMAINS.leave.request, parts),
              now,
            }),
      );
      if (result.outcome === 'rejected') return rejected(mapRepositoryRejection(result.reason));
      return Object.freeze({ outcome: result.outcome, entry: result.entry });
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  async promoteAvailable(
    transaction: PostgresTransaction,
    matchId: MatchId,
    now: UnixEpochSeconds,
  ): Promise<number> {
    if (!isMatchId(matchId) || !isUnixEpochSeconds(now)) {
      throw new MatchWaitlistPersistenceError('invalid_input');
    }
    let promoted = 0;
    for (let attempt = 0; attempt < MAX_PROMOTION_ATTEMPTS; attempt += 1) {
      const candidate = await this.dependencies.waitlist.readPromotionCandidate(transaction, { matchId, now });
      if (candidate.outcome !== 'candidate') return promoted;
      if (!candidate.playerIsActive) {
        await this.dependencies.waitlist.resolvePromotion(transaction, {
          entryId: candidate.entry.entryId,
          matchId,
          accountId: candidate.entry.accountId,
          outcome: 'skipped',
          now,
        });
        continue;
      }
      const parts = [candidate.entry.entryId, matchId, candidate.entry.accountId];
      const joined = await this.dependencies.matches.join(transaction, {
        type: 'join_match',
        matchId,
        commandId: bindingUuid(DOMAINS.promotion.command, parts) as MatchCommandId,
        actorAccountId: candidate.entry.accountId,
        participantId: bindingUuid(DOMAINS.promotion.participant, parts) as MatchParticipantId,
        requestDigest: matchDigest(DOMAINS.promotion.request, parts),
        now,
      });
      if (joined.outcome === 'participant_joined') {
        await this.dependencies.waitlist.resolvePromotion(transaction, {
          entryId: candidate.entry.entryId,
          matchId,
          accountId: candidate.entry.accountId,
          outcome: 'promoted',
          now,
        });
        const notificationId = bindingUuid(
          DOMAINS.promotion.notification,
          parts,
        ) as MatchNotificationId;
        await this.dependencies.notifications.createWaitlistPromotion(
          transaction,
          {
            notificationId,
            waitlistEntryId: candidate.entry.entryId,
            matchId,
            recipientAccountId: candidate.entry.accountId,
            now,
          },
        );
        await this.dependencies.notificationIntents.enqueueDirect(
          transaction,
          {
            eventKey: `waitlist_slot_available:${notificationId}`,
            eventType: 'waitlist_slot_available',
            category: 'match_activity',
            sourceId: notificationId,
            sourceVersion: 1,
            recipientAccountId: candidate.entry.accountId,
            matchId,
            occurredAt: now,
          },
        );
        await this.dependencies.notificationIntents.enqueueMatchOwner(
          transaction,
          {
            eventKey: `participant_joined:${bindingUuid(
              DOMAINS.promotion.command,
              parts,
            )}`,
            eventType: 'participant_joined',
            category: 'match_activity',
            sourceId: bindingUuid(DOMAINS.promotion.command, parts),
            sourceVersion: joined.matchVersion,
            matchId,
            occurredAt: now,
          },
        );
        promoted += 1;
        continue;
      }
      if (['owner_cannot_join', 'already_joined', 'invitation_pending', 'rating_verification_required', 'rating_out_of_range'].includes(joined.reason)) {
        await this.dependencies.waitlist.resolvePromotion(transaction, {
          entryId: candidate.entry.entryId,
          matchId,
          accountId: candidate.entry.accountId,
          outcome: 'skipped',
          now,
        });
        continue;
      }
      if (['match_not_found', 'match_closed', 'match_not_joinable', 'match_started', 'match_full'].includes(joined.reason)) {
        return promoted;
      }
      throw new MatchWaitlistPersistenceError('invalid_persisted_state');
    }
    return promoted;
  }

  closeForParticipant(
    transaction: PostgresTransaction,
    matchId: MatchId,
    accountId: AccountId,
    now: UnixEpochSeconds,
  ): Promise<boolean> {
    return this.dependencies.waitlist.resolveWaitingAccount(transaction, {
      matchId,
      accountId,
      now,
    });
  }
}
