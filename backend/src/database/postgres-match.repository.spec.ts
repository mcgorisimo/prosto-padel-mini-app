import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  LeaveMatchCommand,
  MatchCommandId,
  MatchId,
  MatchInvitationId,
  MatchParticipantId,
  MatchRequestDigest,
  UpdateMatchDescriptionCommand,
} from '../matches/match.types';
import {
  MatchCourtCatalog,
  MatchCourtSnapshot,
} from '../matches/match-court-catalog';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  CreateMatchPersistenceInput,
  JoinMatchInput,
  MatchPersistenceError,
  MatchPersistenceFailure,
} from './match.repository';
import { PlayerProfileReader } from './player-profile-reader';
import {
  PostgresMatchRepository,
  readPlayerRatingLevel,
} from './postgres-match.repository';
import { PostgresTransaction } from './postgres-transaction';

const MATCH_ID = deterministicUuid('repository-match') as MatchId;
const OWNER_ID = deterministicUuid('repository-owner') as AccountId;
const PLAYER_ID = deterministicUuid('repository-player') as AccountId;
const VIEWER_ID = deterministicUuid('repository-viewer') as AccountId;
const CREATE_COMMAND_ID = deterministicUuid(
  'repository-create-command',
) as MatchCommandId;
const JOIN_COMMAND_ID = deterministicUuid(
  'repository-join-command',
) as MatchCommandId;
const LEAVE_COMMAND_ID = deterministicUuid(
  'repository-leave-command',
) as MatchCommandId;
const UPDATE_DESCRIPTION_COMMAND_ID = deterministicUuid(
  'repository-update-description-command',
) as MatchCommandId;
const PARTICIPANT_ID = deterministicUuid(
  'repository-participant',
) as MatchParticipantId;
const INVITATION_ID = deterministicUuid(
  'repository-invitation',
) as MatchInvitationId;
const CREATE_DIGEST = '1'.repeat(64) as MatchRequestDigest;
const JOIN_DIGEST = '2'.repeat(64) as MatchRequestDigest;
const LEAVE_DIGEST = '3'.repeat(64) as MatchRequestDigest;
const UPDATE_DESCRIPTION_DIGEST = '4'.repeat(64) as MatchRequestDigest;
const PRIVATE_MARKER = 'SYNTHETIC_MATCH_PRIVATE_CREDENTIAL';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueuedQuery =
  | QueryResult<QueryResultRow>
  | Error
  | Record<string, unknown>;

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];
  readonly reservationTargetCalls: QueryCall[] = [];

  constructor(
    private readonly queued: QueuedQuery[],
    private readonly reservationTarget: QueryResult<QueryResultRow> =
      queryResult([]),
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    if (
      text.includes('FROM backend_match.match_reservation_links') &&
      text.includes('FOR SHARE')
    ) {
      this.reservationTargetCalls.push({ text, values });
      return this.reservationTarget as QueryResult<Row>;
    }
    this.calls.push({ text, values });
    const next = this.queued.shift();
    if (next === undefined) {
      throw new Error('Unexpected query');
    }
    if (next instanceof Error || !('rows' in next)) {
      throw next;
    }
    return next as unknown as QueryResult<Row>;
  }
}

function queryResult<Row extends QueryResultRow>(
  rows: readonly Row[],
  rowCount: number | null = rows.length,
  command = 'SELECT',
): QueryResult<Row> {
  return {
    command,
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function matchRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: MATCH_ID,
    owner_account_id: OWNER_ID,
    created_at: '1800000000',
    updated_at: '1800000000',
    starts_at: '1800003600',
    duration_minutes: 90,
    court_id: 'court-1',
    court_name: 'Synthetic court',
    court_type: 'panoramic',
    kind: 'match',
    visibility: 'public',
    scenario: 'social',
    status: 'confirmed',
    title: 'Synthetic match',
    description: '',
    rating_min: 2,
    rating_max: 4,
    is_rating_match: true,
    price_per_person_snapshot: '1000.00',
    version: '1',
    terminal_at: null,
    ...overrides,
  };
}

function participantRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: PARTICIPANT_ID,
    match_id: MATCH_ID,
    account_id: PLAYER_ID,
    slot_number: 2,
    status: 'active',
    joined_at: '1800000100',
    updated_at: '1800000100',
    left_at: null,
    version: '1',
    ...overrides,
  };
}

function visibleMatchRow(
  participant: QueryResultRow | null = participantRow(),
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    ...matchRow(),
    participant_id: participant?.id ?? null,
    participant_match_id: participant?.match_id ?? null,
    participant_account_id: participant?.account_id ?? null,
    participant_slot_number: participant?.slot_number ?? null,
    participant_status: participant?.status ?? null,
    participant_joined_at: participant?.joined_at ?? null,
    participant_updated_at: participant?.updated_at ?? null,
    participant_left_at: participant?.left_at ?? null,
    participant_version: participant?.version ?? null,
    ...overrides,
  };
}

function commandRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    command_id: CREATE_COMMAND_ID,
    match_id: MATCH_ID,
    actor_account_id: OWNER_ID,
    command_sequence: '1',
    request_digest: Buffer.from(CREATE_DIGEST, 'hex'),
    command_type: 'create_match',
    applied_at: '1800000000',
    participant_id: null,
    result_type: 'match_created',
    match_version: '1',
    ...overrides,
  };
}

function joinCommandRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return commandRow({
    command_id: JOIN_COMMAND_ID,
    actor_account_id: PLAYER_ID,
    command_sequence: '2',
    request_digest: Buffer.from(JOIN_DIGEST, 'hex'),
    command_type: 'join_match',
    applied_at: '1800000100',
    participant_id: PARTICIPANT_ID,
    result_type: 'participant_joined',
    match_version: '2',
    ...overrides,
  });
}

function leaveCommandRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return commandRow({
    command_id: LEAVE_COMMAND_ID,
    actor_account_id: PLAYER_ID,
    command_sequence: '3',
    request_digest: Buffer.from(LEAVE_DIGEST, 'hex'),
    command_type: 'leave_match',
    applied_at: '1800000200',
    participant_id: PARTICIPANT_ID,
    result_type: 'participant_left',
    match_version: '3',
    ...overrides,
  });
}

function updateDescriptionCommandRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return commandRow({
    command_id: UPDATE_DESCRIPTION_COMMAND_ID,
    command_sequence: '2',
    request_digest: Buffer.from(UPDATE_DESCRIPTION_DIGEST, 'hex'),
    command_type: 'update_match_description',
    applied_at: '1800000100',
    result_type: 'match_description_updated',
    match_version: '2',
    ...overrides,
  });
}

function createCommandLockResult(): QueryResult<QueryResultRow> {
  return queryResult([{ locked: '' }]);
}

function actorRatingResult(
  rating = '3.00',
  isVerified = true,
): QueryResult<QueryResultRow> {
  return queryResult([{ rating, is_verified: isVerified }]);
}

function createCommand(
  overrides: Partial<CreateMatchPersistenceInput> = {},
): CreateMatchPersistenceInput {
  return {
    type: 'create_match',
    matchId: MATCH_ID,
    commandId: CREATE_COMMAND_ID,
    actorAccountId: OWNER_ID,
    requestDigest: CREATE_DIGEST,
    now: unixEpochSeconds(1_800_000_000),
    startsAt: unixEpochSeconds(1_800_003_600),
    durationMinutes: 90,
    courtId: 'court-1',
    kind: 'match',
    visibility: 'public',
    scenario: 'social',
    status: 'confirmed',
    description: '',
    ratingMin: 2,
    ratingMax: 4,
    isRatingMatch: true,
    ...overrides,
  };
}

interface RepositoryHarness {
  readonly repository: PostgresMatchRepository;
  readonly findProfile: jest.MockedFunction<
    PlayerProfileReader['findByAccountId']
  >;
  readonly resolveCourt: jest.MockedFunction<MatchCourtCatalog['resolve']>;
}

function repositoryHarness(options: {
  readonly isVerified?: boolean;
  readonly court?: MatchCourtSnapshot | undefined;
} = {}): RepositoryHarness {
  const findProfile = jest.fn<
    ReturnType<PlayerProfileReader['findByAccountId']>,
    Parameters<PlayerProfileReader['findByAccountId']>
  >().mockResolvedValue({
    outcome: 'found',
    profile: {
      accountId: OWNER_ID,
      firstName: 'Synthetic',
      rating: 3,
      isVerified: options.isVerified ?? true,
      capabilities: [],
    },
  });
  const resolveCourt = jest.fn<
    ReturnType<MatchCourtCatalog['resolve']>,
    Parameters<MatchCourtCatalog['resolve']>
  >().mockReturnValue(
    Object.prototype.hasOwnProperty.call(options, 'court')
      ? options.court
      : Object.freeze({
          courtId: 'court-1',
          courtName: 'Synthetic court',
          courtType: 'panoramic',
          pricePerPersonSnapshot: 1_000,
        }),
  );
  return {
    repository: new PostgresMatchRepository(
      { findByAccountId: findProfile },
      { resolve: resolveCourt },
    ),
    findProfile,
    resolveCourt,
  };
}

function repository(): PostgresMatchRepository {
  return repositoryHarness().repository;
}

function joinCommand(
  overrides: Partial<JoinMatchInput> = {},
): JoinMatchInput {
  return {
    type: 'join_match',
    matchId: MATCH_ID,
    commandId: JOIN_COMMAND_ID,
    actorAccountId: PLAYER_ID,
    requestDigest: JOIN_DIGEST,
    now: unixEpochSeconds(1_800_000_100),
    participantId: PARTICIPANT_ID,
    ...overrides,
  };
}

function leaveCommand(
  overrides: Partial<LeaveMatchCommand> = {},
): LeaveMatchCommand {
  return {
    type: 'leave_match',
    matchId: MATCH_ID,
    commandId: LEAVE_COMMAND_ID,
    actorAccountId: PLAYER_ID,
    requestDigest: LEAVE_DIGEST,
    now: unixEpochSeconds(1_800_000_200),
    ...overrides,
  };
}

function updateDescriptionCommand(
  overrides: Partial<UpdateMatchDescriptionCommand> = {},
): UpdateMatchDescriptionCommand {
  return {
    type: 'update_match_description',
    matchId: MATCH_ID,
    commandId: UPDATE_DESCRIPTION_COMMAND_ID,
    actorAccountId: OWNER_ID,
    requestDigest: UPDATE_DESCRIPTION_DIGEST,
    now: unixEpochSeconds(1_800_000_100),
    description: 'Updated match comment',
    ...overrides,
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function postgresError(
  code: string,
  constraint?: string,
): Record<string, unknown> {
  return {
    code,
    constraint,
    message: PRIVATE_MARKER,
    detail: `${PRIVATE_MARKER}-detail`,
    schema: 'private_schema',
    table: 'private_table',
    query: `SELECT '${PRIVATE_MARKER}'`,
    cause: new Error(`${PRIVATE_MARKER}-cause`),
  };
}

function expectSafeError(
  value: unknown,
  reason: MatchPersistenceFailure,
): MatchPersistenceError {
  expect(value).toBeInstanceOf(MatchPersistenceError);
  const error = value as MatchPersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe('Match persistence failed');
  expect('cause' in error).toBe(false);
  for (const inspected of [
    error.message,
    String(error.stack),
    JSON.stringify(error),
  ]) {
    expect(inspected).not.toContain(PRIVATE_MARKER);
    expect(inspected).not.toContain('private_schema');
    expect(inspected).not.toContain('private_table');
  }
  return error;
}

describe('PostgresMatchRepository', () => {
  it.each([
    ['0.00', 0],
    ['1.99', 0],
    ['2.00', 1],
    ['2.99', 1],
    ['3.00', 2],
    ['3.49', 2],
    ['3.50', 3],
    ['3.99', 3],
    ['4.00', 4],
    ['4.20', 4],
    ['4.69', 4],
    ['4.70', 5],
    ['5.49', 5],
    ['5.50', 6],
    ['10.00', 6],
  ])('maps trusted rating %s to canonical level index %i', (rating, level) => {
    expect(readPlayerRatingLevel(rating)).toBe(level);
  });

  it('creates the match and append-only command in one passed transaction', async () => {
    const harness = repositoryHarness();
    const transaction = new FakeTransaction([
      createCommandLockResult(),
      queryResult([]),
      queryResult([{ id: MATCH_ID, version: '1' }], 1, 'INSERT'),
      queryResult(
        [
          {
            command_id: CREATE_COMMAND_ID,
            match_id: MATCH_ID,
            command_sequence: '1',
          },
        ],
        1,
        'INSERT',
      ),
    ]);

    const result = await harness.repository.create(
      transaction,
      createCommand(),
    );

    expect(result).toMatchObject({
      outcome: 'match_created',
      persistence: 'applied',
      match: {
        matchId: MATCH_ID,
        ownerAccountId: OWNER_ID,
        version: 1,
        participants: [],
      },
    });
    expect(transaction.calls).toHaveLength(4);
    expect(normalizeSql(transaction.calls[0].text)).toContain(
      'pg_advisory_xact_lock',
    );
    expect(transaction.calls[0].values).toEqual([CREATE_COMMAND_ID]);
    expect(normalizeSql(transaction.calls[1].text)).toContain(
      'FROM backend_match.match_commands WHERE command_id = $1',
    );
    expect(normalizeSql(transaction.calls[2].text)).toContain(
      'INSERT INTO backend_match.matches',
    );
    expect(normalizeSql(transaction.calls[3].text)).toContain(
      'INSERT INTO backend_match.match_commands',
    );
    expect(transaction.calls[2].values[1]).toBe(OWNER_ID);
    expect(transaction.calls[2].values.slice(6, 9)).toEqual([
      'court-1',
      'Synthetic court',
      'panoramic',
    ]);
    expect(transaction.calls[2].values[18]).toBe(1_000);
    expect(transaction.calls[3].values[4]).toEqual(
      Buffer.from(CREATE_DIGEST, 'hex'),
    );
    expect(
      transaction.calls.flatMap((call) => call.values),
    ).not.toContain(PRIVATE_MARKER);
    expect(harness.resolveCourt).toHaveBeenCalledWith({
      matchId: MATCH_ID,
      scenario: 'social',
      courtId: 'court-1',
      startsAt: 1_800_003_600,
      durationMinutes: 90,
    });
    expect(harness.findProfile).toHaveBeenCalledWith(transaction, {
      accountId: OWNER_ID,
    });
  });

  it('creates a community match without a selected court using a trusted per-match snapshot', async () => {
    const harness = repositoryHarness({
      court: Object.freeze({
        courtId: `unassigned:${MATCH_ID}`,
        courtName: 'Корт не выбран',
        courtType: 'unassigned',
      }),
    });
    const transaction = new FakeTransaction([
      createCommandLockResult(),
      queryResult([]),
      queryResult([{ id: MATCH_ID, version: '1' }], 1, 'INSERT'),
      queryResult([{ command_id: CREATE_COMMAND_ID }], 1, 'INSERT'),
    ]);

    const result = await harness.repository.create(
      transaction,
      createCommand({
        courtId: undefined,
        scenario: 'community',
        status: 'searching',
        isRatingMatch: false,
      }),
    );

    expect(result).toMatchObject({
      outcome: 'match_created',
      persistence: 'applied',
      match: {
        courtId: `unassigned:${MATCH_ID}`,
        courtName: 'Корт не выбран',
        courtType: 'unassigned',
        scenario: 'community',
        status: 'searching',
      },
    });
    if (result.outcome === 'match_created') {
      expect(result.match).not.toHaveProperty('pricePerPersonSnapshot');
    }
    expect(harness.resolveCourt).toHaveBeenCalledWith({
      matchId: MATCH_ID,
      scenario: 'community',
      startsAt: 1_800_003_600,
      durationMinutes: 90,
    });
    expect(transaction.calls[2].values.slice(6, 9)).toEqual([
      `unassigned:${MATCH_ID}`,
      'Корт не выбран',
      'unassigned',
    ]);
    expect(transaction.calls[2].values[18]).toBeNull();
    expect(harness.findProfile).not.toHaveBeenCalled();
  });

  it('reconstructs the original create result after later join, leave and description changes', async () => {
    const matchRepository = repository();
    const applied = await matchRepository.create(
      new FakeTransaction([
        createCommandLockResult(),
        queryResult([]),
        queryResult([{ id: MATCH_ID, version: '1' }], 1, 'INSERT'),
        queryResult([{ command_id: CREATE_COMMAND_ID }], 1, 'INSERT'),
      ]),
      createCommand(),
    );
    const transaction = new FakeTransaction([
      createCommandLockResult(),
      queryResult([commandRow()]),
      queryResult([
        matchRow({
          updated_at: '1800000300',
          status: 'open',
          version: '4',
          scenario: 'social',
          title: null,
          description: 'Edited later comment',
        }),
      ]),
      queryResult([
        participantRow({
          status: 'left',
          updated_at: '1800000200',
          left_at: '1800000200',
          version: '2',
        }),
      ]),
      queryResult([
        commandRow(),
        joinCommandRow(),
        leaveCommandRow(),
        updateDescriptionCommandRow({
          command_sequence: '4',
          applied_at: '1800000300',
          match_version: '4',
        }),
      ]),
    ]);

    const retryHarness = repositoryHarness({
      isVerified: false,
      court: undefined,
    });
    const result = await retryHarness.repository.create(
      transaction,
      createCommand({
        now: unixEpochSeconds(1_800_004_000),
      }),
    );

    if (applied.outcome !== 'match_created') {
      throw new Error('Synthetic initial create failed');
    }
    expect(result).toEqual({
      ...applied,
      persistence: 'idempotent_retry',
    });
    expect(transaction.calls).toHaveLength(5);
    expect(
      transaction.calls.some((call) =>
        normalizeSql(call.text).startsWith('INSERT'),
      ),
    ).toBe(false);
    expect(retryHarness.resolveCourt).not.toHaveBeenCalled();
    expect(retryHarness.findProfile).not.toHaveBeenCalled();
  });

  it('rejects a new rating match for an unverified backend profile without writes', async () => {
    const harness = repositoryHarness({ isVerified: false });
    const transaction = new FakeTransaction([
      createCommandLockResult(),
      queryResult([]),
    ]);

    await expect(
      harness.repository.create(transaction, createCommand()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'rating_verification_required',
    });
    expect(harness.findProfile).toHaveBeenCalledWith(transaction, {
      accountId: OWNER_ID,
    });
    expect(transaction.calls).toHaveLength(2);
  });

  it('rejects an unknown trusted court before profile reads or writes', async () => {
    const harness = repositoryHarness({ court: undefined });
    const transaction = new FakeTransaction([
      createCommandLockResult(),
      queryResult([]),
    ]);

    await expect(
      harness.repository.create(transaction, createCommand()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'court_invalid',
    });
    expect(harness.findProfile).not.toHaveBeenCalled();
    expect(transaction.calls).toHaveLength(2);
  });

  it('rejects a new started match only after the durable command lookup', async () => {
    const harness = repositoryHarness();
    const transaction = new FakeTransaction([
      createCommandLockResult(),
      queryResult([]),
    ]);

    await expect(
      harness.repository.create(
        transaction,
        createCommand({
          now: unixEpochSeconds(1_800_003_600),
        }),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(2);
    expect(harness.resolveCourt).not.toHaveBeenCalled();
    expect(harness.findProfile).not.toHaveBeenCalled();
  });

  it('rejects create commandId reuse with changed immutable bindings', async () => {
    const result = await repository().create(
      new FakeTransaction([
        createCommandLockResult(),
        queryResult([
          commandRow({
            request_digest: Buffer.from('9'.repeat(64), 'hex'),
          }),
        ]),
      ]),
      createCommand(),
    );

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
    });
  });

  it('lists only backend-owned public active future matches', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        {
          id: MATCH_ID,
          owner_account_id: OWNER_ID,
          starts_at: '1800003600',
          duration_minutes: 90,
          court_id: 'court-1',
          court_name: 'Synthetic court',
          court_type: 'indoor',
          scenario: 'community',
          status: 'open',
          title: 'Synthetic match',
          description: 'Feed comment',
          rating_min: 2,
          rating_max: 4,
          is_rating_match: true,
          price_per_person_snapshot: '1000.00',
          version: '2',
          occupied_slots: '2',
          participant_account_ids: [PLAYER_ID],
          participant_slot_numbers: [2],
        },
      ]),
    ]);

    const result = await repository().listPublicFeed(
      transaction,
      { now: unixEpochSeconds(1_800_000_000), limit: 20 },
    );

    expect(result).toEqual([
      {
        matchId: MATCH_ID,
        ownerAccountId: OWNER_ID,
        startsAt: 1_800_003_600,
        durationMinutes: 90,
        courtId: 'court-1',
        courtName: 'Synthetic court',
        courtType: 'indoor',
        scenario: 'community',
        status: 'open',
        title: 'Synthetic match',
        description: 'Feed comment',
        ratingMin: 2,
        ratingMax: 4,
        isRatingMatch: true,
        pricePerPersonSnapshot: 1000,
        occupiedSlots: 2,
        version: 2,
        participants: [
          {
            playerId: PLAYER_ID,
            slotNumber: 2,
          },
        ],
      },
    ]);
    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql).toContain("matches.visibility = 'public'");
    expect(sql).toContain("matches.kind = 'match'");
    expect(sql).toContain("participants.status = 'active'");
    expect(sql.toLowerCase()).toContain('coalesce(');
    expect(sql.toLowerCase()).not.toContain('pg_catalog.coalesce');
    expect(sql.toLowerCase()).toContain(
      'array_agg( participants.account_id order by participants.slot_number )',
    );
    expect(sql.toLowerCase()).toContain(
      'array_agg( participants.slot_number order by participants.slot_number )',
    );
    expect(sql).toContain('reservation_links.target_datetime');
    expect(sql).toContain('matches.starts_at ) > $1');
    expect(sql).not.toContain('matches.starts_at >= $1');
    expect(transaction.calls[0].values).toEqual([1_800_000_000, 20]);
  });

  it('fails closed when a persisted feed comment exceeds the public limit', async () => {
    const transaction = new FakeTransaction([
      queryResult([{
        id: MATCH_ID,
        owner_account_id: OWNER_ID,
        starts_at: '1800003600',
        duration_minutes: 90,
        court_id: 'court-1',
        court_name: 'Synthetic court',
        court_type: 'indoor',
        scenario: 'community',
        status: 'open',
        title: 'Synthetic match',
        description: 'x'.repeat(241),
        rating_min: 2,
        rating_max: 4,
        is_rating_match: true,
        price_per_person_snapshot: '1000.00',
        version: '2',
        occupied_slots: '1',
        participant_account_ids: [],
        participant_slot_numbers: [],
      }]),
    ]);

    await expect(
      repository().listPublicFeed(transaction, {
        now: unixEpochSeconds(1_800_000_000),
        limit: 20,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it('lists future matches scoped to the authenticated owner or active participant', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        {
          id: MATCH_ID,
          owner_account_id: OWNER_ID,
          starts_at: '1800003600',
          duration_minutes: 90,
          court_id: 'court-1',
          court_name: 'Synthetic court',
          court_type: 'indoor',
          scenario: 'community',
          status: 'open',
          title: 'Synthetic match',
          description: 'Account feed comment',
          rating_min: 2,
          rating_max: 4,
          is_rating_match: true,
          price_per_person_snapshot: '1000.00',
          version: '2',
          occupied_slots: '2',
          participant_account_ids: [PLAYER_ID],
          participant_slot_numbers: [2],
        },
      ]),
    ]);

    const result = await repository().listAccountFeed(transaction, {
      accountId: PLAYER_ID,
      now: unixEpochSeconds(1_800_000_000),
      limit: 50,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      matchId: MATCH_ID,
      ownerAccountId: OWNER_ID,
      participants: [{ playerId: PLAYER_ID, slotNumber: 2 }],
    });
    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql).toContain('reservation_links.target_datetime');
    expect(sql).toContain('matches.starts_at ) > $1');
    expect(sql).toContain('matches.owner_account_id = $2');
    expect(sql).toContain(
      'account_participants.account_id = $2',
    );
    expect(sql).toContain(
      "account_participants.status = 'active'",
    );
    expect(transaction.calls[0].values).toEqual([
      1_800_000_000,
      PLAYER_ID,
      50,
    ]);
  });

  it('fails closed when account feed returns an unrelated aggregate', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        {
          id: MATCH_ID,
          owner_account_id: OWNER_ID,
          starts_at: '1800003600',
          duration_minutes: 90,
          court_id: 'court-1',
          court_name: 'Synthetic court',
          court_type: 'indoor',
          scenario: 'community',
          status: 'open',
          title: 'Synthetic match',
          description: '',
          rating_min: 2,
          rating_max: 4,
          is_rating_match: true,
          price_per_person_snapshot: '1000.00',
          version: '2',
          occupied_slots: '1',
          participant_account_ids: [],
          participant_slot_numbers: [],
        },
      ]),
    ]);

    await expect(
      repository().listAccountFeed(transaction, {
        accountId: VIEWER_ID,
        now: unixEpochSeconds(1_800_000_000),
        limit: 50,
      }),
    ).rejects.toMatchObject({
      reason: 'invalid_persisted_state',
    });
  });

  it('returns one active-only visible detail snapshot and hides missing/private rows as null', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        visibleMatchRow(participantRow(), { version: '2' }),
      ]),
    ]);
    const found = await repository().findVisibleById(
      transaction,
      { matchId: MATCH_ID, viewerAccountId: VIEWER_ID },
    );

    expect(found).toMatchObject({
      matchId: MATCH_ID,
      participants: [
        {
          playerId: PLAYER_ID,
          slotNumber: 2,
        },
      ],
    });
    expect(transaction.calls).toHaveLength(1);
    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql).toContain("participants.status = 'active'");
    expect(sql).toContain(
      'OR EXISTS ( SELECT 1 FROM backend_match.match_participants',
    );
    expect(JSON.stringify(found)).not.toContain('participantId');
    expect(JSON.stringify(found)).not.toContain('joinedAt');
    expect(JSON.stringify(found)).not.toContain('leftAt');
    expect(JSON.stringify(found)).not.toContain('version":1');
    expect(
      await repository().findVisibleById(
        new FakeTransaction([
          queryResult([visibleMatchRow(null)]),
        ]),
        { matchId: MATCH_ID, viewerAccountId: OWNER_ID },
      ),
    ).toMatchObject({ matchId: MATCH_ID, participants: [] });
    expect(
      await repository().findVisibleById(
        new FakeTransaction([queryResult([])]),
        { matchId: MATCH_ID, viewerAccountId: VIEWER_ID },
      ),
    ).toBeNull();
  });

  it('locks the aggregate, updates only the description and appends one immutable command', async () => {
    const transaction = new FakeTransaction([
      queryResult([matchRow({ description: 'Old comment' })]),
      queryResult([]),
      queryResult([commandRow()]),
      queryResult([{ id: MATCH_ID, version: '2' }], 1, 'UPDATE'),
      queryResult([{ command_id: UPDATE_DESCRIPTION_COMMAND_ID }], 1, 'INSERT'),
    ]);

    const result = await repository().updateDescription(
      transaction,
      updateDescriptionCommand(),
    );

    expect(result).toEqual({
      outcome: 'match_description_updated',
      persistence: 'applied',
      matchId: MATCH_ID,
      description: 'Updated match comment',
      matchVersion: 2,
    });
    expect(transaction.calls).toHaveLength(5);
    expect(normalizeSql(transaction.calls[0].text)).toContain(
      'FROM backend_match.matches WHERE id = $1 FOR UPDATE',
    );
    expect(normalizeSql(transaction.calls[3].text)).toContain(
      'UPDATE backend_match.matches SET updated_at = $2, version = $3, description = $4',
    );
    expect(transaction.calls[3].values).toEqual([
      MATCH_ID,
      1_800_000_100,
      2,
      'Updated match comment',
      1,
    ]);
    expect(normalizeSql(transaction.calls[4].text)).toContain(
      'INSERT INTO backend_match.match_commands',
    );
    expect(transaction.calls[4].values).toEqual(expect.arrayContaining([
      UPDATE_DESCRIPTION_COMMAND_ID,
      'update_match_description',
      'match_description_updated',
    ]));
  });

  it('returns the original description update on an exact retry without a second write', async () => {
    const transaction = new FakeTransaction([
      queryResult([matchRow({
        updated_at: '1800000200',
        description: 'A later comment',
        version: '3',
      })]),
      queryResult([]),
      queryResult([
        commandRow(),
        updateDescriptionCommandRow(),
        updateDescriptionCommandRow({
          command_id: deterministicUuid('later-update-command'),
          command_sequence: '3',
          request_digest: Buffer.from('5'.repeat(64), 'hex'),
          applied_at: '1800000200',
          match_version: '3',
        }),
      ]),
    ]);

    await expect(
      repository().updateDescription(
        transaction,
        updateDescriptionCommand(),
      ),
    ).resolves.toEqual({
      outcome: 'match_description_updated',
      persistence: 'idempotent_retry',
      matchId: MATCH_ID,
      description: 'Updated match comment',
      matchVersion: 2,
    });
    expect(transaction.calls).toHaveLength(3);
  });

  it('locks, hydrates, joins, advances the aggregate and appends a command', async () => {
    const transaction = new FakeTransaction([
      queryResult([matchRow()]),
      queryResult([]),
      queryResult([commandRow()]),
      queryResult([]),
      actorRatingResult(),
      queryResult([{ id: PARTICIPANT_ID }], 1, 'INSERT'),
      queryResult([{ id: MATCH_ID, version: '2' }], 1, 'UPDATE'),
      queryResult([{ command_id: JOIN_COMMAND_ID }], 1, 'INSERT'),
    ]);

    const result = await repository().join(
      transaction,
      joinCommand(),
    );

    expect(result).toMatchObject({
      outcome: 'participant_joined',
      persistence: 'applied',
      participant: {
        participantId: PARTICIPANT_ID,
        slotNumber: 2,
        status: 'active',
      },
      matchVersion: 2,
    });
    expect(transaction.calls.map((call) => {
      const sql = normalizeSql(call.text);
      if (sql.includes('FROM backend_match.matches')) return 'match_lock';
      if (sql.includes('FROM backend_match.match_participants'))
        return 'participant_lock';
      if (sql.includes('FROM backend_match.match_commands'))
        return 'hydrate_commands';
      if (sql.includes('FROM backend_match.match_invitations'))
        return 'invitation_lock';
      if (sql.includes('FROM backend_auth.player_rating_states'))
        return 'actor_rating';
      if (sql.startsWith('INSERT INTO backend_match.match_participants'))
        return 'participant_write';
      if (sql.startsWith('UPDATE backend_match.matches'))
        return 'match_write';
      return 'command_write';
    })).toEqual([
      'match_lock',
      'participant_lock',
      'hydrate_commands',
      'invitation_lock',
      'actor_rating',
      'participant_write',
      'match_write',
      'command_write',
    ]);
    expect(normalizeSql(transaction.calls[0].text)).toContain(
      'FOR UPDATE',
    );
    expect(normalizeSql(transaction.calls[1].text)).toContain(
      'ORDER BY slot_number, joined_at, id FOR UPDATE',
    );
    expect(transaction.calls[4].values).toEqual([PLAYER_ID]);
    expect(transaction.calls[6].values).toEqual([
      MATCH_ID,
      1_800_000_100,
      2,
      'open',
      1,
    ]);
  });

  it('uses the active reservation target when deciding whether a join is still open', async () => {
    const startsAt = new Date(1_800_000_100 * 1_000).toISOString();
    const endsAt = new Date((1_800_000_100 + 5_400) * 1_000).toISOString();
    const transaction = new FakeTransaction(
      [
        queryResult([matchRow()]),
        queryResult([]),
        queryResult([commandRow()]),
        queryResult([]),
        actorRatingResult(),
      ],
      queryResult([{
        target_datetime_text: startsAt,
        target_end_datetime_text: endsAt,
      }]),
    );

    await expect(repository().join(
      transaction,
      joinCommand({ now: unixEpochSeconds(1_800_000_100) }),
    )).resolves.toEqual({ outcome: 'rejected', reason: 'match_started' });
    expect(transaction.reservationTargetCalls).toHaveLength(1);
    expect(transaction.calls.some(({ text }) => {
      const sql = normalizeSql(text).toLowerCase();
      return sql.startsWith('insert ') || sql.startsWith('update ');
    })).toBe(false);
  });

  it('reserves pending invitation slots from ordinary joins', async () => {
    const transaction = new FakeTransaction([
      queryResult([matchRow()]),
      queryResult([]),
      queryResult([commandRow()]),
      queryResult([
        {
          id: INVITATION_ID,
          invited_account_id: VIEWER_ID,
          slot_number: 2,
        },
      ]),
      actorRatingResult(),
      queryResult([{ id: PARTICIPANT_ID }], 1, 'INSERT'),
      queryResult([{ id: MATCH_ID, version: '2' }], 1, 'UPDATE'),
      queryResult([{ command_id: JOIN_COMMAND_ID }], 1, 'INSERT'),
    ]);

    await expect(
      repository().join(transaction, joinCommand()),
    ).resolves.toMatchObject({
      outcome: 'participant_joined',
      participant: { slotNumber: 3 },
    });
    expect(transaction.calls[5].values[3]).toBe(3);
  });

  it('requires an invited player to accept its reserved invitation', async () => {
    const pendingInvitation = {
      id: INVITATION_ID,
      invited_account_id: PLAYER_ID,
      slot_number: 2,
    };
    const ordinary = new FakeTransaction([
      queryResult([matchRow()]),
      queryResult([]),
      queryResult([commandRow()]),
      queryResult([pendingInvitation]),
    ]);

    await expect(
      repository().join(ordinary, joinCommand()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invitation_pending',
    });
    expect(ordinary.calls).toHaveLength(4);

    const accepted = new FakeTransaction([
      queryResult([matchRow()]),
      queryResult([]),
      queryResult([commandRow()]),
      queryResult([pendingInvitation]),
      actorRatingResult(),
      queryResult([{ id: PARTICIPANT_ID }], 1, 'INSERT'),
      queryResult([{ id: MATCH_ID, version: '2' }], 1, 'UPDATE'),
      queryResult([{ command_id: JOIN_COMMAND_ID }], 1, 'INSERT'),
    ]);

    await expect(
      repository().join(
        accepted,
        joinCommand({ invitationId: INVITATION_ID }),
      ),
    ).resolves.toMatchObject({
      outcome: 'participant_joined',
      participant: { slotNumber: 2 },
    });
  });

  it('returns idempotent join from persisted command without writes or a new participant binding', async () => {
    const transaction = new FakeTransaction([
      queryResult([matchRow({ version: '2', updated_at: '1800000100' })]),
      queryResult([participantRow()]),
      queryResult([commandRow(), joinCommandRow()]),
    ]);

    const result = await repository().join(
      transaction,
      joinCommand({
        participantId: deterministicUuid(
          'retry-participant',
        ) as MatchParticipantId,
      }),
    );

    expect(result).toMatchObject({
      outcome: 'participant_joined',
      persistence: 'idempotent_retry',
      participant: { participantId: PARTICIPANT_ID },
      matchVersion: 2,
    });
    expect(transaction.calls).toHaveLength(3);
  });

  it('reconstructs the original join result after the participant later left', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        matchRow({
          version: '3',
          updated_at: '1800000200',
          status: 'open',
        }),
      ]),
      queryResult([
        participantRow({
          status: 'left',
          updated_at: '1800000200',
          left_at: '1800000200',
          version: '2',
        }),
      ]),
      queryResult([
        commandRow(),
        joinCommandRow(),
        leaveCommandRow(),
      ]),
    ]);

    const result = await repository().join(
      transaction,
      joinCommand({
        participantId: deterministicUuid(
          'later-retry-participant',
        ) as MatchParticipantId,
      }),
    );

    expect(result).toEqual({
      outcome: 'participant_joined',
      persistence: 'idempotent_retry',
      participant: {
        participantId: PARTICIPANT_ID,
        accountId: PLAYER_ID,
        slotNumber: 2,
        status: 'active',
        joinedAt: 1_800_000_100,
        updatedAt: 1_800_000_100,
        version: 1,
      },
      matchVersion: 2,
    });
    expect(transaction.calls).toHaveLength(3);
  });

  it('marks an active participant left and preserves its row', async () => {
    const transaction = new FakeTransaction([
      queryResult([matchRow({ version: '2', updated_at: '1800000100' })]),
      queryResult([participantRow()]),
      queryResult([commandRow(), joinCommandRow()]),
      queryResult([{ id: PARTICIPANT_ID }], 1, 'UPDATE'),
      queryResult([{ id: MATCH_ID, version: '3' }], 1, 'UPDATE'),
      queryResult([{ command_id: LEAVE_COMMAND_ID }], 1, 'INSERT'),
    ]);

    const result = await repository().leave(
      transaction,
      leaveCommand(),
    );

    expect(result).toMatchObject({
      outcome: 'participant_left',
      persistence: 'applied',
      participant: {
        participantId: PARTICIPANT_ID,
        status: 'left',
        leftAt: 1_800_000_200,
        version: 2,
      },
      matchVersion: 3,
    });
    const update = normalizeSql(transaction.calls[3].text);
    expect(update).toContain(
      "UPDATE backend_match.match_participants SET status = $3",
    );
    expect(update).not.toContain('DELETE');
  });

  it('returns safe domain rejections without writes', async () => {
    const notFound = await repository().join(
      new FakeTransaction([queryResult([])]),
      joinCommand(),
    );
    expect(notFound).toEqual({
      outcome: 'rejected',
      reason: 'match_not_found',
    });

    const ownerTransaction = new FakeTransaction([
      queryResult([matchRow()]),
      queryResult([]),
      queryResult([commandRow()]),
      queryResult([]),
      actorRatingResult(),
    ]);
    const ownerJoin = await repository().join(
      ownerTransaction,
      joinCommand({ actorAccountId: OWNER_ID }),
    );
    expect(ownerJoin).toEqual({
      outcome: 'rejected',
      reason: 'owner_cannot_join',
    });
    expect(ownerTransaction.calls).toHaveLength(5);
  });

  it('uses the trusted backend rating state and rejects an out-of-range join', async () => {
    const transaction = new FakeTransaction([
      queryResult([matchRow()]),
      queryResult([]),
      queryResult([commandRow()]),
      queryResult([]),
      actorRatingResult('7.51'),
    ]);

    const result = await repository().join(
      transaction,
      joinCommand(),
    );

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'rating_out_of_range',
    });
    expect(transaction.calls).toHaveLength(5);
    expect(normalizeSql(transaction.calls[4].text)).toContain(
      'SELECT rating, is_verified FROM backend_auth.player_rating_states',
    );
    expect(transaction.calls[4].values).toEqual([PLAYER_ID]);
  });

  it('uses trusted backend verification and rejects an unverified rating join', async () => {
    const transaction = new FakeTransaction([
      queryResult([matchRow()]),
      queryResult([]),
      queryResult([commandRow()]),
      queryResult([]),
      actorRatingResult('3.00', false),
    ]);

    await expect(
      repository().join(transaction, joinCommand()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'rating_verification_required',
    });
    expect(transaction.calls).toHaveLength(5);
    expect(
      transaction.calls.some((call) =>
        normalizeSql(call.text).startsWith('INSERT'),
      ),
    ).toBe(false);
  });

  it('fails closed before SQL for invalid commands and read inputs', async () => {
    const transaction = new FakeTransaction([]);
    await expect(
      repository().create(
        transaction,
        createCommand({ courtId: '' }),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    await expect(
      repository().listPublicFeed(transaction, {
        now: unixEpochSeconds(1),
        limit: 51,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    await expect(
      repository().findVisibleById(transaction, {
        matchId: 'invalid' as MatchId,
        viewerAccountId: VIEWER_ID,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    ['42501', undefined, 'permission_denied'],
    ['40001', undefined, 'transaction_conflict'],
    ['40P01', undefined, 'transaction_conflict'],
    ['08006', undefined, 'database_unavailable'],
    ['57P01', undefined, 'database_unavailable'],
    ['57014', undefined, 'database_unavailable'],
    ['23505', 'match_participants_active_slot_key', 'match_conflict'],
    ['23505', 'match_commands_pkey', 'command_conflict'],
    ['23P01', 'matches_no_active_court_overlap', 'match_conflict'],
    ['23503', undefined, 'referential_integrity'],
  ] as const)(
    'maps PostgreSQL %s safely to %s',
    async (code, constraint, reason) => {
      try {
        await repository().listPublicFeed(
          new FakeTransaction([
            postgresError(code, constraint),
          ]),
          { now: unixEpochSeconds(1), limit: 20 },
        );
        throw new Error('Expected repository failure');
      } catch (error) {
        expectSafeError(error, reason);
      }
    },
  );

  it('maps corrupt persisted state and unknown errors without detail leakage', async () => {
    await expect(
      repository().listPublicFeed(
        new FakeTransaction([
          queryResult([
            {
              id: MATCH_ID,
              owner_account_id: OWNER_ID,
              starts_at: '1800003600',
              duration_minutes: 90,
              court_id: 'court-1',
              court_name: 'Synthetic court',
              court_type: 'indoor',
              scenario: 'community',
              status: 'open',
              title: null,
              rating_min: 2,
              rating_max: 4,
              is_rating_match: true,
              price_per_person_snapshot: null,
              version: '1',
              occupied_slots: '5',
            },
          ]),
        ]),
        { now: unixEpochSeconds(1), limit: 20 },
      ),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });

    try {
      await repository().listPublicFeed(
        new FakeTransaction([new Error(PRIVATE_MARKER)]),
        { now: unixEpochSeconds(1), limit: 20 },
      );
      throw new Error('Expected repository failure');
    } catch (error) {
      expectSafeError(error, 'storage_failure');
    }
  });

  it('uses static parameterized backend_match SQL without secret or payment state fields', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await repository().listPublicFeed(transaction, {
      now: unixEpochSeconds(1),
      limit: 20,
    });
    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql).toContain('backend_match.matches');
    expect(sql).not.toContain('public.matches');
    expect(sql).not.toContain(PRIVATE_MARKER);
    for (const forbidden of [
      'paymentStatus',
      'ownerPaid',
      'holdAmount',
      'credential',
      'telegram',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });
});
