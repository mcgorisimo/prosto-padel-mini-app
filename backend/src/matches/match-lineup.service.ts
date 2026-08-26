import { createHash } from 'node:crypto';
import { AccountId, USER_ROLES, isAccountId } from '../accounts/account.types';
import { encodeLengthPrefixedUtf8, uuidV5FromParts } from '../auth/crypto-encoding';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchLineupPersistenceError,
  MatchLineupRepository,
  MatchLineupRejection,
} from '../database/match-lineup.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchRepository,
} from '../database/public-player-profile-search.repository';
import { isInternalUuid } from '../common/internal-uuid';
import {
  AssignMatchLineupSlotApiInput,
  MatchLineupApiActor,
  MatchLineupApiRejection,
  MatchLineupPlayerResponse,
  MatchLineupResponse,
  MutateMatchLineupApiResult,
  ReadMatchLineupApiInput,
  ReadMatchLineupApiResult,
  ReleaseMatchLineupSlotApiInput,
} from './match-lineup-api.types';
import {
  MatchLineupAssignmentId,
  MatchLineupCommandId,
  MatchLineupRequestDigest,
  isMatchLineupRequestDigest,
} from './match-lineup.types';
import { MatchCommandId, MatchId, isMatchId } from './match.types';

const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const DOMAINS = Object.freeze({
  assign: Object.freeze({
    command: 'prosto-padel.match-lineup.assign.command.v1',
    assignment: 'prosto-padel.match-lineup.assign.assignment.v1',
    request: 'prosto-padel.match-lineup.assign.request.v1',
  }),
  release: Object.freeze({
    command: 'prosto-padel.match-lineup.release.command.v1',
    request: 'prosto-padel.match-lineup.release.request.v1',
  }),
  participantLeave: Object.freeze({
    command: 'prosto-padel.match-lineup.participant-leave.command.v1',
    request: 'prosto-padel.match-lineup.participant-leave.request.v1',
  }),
});

const SLOT_ORDER = Object.freeze([
  Object.freeze({ teamNumber: 1 as const, courtSide: 'left' as const }),
  Object.freeze({ teamNumber: 1 as const, courtSide: 'right' as const }),
  Object.freeze({ teamNumber: 2 as const, courtSide: 'left' as const }),
  Object.freeze({ teamNumber: 2 as const, courtSide: 'right' as const }),
]);

export interface MatchLineupTransactionExecutor {
  run<T>(operation: (transaction: PostgresTransaction) => Promise<T>): Promise<T>;
}

export interface MatchLineupServiceDependencies {
  readonly transactions: MatchLineupTransactionExecutor;
  readonly lineups: MatchLineupRepository;
  readonly publicProfiles: Pick<PublicPlayerProfileSearchRepository, 'findByPlayerIds'>;
  readonly clock: { nowEpochSeconds(): UnixEpochSeconds };
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

function validActor(value: unknown): value is MatchLineupApiActor {
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
  const value = createHash('sha256')
    .update(encodeLengthPrefixedUtf8([domain, ...parts]))
    .digest('hex');
  if (!isMatchLineupRequestDigest(value)) throw new TypeError('Lineup request binding is invalid');
  return value;
}

function rejected(reason: MatchLineupApiRejection) {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function mapRepositoryRejection(reason: MatchLineupRejection): MatchLineupApiRejection {
  return reason === 'command_reuse_conflict' ? 'request_conflict' : reason;
}

function mapPersistence(error: unknown): MatchLineupApiRejection {
  if (error instanceof PublicPlayerProfileSearchPersistenceError) {
    return error.reason === 'database_unavailable' || error.reason === 'transaction_conflict'
      ? 'temporary_unavailable'
      : 'internal_failure';
  }
  if (!(error instanceof MatchLineupPersistenceError)) return 'internal_failure';
  switch (error.reason) {
    case 'invalid_input': return 'invalid_request';
    case 'database_unavailable':
    case 'transaction_conflict': return 'temporary_unavailable';
    case 'command_conflict': return 'request_conflict';
    case 'invalid_persisted_state':
    case 'assignment_conflict':
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
    !isAccountId(value.playerId) ||
    typeof value.firstName !== 'string' ||
    value.firstName.length < 1 ||
    typeof value.rating !== 'number' ||
    !Number.isFinite(value.rating) ||
    typeof value.isVerified !== 'boolean' ||
    !safePhoto
  ) {
    return undefined;
  }
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

export class MatchLineupService {
  constructor(readonly dependencies: MatchLineupServiceDependencies) {}

  async read(input: ReadMatchLineupApiInput): Promise<ReadMatchLineupApiResult> {
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'matchId']) ||
      !isMatchId(input.matchId)
    ) {
      return rejected('invalid_request');
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      return await this.dependencies.transactions.run(async (transaction) => {
        const result = await this.dependencies.lineups.read(transaction, {
          matchId: input.matchId,
          actorAccountId: input.accountId,
          now,
        });
        if (result.outcome === 'rejected') return rejected(result.reason);
        const profileResult = await this.dependencies.publicProfiles.findByPlayerIds(transaction, {
          playerIds: result.lineup.eligibleAccountIds,
        });
        const requestedIds = new Set(result.lineup.eligibleAccountIds);
        const players = profileResult.players.map(safePlayer);
        if (
          players.some((player) => player === undefined) ||
          profileResult.players.some((profile) => !requestedIds.has(profile.playerId)) ||
          new Set(profileResult.players.map((profile) => profile.playerId)).size !== profileResult.players.length
        ) {
          throw new MatchLineupPersistenceError('invalid_persisted_state');
        }
        const byId = new Map(
          (players as Exclude<MatchLineupPlayerResponse, { readonly unavailable: true }>[])
            .map((player) => [player.playerId, player] as const),
        );
        const assignedIds = new Set(result.lineup.assignments.map((assignment) => assignment.accountId));
        const slots = SLOT_ORDER.map((slot) => {
          const assignment = result.lineup.assignments.find(
            (candidate) => candidate.teamNumber === slot.teamNumber && candidate.courtSide === slot.courtSide,
          );
          return Object.freeze({
            ...slot,
            ...(assignment === undefined ? {} : {
              assignment: Object.freeze({
                assignmentId: assignment.assignmentId,
                player: byId.get(assignment.accountId) ?? Object.freeze({ unavailable: true as const }),
                assignedAt: assignment.assignedAt,
                isCurrentPlayer: assignment.accountId === input.accountId,
              }),
            }),
          });
        });
        const lineup: MatchLineupResponse = Object.freeze({
          matchId: result.lineup.matchId,
          status: result.lineup.status,
          version: result.lineup.version,
          slots: Object.freeze(slots),
          unassignedPlayers: Object.freeze(
            result.lineup.eligibleAccountIds
              .filter((accountId) => !assignedIds.has(accountId))
              .map((accountId) => byId.get(accountId) ?? Object.freeze({ unavailable: true as const })),
          ),
        });
        return Object.freeze({ outcome: 'found' as const, lineup });
      });
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  assign(input: AssignMatchLineupSlotApiInput): Promise<MutateMatchLineupApiResult> {
    return this.mutate('assign', input);
  }

  release(input: ReleaseMatchLineupSlotApiInput): Promise<MutateMatchLineupApiResult> {
    return this.mutate('release', input);
  }

  private async mutate(
    operation: 'assign' | 'release',
    input: AssignMatchLineupSlotApiInput | ReleaseMatchLineupSlotApiInput,
  ): Promise<MutateMatchLineupApiResult> {
    const expectedRequestKeys = operation === 'assign'
      ? ['requestKey', 'teamNumber', 'courtSide']
      : ['requestKey'];
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'matchId', 'request']) ||
      input.role !== 'player' ||
      !isMatchId(input.matchId) ||
      !isRecord(input.request) ||
      !exactKeys(input.request, expectedRequestKeys) ||
      !requestKey(input.request.requestKey) ||
      (operation === 'assign' &&
        (!['left', 'right'].includes(String(input.request.courtSide)) ||
          ![1, 2].includes(input.request.teamNumber as number)))
    ) {
      return rejected(validActor(input) && input.role !== 'player' ? 'forbidden' : 'invalid_request');
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      const request = input.request;
      const commandParts = [input.accountId, input.matchId, request.requestKey];
      const requestParts = operation === 'assign'
        ? [...commandParts, String(request.teamNumber), String(request.courtSide)]
        : commandParts;
      const domain = DOMAINS[operation];
      const result = await this.dependencies.transactions.run((transaction) =>
        operation === 'assign'
          ? this.dependencies.lineups.assign(transaction, {
              commandId: bindingUuid(domain.command, commandParts) as MatchLineupCommandId,
              assignmentId: bindingUuid(DOMAINS.assign.assignment, commandParts) as MatchLineupAssignmentId,
              matchId: input.matchId,
              actorAccountId: input.accountId,
              requestDigest: digest(domain.request, requestParts),
              now,
              teamNumber: request.teamNumber as 1 | 2,
              courtSide: request.courtSide as 'left' | 'right',
            })
          : this.dependencies.lineups.release(transaction, {
              commandId: bindingUuid(domain.command, commandParts) as MatchLineupCommandId,
              matchId: input.matchId,
              actorAccountId: input.accountId,
              requestDigest: digest(domain.request, requestParts),
              now,
            }),
      );
      if (result.outcome === 'rejected') return rejected(mapRepositoryRejection(result.reason));
      return Object.freeze({ outcome: result.outcome, assignment: result.assignment });
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  releaseForParticipantLeave(
    transaction: PostgresTransaction,
    matchId: MatchId,
    accountId: AccountId,
    now: UnixEpochSeconds,
    sourceCommandId: MatchCommandId,
  ): Promise<boolean> {
    if (
      !isMatchId(matchId) ||
      !isAccountId(accountId) ||
      !isUnixEpochSeconds(now) ||
      !isInternalUuid(sourceCommandId)
    ) {
      throw new MatchLineupPersistenceError('invalid_input');
    }
    const parts = [accountId, matchId, sourceCommandId];
    return this.dependencies.lineups.releaseForParticipantLeave(transaction, {
      commandId: bindingUuid(DOMAINS.participantLeave.command, parts) as MatchLineupCommandId,
      matchId,
      actorAccountId: accountId,
      requestDigest: digest(DOMAINS.participantLeave.request, parts) as MatchLineupRequestDigest,
      now,
    });
  }
}
