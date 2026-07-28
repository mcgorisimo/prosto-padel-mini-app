import {
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import {
  PlayerProfileReadPersistenceError,
  PlayerProfileReader,
  PlayerProfileRecord,
} from '../database/player-profile-reader';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  OwnPlayerProfile,
  ReadOwnPlayerProfileInput,
  ReadOwnPlayerProfileResult,
} from './player-profile.types';

export interface PlayerProfileTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PlayerProfileServiceDependencies {
  readonly transactions: PlayerProfileTransactionExecutor;
  readonly profiles: PlayerProfileReader;
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

function isAllowedValue(
  value: unknown,
  allowed: readonly string[],
): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

function validInput(value: unknown): value is ReadOwnPlayerProfileInput {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role']) &&
    isAccountId(value.accountId) &&
    isAllowedValue(value.role, USER_ROLES)
  );
}

function isBoundedString(
  value: unknown,
  maximumCodePoints: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximumCodePoints
  );
}

function validOptionalProfileValue(
  value: unknown,
  maximumCodePoints: number,
): value is string | undefined {
  return value === undefined || isBoundedString(value, maximumCodePoints);
}

function readProfileRecord(
  value: unknown,
  expectedAccountId: ReadOwnPlayerProfileInput['accountId'],
): PlayerProfileRecord | undefined {
  if (
    !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, 'accountId') ||
    !Object.prototype.hasOwnProperty.call(value, 'firstName') ||
    Object.keys(value).some(
      (key) =>
        ![
          'accountId',
          'firstName',
          'lastName',
          'username',
          'photoUrl',
          'languageCode',
        ].includes(key),
    ) ||
    !isAccountId(value.accountId) ||
    value.accountId !== expectedAccountId ||
    !isBoundedString(value.firstName, 256) ||
    !validOptionalProfileValue(value.lastName, 256) ||
    !validOptionalProfileValue(value.username, 64) ||
    !validOptionalProfileValue(value.photoUrl, 2_048) ||
    !validOptionalProfileValue(value.languageCode, 64)
  ) {
    return undefined;
  }
  if (value.photoUrl !== undefined) {
    try {
      if (new URL(value.photoUrl).protocol !== 'https:') {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  return value as unknown as PlayerProfileRecord;
}

function publicProfile(
  profile: PlayerProfileRecord,
): OwnPlayerProfile {
  return Object.freeze({
    accountId: profile.accountId,
    role: 'player',
    firstName: profile.firstName,
    lastName: profile.lastName ?? null,
    username: profile.username ?? null,
    photoUrl: profile.photoUrl ?? null,
    languageCode: profile.languageCode ?? null,
  });
}

function rejected(
  reason: Extract<
    ReadOwnPlayerProfileResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): ReadOwnPlayerProfileResult {
  return Object.freeze({ outcome: 'rejected', reason });
}

function temporaryStorageFailure(error: unknown): boolean {
  return (
    error instanceof PlayerProfileReadPersistenceError &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

export class PlayerProfileService {
  constructor(readonly dependencies: PlayerProfileServiceDependencies) {}

  async readOwnProfile(
    input: ReadOwnPlayerProfileInput,
  ): Promise<ReadOwnPlayerProfileResult> {
    if (!validInput(input)) {
      return rejected('invalid_request');
    }
    if (input.role !== 'player') {
      return rejected('profile_not_found');
    }

    try {
      const result = await this.dependencies.transactions.run(
        (transaction) =>
          this.dependencies.profiles.findByAccountId(transaction, {
            accountId: input.accountId,
          }),
      );
      if (
        isRecord(result) &&
        hasExactlyKeys(result, ['outcome']) &&
        result.outcome === 'not_found'
      ) {
        return rejected('profile_not_found');
      }
      if (
        !isRecord(result) ||
        !hasExactlyKeys(result, ['outcome', 'profile']) ||
        result.outcome !== 'found'
      ) {
        return rejected('internal_failure');
      }
      const profile = readProfileRecord(result.profile, input.accountId);
      if (profile === undefined) {
        return rejected('internal_failure');
      }
      return Object.freeze({
        outcome: 'found',
        profile: publicProfile(profile),
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
