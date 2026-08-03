import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchNotificationRepository } from '../database/match-notification.repository';
import { MatchWaitlistRepository } from '../database/match-waitlist.repository';
import { MatchRepository } from '../database/match.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { PublicPlayerProfileSearchRepository } from '../database/public-player-profile-search.repository';
import { MatchWaitlistEntryId } from './match-waitlist.types';
import { MatchWaitlistService } from './match-waitlist.service';
import { MatchId, MatchParticipantId } from './match.types';

const ACTOR_ID = deterministicUuid('waitlist-service-actor') as AccountId;
const OTHER_ID = deterministicUuid('waitlist-service-other') as AccountId;
const MATCH_ID = deterministicUuid('waitlist-service-match') as MatchId;
const ENTRY_ID = deterministicUuid('waitlist-service-entry') as MatchWaitlistEntryId;
const REQUEST_KEY = deterministicUuid('waitlist-service-request');
const NOW = unixEpochSeconds(1_800_000_000);
const transaction = Object.freeze({ query: jest.fn() }) as unknown as PostgresTransaction;

function waitlist(): jest.Mocked<MatchWaitlistRepository> {
  return {
    join: jest.fn(),
    leave: jest.fn(),
    list: jest.fn(),
    readPromotionCandidate: jest.fn(),
    resolvePromotion: jest.fn(),
    resolveWaitingAccount: jest.fn(),
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

function notifications(): jest.Mocked<MatchNotificationRepository> {
  return {
    list: jest.fn(),
    markRead: jest.fn(),
    createWaitlistPromotion: jest.fn().mockImplementation(
      async (_transaction, input) => ({
        outcome: 'notification_created' as const,
        persistence: 'applied' as const,
        notification: {
          notificationId: input.notificationId,
          waitlistEntryId: input.waitlistEntryId,
          matchId: input.matchId,
          recipientAccountId: input.recipientAccountId,
          notificationType: 'waitlist_promoted' as const,
          createdAt: input.now,
        },
      }),
    ),
  };
}

function harness() {
  const queue = waitlist();
  const matchRepository = matches();
  const notificationRepository = notifications();
  const enqueueMatchNotification = jest.fn().mockResolvedValue(undefined);
  const findByPlayerIds = jest.fn<
    ReturnType<PublicPlayerProfileSearchRepository['findByPlayerIds']>,
    Parameters<PublicPlayerProfileSearchRepository['findByPlayerIds']>
  >().mockResolvedValue({
    outcome: 'found',
    players: [{ playerId: ACTOR_ID, firstName: 'Player', rating: 3, isVerified: true }],
  });
  return {
    queue,
    matches: matchRepository,
    notifications: notificationRepository,
    enqueueMatchNotification,
    findByPlayerIds,
    service: new MatchWaitlistService({
      transactions: { run: (operation) => operation(transaction) },
      waitlist: queue,
      matches: matchRepository,
      notifications: notificationRepository,
      notificationOutbox: { enqueueMatchNotification },
      publicProfiles: { findByPlayerIds },
      clock: { nowEpochSeconds: () => NOW },
    }),
  };
}

function waiting(accountId = ACTOR_ID, position = 1) {
  return Object.freeze({
    entryId: ENTRY_ID,
    matchId: MATCH_ID,
    accountId,
    status: 'waiting' as const,
    joinedAt: NOW,
    updatedAt: NOW,
    version: 1 as const,
    queuePosition: position,
  });
}

describe('MatchWaitlistService', () => {
  it('derives stable provider-neutral join bindings and maps immutable result data', async () => {
    const test = harness();
    test.queue.join.mockImplementation(async (_transaction, input) => ({
      outcome: 'waitlist_joined',
      persistence: 'applied',
      entry: {
        entryId: input.entryId,
        matchId: input.matchId,
        status: 'waiting',
        appliedAt: input.now,
        version: 1,
      },
    }));
    const input = {
      accountId: ACTOR_ID,
      role: 'player' as const,
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY },
    };
    await expect(test.service.join(input)).resolves.toMatchObject({ outcome: 'waitlist_joined' });
    await test.service.join(input);
    const first = test.queue.join.mock.calls[0][1];
    const retry = test.queue.join.mock.calls[1][1];
    expect(first).toEqual(retry);
    expect(first.commandId).not.toBe(first.entryId);
    expect(first.requestDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(first)).not.toContain('credential');
  });

  it('returns FIFO entries and independently exposes the current player position', async () => {
    const test = harness();
    test.queue.list.mockResolvedValue({
      outcome: 'found',
      entries: [waiting(OTHER_ID, 1)],
      current: waiting(ACTOR_ID, 4),
      count: 4,
    });
    await expect(test.service.list({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { limit: 1 },
    })).resolves.toEqual({
      outcome: 'found',
      entries: [{
        entryId: ENTRY_ID,
        player: { unavailable: true },
        queuePosition: 1,
        joinedAt: NOW,
        isCurrentPlayer: false,
      }],
      current: {
        entryId: ENTRY_ID,
        player: { playerId: ACTOR_ID, firstName: 'Player', rating: 3, isVerified: true },
        queuePosition: 4,
        joinedAt: NOW,
        isCurrentPlayer: true,
      },
      count: 4,
    });
  });

  it('promotes FIFO candidates through the trusted match join and skips stale players', async () => {
    const test = harness();
    const stale = waiting(OTHER_ID, 1);
    const eligible = waiting(ACTOR_ID, 1);
    test.queue.readPromotionCandidate
      .mockResolvedValueOnce({ outcome: 'candidate', entry: stale, playerIsActive: false })
      .mockResolvedValueOnce({ outcome: 'candidate', entry: eligible, playerIsActive: true })
      .mockResolvedValueOnce({ outcome: 'empty' });
    test.matches.join.mockResolvedValue({
      outcome: 'participant_joined',
      persistence: 'applied',
      participant: {
        participantId: deterministicUuid('waitlist-service-participant') as MatchParticipantId,
        accountId: ACTOR_ID,
        slotNumber: 2,
        status: 'active',
        joinedAt: NOW,
        updatedAt: NOW,
        version: 1,
      },
      matchVersion: 2,
    });
    await expect(test.service.promoteAvailable(transaction, MATCH_ID, NOW)).resolves.toBe(1);
    expect(test.queue.resolvePromotion).toHaveBeenNthCalledWith(1, transaction, {
      entryId: stale.entryId,
      matchId: MATCH_ID,
      accountId: OTHER_ID,
      outcome: 'skipped',
      now: NOW,
    });
    expect(test.matches.join).toHaveBeenCalledWith(transaction, expect.objectContaining({
      type: 'join_match',
      matchId: MATCH_ID,
      actorAccountId: ACTOR_ID,
    }));
    expect(test.queue.resolvePromotion).toHaveBeenNthCalledWith(2, transaction, expect.objectContaining({
      outcome: 'promoted',
      accountId: ACTOR_ID,
    }));
    expect(test.notifications.createWaitlistPromotion).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        waitlistEntryId: ENTRY_ID,
        matchId: MATCH_ID,
        recipientAccountId: ACTOR_ID,
        now: NOW,
      }),
    );
    const firstNotification =
      test.notifications.createWaitlistPromotion.mock.calls[0][1];
    expect(firstNotification.notificationId).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(test.enqueueMatchNotification).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        matchNotificationId: firstNotification.notificationId,
        now: NOW,
      }),
    );
  });

  it('stops FIFO promotion without consuming the first entry when no slot is free', async () => {
    const test = harness();
    test.queue.readPromotionCandidate.mockResolvedValue({ outcome: 'candidate', entry: waiting(), playerIsActive: true });
    test.matches.join.mockResolvedValue({ outcome: 'rejected', reason: 'match_full' });
    await expect(test.service.promoteAvailable(transaction, MATCH_ID, NOW)).resolves.toBe(0);
    expect(test.queue.resolvePromotion).not.toHaveBeenCalled();
    expect(test.queue.readPromotionCandidate).toHaveBeenCalledTimes(1);
  });

  it('bounds defensive FIFO retries so a primary mutation cannot hold locks indefinitely', async () => {
    const test = harness();
    test.queue.readPromotionCandidate.mockResolvedValue({
      outcome: 'candidate',
      entry: waiting(),
      playerIsActive: false,
    });

    await expect(
      test.service.promoteAvailable(transaction, MATCH_ID, NOW),
    ).resolves.toBe(0);
    expect(test.queue.readPromotionCandidate).toHaveBeenCalledTimes(8);
    expect(test.queue.resolvePromotion).toHaveBeenCalledTimes(8);
    expect(test.matches.join).not.toHaveBeenCalled();
    expect(test.notifications.createWaitlistPromotion).not.toHaveBeenCalled();
    expect(test.enqueueMatchNotification).not.toHaveBeenCalled();
  });

  it('fails the surrounding promotion transaction when notification persistence fails', async () => {
    const test = harness();
    test.queue.readPromotionCandidate.mockResolvedValueOnce({
      outcome: 'candidate',
      entry: waiting(),
      playerIsActive: true,
    });
    test.matches.join.mockResolvedValue({
      outcome: 'participant_joined',
      persistence: 'applied',
      participant: {
        participantId: deterministicUuid(
          'waitlist-notification-rollback-participant',
        ) as MatchParticipantId,
        accountId: ACTOR_ID,
        slotNumber: 2,
        status: 'active',
        joinedAt: NOW,
        updatedAt: NOW,
        version: 1,
      },
      matchVersion: 2,
    });
    test.notifications.createWaitlistPromotion.mockRejectedValue(
      new Error('synthetic notification failure'),
    );

    await expect(
      test.service.promoteAvailable(transaction, MATCH_ID, NOW),
    ).rejects.toThrow('synthetic notification failure');
    expect(test.queue.resolvePromotion).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ outcome: 'promoted' }),
    );
  });

  it('rejects admin mutations and maps command reuse without persistence details', async () => {
    const test = harness();
    await expect(test.service.join({
      accountId: ACTOR_ID,
      role: 'club_admin',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'forbidden' });
    expect(test.queue.join).not.toHaveBeenCalled();
    test.queue.leave.mockResolvedValue({ outcome: 'rejected', reason: 'command_reuse_conflict' });
    await expect(test.service.leave({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'request_conflict' });
  });
});
