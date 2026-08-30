import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchNotificationRepository } from '../database/match-notification.repository';
import { MatchWaitlistOfferRepository } from '../database/match-waitlist-offer.repository';
import { MatchWaitlistRepository } from '../database/match-waitlist.repository';
import { MatchRepository } from '../database/match.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { PublicPlayerProfileSearchRepository } from '../database/public-player-profile-search.repository';
import {
  MatchWaitlistOfferId,
  MatchWaitlistOfferRecord,
} from './match-waitlist-offer.types';
import { MatchWaitlistEntryId } from './match-waitlist.types';
import { MatchWaitlistService } from './match-waitlist.service';
import { MatchId, MatchParticipantId } from './match.types';

const ACTOR_ID = deterministicUuid('waitlist-service-actor') as AccountId;
const OTHER_ID = deterministicUuid('waitlist-service-other') as AccountId;
const MATCH_ID = deterministicUuid('waitlist-service-match') as MatchId;
const ENTRY_ID = deterministicUuid('waitlist-service-entry') as MatchWaitlistEntryId;
const OFFER_ID = deterministicUuid('waitlist-service-offer') as MatchWaitlistOfferId;
const REQUEST_KEY = deterministicUuid('waitlist-service-request');
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(Number(NOW) + 15 * 60);
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

function offers(): jest.Mocked<MatchWaitlistOfferRepository> {
  return {
    create: jest.fn(),
    readCurrentForAccount: jest.fn(),
    readAction: jest.fn(),
    resolve: jest.fn(),
    listDueMatchIds: jest.fn(),
    expireForMatch: jest.fn(),
  };
}

function harness(offersEnabled = false) {
  const queue = waitlist();
  const matchRepository = matches();
  const notificationRepository = notifications();
  const offerRepository = offers();
  queue.readPromotionCandidate.mockResolvedValue({ outcome: 'empty' });
  const enqueueDirect = jest.fn().mockResolvedValue(undefined);
  const enqueueMatchOwner = jest.fn().mockResolvedValue(undefined);
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
    offers: offerRepository,
    enqueueDirect,
    enqueueMatchOwner,
    findByPlayerIds,
    service: new MatchWaitlistService({
      transactions: { run: (operation) => operation(transaction) },
      waitlist: queue,
      matches: matchRepository,
      notifications: notificationRepository,
      offers: offerRepository,
      offersEnabled,
      notificationIntents: { enqueueDirect, enqueueMatchOwner },
      publicProfiles: { findByPlayerIds },
      clock: { nowEpochSeconds: () => NOW },
    }),
  };
}

function activeOffer(
  entryId = ENTRY_ID,
  accountId = ACTOR_ID,
): MatchWaitlistOfferRecord & { readonly status: 'active' } {
  return Object.freeze({
    offerId: OFFER_ID,
    entryId,
    matchId: MATCH_ID,
    accountId,
    slotNumber: 2,
    status: 'active',
    offeredAt: NOW,
    expiresAt: EXPIRES_AT,
    updatedAt: NOW,
    version: 1,
  });
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

  it('exposes only the current player active offer when the feature is enabled', async () => {
    const test = harness(true);
    test.queue.list.mockResolvedValue({
      outcome: 'found',
      entries: [],
      current: waiting(ACTOR_ID, 1),
      count: 1,
    });
    test.offers.readCurrentForAccount.mockResolvedValue(activeOffer());

    await expect(test.service.list({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { limit: 50 },
    })).resolves.toMatchObject({
      outcome: 'found',
      offer: {
        offerId: OFFER_ID,
        status: 'active',
        offeredAt: NOW,
        expiresAt: EXPIRES_AT,
      },
    });
    expect(test.offers.readCurrentForAccount).toHaveBeenCalledWith(
      transaction,
      { matchId: MATCH_ID, accountId: ACTOR_ID, now: NOW },
    );
  });

  it('creates one reserved offer and notification intent without auto-joining', async () => {
    const test = harness(true);
    test.queue.readPromotionCandidate
      .mockResolvedValueOnce({
        outcome: 'candidate',
        entry: waiting(),
        playerIsActive: true,
      });
    test.offers.create.mockImplementation(async (_transaction, input) => ({
      outcome: 'created',
      offer: Object.freeze({
        ...activeOffer(),
        offerId: input.offerId,
        expiresAt: input.expiresAt,
      }),
    }));

    await expect(
      test.service.promoteAvailable(transaction, MATCH_ID, NOW),
    ).resolves.toBe(1);
    expect(test.matches.join).not.toHaveBeenCalled();
    expect(test.queue.resolvePromotion).not.toHaveBeenCalled();
    expect(test.enqueueDirect).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'waitlist_slot_available',
        recipientAccountId: ACTOR_ID,
        occurredAt: NOW,
      }),
    );
  });

  it('skips a candidate that became a participant or invitee before offering', async () => {
    const test = harness(true);
    const nextEntryId = deterministicUuid(
      'waitlist-service-offer-next-entry',
    ) as MatchWaitlistEntryId;
    test.queue.readPromotionCandidate
      .mockResolvedValueOnce({
        outcome: 'candidate',
        entry: waiting(),
        playerIsActive: true,
      })
      .mockResolvedValueOnce({
        outcome: 'candidate',
        entry: Object.freeze({
          ...waiting(OTHER_ID, 1),
          entryId: nextEntryId,
        }),
        playerIsActive: true,
      });
    test.offers.create
      .mockResolvedValueOnce({ outcome: 'candidate_unavailable' })
      .mockImplementationOnce(async (_transaction, input) => ({
        outcome: 'created',
        offer: Object.freeze({
          ...activeOffer(input.entryId, input.accountId),
          offerId: input.offerId,
        }),
      }));

    await expect(
      test.service.promoteAvailable(transaction, MATCH_ID, NOW),
    ).resolves.toBe(1);
    expect(test.queue.resolvePromotion).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        entryId: ENTRY_ID,
        accountId: ACTOR_ID,
        outcome: 'skipped',
      }),
    );
    expect(test.enqueueDirect).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ recipientAccountId: OTHER_ID }),
    );
  });

  it('accepts an offer once and returns the immutable result on an idempotent retry', async () => {
    const test = harness(true);
    const offer = activeOffer();
    const mutation = Object.freeze({
      offerId: OFFER_ID,
      matchId: MATCH_ID,
      status: 'accepted' as const,
      appliedAt: NOW,
      version: 2 as const,
    });
    test.offers.readAction
      .mockResolvedValueOnce({ outcome: 'ready', offer })
      .mockResolvedValueOnce({ outcome: 'idempotent_retry', mutation });
    test.offers.resolve.mockResolvedValue(mutation);
    test.matches.join.mockResolvedValue({
      outcome: 'participant_joined',
      persistence: 'applied',
      participant: {
        participantId: deterministicUuid('waitlist-offer-participant') as MatchParticipantId,
        accountId: ACTOR_ID,
        slotNumber: 2,
        status: 'active',
        joinedAt: NOW,
        updatedAt: NOW,
        version: 1,
      },
      matchVersion: 2,
    });
    const input = {
      accountId: ACTOR_ID,
      role: 'player' as const,
      matchId: MATCH_ID,
      request: { offerId: OFFER_ID, requestKey: REQUEST_KEY },
    };

    await expect(test.service.acceptOffer(input)).resolves.toEqual({
      outcome: 'waitlist_offer_accepted',
      offer: mutation,
    });
    await expect(test.service.acceptOffer(input)).resolves.toEqual({
      outcome: 'waitlist_offer_accepted',
      offer: mutation,
    });
    expect(test.matches.join).toHaveBeenCalledTimes(1);
    expect(test.matches.join).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ waitlistOfferId: OFFER_ID }),
    );
    expect(test.notifications.createWaitlistPromotion).toHaveBeenCalledTimes(1);
    expect(test.enqueueMatchOwner).toHaveBeenCalledTimes(1);
  });

  it('declines an offer and immediately advances FIFO to the next player', async () => {
    const test = harness(true);
    const nextEntryId = deterministicUuid(
      'waitlist-service-next-entry',
    ) as MatchWaitlistEntryId;
    const declined = Object.freeze({
      offerId: OFFER_ID,
      matchId: MATCH_ID,
      status: 'declined' as const,
      appliedAt: NOW,
      version: 2 as const,
    });
    test.offers.readAction.mockResolvedValue({
      outcome: 'ready',
      offer: activeOffer(),
    });
    test.offers.resolve.mockResolvedValue(declined);
    test.queue.readPromotionCandidate.mockResolvedValueOnce({
      outcome: 'candidate',
      entry: Object.freeze({
        ...waiting(OTHER_ID, 1),
        entryId: nextEntryId,
      }),
      playerIsActive: true,
    });
    test.offers.create.mockImplementation(async (_transaction, input) => ({
      outcome: 'created',
      offer: Object.freeze({
        ...activeOffer(input.entryId, input.accountId),
        offerId: input.offerId,
      }),
    }));

    await expect(test.service.declineOffer({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { offerId: OFFER_ID, requestKey: REQUEST_KEY },
    })).resolves.toEqual({
      outcome: 'waitlist_offer_declined',
      offer: declined,
    });
    expect(test.offers.create).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        entryId: nextEntryId,
        accountId: OTHER_ID,
        expiresAt: EXPIRES_AT,
      }),
    );
    expect(test.matches.join).not.toHaveBeenCalled();
  });

  it('expires due offers and creates the next FIFO offer in a separate transaction', async () => {
    const test = harness(true);
    test.offers.listDueMatchIds.mockResolvedValue([MATCH_ID]);
    test.offers.expireForMatch.mockResolvedValue({
      outcome: 'expired',
      offer: Object.freeze({
        ...activeOffer(),
        status: 'expired',
        updatedAt: NOW,
        resolvedAt: NOW,
        version: 2,
      }),
    });
    test.queue.readPromotionCandidate.mockResolvedValue({ outcome: 'empty' });

    await expect(test.service.sweepExpiredOffers()).resolves.toBe(1);
    expect(test.offers.expireForMatch).toHaveBeenCalledWith(
      transaction,
      { matchId: MATCH_ID, now: NOW },
    );
    expect(test.queue.readPromotionCandidate).toHaveBeenCalledWith(
      transaction,
      { matchId: MATCH_ID, now: NOW },
    );
  });

  it('keeps offer actions fail-closed while the feature flag is disabled', async () => {
    const test = harness(false);
    await expect(test.service.acceptOffer({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { offerId: OFFER_ID, requestKey: REQUEST_KEY },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'feature_disabled' });
    expect(test.offers.readAction).not.toHaveBeenCalled();
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
    expect(test.enqueueDirect).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventKey: `waitlist_slot_available:${firstNotification.notificationId}`,
        eventType: 'waitlist_slot_available',
        recipientAccountId: ACTOR_ID,
        occurredAt: NOW,
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
    expect(test.enqueueDirect).not.toHaveBeenCalled();
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
