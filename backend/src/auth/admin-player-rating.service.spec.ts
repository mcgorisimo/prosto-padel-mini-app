import { AccountId } from '../accounts/account.types';
import { InternalUuid } from '../common/internal-uuid';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { AdminPlayerRatingService } from './admin-player-rating.service';

const ADMIN_ID = deterministicUuid('admin-rating-service-admin') as AccountId;
const PLAYER_ID = deterministicUuid('admin-rating-service-player') as AccountId;
const COMMAND_ID = deterministicUuid('admin-rating-service-command') as InternalUuid;
const NOW = unixEpochSeconds(1_800_000_000);

function harness() {
  const listPlayers = jest.fn().mockResolvedValue({
    outcome: 'listed',
    players: [{
      accountId: PLAYER_ID,
      firstName: 'Player',
      rating: 3,
      isVerified: false,
    }],
    nextAfterAccountId: PLAYER_ID,
  });
  const setRatingState = jest.fn().mockImplementation((_transaction, input) => Promise.resolve({
    outcome: 'applied',
    command: {
      commandId: input.commandId,
      actorAccountId: input.actorAccountId,
      targetAccountId: input.targetAccountId,
      resultType: 'rating_and_verification_updated',
      ratingBefore: 3,
      ratingAfter: input.rating,
      isVerifiedBefore: false,
      isVerifiedAfter: input.isVerified,
      appliedAt: input.appliedAt,
    },
  }));
  const run = jest.fn().mockImplementation((operation) => operation({ query: jest.fn() }));
  const service = new AdminPlayerRatingService({
    transactions: { run },
    ratings: { listPlayers, setRatingState },
    clock: { nowEpochSeconds: () => NOW },
  });
  return { service, listPlayers, setRatingState, run };
}

describe('AdminPlayerRatingService', () => {
  it('delegates player-principal authorization to the transactional repository', async () => {
    const subject = harness();
    subject.listPlayers.mockResolvedValueOnce({ outcome: 'forbidden' });
    await expect(subject.service.list({
      accountId: ADMIN_ID,
      role: 'player',
      request: { verification: 'all', limit: 20 },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'forbidden' });
    expect(subject.run).toHaveBeenCalledTimes(1);
    expect(subject.listPlayers).toHaveBeenCalledWith(expect.anything(), {
      actorAccountId: ADMIN_ID,
      verification: 'all',
      limit: 20,
    });
  });

  it('binds a keyset cursor to the search and verification context', async () => {
    const subject = harness();
    const first = await subject.service.list({
      accountId: ADMIN_ID,
      role: 'club_admin',
      request: { search: 'Player', verification: 'unverified', limit: 1 },
    });
    expect(first.outcome).toBe('listed');
    if (first.outcome !== 'listed') throw new Error('expected list');
    expect(first.response.nextCursor).not.toBeNull();
    await subject.service.list({
      accountId: ADMIN_ID,
      role: 'club_admin',
      request: { search: 'Player', verification: 'unverified', limit: 1, cursor: first.response.nextCursor! },
    });
    expect(subject.listPlayers.mock.calls[1][1]).toMatchObject({ afterAccountId: PLAYER_ID });

    await expect(subject.service.list({
      accountId: ADMIN_ID,
      role: 'club_admin',
      request: { search: 'Changed', verification: 'unverified', limit: 1, cursor: first.response.nextCursor! },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'invalid_request' });
  });

  it('derives a stable request digest and exposes only immutable command output', async () => {
    const subject = harness();
    const input = {
      accountId: ADMIN_ID,
      role: 'player' as const,
      targetAccountId: PLAYER_ID,
      request: { requestKey: COMMAND_ID, rating: 4.25, isVerified: true },
    };
    const first = await subject.service.setRatingState(input);
    const second = await subject.service.setRatingState(input);
    expect(first).toEqual(second);
    expect(first).toEqual({
      outcome: 'applied',
      state: {
        commandId: COMMAND_ID,
        targetAccountId: PLAYER_ID,
        resultType: 'rating_and_verification_updated',
        ratingBefore: 3,
        rating: 4.25,
        isVerifiedBefore: false,
        isVerified: true,
        appliedAt: NOW,
      },
    });
    expect(subject.setRatingState.mock.calls[0][1].requestDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(subject.setRatingState.mock.calls[1][1].requestDigest).toBe(subject.setRatingState.mock.calls[0][1].requestDigest);
  });
});
