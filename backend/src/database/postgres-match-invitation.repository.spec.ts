import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  MatchCommandId,
  MatchId,
  MatchInvitationId,
  MatchParticipantId,
  MatchRequestDigest,
} from '../matches/match.types';
import {
  MatchInvitationCommandId,
  MatchInvitationRequestDigest,
} from '../matches/match-invitation.types';
import {
  CreateMatchInvitationInput,
  MatchInvitationPersistenceError,
} from './match-invitation.repository';
import { MatchRepository } from './match.repository';
import { PostgresMatchInvitationRepository } from './postgres-match-invitation.repository';
import { PostgresTransaction } from './postgres-transaction';

const OWNER_ID = deterministicUuid('repository-invitation-owner') as AccountId;
const PLAYER_ID = deterministicUuid(
  'repository-invitation-player',
) as AccountId;
const MATCH_ID = deterministicUuid(
  'repository-invitation-match',
) as MatchId;
const INVITATION_ID = deterministicUuid(
  'repository-invitation-id',
) as MatchInvitationId;
const COMMAND_ID = deterministicUuid(
  'repository-invitation-command',
) as MatchInvitationCommandId;
const MATCH_COMMAND_ID = deterministicUuid(
  'repository-invitation-match-command',
) as MatchCommandId;
const PARTICIPANT_ID = deterministicUuid(
  'repository-invitation-participant',
) as MatchParticipantId;
const INVITATION_DIGEST = 'a'.repeat(
  64,
) as MatchInvitationRequestDigest;
const MATCH_DIGEST = 'b'.repeat(64) as MatchRequestDigest;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_SESSION_CREDENTIAL';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly queued: readonly (
      | QueryResult<QueryResultRow>
      | Error
    )[],
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const next = this.queued[this.calls.length - 1];
    if (next === undefined) throw new Error('Unexpected query');
    if (next instanceof Error) throw next;
    return next as QueryResult<Row>;
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

function matchRow(): QueryResultRow {
  return {
    id: MATCH_ID,
    owner_account_id: OWNER_ID,
    starts_at: '1800003600',
    scenario: 'social',
    status: 'confirmed',
    rating_min: 2,
    rating_max: 4,
    is_rating_match: true,
  };
}

function invitationRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    invitation_id: INVITATION_ID,
    match_id: MATCH_ID,
    invited_by_account_id: OWNER_ID,
    invited_account_id: PLAYER_ID,
    slot_number: 2,
    invitation_status: 'pending',
    created_at: '1800000000',
    updated_at: '1800000000',
    responded_at: null,
    version: '1',
    match_id_value: MATCH_ID,
    owner_account_id: OWNER_ID,
    starts_at: '1800003600',
    duration_minutes: 90,
    court_id: 'court-1',
    court_name: 'Synthetic court',
    court_type: 'panoramic',
    scenario: 'social',
    match_status: 'confirmed',
    title: null,
    rating_min: 2,
    rating_max: 4,
    is_rating_match: true,
    price_per_person_snapshot: '1000.00',
    ...overrides,
  };
}

function commandRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    command_id: COMMAND_ID,
    invitation_id: INVITATION_ID,
    match_id: MATCH_ID,
    actor_account_id: OWNER_ID,
    request_digest: Buffer.from(INVITATION_DIGEST, 'hex'),
    command_type: 'create_invitation',
    result_type: 'invitation_created',
    applied_at: '1800000000',
    invitation_version: '1',
    match_status: 'confirmed',
    participant_id: null,
    match_version: null,
    ...overrides,
  };
}

function createInput(
  overrides: Partial<CreateMatchInvitationInput> = {},
): CreateMatchInvitationInput {
  return {
    commandId: COMMAND_ID,
    invitationId: INVITATION_ID,
    matchId: MATCH_ID,
    actorAccountId: OWNER_ID,
    invitedAccountId: PLAYER_ID,
    slotNumber: 2,
    requestDigest: INVITATION_DIGEST,
    now: NOW,
    ...overrides,
  };
}

function matches(): jest.Mocked<MatchRepository> {
  return {
    create: jest.fn(),
    listPublicFeed: jest.fn(),
    listAccountFeed: jest.fn(),
    findVisibleById: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    updateDescription: jest.fn(),
  };
}

describe('PostgresMatchInvitationRepository', () => {
  it('locks the aggregate, reserves the exact slot and appends an immutable command', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ locked: '' }]),
      queryResult([]),
      queryResult([matchRow()]),
      queryResult([]),
      queryResult([]),
      queryResult([
        {
          id: PLAYER_ID,
          status: 'active',
          role: 'player',
          rating: '3.00',
          is_verified: true,
        },
      ]),
      queryResult([{ id: INVITATION_ID }], 1, 'INSERT'),
      queryResult([invitationRow()]),
      queryResult([{ command_id: COMMAND_ID }], 1, 'INSERT'),
    ]);

    await expect(
      new PostgresMatchInvitationRepository(matches()).create(
        transaction,
        createInput(),
      ),
    ).resolves.toMatchObject({
      outcome: 'invitation_created',
      persistence: 'applied',
      invitation: {
        invitationId: INVITATION_ID,
        invitedAccountId: PLAYER_ID,
        slotNumber: 2,
        status: 'pending',
      },
    });

    const operations = transaction.calls.map(({ text }) => {
      const sql = text.replace(/\s+/gu, ' ').trim();
      if (sql.includes('pg_advisory_xact_lock')) return 'command_lock';
      if (sql.includes('FROM backend_match.match_invitation_commands'))
        return 'command_read';
      if (sql.includes('FROM backend_match.matches')) return 'match_lock';
      if (sql.includes('FROM backend_match.match_participants'))
        return 'participant_lock';
      if (
        sql.includes('FROM backend_match.match_invitations') &&
        sql.includes("status = 'pending'")
      )
        return 'invitation_lock';
      if (sql.includes('FROM backend_auth.accounts')) return 'candidate';
      if (sql.startsWith('INSERT INTO backend_match.match_invitations'))
        return 'invitation_write';
      if (
        sql.startsWith(
          'INSERT INTO backend_match.match_invitation_commands',
        )
      )
        return 'command_write';
      return 'result_read';
    });
    expect(operations).toEqual([
      'command_lock',
      'command_read',
      'match_lock',
      'participant_lock',
      'invitation_lock',
      'candidate',
      'invitation_write',
      'result_read',
      'command_write',
    ]);
    expect(transaction.calls[6].values).toEqual([
      INVITATION_ID,
      MATCH_ID,
      OWNER_ID,
      PLAYER_ID,
      2,
      NOW,
    ]);
    expect(
      JSON.stringify(
        transaction.calls.map((call) => ({
          text: call.text,
          values: call.values,
        })),
      ),
    ).not.toContain(PRIVATE_MARKER);
  });

  it('returns the original create result for an exact retry without writes', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ locked: '' }]),
      queryResult([commandRow()]),
      queryResult([
        invitationRow({
          invitation_status: 'cancelled',
          updated_at: '1800000100',
          responded_at: '1800000100',
          version: '2',
          match_status: 'upcoming',
        }),
      ]),
    ]);

    await expect(
      new PostgresMatchInvitationRepository(matches()).create(
        transaction,
        createInput(),
      ),
    ).resolves.toMatchObject({
      outcome: 'invitation_created',
      persistence: 'idempotent_retry',
      invitation: {
        status: 'pending',
        updatedAt: NOW,
        version: 1,
        match: { status: 'confirmed' },
      },
    });
    expect(transaction.calls).toHaveLength(3);
    expect(
      transaction.calls.some((call) =>
        call.text.trimStart().startsWith('INSERT'),
      ),
    ).toBe(false);
  });

  it('accepts through MatchRepository.join and closes the reservation atomically', async () => {
    const matchRepository = matches();
    matchRepository.join.mockResolvedValue({
      outcome: 'participant_joined',
      persistence: 'applied',
      participant: Object.freeze({
        participantId: PARTICIPANT_ID,
        accountId: PLAYER_ID,
        slotNumber: 2,
        status: 'active',
        joinedAt: NOW,
        updatedAt: NOW,
        version: 1,
      }),
      matchVersion: 2,
    });
    const acceptedAt = unixEpochSeconds(Number(NOW) + 1);
    const transaction = new FakeTransaction([
      queryResult([{ locked: '' }]),
      queryResult([]),
      queryResult([invitationRow()]),
      queryResult([{ id: INVITATION_ID }], 1, 'UPDATE'),
      queryResult([
        invitationRow({
          invitation_status: 'accepted',
          updated_at: String(acceptedAt),
          responded_at: String(acceptedAt),
          version: '2',
        }),
      ]),
      queryResult([{ command_id: COMMAND_ID }], 1, 'INSERT'),
    ]);

    await expect(
      new PostgresMatchInvitationRepository(matchRepository).accept(
        transaction,
        {
          commandId: COMMAND_ID,
          invitationId: INVITATION_ID,
          actorAccountId: PLAYER_ID,
          requestDigest: INVITATION_DIGEST,
          now: acceptedAt,
          matchCommandId: MATCH_COMMAND_ID,
          matchRequestDigest: MATCH_DIGEST,
          participantId: PARTICIPANT_ID,
        },
      ),
    ).resolves.toMatchObject({
      outcome: 'invitation_accepted',
      persistence: 'applied',
      invitation: { status: 'accepted', version: 2 },
      participant: {
        participantId: PARTICIPANT_ID,
        slotNumber: 2,
      },
      matchVersion: 2,
    });
    expect(matchRepository.join).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        matchId: MATCH_ID,
        actorAccountId: PLAYER_ID,
        invitationId: INVITATION_ID,
      }),
    );
    expect(transaction.calls[3].text).toContain(
      'UPDATE backend_match.match_invitations',
    );
  });

  it('rejects terminal invitation acceptance before invoking match mutation', async () => {
    const matchRepository = matches();
    const transaction = new FakeTransaction([
      queryResult([{ locked: '' }]),
      queryResult([]),
      queryResult([
        invitationRow({
          invitation_status: 'declined',
          updated_at: '1800000100',
          responded_at: '1800000100',
          version: '2',
        }),
      ]),
    ]);

    await expect(
      new PostgresMatchInvitationRepository(matchRepository).accept(
        transaction,
        {
          commandId: COMMAND_ID,
          invitationId: INVITATION_ID,
          actorAccountId: PLAYER_ID,
          requestDigest: INVITATION_DIGEST,
          now: NOW,
          matchCommandId: MATCH_COMMAND_ID,
          matchRequestDigest: MATCH_DIGEST,
          participantId: PARTICIPANT_ID,
        },
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invitation_closed',
    });
    expect(matchRepository.join).not.toHaveBeenCalled();
  });

  it('declines a pending invitation after locking match then invitation', async () => {
    const respondedAt = unixEpochSeconds(Number(NOW) + 1);
    const terminalRow = invitationRow({
      invitation_status: 'declined',
      updated_at: String(respondedAt),
      responded_at: String(respondedAt),
      version: '2',
    });
    const transaction = new FakeTransaction([
      queryResult([{ locked: '' }]),
      queryResult([]),
      queryResult([invitationRow()]),
      queryResult([matchRow()]),
      queryResult([invitationRow()]),
      queryResult([{ id: INVITATION_ID }], 1, 'UPDATE'),
      queryResult([terminalRow]),
      queryResult([{ command_id: COMMAND_ID }], 1, 'INSERT'),
    ]);

    await expect(
      new PostgresMatchInvitationRepository(matches()).decline(
        transaction,
        {
          commandId: COMMAND_ID,
          invitationId: INVITATION_ID,
          actorAccountId: PLAYER_ID,
          requestDigest: INVITATION_DIGEST,
          now: respondedAt,
        },
      ),
    ).resolves.toMatchObject({
      outcome: 'invitation_declined',
      persistence: 'applied',
      invitation: {
        status: 'declined',
        respondedAt,
        version: 2,
      },
    });
    expect(transaction.calls[3].text).toContain(
      'FROM backend_match.matches',
    );
    expect(transaction.calls[4].text).toContain(
      'FOR UPDATE OF invitations',
    );
    expect(transaction.calls[7].values).toEqual(
      expect.arrayContaining([
        'decline_invitation',
        'invitation_declined',
        'confirmed',
      ]),
    );
  });

  it('classifies PostgreSQL permission errors without database details', async () => {
    const error = Object.assign(new Error(PRIVATE_MARKER), {
      code: '42501',
      schema: 'backend_match',
      table: 'match_invitations',
    });
    const transaction = new FakeTransaction([error]);

    await expect(
      new PostgresMatchInvitationRepository(matches()).create(
        transaction,
        createInput(),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<MatchInvitationPersistenceError>>({
        reason: 'permission_denied',
        message: 'Match invitation persistence failed',
      }),
    );
    await expect(
      new PostgresMatchInvitationRepository(matches()).create(
        new FakeTransaction([error]),
        createInput(),
      ),
    ).rejects.not.toThrow(PRIVATE_MARKER);
  });
});
