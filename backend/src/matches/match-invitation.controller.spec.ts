import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { SessionAuthenticationResult } from '../auth/session-authentication.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { MatchInvitationController } from './match-invitation.controller';
import {
  MatchInvitationApiListResult,
  MatchInvitationApiMutationResult,
} from './match-invitation-api.types';
import { MatchInvitationService } from './match-invitation.service';
import {
  MatchId,
  MatchInvitationId,
  MatchParticipantId,
} from './match.types';

const CREDENTIAL = Buffer.alloc(32, 0x72).toString('base64url');
const OWNER_ID = deterministicUuid(
  'invitation-controller-owner',
) as AccountId;
const PLAYER_ID = deterministicUuid(
  'invitation-controller-player',
) as AccountId;
const MATCH_ID = deterministicUuid(
  'invitation-controller-match',
) as MatchId;
const INVITATION_ID = deterministicUuid(
  'invitation-controller-id',
) as MatchInvitationId;
const REQUEST_KEY = deterministicUuid(
  'invitation-controller-request',
);
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_INVITATION_CONTROLLER_PRIVATE';

function invitation() {
  return {
    invitationId: INVITATION_ID,
    matchId: MATCH_ID,
    invitedByAccountId: OWNER_ID,
    invitedAccountId: PLAYER_ID,
    slotNumber: 2 as const,
    status: 'pending' as const,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    match: {
      matchId: MATCH_ID,
      ownerAccountId: OWNER_ID,
      startsAt: unixEpochSeconds(Number(NOW) + 3_600),
      durationMinutes: 90 as const,
      courtId: 'court-1',
      courtName: 'Court 1',
      courtType: 'panoramic',
      scenario: 'social' as const,
      status: 'confirmed' as const,
      ratingMin: 2,
      ratingMax: 4,
      isRatingMatch: true,
      owner: {
        playerId: OWNER_ID,
        firstName: 'Owner',
        rating: 3,
        isVerified: true,
      },
    },
    invitedPlayer: {
      playerId: PLAYER_ID,
      firstName: 'Player',
      rating: 3,
      isVerified: true,
    },
  };
}

interface Harness {
  readonly app: NestFastifyApplication;
  readonly create: jest.Mock<
    Promise<MatchInvitationApiMutationResult>,
    [unknown]
  >;
  readonly listIncoming: jest.Mock<
    Promise<MatchInvitationApiListResult>,
    [unknown]
  >;
  readonly listOutgoing: jest.Mock<
    Promise<MatchInvitationApiListResult>,
    [unknown]
  >;
  readonly accept: jest.Mock<
    Promise<MatchInvitationApiMutationResult>,
    [unknown]
  >;
  readonly decline: jest.Mock<
    Promise<MatchInvitationApiMutationResult>,
    [unknown]
  >;
  readonly cancel: jest.Mock<
    Promise<MatchInvitationApiMutationResult>,
    [unknown]
  >;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [unknown]
  >;
  readonly logs: readonly unknown[][];
}

async function createHarness(): Promise<Harness> {
  const create = jest.fn<
    Promise<MatchInvitationApiMutationResult>,
    [unknown]
  >()
    .mockResolvedValue({
      outcome: 'invitation_created',
      invitation: invitation(),
    });
  const listIncoming =
    jest.fn<
      Promise<MatchInvitationApiListResult>,
      [unknown]
    >().mockResolvedValue({
      outcome: 'found',
      invitations: [invitation()],
    });
  const listOutgoing =
    jest.fn<
      Promise<MatchInvitationApiListResult>,
      [unknown]
    >().mockResolvedValue({
      outcome: 'found',
      invitations: [invitation()],
    });
  const accept = jest.fn<
    Promise<MatchInvitationApiMutationResult>,
    [unknown]
  >()
    .mockResolvedValue({
      outcome: 'invitation_accepted',
      result: {
        invitation: {
          ...invitation(),
          status: 'accepted',
          respondedAt: NOW,
          version: 2,
        },
        participant: {
          participantId: deterministicUuid(
            'invitation-controller-participant',
          ) as MatchParticipantId,
          accountId: PLAYER_ID,
          slotNumber: 2,
          status: 'active',
        },
        matchVersion: 2,
      },
    });
  const decline = jest.fn<
    Promise<MatchInvitationApiMutationResult>,
    [unknown]
  >()
    .mockResolvedValue({
      outcome: 'invitation_declined',
      invitation: {
        ...invitation(),
        status: 'declined',
        respondedAt: NOW,
        version: 2,
      },
    });
  const cancel = jest.fn<
    Promise<MatchInvitationApiMutationResult>,
    [unknown]
  >()
    .mockResolvedValue({
      outcome: 'invitation_cancelled',
      invitation: {
        ...invitation(),
        status: 'cancelled',
        respondedAt: NOW,
        version: 2,
      },
    });
  const authenticate = jest
    .fn<Promise<SessionAuthenticationResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: OWNER_ID,
        role: 'player',
        expiresAt: unixEpochSeconds(Number(NOW) + 3_600),
      },
    });
  const moduleRef = await Test.createTestingModule({
    controllers: [MatchInvitationController],
    providers: [
      SessionBearerGuard,
      {
        provide: MatchInvitationService,
        useValue: {
          create,
          listIncoming,
          listOutgoing,
          accept,
          decline,
          cancel,
        },
      },
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: SESSION_AUTHENTICATION_CLOCK,
        useValue: { nowEpochSeconds: () => NOW },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  const logs: unknown[][] = [];
  const capture = (...values: unknown[]) => logs.push(values);
  app.useLogger({
    log: capture,
    error: capture,
    warn: capture,
    debug: capture,
    verbose: capture,
    fatal: capture,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    create,
    listIncoming,
    listOutgoing,
    accept,
    decline,
    cancel,
    authenticate,
    logs,
  };
}

function headers() {
  return { authorization: `Bearer ${CREDENTIAL}` };
}

describe('MatchInvitationController', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('serves create, incoming, outgoing and accept through bearer auth with no-store headers', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/invitations`,
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        playerId: PLAYER_ID,
        slotNumber: 2,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.headers.pragma).toBe('no-cache');

    const incoming = await harness.app.inject({
      method: 'GET',
      url: '/match-invitations?limit=20',
      headers: headers(),
    });
    const outgoing = await harness.app.inject({
      method: 'GET',
      url: `/matches/${MATCH_ID}/invitations?limit=20`,
      headers: headers(),
    });
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/match-invitations/${INVITATION_ID}/accept`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY },
    });
    const declined = await harness.app.inject({
      method: 'POST',
      url: `/match-invitations/${INVITATION_ID}/decline`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY },
    });
    const cancelled = await harness.app.inject({
      method: 'POST',
      url: `/match-invitations/${INVITATION_ID}/cancel`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY },
    });

    expect(incoming.statusCode).toBe(200);
    expect(outgoing.statusCode).toBe(200);
    expect(accepted.statusCode).toBe(201);
    expect(declined.statusCode).toBe(201);
    expect(cancelled.statusCode).toBe(201);
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.listIncoming).toHaveBeenCalledTimes(1);
    expect(harness.listOutgoing).toHaveBeenCalledTimes(1);
    expect(harness.accept).toHaveBeenCalledTimes(1);
    expect(harness.decline).toHaveBeenCalledTimes(1);
    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.authenticate).toHaveBeenCalledTimes(6);
  });

  it('rejects missing bearer and strict body/query violations before service calls', async () => {
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/match-invitations',
        })
      ).statusCode,
    ).toBe(401);

    const invalidBody = await harness.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/invitations`,
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        playerId: PLAYER_ID,
        slotNumber: 2,
        credential: PRIVATE_MARKER,
      },
    });
    const invalidQuery = await harness.app.inject({
      method: 'GET',
      url: '/match-invitations?limit=21',
      headers: headers(),
    });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidQuery.statusCode).toBe(400);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.listIncoming).not.toHaveBeenCalled();
    expect(JSON.stringify(invalidBody.json())).not.toContain(
      PRIVATE_MARKER,
    );
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });

  it('maps domain and persistence-facing failures to safe public errors', async () => {
    harness.create.mockResolvedValueOnce({
      outcome: 'rejected',
      reason: 'slot_unavailable',
    });
    const conflict = await harness.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/invitations`,
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        playerId: PLAYER_ID,
        slotNumber: 2,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      code: 'match_invitation_slot_unavailable',
    });

    harness.listIncoming.mockResolvedValueOnce({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    const failed = await harness.app.inject({
      method: 'GET',
      url: '/match-invitations',
      headers: headers(),
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({
      statusCode: 500,
      code: 'match_invitation_internal_error',
      message: 'Match invitation request failed',
    });
  });
});
