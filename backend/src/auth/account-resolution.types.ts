import {
  AccountId,
  AccountStatus,
  UserRole,
  isAccountId,
} from '../accounts/account.types';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  ExternalIdentityKey,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';

export interface ExistingAccountResolution {
  readonly type: 'existing_account';
  readonly accountId: AccountId;
  readonly accountStatus: 'active';
  readonly identityKey: ExternalIdentityKey;
}

export interface NewAccountRequiredResolution {
  readonly type: 'new_account_required';
  readonly identityKey: ExternalIdentityKey;
  readonly accountDraft: {
    readonly initialRole: Extract<UserRole, 'player'>;
  };
}

export type BlockedAccountResolution =
  | {
      readonly type: 'blocked';
      readonly reason: 'account_blocked';
      readonly accountId: AccountId;
      readonly accountStatus: 'blocked';
      readonly identityKey: ExternalIdentityKey;
    }
  | {
      readonly type: 'blocked';
      readonly reason: 'account_pending_deletion';
      readonly accountId: AccountId;
      readonly accountStatus: 'pending_deletion';
      readonly identityKey: ExternalIdentityKey;
    };

export const ACCOUNT_RESOLUTION_CONFLICT_REASONS = Object.freeze([
  'identity_already_linked_incompatibly',
  'ambiguous_account_resolution',
  'account_anonymized',
  'intent_incompatible_with_current_binding',
] as const);

export type AccountResolutionConflictReason =
  (typeof ACCOUNT_RESOLUTION_CONFLICT_REASONS)[number];

export interface ConflictAccountResolution {
  readonly type: 'conflict';
  readonly reason: AccountResolutionConflictReason;
  readonly identityKey: ExternalIdentityKey;
}

export type AccountResolutionOutcome =
  | ExistingAccountResolution
  | NewAccountRequiredResolution
  | BlockedAccountResolution
  | ConflictAccountResolution;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function passesStringFactory(
  value: unknown,
  factory: (input: string) => string,
): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    factory(value);
    return true;
  } catch {
    return false;
  }
}

function isConflictReason(
  value: unknown,
): value is AccountResolutionConflictReason {
  return (
    typeof value === 'string' &&
    (ACCOUNT_RESOLUTION_CONFLICT_REASONS as readonly string[]).includes(value)
  );
}

export function isValidExternalIdentityKey(
  value: unknown,
): value is ExternalIdentityKey {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['provider', 'namespace', 'lookup']) ||
    typeof value.provider !== 'string' ||
    !(EXTERNAL_IDENTITY_PROVIDERS as readonly string[]).includes(
      value.provider,
    ) ||
    !passesStringFactory(value.namespace, externalIdentityNamespace) ||
    !isRecord(value.lookup)
  ) {
    return false;
  }

  if (value.lookup.kind === 'canonical_subject') {
    return (
      hasExactlyKeys(value.lookup, ['kind', 'subject']) &&
      passesStringFactory(
        value.lookup.subject,
        trustProviderCanonicalizedExternalIdentitySubject,
      )
    );
  }

  return (
    value.lookup.kind === 'lookup_digest' &&
    hasExactlyKeys(value.lookup, ['kind', 'digest']) &&
    passesStringFactory(value.lookup.digest, externalIdentityLookupDigest)
  );
}

export function isValidAccountResolutionOutcome(
  value: unknown,
): value is AccountResolutionOutcome {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'existing_account':
      return (
        hasExactlyKeys(value, [
          'type',
          'accountId',
          'accountStatus',
          'identityKey',
        ]) &&
        isAccountId(value.accountId) &&
        value.accountStatus === 'active' &&
        isValidExternalIdentityKey(value.identityKey)
      );
    case 'new_account_required':
      return (
        hasExactlyKeys(value, ['type', 'identityKey', 'accountDraft']) &&
        isValidExternalIdentityKey(value.identityKey) &&
        isRecord(value.accountDraft) &&
        hasExactlyKeys(value.accountDraft, ['initialRole']) &&
        value.accountDraft.initialRole === 'player'
      );
    case 'blocked':
      return (
        hasExactlyKeys(value, [
          'type',
          'reason',
          'accountId',
          'accountStatus',
          'identityKey',
        ]) &&
        isAccountId(value.accountId) &&
        isValidExternalIdentityKey(value.identityKey) &&
        ((value.accountStatus === 'blocked' &&
          value.reason === 'account_blocked') ||
          (value.accountStatus === 'pending_deletion' &&
            value.reason === 'account_pending_deletion'))
      );
    case 'conflict':
      return (
        hasExactlyKeys(value, ['type', 'reason', 'identityKey']) &&
        isConflictReason(value.reason) &&
        isValidExternalIdentityKey(value.identityKey)
      );
    default:
      return false;
  }
}

function assertValidIdentityKey(identityKey: unknown): asserts identityKey is ExternalIdentityKey {
  if (!isValidExternalIdentityKey(identityKey)) {
    throw new TypeError('External identity key is invalid');
  }
}

function assertAccountId(accountId: unknown): asserts accountId is AccountId {
  if (!isAccountId(accountId)) {
    throw new TypeError('Account ID is invalid');
  }
}

function immutableIdentityKey(
  identityKey: ExternalIdentityKey,
): ExternalIdentityKey {
  const lookup =
    identityKey.lookup.kind === 'canonical_subject'
      ? Object.freeze({
          kind: 'canonical_subject' as const,
          subject: identityKey.lookup.subject,
        })
      : Object.freeze({
          kind: 'lookup_digest' as const,
          digest: identityKey.lookup.digest,
        });

  return Object.freeze({
    provider: identityKey.provider,
    namespace: identityKey.namespace,
    lookup,
  });
}

export function resolveExistingAccountStatus(
  identityKey: ExternalIdentityKey,
  accountId: AccountId,
  accountStatus: AccountStatus,
): ExistingAccountResolution | BlockedAccountResolution | ConflictAccountResolution {
  assertValidIdentityKey(identityKey);
  assertAccountId(accountId);
  const immutableKey = immutableIdentityKey(identityKey);

  switch (accountStatus) {
    case 'active':
      return Object.freeze({
        type: 'existing_account',
        accountId,
        accountStatus,
        identityKey: immutableKey,
      });
    case 'blocked':
      return Object.freeze({
        type: 'blocked',
        reason: 'account_blocked',
        accountId,
        accountStatus,
        identityKey: immutableKey,
      });
    case 'pending_deletion':
      return Object.freeze({
        type: 'blocked',
        reason: 'account_pending_deletion',
        accountId,
        accountStatus,
        identityKey: immutableKey,
      });
    case 'anonymized':
      return Object.freeze({
        type: 'conflict',
        reason: 'account_anonymized',
        identityKey: immutableKey,
      });
    default:
      throw new TypeError('Account status is invalid');
  }
}

export function newAccountRequired(
  identityKey: ExternalIdentityKey,
): NewAccountRequiredResolution {
  assertValidIdentityKey(identityKey);
  return Object.freeze({
    type: 'new_account_required',
    identityKey: immutableIdentityKey(identityKey),
    accountDraft: Object.freeze({ initialRole: 'player' }),
  });
}

export function accountResolutionConflict(
  identityKey: ExternalIdentityKey,
  reason: AccountResolutionConflictReason,
): ConflictAccountResolution {
  assertValidIdentityKey(identityKey);
  if (!isConflictReason(reason)) {
    throw new TypeError('Account resolution conflict reason is invalid');
  }

  return Object.freeze({
    type: 'conflict',
    reason,
    identityKey: immutableIdentityKey(identityKey),
  });
}
