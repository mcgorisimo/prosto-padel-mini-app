import { ExternalIdentityKey } from '../accounts/external-identity.types';
import {
  AccountResolutionOutcome,
  BlockedAccountResolution,
  ConflictAccountResolution,
  ExistingAccountResolution,
  NewAccountRequiredResolution,
  isValidAccountResolutionOutcome,
  isValidExternalIdentityKey,
} from './account-resolution.types';
import {
  AuthenticationCommandId,
  AuthenticationIdempotencyKey,
  AuthenticationIntent,
  AuthenticationOperationId,
  AuthenticationProofReference,
  AuthenticationRequestDigest,
  UnixEpochSeconds,
  isAuthenticationCommandId,
  isAuthenticationIdempotencyKey,
  isAuthenticationIntent,
  isAuthenticationOperationId,
  isAuthenticationProofReference,
  isAuthenticationRequestDigest,
  isUnixEpochSeconds,
} from './auth.types';

export const AUTHENTICATION_OPERATION_FAILURE_REASONS = Object.freeze([
  'proof_validation_unavailable',
  'account_resolution_unavailable',
  'internal_dependency_unavailable',
  'operation_cancelled',
] as const);

export type AuthenticationOperationFailureReason =
  (typeof AUTHENTICATION_OPERATION_FAILURE_REASONS)[number];

const AUTHENTICATION_INTENT_OUTCOME_COMPATIBILITY = Object.freeze({
  sign_in: Object.freeze([
    'existing_account',
    'blocked',
    'conflict',
  ] as const),
  sign_up: Object.freeze([
    'existing_account',
    'new_account_required',
    'blocked',
    'conflict',
  ] as const),
  link_identity: Object.freeze([
    'existing_account',
    'blocked',
    'conflict',
  ] as const),
  fresh_authentication: Object.freeze([
    'existing_account',
    'blocked',
    'conflict',
  ] as const),
  account_recovery: Object.freeze([
    'existing_account',
    'blocked',
    'conflict',
  ] as const),
} satisfies Readonly<
  Record<AuthenticationIntent, readonly AccountResolutionOutcome['type'][]>
>);

export function isAuthenticationIntentOutcomeCompatible(
  intent: AuthenticationIntent,
  outcomeType: AccountResolutionOutcome['type'],
): boolean {
  return (
    AUTHENTICATION_INTENT_OUTCOME_COMPATIBILITY[intent] as readonly string[]
  ).includes(outcomeType);
}

export const AUTHENTICATION_OPERATION_BINDING_REJECTION_REASONS =
  Object.freeze([
    'invalid_binding_shape',
    'invalid_operation_id',
    'invalid_intent',
    'invalid_identity_key',
    'invalid_proof_reference',
    'invalid_idempotency_key',
    'invalid_request_digest',
    'invalid_created_at',
    'invalid_expires_at',
    'invalid_operation_window',
  ] as const);

export type AuthenticationOperationBindingRejectionReason =
  (typeof AUTHENTICATION_OPERATION_BINDING_REJECTION_REASONS)[number];

export const AUTHENTICATION_OPERATION_COMMAND_REJECTION_REASONS =
  Object.freeze([
    'invalid_command_shape',
    'invalid_command_id',
    'invalid_command_type',
    'invalid_operation_id',
    'invalid_command_binding',
    'invalid_time',
    'missing_resolution',
    'missing_failure_reason',
    'invalid_failure_reason',
  ] as const);

export type AuthenticationOperationCommandRejectionReason =
  (typeof AUTHENTICATION_OPERATION_COMMAND_REJECTION_REASONS)[number];

export interface AuthenticationOperationBinding {
  readonly operationId: AuthenticationOperationId;
  readonly intent: AuthenticationIntent;
  readonly identityKey: ExternalIdentityKey;
  readonly proofReference: AuthenticationProofReference;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly idempotencyKey: AuthenticationIdempotencyKey;
  readonly requestDigest: AuthenticationRequestDigest;
}

export type AuthenticationOperationCommandBinding = Pick<
  AuthenticationOperationBinding,
  | 'operationId'
  | 'intent'
  | 'identityKey'
  | 'proofReference'
  | 'idempotencyKey'
  | 'requestDigest'
>;

interface AppliedAuthenticationOperationCommand {
  readonly operationId: AuthenticationOperationId;
  readonly commandId: AuthenticationCommandId;
  readonly commandType: 'complete' | 'fail' | 'expire';
  readonly appliedAt: UnixEpochSeconds;
}

export interface PendingAuthenticationOperation
  extends AuthenticationOperationBinding {
  readonly status: 'pending';
}

export interface CompletedAuthenticationOperation
  extends AuthenticationOperationBinding {
  readonly status: 'completed';
  readonly resolution: AccountResolutionOutcome;
  readonly appliedCommand: AppliedAuthenticationOperationCommand & {
    readonly commandType: 'complete';
  };
}

export interface FailedAuthenticationOperation
  extends AuthenticationOperationBinding {
  readonly status: 'failed';
  readonly failureReason: AuthenticationOperationFailureReason;
  readonly appliedCommand: AppliedAuthenticationOperationCommand & {
    readonly commandType: 'fail';
  };
}

export interface ExpiredAuthenticationOperation
  extends AuthenticationOperationBinding {
  readonly status: 'expired';
  readonly appliedCommand: AppliedAuthenticationOperationCommand & {
    readonly commandType: 'expire';
  };
}

export type AuthenticationOperationState =
  | PendingAuthenticationOperation
  | CompletedAuthenticationOperation
  | FailedAuthenticationOperation
  | ExpiredAuthenticationOperation;

interface AuthenticationOperationCommandBase {
  readonly commandId: AuthenticationCommandId;
  readonly binding: AuthenticationOperationCommandBinding;
  readonly now: UnixEpochSeconds;
}

export interface CompleteAuthenticationOperationCommand
  extends AuthenticationOperationCommandBase {
  readonly type: 'complete';
  readonly resolution: AccountResolutionOutcome;
}

export interface FailAuthenticationOperationCommand
  extends AuthenticationOperationCommandBase {
  readonly type: 'fail';
  readonly reason: AuthenticationOperationFailureReason;
}

export interface ExpireAuthenticationOperationCommand
  extends AuthenticationOperationCommandBase {
  readonly type: 'expire';
}

export type AuthenticationOperationCommand =
  | CompleteAuthenticationOperationCommand
  | FailAuthenticationOperationCommand
  | ExpireAuthenticationOperationCommand;

/**
 * operation_expired is a refusal, not a state transition. The orchestration
 * layer must subsequently apply an expire command; this reducer does not do
 * so implicitly.
 */
export type AuthenticationOperationRejectionReason =
  | 'invalid_authentication_operation_state'
  | 'invalid_operation_binding'
  | 'invalid_command'
  | 'invalid_resolution_outcome'
  | 'intent_outcome_incompatible'
  | 'operation_binding_conflict'
  | 'resolution_identity_conflict'
  | 'operation_not_expired'
  | 'operation_expired'
  | 'command_reuse_conflict'
  | 'forbidden_transition';

export type CreateAuthenticationOperationResult =
  | {
      readonly outcome: 'created';
      readonly state: PendingAuthenticationOperation;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_operation_binding';
      readonly bindingReason: AuthenticationOperationBindingRejectionReason;
    };

export type AuthenticationOperationTransitionResult =
  | {
      readonly outcome: 'transitioned';
      readonly state: AuthenticationOperationState;
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly state: AuthenticationOperationState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_authentication_operation_state';
      readonly stateReason:
        | 'invalid_state_shape'
        | 'invalid_state_binding'
        | 'invalid_pending_state'
        | 'invalid_completed_state'
        | 'invalid_failed_state'
        | 'invalid_expired_state';
      readonly state: AuthenticationOperationState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_command';
      readonly commandReason: AuthenticationOperationCommandRejectionReason;
      readonly state: AuthenticationOperationState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: Exclude<
        AuthenticationOperationRejectionReason,
        | 'invalid_authentication_operation_state'
        | 'invalid_operation_binding'
        | 'invalid_command'
      >;
      readonly state: AuthenticationOperationState;
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

function operationBindingRejectionReason(
  binding: unknown,
): AuthenticationOperationBindingRejectionReason | undefined {
  if (!isRecord(binding)) {
    return 'invalid_binding_shape';
  }
  if (!isAuthenticationOperationId(binding.operationId)) {
    return 'invalid_operation_id';
  }
  if (!isAuthenticationIntent(binding.intent)) {
    return 'invalid_intent';
  }
  if (!isValidExternalIdentityKey(binding.identityKey)) {
    return 'invalid_identity_key';
  }
  if (!isAuthenticationProofReference(binding.proofReference)) {
    return 'invalid_proof_reference';
  }
  if (!isAuthenticationIdempotencyKey(binding.idempotencyKey)) {
    return 'invalid_idempotency_key';
  }
  if (!isAuthenticationRequestDigest(binding.requestDigest)) {
    return 'invalid_request_digest';
  }
  if (!isUnixEpochSeconds(binding.createdAt)) {
    return 'invalid_created_at';
  }
  if (!isUnixEpochSeconds(binding.expiresAt)) {
    return 'invalid_expires_at';
  }
  if (binding.createdAt >= binding.expiresAt) {
    return 'invalid_operation_window';
  }

  return undefined;
}

function isAuthenticationOperationFailureReason(
  value: unknown,
): value is AuthenticationOperationFailureReason {
  return (
    typeof value === 'string' &&
    (AUTHENTICATION_OPERATION_FAILURE_REASONS as readonly string[]).includes(
      value,
    )
  );
}

function isValidCommandBinding(
  binding: unknown,
): binding is AuthenticationOperationCommandBinding {
  return (
    isRecord(binding) &&
    isAuthenticationOperationId(binding.operationId) &&
    isAuthenticationIntent(binding.intent) &&
    isValidExternalIdentityKey(binding.identityKey) &&
    isAuthenticationProofReference(binding.proofReference) &&
    isAuthenticationIdempotencyKey(binding.idempotencyKey) &&
    isAuthenticationRequestDigest(binding.requestDigest)
  );
}

function commandRejectionReason(
  command: unknown,
): AuthenticationOperationCommandRejectionReason | undefined {
  if (!isRecord(command)) {
    return 'invalid_command_shape';
  }
  if (!isAuthenticationCommandId(command.commandId)) {
    return 'invalid_command_id';
  }
  if (
    command.type !== 'complete' &&
    command.type !== 'fail' &&
    command.type !== 'expire'
  ) {
    return 'invalid_command_type';
  }
  if (
    !isRecord(command.binding) ||
    !isAuthenticationOperationId(command.binding.operationId)
  ) {
    return 'invalid_operation_id';
  }
  if (!isValidCommandBinding(command.binding)) {
    return 'invalid_command_binding';
  }
  if (!isUnixEpochSeconds(command.now)) {
    return 'invalid_time';
  }
  if (command.type === 'complete') {
    if (
      !Object.prototype.hasOwnProperty.call(command, 'resolution') ||
      command.resolution === undefined
    ) {
      return 'missing_resolution';
    }
    return undefined;
  }
  if (command.type === 'fail') {
    if (
      !Object.prototype.hasOwnProperty.call(command, 'reason') ||
      command.reason === undefined
    ) {
      return 'missing_failure_reason';
    }
    if (!isAuthenticationOperationFailureReason(command.reason)) {
      return 'invalid_failure_reason';
    }
  }

  return undefined;
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

function identityKeysEqual(
  left: ExternalIdentityKey,
  right: ExternalIdentityKey,
): boolean {
  if (
    left.provider !== right.provider ||
    left.namespace !== right.namespace ||
    left.lookup.kind !== right.lookup.kind
  ) {
    return false;
  }

  if (
    left.lookup.kind === 'canonical_subject' &&
    right.lookup.kind === 'canonical_subject'
  ) {
    return left.lookup.subject === right.lookup.subject;
  }

  return (
    left.lookup.kind === 'lookup_digest' &&
    right.lookup.kind === 'lookup_digest' &&
    left.lookup.digest === right.lookup.digest
  );
}

function immutableProofReference(
  proofReference: AuthenticationProofReference,
): AuthenticationProofReference {
  return proofReference.type === 'telegram_proof'
    ? Object.freeze({
        type: proofReference.type,
        proofFingerprint: proofReference.proofFingerprint,
      })
    : Object.freeze({
        type: proofReference.type,
        challengeId: proofReference.challengeId,
      });
}

function proofReferencesEqual(
  left: AuthenticationProofReference,
  right: AuthenticationProofReference,
): boolean {
  if (left.type !== right.type) {
    return false;
  }

  return left.type === 'telegram_proof' && right.type === 'telegram_proof'
    ? left.proofFingerprint === right.proofFingerprint
    : left.type === 'otp_challenge' &&
        right.type === 'otp_challenge' &&
        left.challengeId === right.challengeId;
}

const AUTHENTICATION_OPERATION_BINDING_KEYS = Object.freeze([
  'operationId',
  'intent',
  'identityKey',
  'proofReference',
  'createdAt',
  'expiresAt',
  'idempotencyKey',
  'requestDigest',
] as const);

function isValidAppliedAuthenticationOperationCommand(
  value: unknown,
  state: AuthenticationOperationBinding,
  expectedType: AppliedAuthenticationOperationCommand['commandType'],
): value is AppliedAuthenticationOperationCommand {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      'operationId',
      'commandId',
      'commandType',
      'appliedAt',
    ]) ||
    value.operationId !== state.operationId ||
    !isAuthenticationCommandId(value.commandId) ||
    value.commandType !== expectedType ||
    !isUnixEpochSeconds(value.appliedAt)
  ) {
    return false;
  }

  return expectedType === 'expire'
    ? value.appliedAt >= state.expiresAt
    : value.appliedAt >= state.createdAt && value.appliedAt < state.expiresAt;
}

function authenticationOperationStateRejectionReason(
  value: unknown,
):
  | 'invalid_state_shape'
  | 'invalid_state_binding'
  | 'invalid_pending_state'
  | 'invalid_completed_state'
  | 'invalid_failed_state'
  | 'invalid_expired_state'
  | undefined {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return 'invalid_state_shape';
  }
  if (operationBindingRejectionReason(value) !== undefined) {
    return 'invalid_state_binding';
  }

  const binding = value as unknown as AuthenticationOperationBinding;
  switch (value.status) {
    case 'pending':
      return hasExactlyKeys(value, [
        ...AUTHENTICATION_OPERATION_BINDING_KEYS,
        'status',
      ])
        ? undefined
        : 'invalid_pending_state';
    case 'completed':
      if (
        !hasExactlyKeys(value, [
          ...AUTHENTICATION_OPERATION_BINDING_KEYS,
          'status',
          'resolution',
          'appliedCommand',
        ]) ||
        !isValidAccountResolutionOutcome(value.resolution) ||
        !isAuthenticationIntentOutcomeCompatible(
          binding.intent,
          value.resolution.type,
        ) ||
        !identityKeysEqual(binding.identityKey, value.resolution.identityKey) ||
        !isValidAppliedAuthenticationOperationCommand(
          value.appliedCommand,
          binding,
          'complete',
        )
      ) {
        return 'invalid_completed_state';
      }
      return undefined;
    case 'failed':
      if (
        !hasExactlyKeys(value, [
          ...AUTHENTICATION_OPERATION_BINDING_KEYS,
          'status',
          'failureReason',
          'appliedCommand',
        ]) ||
        !isAuthenticationOperationFailureReason(value.failureReason) ||
        !isValidAppliedAuthenticationOperationCommand(
          value.appliedCommand,
          binding,
          'fail',
        )
      ) {
        return 'invalid_failed_state';
      }
      return undefined;
    case 'expired':
      if (
        !hasExactlyKeys(value, [
          ...AUTHENTICATION_OPERATION_BINDING_KEYS,
          'status',
          'appliedCommand',
        ]) ||
        !isValidAppliedAuthenticationOperationCommand(
          value.appliedCommand,
          binding,
          'expire',
        )
      ) {
        return 'invalid_expired_state';
      }
      return undefined;
    default:
      return 'invalid_state_shape';
  }
}

function commandBindingMatches(
  state: AuthenticationOperationState,
  binding: AuthenticationOperationCommandBinding,
): boolean {
  return (
    state.operationId === binding.operationId &&
    state.intent === binding.intent &&
    identityKeysEqual(state.identityKey, binding.identityKey) &&
    proofReferencesEqual(state.proofReference, binding.proofReference) &&
    state.idempotencyKey === binding.idempotencyKey &&
    state.requestDigest === binding.requestDigest
  );
}

function resolutionOutcomesEqual(
  left: AccountResolutionOutcome,
  right: AccountResolutionOutcome,
): boolean {
  if (!identityKeysEqual(left.identityKey, right.identityKey)) {
    return false;
  }

  if (left.type === 'existing_account' && right.type === 'existing_account') {
    return (
      left.accountId === right.accountId &&
      left.accountStatus === right.accountStatus
    );
  }

  if (
    left.type === 'new_account_required' &&
    right.type === 'new_account_required'
  ) {
    return left.accountDraft.initialRole === right.accountDraft.initialRole;
  }

  if (left.type === 'blocked' && right.type === 'blocked') {
    return (
      left.reason === right.reason &&
      left.accountId === right.accountId &&
      left.accountStatus === right.accountStatus
    );
  }

  return (
    left.type === 'conflict' &&
    right.type === 'conflict' &&
    left.reason === right.reason
  );
}

function immutableResolution(
  resolution: AccountResolutionOutcome,
  identityKey: ExternalIdentityKey,
): AccountResolutionOutcome {
  switch (resolution.type) {
    case 'existing_account': {
      const result: ExistingAccountResolution = {
        type: resolution.type,
        accountId: resolution.accountId,
        accountStatus: resolution.accountStatus,
        identityKey,
      };
      return Object.freeze(result);
    }
    case 'new_account_required': {
      const result: NewAccountRequiredResolution = {
        type: resolution.type,
        identityKey,
        accountDraft: Object.freeze({
          initialRole: resolution.accountDraft.initialRole,
        }),
      };
      return Object.freeze(result);
    }
    case 'blocked': {
      const result: BlockedAccountResolution = {
        type: resolution.type,
        reason: resolution.reason,
        accountId: resolution.accountId,
        accountStatus: resolution.accountStatus,
        identityKey,
      } as BlockedAccountResolution;
      return Object.freeze(result);
    }
    case 'conflict': {
      const result: ConflictAccountResolution = {
        type: resolution.type,
        reason: resolution.reason,
        identityKey,
      };
      return Object.freeze(result);
    }
  }
}

function baseState(
  state: AuthenticationOperationState,
): AuthenticationOperationBinding {
  return {
    operationId: state.operationId,
    intent: state.intent,
    identityKey: state.identityKey,
    proofReference: state.proofReference,
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    idempotencyKey: state.idempotencyKey,
    requestDigest: state.requestDigest,
  };
}

function appliedCommand(
  command: AuthenticationOperationCommand,
): AppliedAuthenticationOperationCommand {
  return Object.freeze({
    operationId: command.binding.operationId,
    commandId: command.commandId,
    commandType: command.type,
    appliedAt: command.now,
  });
}

function isExactTerminalRetry(
  state: Exclude<AuthenticationOperationState, PendingAuthenticationOperation>,
  command: AuthenticationOperationCommand,
): boolean {
  if (
    state.appliedCommand.commandId !== command.commandId ||
    state.appliedCommand.commandType !== command.type
  ) {
    return false;
  }

  if (state.status === 'completed' && command.type === 'complete') {
    return resolutionOutcomesEqual(state.resolution, command.resolution);
  }

  if (state.status === 'failed' && command.type === 'fail') {
    return state.failureReason === command.reason;
  }

  return state.status === 'expired' && command.type === 'expire';
}

export function createAuthenticationOperation(
  binding: AuthenticationOperationBinding,
): CreateAuthenticationOperationResult {
  const bindingReason = operationBindingRejectionReason(binding);
  if (bindingReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_operation_binding',
      bindingReason,
    };
  }

  const state: PendingAuthenticationOperation = Object.freeze({
    operationId: binding.operationId,
    intent: binding.intent,
    identityKey: immutableIdentityKey(binding.identityKey),
    proofReference: immutableProofReference(binding.proofReference),
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt,
    idempotencyKey: binding.idempotencyKey,
    requestDigest: binding.requestDigest,
    status: 'pending',
  });

  return { outcome: 'created', state };
}

export function transitionAuthenticationOperation(
  state: AuthenticationOperationState,
  command: AuthenticationOperationCommand,
): AuthenticationOperationTransitionResult {
  const stateReason = authenticationOperationStateRejectionReason(state);
  if (stateReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_authentication_operation_state',
      stateReason,
      state,
    };
  }

  const invalidCommandReason = commandRejectionReason(command);
  if (invalidCommandReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_command',
      commandReason: invalidCommandReason,
      state,
    };
  }

  if (!commandBindingMatches(state, command.binding)) {
    return {
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
      state,
    };
  }

  if (
    command.type === 'complete' &&
    !isValidAccountResolutionOutcome(command.resolution)
  ) {
    return {
      outcome: 'rejected',
      reason: 'invalid_resolution_outcome',
      state,
    };
  }

  if (state.status !== 'pending') {
    if (isExactTerminalRetry(state, command)) {
      return {
        outcome: 'idempotent_retry',
        state,
      };
    }

    if (state.appliedCommand.commandId === command.commandId) {
      return {
        outcome: 'rejected',
        reason: 'command_reuse_conflict',
        state,
      };
    }

    return {
      outcome: 'rejected',
      reason: 'forbidden_transition',
      state,
    };
  }

  if (command.now < state.createdAt) {
    return {
      outcome: 'rejected',
      reason: 'invalid_command',
      commandReason: 'invalid_time',
      state,
    };
  }

  if (command.type === 'expire') {
    if (command.now < state.expiresAt) {
      return {
        outcome: 'rejected',
        reason: 'operation_not_expired',
        state,
      };
    }

    const expired: ExpiredAuthenticationOperation = Object.freeze({
      ...baseState(state),
      status: 'expired',
      appliedCommand: appliedCommand(command) as ExpiredAuthenticationOperation['appliedCommand'],
    });
    return { outcome: 'transitioned', state: expired };
  }

  if (command.now >= state.expiresAt) {
    return {
      outcome: 'rejected',
      reason: 'operation_expired',
      state,
    };
  }

  if (command.type === 'complete') {
    if (!identityKeysEqual(state.identityKey, command.resolution.identityKey)) {
      return {
        outcome: 'rejected',
        reason: 'resolution_identity_conflict',
        state,
      };
    }

    if (
      !isAuthenticationIntentOutcomeCompatible(
        state.intent,
        command.resolution.type,
      )
    ) {
      return {
        outcome: 'rejected',
        reason: 'intent_outcome_incompatible',
        state,
      };
    }

    const completed: CompletedAuthenticationOperation = Object.freeze({
      ...baseState(state),
      status: 'completed',
      resolution: immutableResolution(command.resolution, state.identityKey),
      appliedCommand: appliedCommand(command) as CompletedAuthenticationOperation['appliedCommand'],
    });
    return { outcome: 'transitioned', state: completed };
  }

  const failed: FailedAuthenticationOperation = Object.freeze({
    ...baseState(state),
    status: 'failed',
    failureReason: command.reason,
    appliedCommand: appliedCommand(command) as FailedAuthenticationOperation['appliedCommand'],
  });
  return { outcome: 'transitioned', state: failed };
}
