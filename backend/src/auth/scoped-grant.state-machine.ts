import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds, isUnixEpochSeconds } from './auth.types';
import {
  FreshAuthenticationEvidence,
  FreshAuthenticationEvidenceId,
  isFreshAuthenticationEvidence,
  isFreshAuthenticationEvidenceId,
} from './fresh-authentication.types';
import {
  AppliedSessionCommand,
  ConsumedSessionCredential,
  SessionId,
  SessionAppliedCommandResult,
  SessionCredentialBinding,
  SessionCredentialReference,
  SessionCredentialReuseMetadata,
  SessionExpirationMetadata,
  SessionRevocationMetadata,
  SessionState,
  isSessionAccountId,
  isSessionCommandId,
  isSessionCredentialDigest,
  isSessionCredentialGeneration,
  isSessionId,
  isSessionRequestDigest,
  isSessionRevokeReason,
} from './session.types';

declare const scopedGrantIdBrand: unique symbol;
declare const scopedGrantCommandIdBrand: unique symbol;
declare const scopedGrantResourceDigestBrand: unique symbol;
declare const scopedGrantRequestDigestBrand: unique symbol;

const MAX_SCOPED_GRANT_OPAQUE_VALUE_LENGTH = 256;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type ScopedGrantId = string & {
  readonly [scopedGrantIdBrand]: 'ScopedGrantId';
};

/**
 * A command ID is unique within one grant. A future persistence adapter must
 * atomically enforce uniqueness for the pair (grantId, commandId).
 */
export type ScopedGrantCommandId = string & {
  readonly [scopedGrantCommandIdBrand]: 'ScopedGrantCommandId';
};

export type ScopedGrantResourceDigest = string & {
  readonly [scopedGrantResourceDigestBrand]: 'ScopedGrantResourceDigest';
};

export type ScopedGrantRequestDigest = string & {
  readonly [scopedGrantRequestDigestBrand]: 'ScopedGrantRequestDigest';
};

export const SCOPED_GRANT_SCOPES = Object.freeze([
  'link_identity',
  'unlink_identity',
  'revoke_other_sessions',
  'begin_account_deletion',
  'change_primary_identity',
] as const);

export type ScopedGrantScope = (typeof SCOPED_GRANT_SCOPES)[number];

export const SCOPED_GRANT_REVOKE_REASONS = Object.freeze([
  'user_cancelled',
  'session_revoked',
  'security_event',
  'superseded',
] as const);

export type ScopedGrantRevokeReason =
  (typeof SCOPED_GRANT_REVOKE_REASONS)[number];

export interface CreateScopedGrantBinding {
  readonly grantId: ScopedGrantId;
  readonly evidence: FreshAuthenticationEvidence;
  readonly session: SessionState;
  readonly scope: ScopedGrantScope;
  readonly resourceDigest: ScopedGrantResourceDigest;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
}

export interface ScopedGrantConsumptionMetadata {
  readonly consumedAt: UnixEpochSeconds;
  readonly commandId: ScopedGrantCommandId;
}

export interface ScopedGrantRevocationMetadata {
  readonly reason: ScopedGrantRevokeReason;
  readonly revokedAt: UnixEpochSeconds;
  readonly commandId: ScopedGrantCommandId;
}

export interface ScopedGrantExpirationMetadata {
  readonly expiredAt: UnixEpochSeconds;
  readonly commandId: ScopedGrantCommandId;
}

export type ScopedGrantAppliedResult =
  | {
      readonly type: 'grant_consumed';
      readonly consumption: ScopedGrantConsumptionMetadata;
    }
  | {
      readonly type: 'grant_revoked';
      readonly revocation: ScopedGrantRevocationMetadata;
    }
  | {
      readonly type: 'grant_expired';
      readonly expiration: ScopedGrantExpirationMetadata;
    };

interface AppliedScopedGrantCommandBase {
  readonly grantId: ScopedGrantId;
  readonly commandId: ScopedGrantCommandId;
  readonly requestDigest: ScopedGrantRequestDigest;
  readonly appliedAt: UnixEpochSeconds;
  readonly result: ScopedGrantAppliedResult;
}

export interface AppliedConsumeGrantCommand
  extends AppliedScopedGrantCommandBase {
  readonly commandType: 'consume_grant';
  readonly accountId: AccountId;
  readonly sessionId: SessionId;
  readonly scope: ScopedGrantScope;
  readonly resourceDigest: ScopedGrantResourceDigest;
}

export interface AppliedRevokeGrantCommand
  extends AppliedScopedGrantCommandBase {
  readonly commandType: 'revoke_grant';
  readonly reason: ScopedGrantRevokeReason;
}

export interface AppliedExpireGrantCommand
  extends AppliedScopedGrantCommandBase {
  readonly commandType: 'expire_grant';
}

export type AppliedScopedGrantCommand =
  | AppliedConsumeGrantCommand
  | AppliedRevokeGrantCommand
  | AppliedExpireGrantCommand;

export interface ScopedGrantStateBinding {
  readonly grantId: ScopedGrantId;
  readonly evidenceId: FreshAuthenticationEvidenceId;
  readonly accountId: AccountId;
  readonly sessionId: SessionId;
  readonly scope: ScopedGrantScope;
  readonly resourceDigest: ScopedGrantResourceDigest;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly appliedCommands: readonly AppliedScopedGrantCommand[];
}

export interface ActiveScopedGrantState extends ScopedGrantStateBinding {
  readonly status: 'active';
}

export interface ConsumedScopedGrantState extends ScopedGrantStateBinding {
  readonly status: 'consumed';
  readonly consumption: ScopedGrantConsumptionMetadata;
}

export interface ExpiredScopedGrantState extends ScopedGrantStateBinding {
  readonly status: 'expired';
  readonly expiration: ScopedGrantExpirationMetadata;
}

export interface RevokedScopedGrantState extends ScopedGrantStateBinding {
  readonly status: 'revoked';
  readonly revocation: ScopedGrantRevocationMetadata;
}

export type ScopedGrantState =
  | ActiveScopedGrantState
  | ConsumedScopedGrantState
  | ExpiredScopedGrantState
  | RevokedScopedGrantState;

interface ScopedGrantCommandBase {
  readonly grantId: ScopedGrantId;
  readonly commandId: ScopedGrantCommandId;
  readonly now: UnixEpochSeconds;
  readonly requestDigest: ScopedGrantRequestDigest;
}

export interface ConsumeGrantCommand extends ScopedGrantCommandBase {
  readonly type: 'consume_grant';
  readonly accountId: AccountId;
  readonly sessionId: SessionId;
  readonly scope: ScopedGrantScope;
  readonly resourceDigest: ScopedGrantResourceDigest;
}

export interface RevokeGrantCommand extends ScopedGrantCommandBase {
  readonly type: 'revoke_grant';
  readonly reason: ScopedGrantRevokeReason;
}

export interface ExpireGrantCommand extends ScopedGrantCommandBase {
  readonly type: 'expire_grant';
}

export type ScopedGrantCommand =
  | ConsumeGrantCommand
  | RevokeGrantCommand
  | ExpireGrantCommand;

/**
 * The current session is authorization context for a new consume only. It is
 * never persisted in grant state or command history.
 *
 * A future persistence adapter must atomically serialize grant consumption
 * with terminal transitions of the bound session. Reading the session and
 * then writing a consumed grant in separate steps is unsafe: the same atomic
 * boundary must enforce one-time consumption, (grantId, commandId) uniqueness,
 * and refusal after concurrent session revoke, expiry, or reuse detection.
 */
export interface ScopedGrantCommandContext {
  readonly session?: SessionState;
}

export const SCOPED_GRANT_BINDING_REJECTION_REASONS = Object.freeze([
  'invalid_binding_shape',
  'invalid_grant_id',
  'invalid_scope',
  'invalid_resource_digest',
  'invalid_created_at',
  'invalid_expires_at',
  'invalid_grant_window',
  'grant_created_before_session',
  'grant_created_before_evidence',
  'grant_expiry_exceeds_evidence',
  'grant_expiry_exceeds_session',
] as const);

export type ScopedGrantBindingRejectionReason =
  (typeof SCOPED_GRANT_BINDING_REJECTION_REASONS)[number];

export const SCOPED_GRANT_COMMAND_REJECTION_REASONS = Object.freeze([
  'invalid_command_shape',
  'invalid_grant_id',
  'invalid_command_id',
  'invalid_command_type',
  'invalid_request_digest',
  'invalid_time',
  'missing_consume_binding',
  'invalid_account_id',
  'invalid_session_id',
  'invalid_scope',
  'invalid_resource_digest',
  'missing_revoke_reason',
  'invalid_revoke_reason',
] as const);

export type ScopedGrantCommandRejectionReason =
  (typeof SCOPED_GRANT_COMMAND_REJECTION_REASONS)[number];

export type CreateScopedGrantResult =
  | {
      readonly outcome: 'created';
      readonly state: ActiveScopedGrantState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_fresh_authentication_evidence';
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'session_not_active'
        | 'session_expired'
        | 'evidence_binding_mismatch';
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_scoped_grant_binding';
      readonly bindingReason: ScopedGrantBindingRejectionReason;
    };

export type ScopedGrantTransitionRejectionReason =
  | 'grant_binding_conflict'
  | 'command_reuse_conflict'
  | 'forbidden_transition'
  | 'grant_expired'
  | 'not_yet_expired'
  | 'account_mismatch'
  | 'session_mismatch'
  | 'scope_mismatch'
  | 'resource_mismatch'
  | 'session_not_active'
  | 'session_expired'
  | 'session_binding_mismatch'
  | 'invalid_session_context';

export type ScopedGrantTransitionResult =
  | {
      readonly outcome: 'transitioned';
      readonly transition: 'grant_consumed' | 'grant_revoked' | 'grant_expired';
      readonly state: ScopedGrantState;
      readonly result: ScopedGrantAppliedResult;
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly state: ScopedGrantState;
      readonly originalResult: ScopedGrantAppliedResult;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_scoped_grant_state';
      readonly stateReason:
        | 'invalid_state_shape'
        | 'invalid_state_binding'
        | 'invalid_command_history'
        | 'invalid_status_metadata';
      readonly state: ScopedGrantState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_grant_command';
      readonly commandReason: ScopedGrantCommandRejectionReason;
      readonly state: ScopedGrantState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: ScopedGrantTransitionRejectionReason;
      readonly state: ScopedGrantState;
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

function isSessionCredentialReference(
  value: unknown,
): value is SessionCredentialReference {
  return (
    isRecord(value) &&
    isSessionCredentialDigest(value.digest) &&
    isSessionCredentialGeneration(value.generation)
  );
}

function isSessionCredentialBinding(
  value: unknown,
): value is SessionCredentialBinding {
  return (
    isRecord(value) &&
    isSessionCredentialReference(value) &&
    isUnixEpochSeconds(value.issuedAt)
  );
}

function isConsumedSessionCredential(
  value: unknown,
): value is ConsumedSessionCredential {
  return (
    isRecord(value) &&
    isSessionCredentialBinding(value) &&
    isUnixEpochSeconds(value.consumedAt) &&
    value.consumedAt >= value.issuedAt &&
    isSessionCommandId(value.consumedByCommandId)
  );
}

function isSessionRevocationMetadata(
  value: unknown,
): value is SessionRevocationMetadata {
  return (
    isRecord(value) &&
    isSessionRevokeReason(value.reason) &&
    isUnixEpochSeconds(value.revokedAt) &&
    isSessionCommandId(value.commandId)
  );
}

function isSessionExpirationMetadata(
  value: unknown,
): value is SessionExpirationMetadata {
  return (
    isRecord(value) &&
    isUnixEpochSeconds(value.expiredAt) &&
    isSessionCommandId(value.commandId)
  );
}

function isSessionCredentialReuseMetadata(
  value: unknown,
): value is SessionCredentialReuseMetadata {
  return (
    isRecord(value) &&
    isUnixEpochSeconds(value.detectedAt) &&
    isSessionCredentialGeneration(value.generation) &&
    isSessionCredentialDigest(value.digest) &&
    isSessionCommandId(value.commandId)
  );
}

function isSessionAppliedResult(
  value: unknown,
): value is SessionAppliedCommandResult {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case 'credential_rotated':
      return isSessionCredentialBinding(value.credential);
    case 'session_revoked':
      return isSessionRevocationMetadata(value.revocation);
    case 'session_expired':
      return isSessionExpirationMetadata(value.expiration);
    case 'reuse_detected':
      return isSessionCredentialReuseMetadata(value.reuse);
    default:
      return false;
  }
}

function isAppliedSessionCommand(
  value: unknown,
  sessionId: SessionId,
): value is AppliedSessionCommand {
  if (
    !isRecord(value) ||
    value.sessionId !== sessionId ||
    !isSessionCommandId(value.commandId) ||
    !isSessionRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.appliedAt) ||
    !isSessionAppliedResult(value.result)
  ) {
    return false;
  }

  switch (value.commandType) {
    case 'rotate_credential':
      return (
        isSessionCredentialReference(value.presentedCredential) &&
        isSessionCredentialReference(value.nextCredential) &&
        (value.result.type === 'credential_rotated' ||
          value.result.type === 'reuse_detected')
      );
    case 'revoke_session':
      return (
        isSessionRevokeReason(value.reason) &&
        value.result.type === 'session_revoked'
      );
    case 'expire_session':
      return value.result.type === 'session_expired';
    default:
      return false;
  }
}

function isSessionStateContext(value: unknown): value is SessionState {
  if (
    !isRecord(value) ||
    !isSessionId(value.sessionId) ||
    !isSessionAccountId(value.accountId) ||
    !isUnixEpochSeconds(value.createdAt) ||
    !isUnixEpochSeconds(value.expiresAt) ||
    value.createdAt >= value.expiresAt ||
    !isSessionCredentialBinding(value.currentCredential) ||
    value.currentCredential.issuedAt < value.createdAt ||
    value.currentCredential.issuedAt >= value.expiresAt
  ) {
    return false;
  }

  const sessionId = value.sessionId;
  const createdAt = value.createdAt;
  const expiresAt = value.expiresAt;
  if (
    !Array.isArray(value.consumedCredentials) ||
    !value.consumedCredentials.every(
      (credential) =>
        isConsumedSessionCredential(credential) &&
        credential.issuedAt >= createdAt &&
        credential.issuedAt < expiresAt &&
        credential.consumedAt < expiresAt,
    ) ||
    !Array.isArray(value.appliedCommands) ||
    !value.appliedCommands.every((command) =>
      isAppliedSessionCommand(command, sessionId),
    )
  ) {
    return false;
  }

  const credentialDigests = new Set<string>();
  const credentialGenerations = new Set<number>();
  for (const credential of value.consumedCredentials) {
    if (
      credentialDigests.has(credential.digest) ||
      credentialGenerations.has(credential.generation)
    ) {
      return false;
    }
    credentialDigests.add(credential.digest);
    credentialGenerations.add(credential.generation);
  }
  if (
    credentialDigests.has(value.currentCredential.digest) ||
    credentialGenerations.has(value.currentCredential.generation)
  ) {
    return false;
  }

  const commandIds = new Set<string>();
  for (const command of value.appliedCommands) {
    if (commandIds.has(command.commandId)) {
      return false;
    }
    commandIds.add(command.commandId);
  }

  switch (value.status) {
    case 'active':
      return true;
    case 'expired':
      return isSessionExpirationMetadata(value.expiration);
    case 'revoked':
      return isSessionRevocationMetadata(value.revocation);
    case 'reuse_detected':
      return isSessionCredentialReuseMetadata(value.reuse);
    default:
      return false;
  }
}

function isOpaqueValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SCOPED_GRANT_OPAQUE_VALUE_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export function isScopedGrantId(value: unknown): value is ScopedGrantId {
  return isOpaqueValue(value);
}

export function isScopedGrantCommandId(
  value: unknown,
): value is ScopedGrantCommandId {
  return isOpaqueValue(value);
}

export function isScopedGrantResourceDigest(
  value: unknown,
): value is ScopedGrantResourceDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function isScopedGrantRequestDigest(
  value: unknown,
): value is ScopedGrantRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function isScopedGrantScope(value: unknown): value is ScopedGrantScope {
  return (
    typeof value === 'string' &&
    (SCOPED_GRANT_SCOPES as readonly string[]).includes(value)
  );
}

export function isScopedGrantRevokeReason(
  value: unknown,
): value is ScopedGrantRevokeReason {
  return (
    typeof value === 'string' &&
    (SCOPED_GRANT_REVOKE_REASONS as readonly string[]).includes(value)
  );
}

function bindingRejectionReason(
  binding: unknown,
): ScopedGrantBindingRejectionReason | undefined {
  if (!isRecord(binding)) {
    return 'invalid_binding_shape';
  }
  if (!isScopedGrantId(binding.grantId)) {
    return 'invalid_grant_id';
  }
  if (!isScopedGrantScope(binding.scope)) {
    return 'invalid_scope';
  }
  if (!isScopedGrantResourceDigest(binding.resourceDigest)) {
    return 'invalid_resource_digest';
  }
  if (!isUnixEpochSeconds(binding.createdAt)) {
    return 'invalid_created_at';
  }
  if (!isUnixEpochSeconds(binding.expiresAt)) {
    return 'invalid_expires_at';
  }
  if (binding.createdAt >= binding.expiresAt) {
    return 'invalid_grant_window';
  }
  return undefined;
}

function commandRejectionReason(
  command: unknown,
): ScopedGrantCommandRejectionReason | undefined {
  if (!isRecord(command)) {
    return 'invalid_command_shape';
  }
  if (!isScopedGrantId(command.grantId)) {
    return 'invalid_grant_id';
  }
  if (!isScopedGrantCommandId(command.commandId)) {
    return 'invalid_command_id';
  }
  if (
    command.type !== 'consume_grant' &&
    command.type !== 'revoke_grant' &&
    command.type !== 'expire_grant'
  ) {
    return 'invalid_command_type';
  }
  if (!isScopedGrantRequestDigest(command.requestDigest)) {
    return 'invalid_request_digest';
  }
  if (!isUnixEpochSeconds(command.now)) {
    return 'invalid_time';
  }
  if (command.type === 'consume_grant') {
    if (
      !Object.prototype.hasOwnProperty.call(command, 'accountId') ||
      !Object.prototype.hasOwnProperty.call(command, 'sessionId') ||
      !Object.prototype.hasOwnProperty.call(command, 'scope') ||
      !Object.prototype.hasOwnProperty.call(command, 'resourceDigest')
    ) {
      return 'missing_consume_binding';
    }
    if (!isSessionAccountId(command.accountId)) {
      return 'invalid_account_id';
    }
    if (!isSessionId(command.sessionId)) {
      return 'invalid_session_id';
    }
    if (!isScopedGrantScope(command.scope)) {
      return 'invalid_scope';
    }
    if (!isScopedGrantResourceDigest(command.resourceDigest)) {
      return 'invalid_resource_digest';
    }
  }
  if (command.type === 'revoke_grant') {
    if (!Object.prototype.hasOwnProperty.call(command, 'reason')) {
      return 'missing_revoke_reason';
    }
    if (!isScopedGrantRevokeReason(command.reason)) {
      return 'invalid_revoke_reason';
    }
  }

  return undefined;
}

function isGrantConsumptionMetadata(
  value: unknown,
): value is ScopedGrantConsumptionMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['consumedAt', 'commandId']) &&
    isUnixEpochSeconds(value.consumedAt) &&
    isScopedGrantCommandId(value.commandId)
  );
}

function isGrantRevocationMetadata(
  value: unknown,
): value is ScopedGrantRevocationMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['reason', 'revokedAt', 'commandId']) &&
    isScopedGrantRevokeReason(value.reason) &&
    isUnixEpochSeconds(value.revokedAt) &&
    isScopedGrantCommandId(value.commandId)
  );
}

function isGrantExpirationMetadata(
  value: unknown,
): value is ScopedGrantExpirationMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['expiredAt', 'commandId']) &&
    isUnixEpochSeconds(value.expiredAt) &&
    isScopedGrantCommandId(value.commandId)
  );
}

function isGrantAppliedResult(
  value: unknown,
): value is ScopedGrantAppliedResult {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'grant_consumed':
      return (
        hasExactlyKeys(value, ['type', 'consumption']) &&
        isGrantConsumptionMetadata(value.consumption)
      );
    case 'grant_revoked':
      return (
        hasExactlyKeys(value, ['type', 'revocation']) &&
        isGrantRevocationMetadata(value.revocation)
      );
    case 'grant_expired':
      return (
        hasExactlyKeys(value, ['type', 'expiration']) &&
        isGrantExpirationMetadata(value.expiration)
      );
    default:
      return false;
  }
}

function isAppliedScopedGrantCommandShape(
  value: unknown,
  grantId: ScopedGrantId,
): value is AppliedScopedGrantCommand {
  if (
    !isRecord(value) ||
    value.grantId !== grantId ||
    !isScopedGrantCommandId(value.commandId) ||
    !isScopedGrantRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.appliedAt) ||
    !isGrantAppliedResult(value.result)
  ) {
    return false;
  }
  switch (value.commandType) {
    case 'consume_grant':
      return (
        hasExactlyKeys(value, [
          'grantId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
          'accountId',
          'sessionId',
          'scope',
          'resourceDigest',
        ]) &&
        isSessionAccountId(value.accountId) &&
        isSessionId(value.sessionId) &&
        isScopedGrantScope(value.scope) &&
        isScopedGrantResourceDigest(value.resourceDigest) &&
        value.result.type === 'grant_consumed'
      );
    case 'revoke_grant':
      return (
        hasExactlyKeys(value, [
          'grantId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
          'reason',
        ]) &&
        isScopedGrantRevokeReason(value.reason) &&
        value.result.type === 'grant_revoked'
      );
    case 'expire_grant':
      return (
        hasExactlyKeys(value, [
          'grantId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
        ]) && value.result.type === 'grant_expired'
      );
    default:
      return false;
  }
}

function consumptionsEqual(
  left: ScopedGrantConsumptionMetadata,
  right: ScopedGrantConsumptionMetadata,
): boolean {
  return left.consumedAt === right.consumedAt && left.commandId === right.commandId;
}

function grantRevocationsEqual(
  left: ScopedGrantRevocationMetadata,
  right: ScopedGrantRevocationMetadata,
): boolean {
  return (
    left.reason === right.reason &&
    left.revokedAt === right.revokedAt &&
    left.commandId === right.commandId
  );
}

function grantExpirationsEqual(
  left: ScopedGrantExpirationMetadata,
  right: ScopedGrantExpirationMetadata,
): boolean {
  return left.expiredAt === right.expiredAt && left.commandId === right.commandId;
}

const SCOPED_GRANT_STATE_BINDING_KEYS = Object.freeze([
  'grantId',
  'evidenceId',
  'accountId',
  'sessionId',
  'scope',
  'resourceDigest',
  'createdAt',
  'expiresAt',
  'appliedCommands',
] as const);

function scopedGrantStateRejectionReason(
  value: unknown,
):
  | 'invalid_state_shape'
  | 'invalid_state_binding'
  | 'invalid_command_history'
  | 'invalid_status_metadata'
  | undefined {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return 'invalid_state_shape';
  }
  if (
    !isScopedGrantId(value.grantId) ||
    !isFreshAuthenticationEvidenceId(value.evidenceId) ||
    !isSessionAccountId(value.accountId) ||
    !isSessionId(value.sessionId) ||
    !isScopedGrantScope(value.scope) ||
    !isScopedGrantResourceDigest(value.resourceDigest) ||
    !isUnixEpochSeconds(value.createdAt) ||
    !isUnixEpochSeconds(value.expiresAt) ||
    value.createdAt >= value.expiresAt ||
    !Array.isArray(value.appliedCommands)
  ) {
    return 'invalid_state_binding';
  }

  const commands: AppliedScopedGrantCommand[] = [];
  const commandIds = new Set<string>();
  for (const command of value.appliedCommands) {
    if (
      !isAppliedScopedGrantCommandShape(command, value.grantId) ||
      commandIds.has(command.commandId)
    ) {
      return 'invalid_command_history';
    }
    commandIds.add(command.commandId);
    commands.push(command);
  }

  if (value.status === 'active') {
    return commands.length === 0 &&
      hasExactlyKeys(value, [...SCOPED_GRANT_STATE_BINDING_KEYS, 'status'])
      ? undefined
      : 'invalid_status_metadata';
  }
  if (commands.length !== 1) {
    return 'invalid_command_history';
  }
  const command = commands[0];

  if (value.status === 'consumed') {
    if (
      !hasExactlyKeys(value, [
        ...SCOPED_GRANT_STATE_BINDING_KEYS,
        'status',
        'consumption',
      ]) ||
      command.commandType !== 'consume_grant' ||
      command.result.type !== 'grant_consumed' ||
      command.accountId !== value.accountId ||
      command.sessionId !== value.sessionId ||
      command.scope !== value.scope ||
      command.resourceDigest !== value.resourceDigest ||
      command.appliedAt < value.createdAt ||
      command.appliedAt >= value.expiresAt ||
      !isGrantConsumptionMetadata(value.consumption) ||
      !consumptionsEqual(command.result.consumption, {
        consumedAt: command.appliedAt,
        commandId: command.commandId,
      }) ||
      !consumptionsEqual(value.consumption, command.result.consumption)
    ) {
      return 'invalid_status_metadata';
    }
    return undefined;
  }

  if (value.status === 'revoked') {
    if (
      !hasExactlyKeys(value, [
        ...SCOPED_GRANT_STATE_BINDING_KEYS,
        'status',
        'revocation',
      ]) ||
      command.commandType !== 'revoke_grant' ||
      command.result.type !== 'grant_revoked' ||
      command.appliedAt < value.createdAt ||
      command.appliedAt >= value.expiresAt ||
      !isGrantRevocationMetadata(value.revocation) ||
      !grantRevocationsEqual(command.result.revocation, {
        reason: command.reason,
        revokedAt: command.appliedAt,
        commandId: command.commandId,
      }) ||
      !grantRevocationsEqual(value.revocation, command.result.revocation)
    ) {
      return 'invalid_status_metadata';
    }
    return undefined;
  }

  if (value.status === 'expired') {
    if (
      !hasExactlyKeys(value, [
        ...SCOPED_GRANT_STATE_BINDING_KEYS,
        'status',
        'expiration',
      ]) ||
      command.commandType !== 'expire_grant' ||
      command.result.type !== 'grant_expired' ||
      command.appliedAt < value.expiresAt ||
      !isGrantExpirationMetadata(value.expiration) ||
      !grantExpirationsEqual(command.result.expiration, {
        expiredAt: command.appliedAt,
        commandId: command.commandId,
      }) ||
      !grantExpirationsEqual(value.expiration, command.result.expiration)
    ) {
      return 'invalid_status_metadata';
    }
    return undefined;
  }

  return 'invalid_state_shape';
}

function immutableConsumption(
  consumption: ScopedGrantConsumptionMetadata,
): ScopedGrantConsumptionMetadata {
  return Object.freeze({
    consumedAt: consumption.consumedAt,
    commandId: consumption.commandId,
  });
}

function immutableRevocation(
  revocation: ScopedGrantRevocationMetadata,
): ScopedGrantRevocationMetadata {
  return Object.freeze({
    reason: revocation.reason,
    revokedAt: revocation.revokedAt,
    commandId: revocation.commandId,
  });
}

function immutableExpiration(
  expiration: ScopedGrantExpirationMetadata,
): ScopedGrantExpirationMetadata {
  return Object.freeze({
    expiredAt: expiration.expiredAt,
    commandId: expiration.commandId,
  });
}

function immutableAppliedResult(
  result: ScopedGrantAppliedResult,
): ScopedGrantAppliedResult {
  switch (result.type) {
    case 'grant_consumed':
      return Object.freeze({
        type: result.type,
        consumption: immutableConsumption(result.consumption),
      });
    case 'grant_revoked':
      return Object.freeze({
        type: result.type,
        revocation: immutableRevocation(result.revocation),
      });
    case 'grant_expired':
      return Object.freeze({
        type: result.type,
        expiration: immutableExpiration(result.expiration),
      });
  }
}

function immutableAppliedCommand(
  command: AppliedScopedGrantCommand,
): AppliedScopedGrantCommand {
  const base = {
    grantId: command.grantId,
    commandId: command.commandId,
    requestDigest: command.requestDigest,
    appliedAt: command.appliedAt,
    result: immutableAppliedResult(command.result),
  };

  switch (command.commandType) {
    case 'consume_grant':
      return Object.freeze({
        ...base,
        commandType: command.commandType,
        accountId: command.accountId,
        sessionId: command.sessionId,
        scope: command.scope,
        resourceDigest: command.resourceDigest,
      });
    case 'revoke_grant':
      return Object.freeze({
        ...base,
        commandType: command.commandType,
        reason: command.reason,
      });
    case 'expire_grant':
      return Object.freeze({ ...base, commandType: command.commandType });
  }
}

function immutableStateBinding(
  state: ScopedGrantState,
  appliedCommands: readonly AppliedScopedGrantCommand[] =
    state.appliedCommands,
): ScopedGrantStateBinding {
  return {
    grantId: state.grantId,
    evidenceId: state.evidenceId,
    accountId: state.accountId,
    sessionId: state.sessionId,
    scope: state.scope,
    resourceDigest: state.resourceDigest,
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    appliedCommands: Object.freeze(appliedCommands.map(immutableAppliedCommand)),
  };
}

function isExactAppliedCommand(
  applied: AppliedScopedGrantCommand,
  command: ScopedGrantCommand,
): boolean {
  if (
    applied.grantId !== command.grantId ||
    applied.commandId !== command.commandId ||
    applied.commandType !== command.type ||
    applied.requestDigest !== command.requestDigest
  ) {
    return false;
  }

  if (
    applied.commandType === 'consume_grant' &&
    command.type === 'consume_grant'
  ) {
    return (
      applied.accountId === command.accountId &&
      applied.sessionId === command.sessionId &&
      applied.scope === command.scope &&
      applied.resourceDigest === command.resourceDigest
    );
  }

  if (
    applied.commandType === 'revoke_grant' &&
    command.type === 'revoke_grant'
  ) {
    return applied.reason === command.reason;
  }

  return (
    applied.commandType === 'expire_grant' &&
    command.type === 'expire_grant'
  );
}

function appliedCommandFor(
  command: ScopedGrantCommand,
  result: ScopedGrantAppliedResult,
): AppliedScopedGrantCommand {
  const base = {
    grantId: command.grantId,
    commandId: command.commandId,
    requestDigest: command.requestDigest,
    appliedAt: command.now,
    result: immutableAppliedResult(result),
  };

  switch (command.type) {
    case 'consume_grant':
      return Object.freeze({
        ...base,
        commandType: command.type,
        accountId: command.accountId,
        sessionId: command.sessionId,
        scope: command.scope,
        resourceDigest: command.resourceDigest,
      });
    case 'revoke_grant':
      return Object.freeze({
        ...base,
        commandType: command.type,
        reason: command.reason,
      });
    case 'expire_grant':
      return Object.freeze({ ...base, commandType: command.type });
  }
}

function storedResult(state: ScopedGrantState): ScopedGrantAppliedResult {
  return state.appliedCommands[state.appliedCommands.length - 1].result;
}

export function createScopedGrant(
  binding: CreateScopedGrantBinding,
): CreateScopedGrantResult {
  const bindingReason = bindingRejectionReason(binding);
  if (bindingReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason,
    };
  }
  if (!isFreshAuthenticationEvidence(binding.evidence)) {
    return {
      outcome: 'rejected',
      reason: 'invalid_fresh_authentication_evidence',
    };
  }
  if (
    !isSessionStateContext(binding.session) ||
    binding.session.status !== 'active'
  ) {
    return { outcome: 'rejected', reason: 'session_not_active' };
  }
  if (
    binding.evidence.accountId !== binding.session.accountId ||
    binding.evidence.sessionId !== binding.session.sessionId
  ) {
    return { outcome: 'rejected', reason: 'evidence_binding_mismatch' };
  }
  if (binding.createdAt < binding.session.createdAt) {
    return {
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'grant_created_before_session',
    };
  }
  if (binding.createdAt >= binding.session.expiresAt) {
    return { outcome: 'rejected', reason: 'session_expired' };
  }
  if (binding.createdAt < binding.evidence.authenticatedAt) {
    return {
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'grant_created_before_evidence',
    };
  }
  if (binding.createdAt >= binding.evidence.expiresAt) {
    return {
      outcome: 'rejected',
      reason: 'invalid_fresh_authentication_evidence',
    };
  }
  if (binding.expiresAt > binding.evidence.expiresAt) {
    return {
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'grant_expiry_exceeds_evidence',
    };
  }
  if (binding.expiresAt > binding.session.expiresAt) {
    return {
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'grant_expiry_exceeds_session',
    };
  }

  const state: ActiveScopedGrantState = Object.freeze({
    grantId: binding.grantId,
    evidenceId: binding.evidence.evidenceId,
    accountId: binding.evidence.accountId,
    sessionId: binding.evidence.sessionId,
    scope: binding.scope,
    resourceDigest: binding.resourceDigest,
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt,
    appliedCommands: Object.freeze([]),
    status: 'active',
  });

  return { outcome: 'created', state };
}

export function transitionScopedGrant(
  state: ScopedGrantState,
  command: ScopedGrantCommand,
  context?: ScopedGrantCommandContext,
): ScopedGrantTransitionResult {
  const stateReason = scopedGrantStateRejectionReason(state);
  if (stateReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_state',
      stateReason,
      state,
    };
  }

  const commandReason = commandRejectionReason(command);
  if (commandReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_grant_command',
      commandReason,
      state,
    };
  }
  if (state.grantId !== command.grantId) {
    return { outcome: 'rejected', reason: 'grant_binding_conflict', state };
  }

  const previousCommand = state.appliedCommands.find(
    (applied) => applied.commandId === command.commandId,
  );
  if (previousCommand !== undefined) {
    if (isExactAppliedCommand(previousCommand, command)) {
      return {
        outcome: 'idempotent_retry',
        state,
        originalResult: previousCommand.result,
      };
    }
    return { outcome: 'rejected', reason: 'command_reuse_conflict', state };
  }

  if (state.status !== 'active') {
    return { outcome: 'rejected', reason: 'forbidden_transition', state };
  }

  if (command.now < state.createdAt) {
    return {
      outcome: 'rejected',
      reason: 'invalid_grant_command',
      commandReason: 'invalid_time',
      state,
    };
  }

  if (command.type === 'expire_grant') {
    if (command.now < state.expiresAt) {
      return { outcome: 'rejected', reason: 'not_yet_expired', state };
    }
    const expiration = immutableExpiration({
      expiredAt: command.now,
      commandId: command.commandId,
    });
    const result = immutableAppliedResult({
      type: 'grant_expired',
      expiration,
    });
    const applied = appliedCommandFor(command, result);
    const expired: ExpiredScopedGrantState = Object.freeze({
      ...immutableStateBinding(state, [...state.appliedCommands, applied]),
      status: 'expired',
      expiration,
    });
    return {
      outcome: 'transitioned',
      transition: 'grant_expired',
      state: expired,
      result: storedResult(expired),
    };
  }

  if (command.now >= state.expiresAt) {
    return { outcome: 'rejected', reason: 'grant_expired', state };
  }

  if (command.type === 'consume_grant') {
    if (!isRecord(context) || !isSessionStateContext(context.session)) {
      return {
        outcome: 'rejected',
        reason: 'invalid_session_context',
        state,
      };
    }
    if (context.session.status !== 'active') {
      return { outcome: 'rejected', reason: 'session_not_active', state };
    }
    if (
      command.now < context.session.createdAt ||
      command.now >= context.session.expiresAt
    ) {
      return { outcome: 'rejected', reason: 'session_expired', state };
    }
    if (
      context.session.accountId !== state.accountId ||
      context.session.sessionId !== state.sessionId
    ) {
      return {
        outcome: 'rejected',
        reason: 'session_binding_mismatch',
        state,
      };
    }
    if (command.accountId !== state.accountId) {
      return { outcome: 'rejected', reason: 'account_mismatch', state };
    }
    if (command.sessionId !== state.sessionId) {
      return { outcome: 'rejected', reason: 'session_mismatch', state };
    }
    if (command.scope !== state.scope) {
      return { outcome: 'rejected', reason: 'scope_mismatch', state };
    }
    if (command.resourceDigest !== state.resourceDigest) {
      return { outcome: 'rejected', reason: 'resource_mismatch', state };
    }

    const consumption = immutableConsumption({
      consumedAt: command.now,
      commandId: command.commandId,
    });
    const result = immutableAppliedResult({
      type: 'grant_consumed',
      consumption,
    });
    const applied = appliedCommandFor(command, result);
    const consumed: ConsumedScopedGrantState = Object.freeze({
      ...immutableStateBinding(state, [...state.appliedCommands, applied]),
      status: 'consumed',
      consumption,
    });
    return {
      outcome: 'transitioned',
      transition: 'grant_consumed',
      state: consumed,
      result: storedResult(consumed),
    };
  }

  const revocation = immutableRevocation({
    reason: command.reason,
    revokedAt: command.now,
    commandId: command.commandId,
  });
  const result = immutableAppliedResult({
    type: 'grant_revoked',
    revocation,
  });
  const applied = appliedCommandFor(command, result);
  const revoked: RevokedScopedGrantState = Object.freeze({
    ...immutableStateBinding(state, [...state.appliedCommands, applied]),
    status: 'revoked',
    revocation,
  });
  return {
    outcome: 'transitioned',
    transition: 'grant_revoked',
    state: revoked,
    result: storedResult(revoked),
  };
}
