import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchReservationRepository } from '../database/match-reservation.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { CourtReservationId } from '../reservations/reservation.types';
import { MatchReservationApiService } from './match-reservation-api.service';
import { MatchId } from './match.types';

const OWNER = deterministicUuid('d3-api-owner') as AccountId;
const MATCH_ID = deterministicUuid('d3-api-match') as MatchId;
const RESERVATION_ID = deterministicUuid(
  'd3-api-reservation',
) as CourtReservationId;
const REQUEST_KEY = deterministicUuid('d3-api-request');
const NOW = unixEpochSeconds(1_800_000_000);
const TRANSACTION = {} as PostgresTransaction;

function harness() {
  const linkConfirmed = jest.fn<
    ReturnType<MatchReservationRepository['linkConfirmed']>,
    Parameters<MatchReservationRepository['linkConfirmed']>
  >().mockResolvedValue({
    outcome: 'linked',
    persistence: 'applied',
    projection: {
      status: 'confirmed',
      stale: false,
      reservationId: RESERVATION_ID,
      target: {
        serviceId: 11,
        courtId: 22,
        startsAt: '2027-01-17T10:00:00+03:00',
        endsAt: '2027-01-17T11:30:00+03:00',
      },
    },
  });
  const service = new MatchReservationApiService({
    transactions: {
      run: async <T>(operation: (transaction: PostgresTransaction) => Promise<T>) =>
        operation(TRANSACTION),
    },
    matchReservations: { linkConfirmed } as never,
    clock: { nowEpochSeconds: () => NOW },
  });
  return { service, linkConfirmed };
}

describe('MatchReservationApiService', () => {
  it('links only the authenticated owner scope and exposes canonical target', async () => {
    const test = harness();

    await expect(test.service.link({
      accountId: OWNER,
      role: 'player',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY, reservationId: RESERVATION_ID },
    })).resolves.toMatchObject({
      outcome: 'linked',
      persistence: 'applied',
      courtBooking: {
        courtBookingStatus: 'confirmed',
        courtBookingStale: false,
        courtReservationId: RESERVATION_ID,
      },
    });
    expect(test.linkConfirmed).toHaveBeenCalledWith(TRANSACTION, {
      linkId: REQUEST_KEY,
      matchId: MATCH_ID,
      reservationId: RESERVATION_ID,
      ownerAccountId: OWNER,
      now: NOW,
    });
  });

  it('rejects club admins before persistence', async () => {
    const test = harness();
    await expect(test.service.link({
      accountId: OWNER,
      role: 'club_admin',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY, reservationId: RESERVATION_ID },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'forbidden' });
    expect(test.linkConfirmed).not.toHaveBeenCalled();
  });

  it('maps duplicate active bindings to a fail-closed conflict', async () => {
    const test = harness();
    test.linkConfirmed.mockResolvedValueOnce({
      outcome: 'rejected',
      reason: 'reservation_already_linked',
    });
    await expect(test.service.link({
      accountId: OWNER,
      role: 'player',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY, reservationId: RESERVATION_ID },
    })).resolves.toEqual({
      outcome: 'rejected',
      reason: 'reservation_already_linked',
    });
  });
});
