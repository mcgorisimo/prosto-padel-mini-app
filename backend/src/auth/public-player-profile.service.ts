import {
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import {
  PublicPlayerProfileRecord,
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchRepository,
} from '../database/public-player-profile-search.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PublicPlayerProfile,
  SearchPublicPlayerProfilesInput,
  SearchPublicPlayerProfilesResult,
  isPublicPlayerProfile,
} from './public-player-profile.types';

export interface PublicPlayerProfileTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PublicPlayerProfileServiceDependencies {
  readonly transactions: PublicPlayerProfileTransactionExecutor;
  readonly profiles: Pick<
    PublicPlayerProfileSearchRepository,
    'search'
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isCanonicalQuery(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.normalize('NFKC') === value &&
    [...value].length >= 2 &&
    [...value].length <= 64 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

function validInput(value: unknown): value is SearchPublicPlayerProfilesInput {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['query', 'limit', 'role']) &&
    isCanonicalQuery(value.query) &&
    Number.isInteger(value.limit) &&
    (value.limit as number) >= 1 &&
    (value.limit as number) <= 20 &&
    typeof value.role === 'string' &&
    USER_ROLES.includes(
      value.role as (typeof USER_ROLES)[number],
    )
  );
}

function publicProfile(
  profile: PublicPlayerProfileRecord,
): PublicPlayerProfile {
  return Object.freeze({
    playerId: profile.playerId,
    firstName: profile.firstName,
    lastName: profile.lastName ?? null,
    username: profile.username ?? null,
    ...(profile.photoUrl === undefined
      ? {}
      : { photoUrl: profile.photoUrl }),
    rating: profile.rating,
    isVerified: profile.isVerified,
  });
}

function isRepositoryProfile(
  value: unknown,
): value is PublicPlayerProfileRecord {
  const requiredKeys = [
    'playerId',
    'firstName',
    'rating',
    'isVerified',
  ] as const;
  const allowedKeys = [
    ...requiredKeys,
    'lastName',
    'username',
    'photoUrl',
  ] as const;
  if (
    !isRecord(value) ||
    !requiredKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) ||
    Object.keys(value).some(
      (key) =>
        !allowedKeys.includes(
          key as (typeof allowedKeys)[number],
        ),
    ) ||
    !isAccountId(value.playerId)
  ) {
    return false;
  }
  return isPublicPlayerProfile(
    publicProfile(value as unknown as PublicPlayerProfileRecord),
  );
}

function rejected(
  reason: Extract<
    SearchPublicPlayerProfilesResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): Extract<
  SearchPublicPlayerProfilesResult,
  { readonly outcome: 'rejected' }
> {
  return Object.freeze({ outcome: 'rejected', reason });
}

function temporaryStorageFailure(error: unknown): boolean {
  return (
    error instanceof PublicPlayerProfileSearchPersistenceError &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

export class PublicPlayerProfileService {
  constructor(
    readonly dependencies: PublicPlayerProfileServiceDependencies,
  ) {}

  async search(
    input: SearchPublicPlayerProfilesInput,
  ): Promise<SearchPublicPlayerProfilesResult> {
    if (!validInput(input)) {
      return rejected('invalid_request');
    }

    try {
      const result = await this.dependencies.transactions.run(
        (transaction) =>
          this.dependencies.profiles.search(transaction, {
            query: input.query,
            limit: input.limit,
          }),
      );
      if (
        !isRecord(result) ||
        !hasExactlyKeys(result, ['outcome', 'players']) ||
        result.outcome !== 'found' ||
        !Array.isArray(result.players) ||
        result.players.length > input.limit ||
        !result.players.every(isRepositoryProfile)
      ) {
        return rejected('internal_failure');
      }

      const players = result.players.map(publicProfile);
      if (
        !players.every(isPublicPlayerProfile) ||
        new Set(players.map((player) => player.playerId)).size !==
          players.length
      ) {
        return rejected('internal_failure');
      }

      return Object.freeze({
        outcome: 'found',
        players: Object.freeze(players),
      });
    } catch (error) {
      return rejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }
}
