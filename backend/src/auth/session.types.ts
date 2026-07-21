import { AccountId, isAccountId } from '../accounts/account.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';
import {
  AuthenticationOperationId,
  UnixEpochSeconds,
} from './auth.types';
import { AggregateCommandSequence } from './aggregate-command-sequence';

declare const sessionIdBrand: unique symbol;
declare const sessionCommandIdBrand: unique symbol;
declare const sessionCredentialDigestBrand: unique symbol;
declare const sessionRequestDigestBrand: unique symbol;

const MAX_SESSION_OPAQUE_VALUE_LENGTH = 256;
const SESSION_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Compatibility name for the existing session-family aggregate: one account
 * authentication followed by one ordered chain of credential generations.
 * It is not a leaf transport session ID.
 */
export type SessionId = InternalUuid & {
  readonly [sessionIdBrand]: 'SessionId';
};

/**
 * A command ID is unique within one session. A future persistence adapter
 * must atomically enforce uniqueness for the pair (sessionId, commandId).
 */
export type SessionCommandId = InternalUuid & {
  readonly [sessionCommandIdBrand]: 'SessionCommandId';
};

export type SessionCredentialDigest = string & {
  readonly [sessionCredentialDigestBrand]: 'SessionCredentialDigest';
};

export type SessionRequestDigest = string & {
  readonly [sessionRequestDigestBrand]: 'SessionRequestDigest';
};

function isSessionOpaqueValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SESSION_OPAQUE_VALUE_LENGTH &&
    value.trim() === value &&
    !SESSION_CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export function isSessionId(value: unknown): value is SessionId {
  return isInternalUuid(value);
}

export function isSessionCommandId(
  value: unknown,
): value is SessionCommandId {
  return isInternalUuid(value);
}

export function newSessionId(): SessionId {
  return newInternalUuid() as SessionId;
}

export function newSessionCommandId(): SessionCommandId {
  return newInternalUuid() as SessionCommandId;
}

export function isSessionRequestDigest(
  value: unknown,
): value is SessionRequestDigest {
  return isSessionOpaqueValue(value);
}

export function isSessionCredentialDigest(
  value: unknown,
): value is SessionCredentialDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function isSessionCredentialGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

export function isSessionAccountId(value: unknown): value is AccountId {
  return isAccountId(value);
}

export interface SessionCredentialReference {
  readonly digest: SessionCredentialDigest;
  readonly generation: number;
}

export interface SessionCredentialBinding
  extends SessionCredentialReference {
  readonly issuedAt: UnixEpochSeconds;
}

export interface ConsumedSessionCredential
  extends SessionCredentialBinding {
  readonly consumedAt: UnixEpochSeconds;
  readonly consumedByCommandId: SessionCommandId;
}

export const SESSION_REVOKE_REASONS = Object.freeze([
  'user_sign_out',
  'administrator',
  'account_blocked',
  'security_event',
  'superseded',
] as const);

export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export function isSessionRevokeReason(
  value: unknown,
): value is SessionRevokeReason {
  return (
    typeof value === 'string' &&
    (SESSION_REVOKE_REASONS as readonly string[]).includes(value)
  );
}

export interface SessionRevocationMetadata {
  readonly reason: SessionRevokeReason;
  readonly revokedAt: UnixEpochSeconds;
  readonly commandId: SessionCommandId;
}

export interface SessionExpirationMetadata {
  readonly expiredAt: UnixEpochSeconds;
  readonly commandId: SessionCommandId;
}

export interface SessionCredentialReuseMetadata {
  readonly detectedAt: UnixEpochSeconds;
  readonly generation: number;
  readonly digest: SessionCredentialDigest;
  readonly commandId: SessionCommandId;
}

export type SessionAppliedCommandResult =
  | {
      readonly type: 'credential_rotated';
      readonly credential: SessionCredentialBinding;
    }
  | {
      readonly type: 'session_revoked';
      readonly revocation: SessionRevocationMetadata;
    }
  | {
      readonly type: 'session_expired';
      readonly expiration: SessionExpirationMetadata;
    }
  | {
      readonly type: 'reuse_detected';
      readonly reuse: SessionCredentialReuseMetadata;
    };

interface AppliedSessionCommandBase {
  readonly sessionId: SessionId;
  readonly commandId: SessionCommandId;
  readonly requestDigest: SessionRequestDigest;
  readonly appliedAt: UnixEpochSeconds;
  readonly result: SessionAppliedCommandResult;
}

export interface AppliedRotateCredentialCommand
  extends AppliedSessionCommandBase {
  readonly commandType: 'rotate_credential';
  readonly presentedCredential: SessionCredentialReference;
  readonly nextCredential: SessionCredentialReference;
}

export interface AppliedRevokeSessionCommand
  extends AppliedSessionCommandBase {
  readonly commandType: 'revoke_session';
  readonly reason: SessionRevokeReason;
}

export interface AppliedExpireSessionCommand
  extends AppliedSessionCommandBase {
  readonly commandType: 'expire_session';
}

export type AppliedSessionCommand =
  | AppliedRotateCredentialCommand
  | AppliedRevokeSessionCommand
  | AppliedExpireSessionCommand;

interface SessionCommandPersistenceRecordBase {
  readonly sessionId: SessionId;
  readonly commandId: SessionCommandId;
  readonly commandSequence: AggregateCommandSequence;
  /** Must cryptographically bind every command input in canonical form. */
  readonly requestDigest: SessionRequestDigest;
  readonly appliedAt: UnixEpochSeconds;
}

/**
 * Relational command history needed to hydrate the existing session-family
 * reducer. Credential references contain only generation and digest, never the
 * plaintext session credential.
 */
export type SessionCommandPersistenceRecord =
  | (SessionCommandPersistenceRecordBase & {
      readonly commandType: 'rotate_credential';
      readonly presentedCredential: SessionCredentialReference;
      readonly nextCredential: SessionCredentialReference;
      readonly result: Extract<
        SessionAppliedCommandResult,
        { readonly type: 'credential_rotated' | 'reuse_detected' }
      >;
    })
  | (SessionCommandPersistenceRecordBase & {
      readonly commandType: 'revoke_session';
      readonly reason: SessionRevokeReason;
      readonly result: Extract<
        SessionAppliedCommandResult,
        { readonly type: 'session_revoked' }
      >;
    })
  | (SessionCommandPersistenceRecordBase & {
      readonly commandType: 'expire_session';
      readonly result: Extract<
        SessionAppliedCommandResult,
        { readonly type: 'session_expired' }
      >;
    });

export interface SessionStateBinding {
  readonly sessionId: SessionId;
  readonly authenticationOperationId: AuthenticationOperationId;
  readonly accountId: AccountId;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly currentCredential: SessionCredentialBinding;
  readonly consumedCredentials: readonly ConsumedSessionCredential[];
  readonly appliedCommands: readonly AppliedSessionCommand[];
}

export interface ActiveSessionState extends SessionStateBinding {
  readonly status: 'active';
}

export interface ExpiredSessionState extends SessionStateBinding {
  readonly status: 'expired';
  readonly expiration: SessionExpirationMetadata;
}

export interface RevokedSessionState extends SessionStateBinding {
  readonly status: 'revoked';
  readonly revocation: SessionRevocationMetadata;
}

export interface ReuseDetectedSessionState extends SessionStateBinding {
  readonly status: 'reuse_detected';
  readonly reuse: SessionCredentialReuseMetadata;
}

export type SessionState =
  | ActiveSessionState
  | ExpiredSessionState
  | RevokedSessionState
  | ReuseDetectedSessionState;

export interface CreateActiveSessionBinding {
  readonly sessionId: SessionId;
  readonly authenticationOperationId: AuthenticationOperationId;
  readonly accountId: AccountId;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly currentCredential: SessionCredentialBinding;
}

interface SessionCommandBase {
  readonly sessionId: SessionId;
  readonly commandId: SessionCommandId;
  readonly now: UnixEpochSeconds;
  readonly requestDigest: SessionRequestDigest;
}

export interface RotateSessionCredentialCommand extends SessionCommandBase {
  readonly type: 'rotate_credential';
  readonly presentedCredential: SessionCredentialReference;
  readonly nextCredential: SessionCredentialReference;
}

export interface RevokeSessionCommand extends SessionCommandBase {
  readonly type: 'revoke_session';
  readonly reason: SessionRevokeReason;
}

export interface ExpireSessionCommand extends SessionCommandBase {
  readonly type: 'expire_session';
}

export type SessionCommand =
  | RotateSessionCredentialCommand
  | RevokeSessionCommand
  | ExpireSessionCommand;
