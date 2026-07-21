import { AccountId, isAccountId } from './account.types';

export interface PlayerProfile {
  readonly accountId: AccountId;
}

export interface CreatePlayerAccountWithProfileBinding {
  readonly account: {
    readonly accountId: AccountId;
    readonly role: 'player';
    readonly status: 'active';
  };
  readonly playerProfile: PlayerProfile;
}

export type CreatePlayerAccountWithProfileResult =
  | {
      readonly outcome: 'validated';
      /** Must be persisted atomically as one account/profile creation unit. */
      readonly binding: CreatePlayerAccountWithProfileBinding;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_player_account_binding'
        | 'player_profile_account_mismatch';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

export function isPlayerProfile(value: unknown): value is PlayerProfile {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['accountId']) &&
    isAccountId(value.accountId)
  );
}

export function validatePlayerAccountWithProfileCreation(
  value: unknown,
): CreatePlayerAccountWithProfileResult {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['account', 'playerProfile']) ||
    !isRecord(value.account) ||
    !hasExactlyKeys(value.account, ['accountId', 'role', 'status']) ||
    !isAccountId(value.account.accountId) ||
    value.account.role !== 'player' ||
    value.account.status !== 'active' ||
    !isPlayerProfile(value.playerProfile)
  ) {
    return {
      outcome: 'rejected',
      reason: 'invalid_player_account_binding',
    };
  }

  if (value.account.accountId !== value.playerProfile.accountId) {
    return {
      outcome: 'rejected',
      reason: 'player_profile_account_mismatch',
    };
  }

  return {
    outcome: 'validated',
    binding: Object.freeze({
      account: Object.freeze({
        accountId: value.account.accountId,
        role: 'player' as const,
        status: 'active' as const,
      }),
      playerProfile: Object.freeze({
        accountId: value.playerProfile.accountId,
      }),
    }),
  };
}
