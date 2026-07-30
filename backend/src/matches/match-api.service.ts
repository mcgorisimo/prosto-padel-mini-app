import { createHash } from 'node:crypto';
import {
  AccountId,
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import {
  encodeLengthPrefixedUtf8,
  uuidV5FromParts,
} from '../auth/crypto-encoding';
import {
  isUnixEpochSeconds,
} from '../auth/auth.types';
import {
  MatchDetailRecord,
  MatchFeedRecord,
  CreateMatchPersistenceInput,
  MatchPersistenceError,
  MatchRepository,
} from '../database/match.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchRepository,
} from '../database/public-player-profile-search.repository';
import {
  MatchCommandId,
  MatchId,
  MatchParticipantId,
  MatchRequestDigest,
  isMatchId,
  isMatchRequestDigest,
} from './match.types';
import {
  CreateMatchApiResult,
  CreateMatchInput,
  ListMatchFeedApiResult,
  ListMatchFeedInput,
  MatchApiActor,
  MatchApiRejection,
  MatchDetailResponse,
  MatchFeedResponse,
  MatchParticipationResponse,
  MatchPublicPlayerResponse,
  MutateMatchParticipationApiResult,
  MutateMatchParticipationInput,
  ReadMatchDetailApiResult,
  ReadMatchDetailInput,
} from './match-api.types';
import {
  readCreateMatchRequest,
  readMatchActionRequest,
} from './match-api.http';

const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const BINDING_DOMAINS = Object.freeze({
  create: Object.freeze({
    match: 'prosto-padel.matches.create.match.v1',
    command: 'prosto-padel.matches.create.command.v1',
    request: 'prosto-padel.matches.create.request.v1',
  }),
  join: Object.freeze({
    participant: 'prosto-padel.matches.join.participant.v1',
    command: 'prosto-padel.matches.join.command.v1',
    request: 'prosto-padel.matches.join.request.v1',
  }),
  leave: Object.freeze({
    command: 'prosto-padel.matches.leave.command.v1',
    request: 'prosto-padel.matches.leave.request.v1',
  }),
} as const);

export interface MatchApiTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}
export interface MatchApiServiceDependencies {
  readonly transactions: MatchApiTransactionExecutor;
  readonly matches: MatchRepository;
  readonly publicProfiles: Pick<
    PublicPlayerProfileSearchRepository,
    'findByPlayerIds'
  >;
  readonly clock: {
    nowEpochSeconds(): import('../auth/auth.types').UnixEpochSeconds;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
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

function validActor(
  value: unknown,
): value is Record<string, unknown> & MatchApiActor {
  return (
    isRecord(value) &&
    isAccountId(value.accountId) &&
    typeof value.role === 'string' &&
    USER_ROLES.includes(value.role as (typeof USER_ROLES)[number])
  );
}

function requestDigest(parts: readonly string[]): MatchRequestDigest {
  const digest = createHash('sha256')
    .update(encodeLengthPrefixedUtf8(parts))
    .digest('hex');
  if (!isMatchRequestDigest(digest)) {
    throw new TypeError('Match request binding is invalid');
  }
  return digest;
}

function bindingUuid(
  domain: string,
  parts: readonly string[],
): ReturnType<typeof uuidV5FromParts> {
  return uuidV5FromParts(UUID_URL_NAMESPACE, [domain, ...parts]);
}

function rejected(reason: MatchApiRejection): {
  readonly outcome: 'rejected';
  readonly reason: MatchApiRejection;
} {
  return Object.freeze({ outcome: 'rejected', reason });
}

function mapRepositoryRejection(
  reason: string,
): MatchApiRejection {
  switch (reason) {
    case 'command_reuse_conflict':
      return 'request_conflict';
    case 'court_invalid':
      return 'invalid_request';
    case 'match_not_found':
    case 'match_closed':
    case 'match_not_joinable':
    case 'match_started':
    case 'rating_verification_required':
    case 'rating_out_of_range':
    case 'owner_cannot_join':
    case 'already_joined':
    case 'invitation_pending':
    case 'match_full':
    case 'participant_not_active':
      return reason;
    default:
      return 'internal_failure';
  }
}

function mapPersistenceFailure(error: unknown): MatchApiRejection {
  if (error instanceof PublicPlayerProfileSearchPersistenceError) {
    switch (error.reason) {
      case 'database_unavailable':
      case 'transaction_conflict':
        return 'temporary_unavailable';
      case 'invalid_input':
      case 'invalid_persisted_state':
      case 'permission_denied':
      case 'storage_failure':
        return 'internal_failure';
    }
  }
  if (!(error instanceof MatchPersistenceError)) {
    return 'internal_failure';
  }
  switch (error.reason) {
    case 'database_unavailable':
    case 'transaction_conflict':
      return 'temporary_unavailable';
    case 'command_conflict':
      return 'request_conflict';
    case 'match_conflict':
      return 'match_conflict';
    case 'invalid_input':
      return 'invalid_request';
    case 'invalid_persisted_state':
    case 'referential_integrity':
    case 'permission_denied':
    case 'storage_failure':
      return 'internal_failure';
  }
}

function invalidReadModel(): MatchPersistenceError {
  return new MatchPersistenceError('invalid_persisted_state');
}

function optionalSafeText(
  value: unknown,
  maximum: number,
): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length > 0 &&
      [...value].length <= maximum)
  );
}

function isSafePrice(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= 1_000_000 &&
      Number(value.toFixed(2)) === value)
  );
}

function isOptionalRatingLevel(
  value: unknown,
): value is number | undefined {
  return (
    value === undefined ||
    (Number.isInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= 6)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function safePublicPlayer(
  value: unknown,
): MatchPublicPlayerResponse | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ['playerId', 'firstName', 'rating', 'isVerified'],
      ['lastName', 'username'],
    ) ||
    !isAccountId(value.playerId) ||
    typeof value.firstName !== 'string' ||
    value.firstName.length === 0 ||
    [...value.firstName].length > 256 ||
    !optionalSafeText(value.lastName, 256) ||
    !optionalSafeText(value.username, 64) ||
    typeof value.rating !== 'number' ||
    !Number.isFinite(value.rating) ||
    value.rating < 0 ||
    value.rating > 10 ||
    Number(value.rating.toFixed(2)) !== value.rating ||
    typeof value.isVerified !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    playerId: value.playerId,
    firstName: value.firstName,
    ...(value.lastName === undefined
      ? {}
      : { lastName: value.lastName }),
    ...(value.username === undefined
      ? {}
      : { username: value.username }),
    rating: value.rating,
    isVerified: value.isVerified,
  });
}

function publicPlayerIds(
  records: readonly (MatchDetailRecord | MatchFeedRecord)[],
): readonly AccountId[] {
  return Object.freeze([
    ...new Set(
      records.flatMap((record) => [
        record.ownerAccountId,
        ...record.participants.map(
          (participant) => participant.playerId,
        ),
      ]),
    ),
  ]);
}

async function readPublicPlayers(
  dependency: MatchApiServiceDependencies['publicProfiles'],
  transaction: PostgresTransaction,
  records: readonly (MatchDetailRecord | MatchFeedRecord)[],
): Promise<ReadonlyMap<AccountId, MatchPublicPlayerResponse>> {
  const playerIds = publicPlayerIds(records);
  if (playerIds.length < 1 || playerIds.length > 200) {
    throw invalidReadModel();
  }
  const result = await dependency.findByPlayerIds(transaction, {
    playerIds,
  });
  if (
    !isRecord(result) ||
    result.outcome !== 'found' ||
    !Array.isArray(result.players) ||
    result.players.length !== playerIds.length
  ) {
    throw invalidReadModel();
  }
  const players = result.players.map((player) =>
    safePublicPlayer(player),
  );
  if (players.some((player) => player === undefined)) {
    throw invalidReadModel();
  }
  const byId = new Map(
    (players as MatchPublicPlayerResponse[]).map((player) => [
      player.playerId,
      player,
    ]),
  );
  if (
    byId.size !== playerIds.length ||
    playerIds.some((playerId) => !byId.has(playerId))
  ) {
    throw invalidReadModel();
  }
  return byId;
}

function enrichDetail(
  record: MatchDetailRecord,
  players: ReadonlyMap<AccountId, MatchPublicPlayerResponse>,
): MatchDetailResponse {
  const owner = players.get(record.ownerAccountId);
  const participants = record.participants.map((participant) => {
    const player = players.get(participant.playerId);
    if (player === undefined) {
      throw invalidReadModel();
    }
    return Object.freeze({
      ...player,
      slotNumber: participant.slotNumber,
    });
  });
  if (owner === undefined) {
    throw invalidReadModel();
  }
  return Object.freeze({
    ...record,
    owner,
    participants: Object.freeze(participants),
  });
}

function enrichFeed(
  record: MatchFeedRecord,
  players: ReadonlyMap<AccountId, MatchPublicPlayerResponse>,
): MatchFeedResponse {
  const owner = players.get(record.ownerAccountId);
  const participants = record.participants.map((participant) => {
    const player = players.get(participant.playerId);
    if (player === undefined) {
      throw invalidReadModel();
    }
    return Object.freeze({
      ...player,
      slotNumber: participant.slotNumber,
    });
  });
  if (owner === undefined) {
    throw invalidReadModel();
  }
  return Object.freeze({
    ...record,
    owner,
    participants: Object.freeze(participants),
  });
}

function safeMatchDetail(value: unknown): MatchDetailRecord | undefined {
  if (
    !isRecord(value) ||
    !isMatchId(value.matchId) ||
    !isAccountId(value.ownerAccountId) ||
    !isUnixEpochSeconds(value.createdAt) ||
    !isUnixEpochSeconds(value.updatedAt) ||
    !isUnixEpochSeconds(value.startsAt) ||
    ![60, 90, 120, 150].includes(value.durationMinutes as number) ||
    typeof value.courtId !== 'string' ||
    typeof value.courtName !== 'string' ||
    typeof value.courtType !== 'string' ||
    !['match', 'private'].includes(value.kind as string) ||
    !['public', 'private'].includes(value.visibility as string) ||
    !['community', 'social', 'private'].includes(
      value.scenario as string,
    ) ||
    ![
      'open',
      'searching',
      'confirmed',
      'upcoming',
      'completed',
      'cancelled',
    ].includes(value.status as string) ||
    !optionalSafeText(value.title, 160) ||
    typeof value.description !== 'string' ||
    !isOptionalRatingLevel(value.ratingMin) ||
    !isOptionalRatingLevel(value.ratingMax) ||
    typeof value.isRatingMatch !== 'boolean' ||
    !isSafePrice(value.pricePerPersonSnapshot) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    (value.terminalAt !== undefined &&
      !isUnixEpochSeconds(value.terminalAt)) ||
    !Array.isArray(value.participants) ||
    value.participants.length > 3
  ) {
    return undefined;
  }
  const participants = value.participants.map((participant) => {
    if (
      !isRecord(participant) ||
      !isAccountId(participant.playerId) ||
      ![2, 3, 4].includes(participant.slotNumber as number)
    ) {
      return undefined;
    }
    return Object.freeze({
      playerId: participant.playerId,
      slotNumber: participant.slotNumber as 2 | 3 | 4,
    });
  });
  if (
    participants.some((participant) => participant === undefined) ||
    new Set(
      participants.map((participant) => participant?.playerId),
    ).size !== participants.length
  ) {
    return undefined;
  }
  const ratingMin =
    value.ratingMin === undefined ? undefined : value.ratingMin;
  const ratingMax =
    value.ratingMax === undefined ? undefined : value.ratingMax;
  if (
    ratingMin !== undefined &&
    ratingMax !== undefined &&
    ratingMin > ratingMax
  ) {
    return undefined;
  }
  if (
    value.kind === 'private'
      ? value.visibility !== 'private' ||
        value.scenario !== 'private' ||
        ratingMin !== undefined ||
        ratingMax !== undefined ||
        value.isRatingMatch !== false
      : value.visibility !== 'public' ||
        value.scenario === 'private' ||
        ratingMin === undefined ||
        ratingMax === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    matchId: value.matchId,
    ownerAccountId: value.ownerAccountId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    startsAt: value.startsAt,
    durationMinutes: value.durationMinutes as 60 | 90 | 120 | 150,
    courtId: value.courtId,
    courtName: value.courtName,
    courtType: value.courtType,
    kind: value.kind as MatchDetailRecord['kind'],
    visibility: value.visibility as MatchDetailRecord['visibility'],
    scenario: value.scenario as MatchDetailRecord['scenario'],
    status: value.status as MatchDetailRecord['status'],
    ...(value.title === undefined ? {} : { title: value.title }),
    description: value.description,
    ...(ratingMin === undefined
      ? {}
      : { ratingMin: ratingMin as number }),
    ...(ratingMax === undefined
      ? {}
      : { ratingMax: ratingMax as number }),
    isRatingMatch: value.isRatingMatch,
    ...(value.pricePerPersonSnapshot === undefined
      ? {}
      : { pricePerPersonSnapshot: value.pricePerPersonSnapshot }),
    version: value.version as number,
    ...(value.terminalAt === undefined
      ? {}
      : { terminalAt: value.terminalAt }),
    participants: Object.freeze(
      participants as MatchDetailRecord['participants'],
    ),
  });
}

function safeFeedRecord(
  value: unknown,
  now: import('../auth/auth.types').UnixEpochSeconds,
): MatchFeedRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const detail = safeMatchDetail({
    ...value,
    createdAt: value.startsAt,
    updatedAt: value.startsAt,
    kind: 'match',
    visibility: 'public',
    description: '',
    participants: value.participants,
  });
  if (
    detail === undefined ||
    detail.scenario === 'private' ||
    !['open', 'searching', 'confirmed', 'upcoming'].includes(
      detail.status,
    ) ||
    detail.startsAt <= now ||
    !Number.isInteger(value.occupiedSlots) ||
    (value.occupiedSlots as number) < 1 ||
    (value.occupiedSlots as number) > 4 ||
    value.ratingMin === undefined ||
    value.ratingMax === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    matchId: detail.matchId,
    ownerAccountId: detail.ownerAccountId,
    startsAt: detail.startsAt,
    durationMinutes: detail.durationMinutes,
    courtId: detail.courtId,
    courtName: detail.courtName,
    courtType: detail.courtType,
    scenario: detail.scenario,
    status: detail.status,
    ...(detail.title === undefined ? {} : { title: detail.title }),
    ratingMin: value.ratingMin as number,
    ratingMax: value.ratingMax as number,
    isRatingMatch: detail.isRatingMatch,
    ...(detail.pricePerPersonSnapshot === undefined
      ? {}
      : {
          pricePerPersonSnapshot:
            detail.pricePerPersonSnapshot,
        }),
    occupiedSlots: value.occupiedSlots as number,
    version: detail.version,
    participants: detail.participants,
  });
}

function validReadInput(
  value: unknown,
): value is ReadMatchDetailInput {
  return (
    validActor(value) &&
    isRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role', 'matchId']) &&
    isMatchId(value.matchId)
  );
}

function participation(
  matchId: MatchId,
  actorAccountId: CreateMatchInput['accountId'],
  value: unknown,
  matchVersion: unknown,
  status: 'active' | 'left',
): MatchParticipationResponse | undefined {
  if (
    !isRecord(value) ||
    value.accountId !== actorAccountId ||
    value.status !== status ||
    ![2, 3, 4].includes(value.slotNumber as number) ||
    !Number.isSafeInteger(matchVersion) ||
    (matchVersion as number) < 1
  ) {
    return undefined;
  }
  return Object.freeze({
    matchId,
    playerId: actorAccountId,
    slotNumber: value.slotNumber as 2 | 3 | 4,
    status,
    matchVersion: matchVersion as number,
  });
}

export class MatchApiService {
  constructor(readonly dependencies: MatchApiServiceDependencies) {}

  async create(input: CreateMatchInput): Promise<CreateMatchApiResult> {
    const request = readCreateMatchRequest(input.request);
    if (
      !validActor(input) ||
      !hasExactlyKeys(input, ['accountId', 'role', 'request']) ||
      input.role !== 'player' ||
      request === undefined
    ) {
      return rejected(
        validActor(input) && input.role !== 'player'
          ? 'forbidden'
          : 'invalid_request',
      );
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) {
        return rejected('invalid_request');
      }
      const idParts = [input.accountId, request.requestKey];
      const matchId = bindingUuid(
        BINDING_DOMAINS.create.match,
        idParts,
      ) as MatchId;
      const commandId = bindingUuid(
        BINDING_DOMAINS.create.command,
        idParts,
      ) as MatchCommandId;
      const digest = requestDigest([
        BINDING_DOMAINS.create.request,
        request.requestKey,
        input.accountId,
        String(request.startsAt),
        String(request.durationMinutes),
        request.courtId ?? '',
        request.scenario,
        request.title ?? '',
        request.description,
        request.ratingMin === undefined
          ? ''
          : String(request.ratingMin),
        request.ratingMax === undefined
          ? ''
          : String(request.ratingMax),
        String(request.isRatingMatch),
      ]);
      const command: CreateMatchPersistenceInput = Object.freeze({
        type: 'create_match',
        matchId,
        commandId,
        actorAccountId: input.accountId,
        requestDigest: digest,
        now,
        startsAt: request.startsAt,
        durationMinutes: request.durationMinutes,
        ...(request.courtId === undefined
          ? {}
          : { courtId: request.courtId }),
        kind: request.scenario === 'private' ? 'private' : 'match',
        visibility:
          request.scenario === 'private' ? 'private' : 'public',
        scenario: request.scenario,
        status:
          request.scenario === 'private'
            ? 'upcoming'
            : request.scenario === 'community'
              ? 'searching'
              : 'confirmed',
        ...(request.title === undefined
          ? {}
          : { title: request.title }),
        description: request.description,
        ...(request.ratingMin === undefined
          ? {}
          : { ratingMin: request.ratingMin }),
        ...(request.ratingMax === undefined
          ? {}
          : { ratingMax: request.ratingMax }),
        isRatingMatch: request.isRatingMatch,
      });
      const completed = await this.dependencies.transactions.run(
        async (transaction) => {
          const result = await this.dependencies.matches.create(
            transaction,
            command,
          );
          if (result.outcome === 'rejected') {
            return Object.freeze({ result });
          }
          const record = safeMatchDetail(result.match);
          if (
            record === undefined ||
            record.matchId !== matchId ||
            record.ownerAccountId !== input.accountId
          ) {
            throw invalidReadModel();
          }
          const players = await readPublicPlayers(
            this.dependencies.publicProfiles,
            transaction,
            [record],
          );
          return Object.freeze({
            result,
            match: enrichDetail(record, players),
          });
        },
      );
      if (completed.result.outcome === 'rejected') {
        return rejected(
          mapRepositoryRejection(completed.result.reason),
        );
      }
      if (!('match' in completed)) {
        return rejected('internal_failure');
      }
      return Object.freeze({
        outcome: 'created',
        match: completed.match,
      });
    } catch (error) {
      return rejected(
        mapPersistenceFailure(error),
      );
    }
  }

  async list(
    input: ListMatchFeedInput,
  ): Promise<ListMatchFeedApiResult> {
    if (
      !validActor(input) ||
      !hasExactlyKeys(input, ['accountId', 'role', 'request']) ||
      !isRecord(input.request) ||
      !hasExactlyKeys(input.request, ['limit']) ||
      !Number.isInteger(input.request.limit) ||
      input.request.limit < 1 ||
      input.request.limit > 50
    ) {
      return rejected('invalid_request');
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) {
        return rejected('internal_failure');
      }
      const matches = await this.dependencies.transactions.run(
        async (transaction) => {
          const records =
            await this.dependencies.matches.listPublicFeed(transaction, {
              now,
              limit: input.request.limit,
            });
          if (
            !Array.isArray(records) ||
            records.length > input.request.limit
          ) {
            throw invalidReadModel();
          }
          const safeRecords = records.map((record) =>
            safeFeedRecord(record, now),
          );
          if (
            safeRecords.some((match) => match === undefined) ||
            new Set(
              safeRecords.map((match) => match?.matchId),
            ).size !== safeRecords.length
          ) {
            throw invalidReadModel();
          }
          if (safeRecords.length === 0) {
            return Object.freeze([]) as readonly MatchFeedResponse[];
          }
          const typedRecords = safeRecords as MatchFeedRecord[];
          const players = await readPublicPlayers(
            this.dependencies.publicProfiles,
            transaction,
            typedRecords,
          );
          return Object.freeze(
            typedRecords.map((record) => enrichFeed(record, players)),
          );
        },
      );
      return Object.freeze({
        outcome: 'found',
        matches,
      });
    } catch (error) {
      return rejected(
        mapPersistenceFailure(error),
      );
    }
  }

  async listMine(
    input: ListMatchFeedInput,
  ): Promise<ListMatchFeedApiResult> {
    if (
      !validActor(input) ||
      !hasExactlyKeys(input, ['accountId', 'role', 'request']) ||
      !isRecord(input.request) ||
      !hasExactlyKeys(input.request, ['limit']) ||
      !Number.isInteger(input.request.limit) ||
      input.request.limit < 1 ||
      input.request.limit > 50
    ) {
      return rejected('invalid_request');
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) {
        return rejected('internal_failure');
      }
      const matches = await this.dependencies.transactions.run(
        async (transaction) => {
          const records =
            await this.dependencies.matches.listAccountFeed(transaction, {
              accountId: input.accountId,
              now,
              limit: input.request.limit,
            });
          if (
            !Array.isArray(records) ||
            records.length > input.request.limit
          ) {
            throw invalidReadModel();
          }
          const safeRecords = records.map((record) =>
            safeFeedRecord(record, now),
          );
          if (
            safeRecords.some((match) => match === undefined) ||
            new Set(
              safeRecords.map((match) => match?.matchId),
            ).size !== safeRecords.length ||
            safeRecords.some(
              (match) =>
                match?.ownerAccountId !== input.accountId &&
                !match?.participants.some(
                  (participant) =>
                    participant.playerId === input.accountId,
                ),
            )
          ) {
            throw invalidReadModel();
          }
          if (safeRecords.length === 0) {
            return Object.freeze([]) as readonly MatchFeedResponse[];
          }
          const typedRecords = safeRecords as MatchFeedRecord[];
          const players = await readPublicPlayers(
            this.dependencies.publicProfiles,
            transaction,
            typedRecords,
          );
          return Object.freeze(
            typedRecords.map((record) => enrichFeed(record, players)),
          );
        },
      );
      return Object.freeze({
        outcome: 'found',
        matches,
      });
    } catch (error) {
      return rejected(
        mapPersistenceFailure(error),
      );
    }
  }

  async detail(
    input: ReadMatchDetailInput,
  ): Promise<ReadMatchDetailApiResult> {
    if (!validReadInput(input)) {
      return rejected('invalid_request');
    }
    try {
      const match = await this.dependencies.transactions.run(
        async (transaction) => {
          const record =
            await this.dependencies.matches.findVisibleById(transaction, {
              matchId: input.matchId,
              viewerAccountId: input.accountId,
            });
          if (record === null) {
            return null;
          }
          const safeRecord = safeMatchDetail(record);
          if (
            safeRecord === undefined ||
            safeRecord.matchId !== input.matchId
          ) {
            throw invalidReadModel();
          }
          const players = await readPublicPlayers(
            this.dependencies.publicProfiles,
            transaction,
            [safeRecord],
          );
          return enrichDetail(safeRecord, players);
        },
      );
      if (match === null) {
        return rejected('match_not_found');
      }
      return Object.freeze({ outcome: 'found', match });
    } catch (error) {
      return rejected(
        mapPersistenceFailure(error),
      );
    }
  }

  async join(
    input: MutateMatchParticipationInput,
  ): Promise<MutateMatchParticipationApiResult> {
    return this.mutateParticipation('join', input);
  }

  async leave(
    input: MutateMatchParticipationInput,
  ): Promise<MutateMatchParticipationApiResult> {
    return this.mutateParticipation('leave', input);
  }

  private async mutateParticipation(
    operation: 'join' | 'leave',
    input: MutateMatchParticipationInput,
  ): Promise<MutateMatchParticipationApiResult> {
    const request = readMatchActionRequest(input.request);
    if (
      !validActor(input) ||
      !hasExactlyKeys(input, [
        'accountId',
        'role',
        'matchId',
        'request',
      ]) ||
      input.role !== 'player' ||
      !isMatchId(input.matchId) ||
      request === undefined
    ) {
      return rejected(
        validActor(input) && input.role !== 'player'
          ? 'forbidden'
          : 'invalid_request',
      );
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) {
        return rejected(
          'internal_failure',
        );
      }
      const parts = [
        input.accountId,
        input.matchId,
        request.requestKey,
      ];
      const commandId = bindingUuid(
        BINDING_DOMAINS[operation].command,
        parts,
      ) as MatchCommandId;
      const digest = requestDigest([
        BINDING_DOMAINS[operation].request,
        request.requestKey,
        input.accountId,
        input.matchId,
      ]);
      const result =
        operation === 'join'
          ? await this.dependencies.transactions.run((transaction) =>
              this.dependencies.matches.join(transaction, {
                type: 'join_match',
                matchId: input.matchId,
                commandId,
                actorAccountId: input.accountId,
                participantId: bindingUuid(
                  BINDING_DOMAINS.join.participant,
                  parts,
                ) as MatchParticipantId,
                requestDigest: digest,
                now,
              }),
            )
          : await this.dependencies.transactions.run((transaction) =>
              this.dependencies.matches.leave(transaction, {
                type: 'leave_match',
                matchId: input.matchId,
                commandId,
                actorAccountId: input.accountId,
                requestDigest: digest,
                now,
              }),
            );
      if (result.outcome === 'rejected') {
        return rejected(
          mapRepositoryRejection(result.reason),
        );
      }
      const safeParticipant = participation(
        input.matchId,
        input.accountId,
        result.participant,
        result.matchVersion,
        operation === 'join' ? 'active' : 'left',
      );
      if (safeParticipant === undefined) {
        return rejected(
          'internal_failure',
        );
      }
      return Object.freeze({
        outcome: 'updated',
        participant: safeParticipant,
      });
    } catch (error) {
      return rejected(
        mapPersistenceFailure(error),
      );
    }
  }
}
