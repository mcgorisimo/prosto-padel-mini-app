import {
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import { isUserGeneratedTextAllowed } from '../common/content-moderation';
import {
  PlayerProfileReadPersistenceError,
  PlayerProfileReader,
  PlayerProfileRecord,
} from '../database/player-profile-reader';
import {
  PlayerProfileWritePersistenceError,
  PlayerProfileWriter,
} from '../database/player-profile-writer';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  OwnPlayerProfile,
  ReadOwnPlayerProfileInput,
  ReadOwnPlayerProfileResult,
  UpdateOwnPlayerProfileInput,
  UpdateOwnPlayerProfileResult,
  readOwnPlayerProfilePatch,
} from './player-profile.types';
import { SessionAuthenticationClock } from './session-authentication.guard';

export interface PlayerProfileTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PlayerProfileServiceDependencies {
  readonly transactions: PlayerProfileTransactionExecutor;
  readonly profiles: PlayerProfileReader;
  readonly profileWriter: PlayerProfileWriter;
  readonly clock: SessionAuthenticationClock;
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

function isRating(value: unknown): value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10
  ) {
    return false;
  }
  const scaled = value * 100;
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
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
          'fullPhotoUrl',
          'languageCode',
          'phone',
          'normalizedEmail',
          'sidePreference',
          'rating',
          'isVerified',
          'capabilities',
        ].includes(key),
    ) ||
    !isAccountId(value.accountId) ||
    value.accountId !== expectedAccountId ||
    !isBoundedString(value.firstName, 256) ||
    !validOptionalProfileValue(value.lastName, 256) ||
    !validOptionalProfileValue(value.username, 64) ||
    !validOptionalProfileValue(value.photoUrl, 2_048) ||
    !validOptionalProfileValue(value.fullPhotoUrl, 2_048) ||
    !validOptionalProfileValue(value.languageCode, 64)
    || (value.phone !== undefined &&
      (typeof value.phone !== 'string' ||
        !/^\+[1-9][0-9]{6,14}$/u.test(value.phone)))
    || (value.normalizedEmail !== undefined &&
      (typeof value.normalizedEmail !== 'string' ||
        value.normalizedEmail.length > 320 ||
        value.normalizedEmail.trim() !== value.normalizedEmail ||
        value.normalizedEmail.toLowerCase() !== value.normalizedEmail ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u.test(
          value.normalizedEmail,
        )))
    || (value.sidePreference !== undefined &&
      (typeof value.sidePreference !== 'string' ||
        !['Left', 'Both', 'Right'].includes(value.sidePreference)))
    || !isRating(value.rating)
    || typeof value.isVerified !== 'boolean'
    || !Array.isArray(value.capabilities)
    || value.capabilities.length > 1
    || value.capabilities.some((capability) => capability !== 'club_admin')
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
  if (value.fullPhotoUrl !== undefined) {
    try {
      if (new URL(value.fullPhotoUrl).protocol !== 'https:') {
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
    fullPhotoUrl: profile.fullPhotoUrl ?? null,
    languageCode: profile.languageCode ?? null,
    phone: profile.phone ?? null,
    sidePreference: profile.sidePreference ?? null,
    rating: profile.rating,
    isVerified: profile.isVerified,
    capabilities: Object.freeze([...profile.capabilities]),
  });
}

type PlayerProfileRejectionReason = Extract<
  ReadOwnPlayerProfileResult | UpdateOwnPlayerProfileResult,
  { readonly outcome: 'rejected' }
>['reason'];

function rejected<Reason extends PlayerProfileRejectionReason>(
  reason: Reason,
): Readonly<{ readonly outcome: 'rejected'; readonly reason: Reason }> {
  return Object.freeze({ outcome: 'rejected', reason });
}

function temporaryStorageFailure(error: unknown): boolean {
  return (
    (error instanceof PlayerProfileReadPersistenceError ||
      error instanceof PlayerProfileWritePersistenceError) &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

function validUpdateInput(
  value: unknown,
): value is UpdateOwnPlayerProfileInput {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role', 'changes']) &&
    validInput({ accountId: value.accountId, role: value.role }) &&
    readOwnPlayerProfilePatch(value.changes) !== undefined
  );
}

function containsDisallowedProfileText(
  changes: UpdateOwnPlayerProfileInput['changes'],
): boolean {
  return (
    (changes.firstName !== undefined &&
      !isUserGeneratedTextAllowed(changes.firstName)) ||
    (changes.lastName !== undefined &&
      changes.lastName !== null &&
      !isUserGeneratedTextAllowed(changes.lastName))
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

  async updateOwnProfile(
    input: UpdateOwnPlayerProfileInput,
  ): Promise<UpdateOwnPlayerProfileResult> {
    if (!validUpdateInput(input) || input.role !== 'player') {
      return rejected('invalid_request');
    }
    if (containsDisallowedProfileText(input.changes)) {
      return rejected('content_not_allowed');
    }

    try {
      const result = await this.dependencies.transactions.run(
        async (transaction) => {
          const updated = await this.dependencies.profileWriter.updateByAccountId(
            transaction,
            {
              accountId: input.accountId,
              changes: input.changes,
              updatedAt: this.dependencies.clock.nowEpochSeconds(),
            },
          );
          if (updated.outcome === 'not_found') {
            return updated;
          }
          return this.dependencies.profiles.findByAccountId(transaction, {
            accountId: input.accountId,
          });
        },
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
        outcome: 'updated',
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
