import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  CreateMatchCommand,
  JoinMatchCommand,
  LeaveMatchCommand,
  MatchDurationMinutes,
  MatchId,
  MatchKind,
  MatchParticipantState,
  MatchScenario,
  MatchState,
  MatchStatus,
  MatchVisibility,
} from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export type MatchCommandPersistence = 'applied' | 'idempotent_retry';

export type MatchCommandRejection =
  | 'command_reuse_conflict'
  | 'match_not_found'
  | 'match_closed'
  | 'match_not_joinable'
  | 'match_started'
  | 'rating_verification_required'
  | 'rating_out_of_range'
  | 'owner_cannot_join'
  | 'already_joined'
  | 'match_full'
  | 'participant_not_active';

export type CreateMatchResult =
  | {
      readonly outcome: 'match_created';
      readonly persistence: MatchCommandPersistence;
      readonly match: MatchDetailRecord;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'command_reuse_conflict'
        | 'court_invalid'
        | 'rating_verification_required';
    };

export type CreateMatchPersistenceInput = Omit<
  CreateMatchCommand,
  | 'actorIsVerified'
  | 'courtId'
  | 'courtName'
  | 'courtType'
  | 'pricePerPersonSnapshot'
> & {
  readonly courtId?: string;
};

export type JoinMatchResult =
  | {
      readonly outcome: 'participant_joined';
      readonly persistence: MatchCommandPersistence;
      readonly participant: MatchParticipantState;
      readonly matchVersion: number;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchCommandRejection;
    };

export type LeaveMatchResult =
  | {
      readonly outcome: 'participant_left';
      readonly persistence: MatchCommandPersistence;
      readonly participant: MatchParticipantState;
      readonly matchVersion: number;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchCommandRejection;
    };

export interface ListPublicMatchFeedInput {
  readonly now: UnixEpochSeconds;
  readonly limit: number;
}

export interface FindVisibleMatchInput {
  readonly matchId: MatchId;
  readonly viewerAccountId: AccountId;
}

export interface MatchFeedRecord {
  readonly matchId: MatchId;
  readonly ownerAccountId: AccountId;
  readonly startsAt: UnixEpochSeconds;
  readonly durationMinutes: MatchDurationMinutes;
  readonly courtId: string;
  readonly courtName: string;
  readonly courtType: string;
  readonly scenario: Exclude<MatchScenario, 'private'>;
  readonly status: MatchStatus;
  readonly title?: string;
  readonly ratingMin: number;
  readonly ratingMax: number;
  readonly isRatingMatch: boolean;
  readonly pricePerPersonSnapshot?: number;
  readonly occupiedSlots: number;
  readonly version: number;
  readonly participants: readonly VisibleMatchParticipantRecord[];
}

export interface VisibleMatchParticipantRecord {
  readonly playerId: AccountId;
  readonly slotNumber: MatchParticipantState['slotNumber'];
}

export interface MatchDetailRecord {
  readonly matchId: MatchId;
  readonly ownerAccountId: AccountId;
  readonly createdAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly startsAt: UnixEpochSeconds;
  readonly durationMinutes: MatchDurationMinutes;
  readonly courtId: string;
  readonly courtName: string;
  readonly courtType: string;
  readonly kind: MatchKind;
  readonly visibility: MatchVisibility;
  readonly scenario: MatchScenario;
  readonly status: MatchStatus;
  readonly title?: string;
  readonly description: string;
  readonly ratingMin?: number;
  readonly ratingMax?: number;
  readonly isRatingMatch: boolean;
  readonly pricePerPersonSnapshot?: number;
  readonly version: number;
  readonly terminalAt?: UnixEpochSeconds;
  readonly participants: readonly VisibleMatchParticipantRecord[];
}

export type JoinMatchInput = Omit<
  JoinMatchCommand,
  'actorRatingLevel' | 'actorIsVerified'
>;

export type MatchPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'match_conflict'
  | 'command_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class MatchPersistenceError extends Error {
  readonly name = 'MatchPersistenceError';

  constructor(readonly reason: MatchPersistenceFailure) {
    super('Match persistence failed');
  }
}

export interface MatchRepository {
  create(
    transaction: PostgresTransaction,
    command: CreateMatchPersistenceInput,
  ): Promise<CreateMatchResult>;

  listPublicFeed(
    transaction: PostgresTransaction,
    input: ListPublicMatchFeedInput,
  ): Promise<readonly MatchFeedRecord[]>;

  findVisibleById(
    transaction: PostgresTransaction,
    input: FindVisibleMatchInput,
  ): Promise<MatchDetailRecord | null>;

  join(
    transaction: PostgresTransaction,
    command: JoinMatchInput,
  ): Promise<JoinMatchResult>;

  leave(
    transaction: PostgresTransaction,
    command: LeaveMatchCommand,
  ): Promise<LeaveMatchResult>;
}

export function matchDetailFromState(state: MatchState): MatchDetailRecord {
  return Object.freeze({
    matchId: state.matchId,
    ownerAccountId: state.ownerAccountId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    startsAt: state.startsAt,
    durationMinutes: state.durationMinutes,
    courtId: state.courtId,
    courtName: state.courtName,
    courtType: state.courtType,
    kind: state.kind,
    visibility: state.visibility,
    scenario: state.scenario,
    status: state.status,
    ...(state.title === undefined ? {} : { title: state.title }),
    description: state.description,
    ...(state.ratingMin === undefined
      ? {}
      : { ratingMin: state.ratingMin }),
    ...(state.ratingMax === undefined
      ? {}
      : { ratingMax: state.ratingMax }),
    isRatingMatch: state.isRatingMatch,
    ...(state.pricePerPersonSnapshot === undefined
      ? {}
      : { pricePerPersonSnapshot: state.pricePerPersonSnapshot }),
    version: state.version,
    ...(state.terminalAt === undefined
      ? {}
      : { terminalAt: state.terminalAt }),
    participants: Object.freeze(
      state.participants
        .filter((participant) => participant.status === 'active')
        .map((participant) =>
          Object.freeze({
            playerId: participant.accountId,
            slotNumber: participant.slotNumber,
          }),
        ),
    ),
  });
}
