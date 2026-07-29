import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchInvitationPersistenceError,
  MatchInvitationRepository,
} from '../database/match-invitation.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { PublicPlayerProfileSearchRepository } from '../database/public-player-profile-search.repository';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  MatchId,
  MatchInvitationId,
  MatchParticipantId,
} from './match.types';
import { MatchInvitationRecord } from './match-invitation.types';
import { MatchInvitationService } from './match-invitation.service';

const OWNER_ID = deterministicUuid('invitation-owner') as AccountId;
const PLAYER_ID = deterministicUuid('invitation-player') as AccountId;
const OTHER_PLAYER_ID = deterministicUuid(
  'invitation-other-player',
) as AccountId;
const MATCH_ID = deterministicUuid('invitation-match') as MatchId;
const INVITATION_ID = deterministicUuid(
  'invitation-record',
) as MatchInvitationId;
const PARTICIPANT_ID = deterministicUuid(
  'invitation-participant',
) as MatchParticipantId;
const REQUEST_KEY = deterministicUuid('invitation-request');
const NOW = unixEpochSeconds(1_800_000_000);

const transaction = Object.freeze({
  query: jest.fn(),
}) as unknown as PostgresTransaction;

function invitation(
  overrides: Partial<MatchInvitationRecord> = {},
): MatchInvitationRecord {
  return Object.freeze({
    invitationId: INVITATION_ID,
    matchId: MATCH_ID,
    invitedByAccountId: OWNER_ID,
    invitedAccountId: PLAYER_ID,
    slotNumber: 2,
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    match: Object.freeze({
      matchId: MATCH_ID,
      ownerAccountId: OWNER_ID,
      startsAt: unixEpochSeconds(1_800_003_600),
      durationMinutes: 90,
      courtId: 'court-1',
      courtName: 'Synthetic court',
      courtType: 'panoramic',
      scenario: 'social',
      status: 'confirmed',
      ratingMin: 2,
      ratingMax: 4,
      isRatingMatch: true,
    }),
    ...overrides,
  });
}

function repository(): jest.Mocked<MatchInvitationRepository> {
  return {
    create: jest.fn(),
    listIncoming: jest.fn(),
    listOutgoing: jest.fn(),
    accept: jest.fn(),
    decline: jest.fn(),
    cancel: jest.fn(),
  };
}

function profiles(): jest.Mocked<
  Pick<PublicPlayerProfileSearchRepository, 'findByPlayerIds'>
> {
  return {
    findByPlayerIds: jest.fn().mockResolvedValue({
      outcome: 'found',
      players: [
        {
          playerId: OWNER_ID,
          firstName: 'Owner',
          rating: 3,
          isVerified: true,
        },
        {
          playerId: PLAYER_ID,
          firstName: 'Player',
          rating: 3,
          isVerified: true,
        },
      ],
    }),
  };
}

function service(
  invitations = repository(),
  publicProfiles = profiles(),
) {
  return {
    invitations,
    publicProfiles,
    service: new MatchInvitationService({
      transactions: {
        run: (operation) => operation(transaction),
      },
      invitations,
      publicProfiles,
      clock: { nowEpochSeconds: () => NOW },
    }),
  };
}

describe('MatchInvitationService', () => {
  it('creates deterministic bindings and enriches the private invitation record', async () => {
    const harness = service();
    harness.invitations.create.mockResolvedValue({
      outcome: 'invitation_created',
      persistence: 'applied',
      invitation: invitation(),
    });

    await expect(
      harness.service.create({
        accountId: OWNER_ID,
        role: 'player',
        matchId: MATCH_ID,
        request: {
          requestKey: REQUEST_KEY,
          playerId: PLAYER_ID,
          slotNumber: 2,
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'invitation_created',
      invitation: {
        invitedPlayer: { playerId: PLAYER_ID, firstName: 'Player' },
        match: {
          owner: { playerId: OWNER_ID, firstName: 'Owner' },
        },
      },
    });

    const persistenceInput =
      harness.invitations.create.mock.calls[0][1];
    expect(persistenceInput).toMatchObject({
      matchId: MATCH_ID,
      actorAccountId: OWNER_ID,
      invitedAccountId: PLAYER_ID,
      slotNumber: 2,
      now: NOW,
    });
    expect(persistenceInput.commandId).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(persistenceInput.requestDigest).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(JSON.stringify(persistenceInput)).not.toContain(
      'credential',
    );
  });

  it('binds command identity to requestKey and detects changed create payload through the digest', async () => {
    const harness = service();
    harness.invitations.create.mockResolvedValue({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
    });

    await harness.service.create({
      accountId: OWNER_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: {
        requestKey: REQUEST_KEY,
        playerId: PLAYER_ID,
        slotNumber: 2,
      },
    });
    await harness.service.create({
      accountId: OWNER_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: {
        requestKey: REQUEST_KEY,
        playerId: OTHER_PLAYER_ID,
        slotNumber: 3,
      },
    });

    const first = harness.invitations.create.mock.calls[0][1];
    const second = harness.invitations.create.mock.calls[1][1];
    expect(second.commandId).toBe(first.commandId);
    expect(second.invitationId).toBe(first.invitationId);
    expect(second.requestDigest).not.toBe(first.requestDigest);
  });

  it('accepts through separate deterministic invitation and match bindings', async () => {
    const harness = service();
    harness.invitations.accept.mockResolvedValue({
      outcome: 'invitation_accepted',
      persistence: 'applied',
      invitation: invitation({
        status: 'accepted',
        updatedAt: unixEpochSeconds(Number(NOW) + 1),
        respondedAt: unixEpochSeconds(Number(NOW) + 1),
        version: 2,
      }),
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

    await expect(
      harness.service.accept({
        accountId: PLAYER_ID,
        role: 'player',
        invitationId: INVITATION_ID,
        request: { requestKey: REQUEST_KEY },
      }),
    ).resolves.toMatchObject({
      outcome: 'invitation_accepted',
      result: {
        participant: {
          participantId: PARTICIPANT_ID,
          accountId: PLAYER_ID,
          slotNumber: 2,
          status: 'active',
        },
        matchVersion: 2,
      },
    });

    const input = harness.invitations.accept.mock.calls[0][1];
    expect(input.commandId).not.toBe(input.matchCommandId);
    expect(input.requestDigest).not.toBe(input.matchRequestDigest);
    expect(input.participantId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('maps conflicts and storage failures without exposing internals', async () => {
    const conflict = service();
    conflict.invitations.decline.mockResolvedValue({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
    });
    await expect(
      conflict.service.decline({
        accountId: PLAYER_ID,
        role: 'player',
        invitationId: INVITATION_ID,
        request: { requestKey: REQUEST_KEY },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'request_conflict',
    });

    const failed = service();
    failed.invitations.listIncoming.mockRejectedValue(
      new MatchInvitationPersistenceError('permission_denied'),
    );
    const result = await failed.service.listIncoming({
      accountId: PLAYER_ID,
      role: 'player',
      request: { limit: 20 },
    });
    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    expect(JSON.stringify(result)).not.toContain('permission');
  });

  it('rejects non-player mutation actors and malformed inputs before persistence', async () => {
    const harness = service();

    await expect(
      harness.service.create({
        accountId: OWNER_ID,
        role: 'club_admin',
        matchId: MATCH_ID,
        request: {
          requestKey: REQUEST_KEY,
          playerId: PLAYER_ID,
          slotNumber: 2,
        },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'forbidden',
    });
    expect(harness.invitations.create).not.toHaveBeenCalled();
  });
});
