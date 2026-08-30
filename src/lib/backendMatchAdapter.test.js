import { describe, expect, it } from 'vitest';
import {
  applyBackendParticipantResult,
  createBackendMatchDraft,
  mergeAccountUpcomingMatches,
  preferConfirmedBackendMatchMutation,
  resolveBackendMatchMode,
  resolveMatchSource,
  selectBackendAccountMatches,
  selectFutureBackendMatches,
  shouldApplyBackendMatchFeedResponse,
} from './backendMatchAdapter.js';

const accountId = '11111111-1111-4111-8111-111111111111';
const otherAccountId = '22222222-2222-4222-8222-222222222222';

function backendMatch(overrides = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    backendOwned: true,
    ownerId: accountId,
    participants: [accountId],
    filledSlots: [
      { id: accountId, slotIndex: 0, isOrganizer: true },
      null,
      null,
      null,
    ],
    startsAt: 2_000,
    status: 'open',
    version: 4,
    ...overrides,
  };
}

describe('backend match adapter', () => {
  it('builds match creation only from the canonical reservation id', () => {
    const reservationId = '88888888-8888-4888-8888-888888888888';

    expect(createBackendMatchDraft({
      reservationId,
      scenario: 'community',
      description: 'Игра вечером',
      ratingMin: 2,
      ratingMax: 5,
      isRatingMatch: true,
    })).toEqual({
      reservationId,
      scenario: 'community',
      description: 'Игра вечером',
      ratingMin: 2,
      ratingMax: 5,
      isRatingMatch: true,
    });
    expect(createBackendMatchDraft({
      scenario: 'community',
      dateISO: '2027-01-01',
      time: '10:00',
      duration: 1,
    })).toBeNull();
  });

  it('keeps the existing private metadata boundary on the same reservation path', () => {
    expect(createBackendMatchDraft({
      reservationId: '99999999-9999-4999-8999-999999999999',
      scenario: 'social',
      isPrivate: true,
      description: '',
      isRatingMatch: true,
      ratingMin: 1,
      ratingMax: 6,
    })).toEqual({
      reservationId: '99999999-9999-4999-8999-999999999999',
      scenario: 'private',
      description: '',
      isRatingMatch: false,
    });
  });

  it.each([
    [{ hasBackendActions: false }, 'loading'],
    [{ hasBackendActions: false, profileStatus: 'error' }, 'error'],
    [{ hasBackendActions: true, profileStatus: 'ready', accountId }, 'ready'],
    [{ hasBackendActions: true, profileStatus: 'error' }, 'error'],
  ])('resolves the backend mode fail-closed', (partial, expected) => {
    expect(
      resolveBackendMatchMode({
        hasBackendActions: false,
        lifecycleStatus: 'idle',
        profileStatus: 'idle',
        accountId: null,
        ...partial,
      }),
    ).toBe(expected);
  });

  it('accepts only the currently owned feed response', () => {
    expect(shouldApplyBackendMatchFeedResponse(2, 2)).toBe(true);
    expect(shouldApplyBackendMatchFeedResponse(3, 2)).toBe(false);
  });

  it('applies a confirmed participant result without duplicating the player', () => {
    const result = applyBackendParticipantResult(
      backendMatch(),
      {
        matchId: '33333333-3333-4333-8333-333333333333',
        playerId: otherAccountId,
        slotNumber: 2,
        status: 'active',
        matchVersion: 5,
      },
      { id: otherAccountId, firstName: 'Player' },
    );

    expect(result).toMatchObject({
      players: 2,
      occupiedSlots: 2,
      participants: [accountId, otherAccountId],
      version: 5,
    });
    expect(result.filledSlots[1]).toMatchObject({
      id: otherAccountId,
      slotIndex: 1,
      isOrganizer: false,
    });
    expect(
      applyBackendParticipantResult(
        backendMatch(),
        {
          matchId: 'wrong',
          playerId: otherAccountId,
          slotNumber: 2,
          status: 'active',
          matchVersion: 5,
        },
        { id: otherAccountId },
      ),
    ).toBeNull();
  });

  it('never replaces a newer confirmed mutation with stale refresh data', () => {
    const confirmed = backendMatch({ version: 8 });
    expect(
      preferConfirmedBackendMatchMutation(
        confirmed,
        backendMatch({ version: 7, title: 'stale' }),
      ),
    ).toBe(confirmed);
    expect(
      preferConfirmedBackendMatchMutation(
        confirmed,
        backendMatch({ version: 9, title: 'fresh' }),
      ),
    ).toMatchObject({ version: 9, title: 'fresh' });
  });

  it('selects only future backend account matches', () => {
    const owned = backendMatch();
    const participating = backendMatch({
      id: '44444444-4444-4444-8444-444444444444',
      ownerId: otherAccountId,
      participants: [accountId],
      startsAt: 3_000,
    });
    const privateOther = backendMatch({
      id: '55555555-5555-4555-8555-555555555555',
      ownerId: otherAccountId,
      participants: [],
    });
    const past = backendMatch({
      id: '66666666-6666-4666-8666-666666666666',
      startsAt: 900,
    });

    expect(
      selectFutureBackendMatches(
        [owned, participating, privateOther, past],
        1_000,
      ),
    ).toHaveLength(3);
    expect(
      selectBackendAccountMatches(
        [owned, participating, privateOther, past],
        accountId,
        1_000,
      ),
    ).toEqual([owned, participating]);
    expect(mergeAccountUpcomingMatches([owned], accountId, 1_000)).toEqual([
      owned,
    ]);
    expect(resolveMatchSource(owned.id, null, [owned])).toBe(owned);
    expect(
      resolveMatchSource('77777777-7777-4777-8777-777777777777', null, [owned]),
    ).toBeNull();
  });
});
