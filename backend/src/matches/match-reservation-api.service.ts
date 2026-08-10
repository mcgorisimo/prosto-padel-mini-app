import { USER_ROLES, isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchReservationPersistenceError,
  MatchReservationRepository,
} from '../database/match-reservation.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { isCourtReservationId } from '../reservations/reservation.types';
import {
  LinkMatchReservationApiRejection,
  LinkMatchReservationApiResult,
  LinkMatchReservationInput,
  MatchCourtBookingResponse,
} from './match-reservation-api.types';
import { readLinkMatchReservationRequest } from './match-reservation-api.http';
import {
  MatchCourtBookingProjection,
  MatchReservationLinkId,
} from './match-reservation.types';
import { isMatchId } from './match.types';

export interface MatchReservationApiServiceDependencies {
  readonly transactions: {
    run<T>(
      operation: (transaction: PostgresTransaction) => Promise<T>,
    ): Promise<T>;
  };
  readonly matchReservations: MatchReservationRepository;
  readonly clock: {
    nowEpochSeconds(): import('../auth/auth.types').UnixEpochSeconds;
  };
}

export function courtBookingResponse(
  projection: MatchCourtBookingProjection,
): MatchCourtBookingResponse {
  return projection.status === 'unbooked'
    ? Object.freeze({
        courtBookingStatus: 'unbooked' as const,
        courtBookingStale: false as const,
      })
    : Object.freeze({
        courtBookingStatus: 'confirmed' as const,
        courtBookingStale: projection.stale,
        courtReservationId: projection.reservationId,
        courtBookingTarget: projection.target,
      });
}

function rejected(reason: LinkMatchReservationApiRejection) {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function persistenceRejection(
  error: unknown,
): LinkMatchReservationApiRejection {
  if (!(error instanceof MatchReservationPersistenceError)) {
    return 'internal_failure';
  }
  switch (error.reason) {
    case 'invalid_input':
      return 'invalid_request';
    case 'transaction_conflict':
      return 'match_conflict';
    case 'database_unavailable':
      return 'temporary_unavailable';
    case 'invalid_persisted_state':
    case 'referential_integrity':
    case 'permission_denied':
    case 'storage_failure':
      return 'internal_failure';
  }
}

export class MatchReservationApiService {
  constructor(
    readonly dependencies: MatchReservationApiServiceDependencies,
  ) {}

  async link(
    input: LinkMatchReservationInput,
  ): Promise<LinkMatchReservationApiResult> {
    const request = readLinkMatchReservationRequest(input?.request);
    if (
      typeof input !== 'object' ||
      input === null ||
      Object.keys(input).length !== 4 ||
      !isAccountId(input.accountId) ||
      !USER_ROLES.includes(input.role) ||
      !isMatchId(input.matchId) ||
      request === undefined ||
      !isCourtReservationId(request.reservationId)
    ) {
      return rejected('invalid_request');
    }
    if (input.role !== 'player') return rejected('forbidden');
    const now = this.dependencies.clock.nowEpochSeconds();
    if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
    try {
      const result = await this.dependencies.transactions.run((transaction) =>
        this.dependencies.matchReservations.linkConfirmed(transaction, {
          linkId: request.requestKey as MatchReservationLinkId,
          matchId: input.matchId,
          reservationId: request.reservationId,
          ownerAccountId: input.accountId,
          now,
        }),
      );
      if (result.outcome === 'rejected') {
        return rejected(
          result.reason === 'conflict'
            ? 'match_conflict'
            : result.reason,
        );
      }
      return Object.freeze({
        outcome: 'linked',
        persistence: result.persistence,
        courtBooking: courtBookingResponse(result.projection),
      });
    } catch (error) {
      return rejected(persistenceRejection(error));
    }
  }
}
