import { AccountId, isAccountId } from './account.types';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  ExternalIdentityLookupDigest,
  ExternalIdentityNamespace,
  ExternalIdentityProvider,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from './external-identity.types';
import {
  EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  ExternalIdentityLookupDigestPepperVersion,
  ExternalIdentityLookupDigestVersion,
} from './external-identity-lookup-digest.port';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';

declare const externalIdentityIdBrand: unique symbol;

export type ExternalIdentityId = InternalUuid & {
  readonly [externalIdentityIdBrand]: 'ExternalIdentityId';
};

export function isExternalIdentityId(
  value: unknown,
): value is ExternalIdentityId {
  return isInternalUuid(value);
}

export function newExternalIdentityId(): ExternalIdentityId {
  return newInternalUuid() as ExternalIdentityId;
}

export interface ExternalIdentityLookupDigestAlias {
  readonly identityId: ExternalIdentityId;
  readonly algorithm: typeof EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM;
  readonly provider: ExternalIdentityProvider;
  readonly namespace: ExternalIdentityNamespace;
  readonly digest: ExternalIdentityLookupDigest;
  readonly digestVersion: ExternalIdentityLookupDigestVersion;
  readonly pepperVersion: ExternalIdentityLookupDigestPepperVersion;
}

export interface ExternalIdentityStateBinding {
  readonly identityId: ExternalIdentityId;
  /** Immutable historical owner; ordinary lifecycle operations never replace it. */
  readonly accountId: AccountId;
  readonly provider: ExternalIdentityProvider;
  readonly namespace: ExternalIdentityNamespace;
  readonly lookupDigestAliases: readonly ExternalIdentityLookupDigestAlias[];
}

export interface LinkedExternalIdentityState
  extends ExternalIdentityStateBinding {
  readonly status: 'linked';
  readonly isPrimary: boolean;
}

export interface UnlinkedExternalIdentityState
  extends ExternalIdentityStateBinding {
  readonly status: 'unlinked';
  readonly isPrimary: false;
}

export type ExternalIdentityState =
  | LinkedExternalIdentityState
  | UnlinkedExternalIdentityState;

export interface LinkExternalIdentityCommand {
  readonly identityId: ExternalIdentityId;
  readonly accountId: AccountId;
  readonly makePrimary: boolean;
}

export interface UnlinkExternalIdentityCommand {
  readonly identityId: ExternalIdentityId;
  readonly accountId: AccountId;
}

/**
 * Result of the account-level login-method check required before unlink.
 *
 * A future repository must calculate this context while the account row and
 * all of its linked external-identity rows are locked in one PostgreSQL
 * transaction. The transition must be called before commit in that same
 * transaction. This TypeScript value does not provide a concurrency guarantee.
 */
export type UnlinkExternalIdentityTransitionContext =
  | {
      readonly identityId: ExternalIdentityId;
      readonly accountId: AccountId;
      readonly hasOtherLinkedIdentity: false;
      readonly replacementPrimaryIdentityId: null;
    }
  | {
      readonly identityId: ExternalIdentityId;
      readonly accountId: AccountId;
      readonly hasOtherLinkedIdentity: true;
      /**
       * Required when the identity being unlinked is currently primary. The
       * future repository must promote this already-linked replacement inside
       * the same transaction; this reducer only transitions the target.
       */
      readonly replacementPrimaryIdentityId: ExternalIdentityId | null;
    };

export type ExternalIdentityLifecycleResult =
  | {
      readonly outcome: 'transitioned' | 'idempotent_retry';
      readonly state: ExternalIdentityState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'identity_historically_reserved_for_another_account'
        | 'identity_binding_conflict'
        | 'invalid_external_identity_state'
        | 'invalid_external_identity_command'
        | 'invalid_unlink_transition_context'
        | 'unlink_context_binding_conflict'
        | 'last_login_method_cannot_be_unlinked'
        | 'replacement_primary_identity_required';
      readonly state: ExternalIdentityState;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isPositiveSafeInteger(value: unknown): boolean {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  );
}

export function isExternalIdentityLookupDigestAlias(
  value: unknown,
): value is ExternalIdentityLookupDigestAlias {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === 7 &&
    [
      'identityId',
      'algorithm',
      'provider',
      'namespace',
      'digest',
      'digestVersion',
      'pepperVersion',
    ].every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    isExternalIdentityId(value.identityId) &&
    value.algorithm === EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM &&
    typeof value.provider === 'string' &&
    (EXTERNAL_IDENTITY_PROVIDERS as readonly string[]).includes(
      value.provider,
    ) &&
    passesStringFactory(value.namespace, externalIdentityNamespace) &&
    passesStringFactory(value.digest, externalIdentityLookupDigest) &&
    isPositiveSafeInteger(value.digestVersion) &&
    isPositiveSafeInteger(value.pepperVersion)
  );
}

export function isExternalIdentityState(
  value: unknown,
): value is ExternalIdentityState {
  if (
    !isRecord(value) ||
    !isExternalIdentityId(value.identityId) ||
    !isAccountId(value.accountId) ||
    typeof value.provider !== 'string' ||
    !(EXTERNAL_IDENTITY_PROVIDERS as readonly string[]).includes(
      value.provider,
    ) ||
    !passesStringFactory(value.namespace, externalIdentityNamespace) ||
    !Array.isArray(value.lookupDigestAliases) ||
    value.lookupDigestAliases.length === 0
  ) {
    return false;
  }

  const aliasVersions = new Set<string>();
  for (const alias of value.lookupDigestAliases) {
    if (
      !isExternalIdentityLookupDigestAlias(alias) ||
      alias.identityId !== value.identityId ||
      alias.provider !== value.provider ||
      alias.namespace !== value.namespace
    ) {
      return false;
    }

    const versionKey = `${alias.digestVersion}:${alias.pepperVersion}`;
    if (aliasVersions.has(versionKey)) {
      return false;
    }
    aliasVersions.add(versionKey);
  }

  const expectedKeys = [
    'identityId',
    'accountId',
    'provider',
    'namespace',
    'lookupDigestAliases',
    'status',
    'isPrimary',
  ];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    !expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  ) {
    return false;
  }

  return value.status === 'linked'
    ? typeof value.isPrimary === 'boolean'
    : value.status === 'unlinked' && value.isPrimary === false;
}

export function isLinkExternalIdentityCommand(
  value: unknown,
): value is LinkExternalIdentityCommand {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    ['identityId', 'accountId', 'makePrimary'].every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) &&
    isExternalIdentityId(value.identityId) &&
    isAccountId(value.accountId) &&
    typeof value.makePrimary === 'boolean'
  );
}

export function isUnlinkExternalIdentityCommand(
  value: unknown,
): value is UnlinkExternalIdentityCommand {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    ['identityId', 'accountId'].every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) &&
    isExternalIdentityId(value.identityId) &&
    isAccountId(value.accountId)
  );
}

export function isUnlinkExternalIdentityTransitionContext(
  value: unknown,
): value is UnlinkExternalIdentityTransitionContext {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    ![
      'identityId',
      'accountId',
      'hasOtherLinkedIdentity',
      'replacementPrimaryIdentityId',
    ].every((key) => Object.prototype.hasOwnProperty.call(value, key)) ||
    !isExternalIdentityId(value.identityId) ||
    !isAccountId(value.accountId) ||
    typeof value.hasOtherLinkedIdentity !== 'boolean'
  ) {
    return false;
  }

  if (!value.hasOtherLinkedIdentity) {
    return value.replacementPrimaryIdentityId === null;
  }

  return (
    value.replacementPrimaryIdentityId === null ||
    (isExternalIdentityId(value.replacementPrimaryIdentityId) &&
      value.replacementPrimaryIdentityId !== value.identityId)
  );
}

function immutableStateBinding(
  state: ExternalIdentityState,
): ExternalIdentityStateBinding {
  return {
    identityId: state.identityId,
    accountId: state.accountId,
    provider: state.provider,
    namespace: state.namespace,
    lookupDigestAliases: Object.freeze(
      state.lookupDigestAliases.map((alias) => Object.freeze({ ...alias })),
    ),
  };
}

export function linkExternalIdentity(
  state: ExternalIdentityState,
  command: LinkExternalIdentityCommand,
): ExternalIdentityLifecycleResult {
  if (!isExternalIdentityState(state)) {
    return { outcome: 'rejected', reason: 'invalid_external_identity_state', state };
  }
  if (!isLinkExternalIdentityCommand(command)) {
    return {
      outcome: 'rejected',
      reason: 'invalid_external_identity_command',
      state,
    };
  }
  if (command.accountId !== state.accountId) {
    return {
      outcome: 'rejected',
      reason: 'identity_historically_reserved_for_another_account',
      state,
    };
  }
  if (command.identityId !== state.identityId) {
    return { outcome: 'rejected', reason: 'identity_binding_conflict', state };
  }
  if (state.status === 'linked' && state.isPrimary === command.makePrimary) {
    return { outcome: 'idempotent_retry', state };
  }

  return {
    outcome: 'transitioned',
    state: Object.freeze({
      ...immutableStateBinding(state),
      status: 'linked' as const,
      isPrimary: command.makePrimary,
    }),
  };
}

export function unlinkExternalIdentity(
  state: ExternalIdentityState,
  command: UnlinkExternalIdentityCommand,
  context: UnlinkExternalIdentityTransitionContext,
): ExternalIdentityLifecycleResult {
  if (!isExternalIdentityState(state)) {
    return { outcome: 'rejected', reason: 'invalid_external_identity_state', state };
  }
  if (!isUnlinkExternalIdentityCommand(command)) {
    return {
      outcome: 'rejected',
      reason: 'invalid_external_identity_command',
      state,
    };
  }
  if (!isUnlinkExternalIdentityTransitionContext(context)) {
    return {
      outcome: 'rejected',
      reason: 'invalid_unlink_transition_context',
      state,
    };
  }
  if (command.accountId !== state.accountId) {
    return {
      outcome: 'rejected',
      reason: 'identity_historically_reserved_for_another_account',
      state,
    };
  }
  if (command.identityId !== state.identityId) {
    return { outcome: 'rejected', reason: 'identity_binding_conflict', state };
  }
  if (
    context.accountId !== state.accountId ||
    context.identityId !== state.identityId
  ) {
    return {
      outcome: 'rejected',
      reason: 'unlink_context_binding_conflict',
      state,
    };
  }
  if (state.status === 'unlinked') {
    return { outcome: 'idempotent_retry', state };
  }
  if (!context.hasOtherLinkedIdentity) {
    return {
      outcome: 'rejected',
      reason: 'last_login_method_cannot_be_unlinked',
      state,
    };
  }
  if (state.isPrimary && context.replacementPrimaryIdentityId === null) {
    return {
      outcome: 'rejected',
      reason: 'replacement_primary_identity_required',
      state,
    };
  }

  return {
    outcome: 'transitioned',
    state: Object.freeze({
      ...immutableStateBinding(state),
      status: 'unlinked' as const,
      isPrimary: false as const,
    }),
  };
}
