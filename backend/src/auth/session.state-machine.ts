import {
  isAuthenticationOperationId,
  isUnixEpochSeconds,
} from './auth.types';
import { isAggregateCommandSequence } from './aggregate-command-sequence';
import {
  ActiveSessionState,
  AppliedExpireSessionCommand,
  AppliedRevokeSessionCommand,
  AppliedRotateCredentialCommand,
  AppliedSessionCommand,
  ConsumedSessionCredential,
  CreateActiveSessionBinding,
  ExpiredSessionState,
  ReuseDetectedSessionState,
  RevokedSessionState,
  RotateSessionCredentialCommand,
  SessionAppliedCommandResult,
  SessionCommand,
  SessionCommandPersistenceRecord,
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

export const SESSION_BINDING_REJECTION_REASONS = Object.freeze([
    'invalid_binding_shape',
    'invalid_session_id',
    'invalid_authentication_operation_id',
    'invalid_account_id',
  'invalid_created_at',
  'invalid_expires_at',
  'invalid_session_window',
  'invalid_current_credential',
  'invalid_initial_generation',
  'invalid_credential_issued_at',
] as const);

export type SessionBindingRejectionReason =
  (typeof SESSION_BINDING_REJECTION_REASONS)[number];

export const SESSION_COMMAND_REJECTION_REASONS = Object.freeze([
  'invalid_command_shape',
  'invalid_session_id',
  'invalid_command_id',
  'invalid_command_type',
  'invalid_request_digest',
  'invalid_time',
  'missing_presented_credential',
  'invalid_presented_credential',
  'missing_next_credential',
  'invalid_next_credential_shape',
  'missing_revoke_reason',
  'invalid_revoke_reason',
] as const);

export type SessionCommandRejectionReason =
  (typeof SESSION_COMMAND_REJECTION_REASONS)[number];

export type CreateActiveSessionResult =
  | {
      readonly outcome: 'created';
      readonly state: ActiveSessionState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_session_binding';
      readonly bindingReason: SessionBindingRejectionReason;
    };

export type SessionTransitionRejectionReason =
  | 'invalid_session_state'
  | 'session_binding_conflict'
  | 'command_reuse_conflict'
  | 'invalid_session_credential'
  | 'invalid_next_credential'
  | 'session_expired'
  | 'not_yet_expired'
  | 'forbidden_transition';

export type SessionTransitionResult =
  | {
      readonly outcome: 'transitioned';
      readonly transition:
        | 'credential_rotated'
        | 'session_revoked'
        | 'session_expired'
        | 'reuse_detected';
      readonly state: SessionState;
      readonly result: SessionAppliedCommandResult;
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly state: SessionState;
      readonly originalResult: SessionAppliedCommandResult;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_session_state';
      readonly stateReason:
        | 'invalid_state_shape'
        | 'invalid_state_binding'
        | 'invalid_credential_history'
        | 'invalid_command_history'
        | 'invalid_status_metadata';
      readonly state: SessionState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_session_command';
      readonly commandReason: SessionCommandRejectionReason;
      readonly state: SessionState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: SessionTransitionRejectionReason;
      readonly state: SessionState;
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

function isCredentialReference(
  value: unknown,
): value is SessionCredentialReference {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['digest', 'generation']) &&
    isSessionCredentialDigest(value.digest) &&
    isSessionCredentialGeneration(value.generation)
  );
}

function hasNextCredentialShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['digest', 'generation']) &&
    typeof value.digest === 'string' &&
    typeof value.generation === 'number'
  );
}

function isCredentialBinding(
  value: unknown,
): value is SessionCredentialBinding {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['digest', 'generation', 'issuedAt']) &&
    isSessionCredentialDigest(value.digest) &&
    isSessionCredentialGeneration(value.generation) &&
    isUnixEpochSeconds(value.issuedAt)
  );
}

function sessionBindingRejectionReason(
  binding: unknown,
): SessionBindingRejectionReason | undefined {
  if (!isRecord(binding)) {
    return 'invalid_binding_shape';
  }
  if (!isSessionId(binding.sessionId)) {
    return 'invalid_session_id';
  }
  if (!isAuthenticationOperationId(binding.authenticationOperationId)) {
    return 'invalid_authentication_operation_id';
  }
  if (!isSessionAccountId(binding.accountId)) {
    return 'invalid_account_id';
  }
  if (!isUnixEpochSeconds(binding.createdAt)) {
    return 'invalid_created_at';
  }
  if (!isUnixEpochSeconds(binding.expiresAt)) {
    return 'invalid_expires_at';
  }
  if (binding.createdAt >= binding.expiresAt) {
    return 'invalid_session_window';
  }
  if (!isCredentialBinding(binding.currentCredential)) {
    return 'invalid_current_credential';
  }
  if (binding.currentCredential.generation !== 1) {
    return 'invalid_initial_generation';
  }
  if (
    binding.currentCredential.issuedAt < binding.createdAt ||
    binding.currentCredential.issuedAt >= binding.expiresAt
  ) {
    return 'invalid_credential_issued_at';
  }

  return undefined;
}

function sessionCommandRejectionReason(
  command: unknown,
): SessionCommandRejectionReason | undefined {
  if (!isRecord(command)) {
    return 'invalid_command_shape';
  }
  if (!isSessionId(command.sessionId)) {
    return 'invalid_session_id';
  }
  if (!isSessionCommandId(command.commandId)) {
    return 'invalid_command_id';
  }
  if (
    command.type !== 'rotate_credential' &&
    command.type !== 'revoke_session' &&
    command.type !== 'expire_session'
  ) {
    return 'invalid_command_type';
  }
  if (!isSessionRequestDigest(command.requestDigest)) {
    return 'invalid_request_digest';
  }
  if (!isUnixEpochSeconds(command.now)) {
    return 'invalid_time';
  }
  if (command.type === 'rotate_credential') {
    if (!Object.prototype.hasOwnProperty.call(command, 'presentedCredential')) {
      return 'missing_presented_credential';
    }
    if (!isCredentialReference(command.presentedCredential)) {
      return 'invalid_presented_credential';
    }
    if (!Object.prototype.hasOwnProperty.call(command, 'nextCredential')) {
      return 'missing_next_credential';
    }
    if (!hasNextCredentialShape(command.nextCredential)) {
      return 'invalid_next_credential_shape';
    }
  }
  if (command.type === 'revoke_session') {
    if (!Object.prototype.hasOwnProperty.call(command, 'reason')) {
      return 'missing_revoke_reason';
    }
    if (!isSessionRevokeReason(command.reason)) {
      return 'invalid_revoke_reason';
    }
  }

  return undefined;
}

function immutableCredentialReference(
  credential: SessionCredentialReference,
): SessionCredentialReference {
  return Object.freeze({
    digest: credential.digest,
    generation: credential.generation,
  });
}

function immutableCredentialBinding(
  credential: SessionCredentialBinding,
): SessionCredentialBinding {
  return Object.freeze({
    digest: credential.digest,
    generation: credential.generation,
    issuedAt: credential.issuedAt,
  });
}

function immutableConsumedCredential(
  credential: ConsumedSessionCredential,
): ConsumedSessionCredential {
  return Object.freeze({
    digest: credential.digest,
    generation: credential.generation,
    issuedAt: credential.issuedAt,
    consumedAt: credential.consumedAt,
    consumedByCommandId: credential.consumedByCommandId,
  });
}

function immutableRevocation(
  revocation: SessionRevocationMetadata,
): SessionRevocationMetadata {
  return Object.freeze({
    reason: revocation.reason,
    revokedAt: revocation.revokedAt,
    commandId: revocation.commandId,
  });
}

function immutableExpiration(
  expiration: SessionExpirationMetadata,
): SessionExpirationMetadata {
  return Object.freeze({
    expiredAt: expiration.expiredAt,
    commandId: expiration.commandId,
  });
}

function immutableReuse(
  reuse: SessionCredentialReuseMetadata,
): SessionCredentialReuseMetadata {
  return Object.freeze({
    detectedAt: reuse.detectedAt,
    generation: reuse.generation,
    digest: reuse.digest,
    commandId: reuse.commandId,
  });
}

function immutableAppliedResult(
  result: SessionAppliedCommandResult,
): SessionAppliedCommandResult {
  switch (result.type) {
    case 'credential_rotated':
      return Object.freeze({
        type: result.type,
        credential: immutableCredentialBinding(result.credential),
      });
    case 'session_revoked':
      return Object.freeze({
        type: result.type,
        revocation: immutableRevocation(result.revocation),
      });
    case 'session_expired':
      return Object.freeze({
        type: result.type,
        expiration: immutableExpiration(result.expiration),
      });
    case 'reuse_detected':
      return Object.freeze({
        type: result.type,
        reuse: immutableReuse(result.reuse),
      });
  }
}

function immutableAppliedCommand(
  command: AppliedSessionCommand,
): AppliedSessionCommand {
  const base = {
    sessionId: command.sessionId,
    commandId: command.commandId,
    requestDigest: command.requestDigest,
    appliedAt: command.appliedAt,
    result: immutableAppliedResult(command.result),
  };

  switch (command.commandType) {
    case 'rotate_credential':
      return Object.freeze({
        ...base,
        commandType: command.commandType,
        presentedCredential: immutableCredentialReference(
          command.presentedCredential,
        ),
        nextCredential: immutableCredentialReference(command.nextCredential),
      });
    case 'revoke_session':
      return Object.freeze({
        ...base,
        commandType: command.commandType,
        reason: command.reason,
      });
    case 'expire_session':
      return Object.freeze({
        ...base,
        commandType: command.commandType,
      });
  }
}

function immutableStateBinding(
  state: SessionState,
  currentCredential: SessionCredentialBinding = state.currentCredential,
  consumedCredentials: readonly ConsumedSessionCredential[] =
    state.consumedCredentials,
  appliedCommands: readonly AppliedSessionCommand[] = state.appliedCommands,
) {
  return {
    sessionId: state.sessionId,
    authenticationOperationId: state.authenticationOperationId,
    accountId: state.accountId,
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    currentCredential: immutableCredentialBinding(currentCredential),
    consumedCredentials: Object.freeze(
      consumedCredentials.map(immutableConsumedCredential),
    ),
    appliedCommands: Object.freeze(appliedCommands.map(immutableAppliedCommand)),
  };
}

function referencesEqual(
  left: SessionCredentialReference,
  right: SessionCredentialReference,
): boolean {
  return (
    left.digest === right.digest && left.generation === right.generation
  );
}

function credentialBindingsEqual(
  left: SessionCredentialBinding,
  right: SessionCredentialBinding,
): boolean {
  return referencesEqual(left, right) && left.issuedAt === right.issuedAt;
}

function isSessionRevocationMetadata(
  value: unknown,
): value is SessionRevocationMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['reason', 'revokedAt', 'commandId']) &&
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
    hasExactlyKeys(value, ['expiredAt', 'commandId']) &&
    isUnixEpochSeconds(value.expiredAt) &&
    isSessionCommandId(value.commandId)
  );
}

function isSessionReuseMetadata(
  value: unknown,
): value is SessionCredentialReuseMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, [
      'detectedAt',
      'generation',
      'digest',
      'commandId',
    ]) &&
    isUnixEpochSeconds(value.detectedAt) &&
    isSessionCredentialGeneration(value.generation) &&
    isSessionCredentialDigest(value.digest) &&
    isSessionCommandId(value.commandId)
  );
}

function isSessionAppliedResult(
  value: unknown,
): value is SessionAppliedCommandResult {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'credential_rotated':
      return (
        hasExactlyKeys(value, ['type', 'credential']) &&
        isCredentialBinding(value.credential)
      );
    case 'session_revoked':
      return (
        hasExactlyKeys(value, ['type', 'revocation']) &&
        isSessionRevocationMetadata(value.revocation)
      );
    case 'session_expired':
      return (
        hasExactlyKeys(value, ['type', 'expiration']) &&
        isSessionExpirationMetadata(value.expiration)
      );
    case 'reuse_detected':
      return (
        hasExactlyKeys(value, ['type', 'reuse']) &&
        isSessionReuseMetadata(value.reuse)
      );
    default:
      return false;
  }
}

function isAppliedSessionCommandShape(
  value: unknown,
  sessionId: SessionState['sessionId'],
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
        hasExactlyKeys(value, [
          'sessionId',
          'commandId',
          'commandType',
          'requestDigest',
          'appliedAt',
          'presentedCredential',
          'nextCredential',
          'result',
        ]) &&
        isCredentialReference(value.presentedCredential) &&
        isCredentialReference(value.nextCredential) &&
        (value.result.type === 'credential_rotated' ||
          value.result.type === 'reuse_detected')
      );
    case 'revoke_session':
      return (
        hasExactlyKeys(value, [
          'sessionId',
          'commandId',
          'commandType',
          'requestDigest',
          'appliedAt',
          'reason',
          'result',
        ]) &&
        isSessionRevokeReason(value.reason) &&
        value.result.type === 'session_revoked'
      );
    case 'expire_session':
      return (
        hasExactlyKeys(value, [
          'sessionId',
          'commandId',
          'commandType',
          'requestDigest',
          'appliedAt',
          'result',
        ]) && value.result.type === 'session_expired'
      );
    default:
      return false;
  }
}

export function isSessionCommandPersistenceRecord(
  value: unknown,
): value is SessionCommandPersistenceRecord {
  if (
    !isRecord(value) ||
    !isSessionId(value.sessionId) ||
    !isSessionCommandId(value.commandId) ||
    !isAggregateCommandSequence(value.commandSequence) ||
    !isSessionRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.appliedAt) ||
    !isSessionAppliedResult(value.result)
  ) {
    return false;
  }

  switch (value.commandType) {
    case 'rotate_credential':
      return (
        hasExactlyKeys(value, [
          'sessionId',
          'commandId',
          'commandSequence',
          'commandType',
          'requestDigest',
          'appliedAt',
          'presentedCredential',
          'nextCredential',
          'result',
        ]) &&
        isCredentialReference(value.presentedCredential) &&
        isCredentialReference(value.nextCredential) &&
        (value.result.type === 'credential_rotated' ||
          value.result.type === 'reuse_detected')
      );
    case 'revoke_session':
      return (
        hasExactlyKeys(value, [
          'sessionId',
          'commandId',
          'commandSequence',
          'commandType',
          'requestDigest',
          'appliedAt',
          'reason',
          'result',
        ]) &&
        isSessionRevokeReason(value.reason) &&
        value.result.type === 'session_revoked'
      );
    case 'expire_session':
      return (
        hasExactlyKeys(value, [
          'sessionId',
          'commandId',
          'commandSequence',
          'commandType',
          'requestDigest',
          'appliedAt',
          'result',
        ]) && value.result.type === 'session_expired'
      );
    default:
      return false;
  }
}

function appliedSessionCommandFromPersistenceRecord(
  record: SessionCommandPersistenceRecord,
): AppliedSessionCommand {
  const base = {
    sessionId: record.sessionId,
    commandId: record.commandId,
    requestDigest: record.requestDigest,
    appliedAt: record.appliedAt,
    result: record.result,
  };

  switch (record.commandType) {
    case 'rotate_credential':
      return immutableAppliedCommand({
        ...base,
        commandType: record.commandType,
        presentedCredential: record.presentedCredential,
        nextCredential: record.nextCredential,
      });
    case 'revoke_session':
      return immutableAppliedCommand({
        ...base,
        commandType: record.commandType,
        reason: record.reason,
      });
    case 'expire_session':
      return immutableAppliedCommand({
        ...base,
        commandType: record.commandType,
      });
  }
}

export function hydrateAppliedSessionCommandHistory(
  records: unknown,
): readonly AppliedSessionCommand[] {
  if (!Array.isArray(records)) {
    throw new TypeError('Session command persistence history is invalid');
  }

  const orderedRecords = records.map((record) => {
    if (!isSessionCommandPersistenceRecord(record)) {
      throw new TypeError('Session command persistence record is invalid');
    }
    return record;
  });
  orderedRecords.sort(
    (left, right) => left.commandSequence - right.commandSequence,
  );

  for (const [index, record] of orderedRecords.entries()) {
    if (record.commandSequence !== index + 1) {
      throw new TypeError('Session command persistence sequence is invalid');
    }
  }

  return Object.freeze(
    orderedRecords.map(appliedSessionCommandFromPersistenceRecord),
  );
}

export function hydrateSessionStateFromCommandPersistenceRecords(
  value: unknown,
): SessionState {
  if (!isRecord(value) || !Array.isArray(value.appliedCommands)) {
    throw new TypeError('Session persistence state is invalid');
  }

  const candidate = Object.freeze({
    ...value,
    appliedCommands: hydrateAppliedSessionCommandHistory(
      value.appliedCommands,
    ),
  });
  if (!isValidSessionState(candidate)) {
    throw new TypeError('Session persistence state is invalid');
  }

  return candidate;
}

function revocationsEqual(
  left: SessionRevocationMetadata,
  right: SessionRevocationMetadata,
): boolean {
  return (
    left.reason === right.reason &&
    left.revokedAt === right.revokedAt &&
    left.commandId === right.commandId
  );
}

function expirationsEqual(
  left: SessionExpirationMetadata,
  right: SessionExpirationMetadata,
): boolean {
  return left.expiredAt === right.expiredAt && left.commandId === right.commandId;
}

function reuseMetadataEqual(
  left: SessionCredentialReuseMetadata,
  right: SessionCredentialReuseMetadata,
): boolean {
  return (
    left.detectedAt === right.detectedAt &&
    left.generation === right.generation &&
    left.digest === right.digest &&
    left.commandId === right.commandId
  );
}

const SESSION_STATE_BINDING_KEYS = Object.freeze([
  'sessionId',
  'authenticationOperationId',
  'accountId',
  'createdAt',
  'expiresAt',
  'currentCredential',
  'consumedCredentials',
  'appliedCommands',
] as const);

function sessionStateRejectionReason(
  value: unknown,
):
  | 'invalid_state_shape'
  | 'invalid_state_binding'
  | 'invalid_credential_history'
  | 'invalid_command_history'
  | 'invalid_status_metadata'
  | undefined {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return 'invalid_state_shape';
  }
  if (
    !isSessionId(value.sessionId) ||
    !isAuthenticationOperationId(value.authenticationOperationId) ||
    !isSessionAccountId(value.accountId) ||
    !isUnixEpochSeconds(value.createdAt) ||
    !isUnixEpochSeconds(value.expiresAt) ||
    value.createdAt >= value.expiresAt ||
    !isCredentialBinding(value.currentCredential) ||
    value.currentCredential.issuedAt < value.createdAt ||
    value.currentCredential.issuedAt >= value.expiresAt ||
    !Array.isArray(value.consumedCredentials) ||
    !Array.isArray(value.appliedCommands)
  ) {
    return 'invalid_state_binding';
  }

  const sessionId = value.sessionId;
  const currentCredential = value.currentCredential;
  const consumedCredentials: ConsumedSessionCredential[] = [];
  const credentialDigests = new Set<string>();
  for (let index = 0; index < value.consumedCredentials.length; index += 1) {
    const credential = value.consumedCredentials[index];
    if (
      !isRecord(credential) ||
      !hasExactlyKeys(credential, [
        'digest',
        'generation',
        'issuedAt',
        'consumedAt',
        'consumedByCommandId',
      ]) ||
      !isSessionCredentialDigest(credential.digest) ||
      !isSessionCredentialGeneration(credential.generation) ||
      !isUnixEpochSeconds(credential.issuedAt) ||
      !isUnixEpochSeconds(credential.consumedAt) ||
      !isSessionCommandId(credential.consumedByCommandId) ||
      credential.generation !== index + 1 ||
      credential.issuedAt < value.createdAt ||
      credential.issuedAt >= value.expiresAt ||
      credential.consumedAt < credential.issuedAt ||
      credential.consumedAt >= value.expiresAt ||
      credentialDigests.has(credential.digest)
    ) {
      return 'invalid_credential_history';
    }
    if (
      index > 0 &&
      credential.issuedAt !== consumedCredentials[index - 1].consumedAt
    ) {
      return 'invalid_credential_history';
    }
    credentialDigests.add(credential.digest);
    consumedCredentials.push(credential as unknown as ConsumedSessionCredential);
  }
  if (
    currentCredential.generation !== consumedCredentials.length + 1 ||
    credentialDigests.has(currentCredential.digest) ||
    (consumedCredentials.length > 0 &&
      currentCredential.issuedAt !==
        consumedCredentials[consumedCredentials.length - 1].consumedAt)
  ) {
    return 'invalid_credential_history';
  }

  const appliedCommands: AppliedSessionCommand[] = [];
  const commandIds = new Set<string>();
  for (const command of value.appliedCommands) {
    if (
      !isAppliedSessionCommandShape(command, sessionId) ||
      commandIds.has(command.commandId)
    ) {
      return 'invalid_command_history';
    }
    commandIds.add(command.commandId);
    appliedCommands.push(command);
  }

  let simulatedCredential: SessionCredentialBinding =
    consumedCredentials.length === 0
      ? currentCredential
      : consumedCredentials[0];
  let consumedIndex = 0;
  let lifecycle: SessionState['status'] = 'active';
  let storedRevocation: SessionRevocationMetadata | undefined;
  let storedExpiration: SessionExpirationMetadata | undefined;
  let storedReuse: SessionCredentialReuseMetadata | undefined;
  let previousAppliedAt = value.createdAt;

  for (const command of appliedCommands) {
    if (
      command.appliedAt < previousAppliedAt ||
      lifecycle === 'expired' ||
      lifecycle === 'reuse_detected'
    ) {
      return 'invalid_command_history';
    }
    previousAppliedAt = command.appliedAt;
    if (command.commandType === 'rotate_credential') {
      if (command.result.type === 'credential_rotated') {
        const consumed = consumedCredentials[consumedIndex];
        if (
          lifecycle !== 'active' ||
          command.appliedAt < value.createdAt ||
          command.appliedAt >= value.expiresAt ||
          !referencesEqual(command.presentedCredential, simulatedCredential) ||
          command.nextCredential.generation !==
            simulatedCredential.generation + 1 ||
          command.nextCredential.digest === simulatedCredential.digest ||
          !credentialBindingsEqual(command.result.credential, {
            ...command.nextCredential,
            issuedAt: command.appliedAt,
          }) ||
          consumed === undefined ||
          !credentialBindingsEqual(consumed, simulatedCredential) ||
          consumed.consumedAt !== command.appliedAt ||
          consumed.consumedByCommandId !== command.commandId
        ) {
          return 'invalid_command_history';
        }
        simulatedCredential = command.result.credential;
        consumedIndex += 1;
        continue;
      }

      if (
        command.result.type !== 'reuse_detected' ||
        (lifecycle !== 'active' && lifecycle !== 'revoked') ||
        command.appliedAt < value.createdAt ||
        !consumedCredentials.some((credential) =>
          referencesEqual(credential, command.presentedCredential),
        ) ||
        !reuseMetadataEqual(command.result.reuse, {
          detectedAt: command.appliedAt,
          generation: command.presentedCredential.generation,
          digest: command.presentedCredential.digest,
          commandId: command.commandId,
        })
      ) {
        return 'invalid_command_history';
      }
      lifecycle = 'reuse_detected';
      storedReuse = command.result.reuse;
      continue;
    }

    if (command.commandType === 'revoke_session') {
      if (
        command.result.type !== 'session_revoked' ||
        lifecycle !== 'active' ||
        command.appliedAt < value.createdAt ||
        command.appliedAt >= value.expiresAt ||
        !revocationsEqual(command.result.revocation, {
          reason: command.reason,
          revokedAt: command.appliedAt,
          commandId: command.commandId,
        })
      ) {
        return 'invalid_command_history';
      }
      lifecycle = 'revoked';
      storedRevocation = command.result.revocation;
      continue;
    }

    if (
      command.result.type !== 'session_expired' ||
      lifecycle !== 'active' ||
      command.appliedAt < value.expiresAt ||
      !expirationsEqual(command.result.expiration, {
        expiredAt: command.appliedAt,
        commandId: command.commandId,
      })
    ) {
      return 'invalid_command_history';
    }
    lifecycle = 'expired';
    storedExpiration = command.result.expiration;
  }

  if (
    consumedIndex !== consumedCredentials.length ||
    !credentialBindingsEqual(simulatedCredential, currentCredential) ||
    value.status !== lifecycle
  ) {
    return 'invalid_command_history';
  }

  switch (value.status) {
    case 'active':
      return hasExactlyKeys(value, [...SESSION_STATE_BINDING_KEYS, 'status'])
        ? undefined
        : 'invalid_status_metadata';
    case 'expired':
      return hasExactlyKeys(value, [
        ...SESSION_STATE_BINDING_KEYS,
        'status',
        'expiration',
      ]) &&
        isSessionExpirationMetadata(value.expiration) &&
        storedExpiration !== undefined &&
        expirationsEqual(value.expiration, storedExpiration)
        ? undefined
        : 'invalid_status_metadata';
    case 'revoked':
      return hasExactlyKeys(value, [
        ...SESSION_STATE_BINDING_KEYS,
        'status',
        'revocation',
      ]) &&
        isSessionRevocationMetadata(value.revocation) &&
        storedRevocation !== undefined &&
        revocationsEqual(value.revocation, storedRevocation)
        ? undefined
        : 'invalid_status_metadata';
    case 'reuse_detected':
      return hasExactlyKeys(value, [
        ...SESSION_STATE_BINDING_KEYS,
        'status',
        'reuse',
      ]) &&
        isSessionReuseMetadata(value.reuse) &&
        storedReuse !== undefined &&
        reuseMetadataEqual(value.reuse, storedReuse)
        ? undefined
        : 'invalid_status_metadata';
    default:
      return 'invalid_state_shape';
  }
}

export function isValidSessionState(value: unknown): value is SessionState {
  return sessionStateRejectionReason(value) === undefined;
}

function isExactAppliedCommand(
  applied: AppliedSessionCommand,
  command: SessionCommand,
): boolean {
  // `now` is an orchestration observation, not part of command identity. The
  // original application time is retained as `appliedAt`, so a later network
  // retry can return the stored result even after the session expiry boundary.
  if (
    applied.commandType !== command.type ||
    applied.sessionId !== command.sessionId ||
    applied.commandId !== command.commandId ||
    applied.requestDigest !== command.requestDigest
  ) {
    return false;
  }

  if (
    applied.commandType === 'rotate_credential' &&
    command.type === 'rotate_credential'
  ) {
    return (
      referencesEqual(
        applied.presentedCredential,
        command.presentedCredential,
      ) && referencesEqual(applied.nextCredential, command.nextCredential)
    );
  }

  if (
    applied.commandType === 'revoke_session' &&
    command.type === 'revoke_session'
  ) {
    return applied.reason === command.reason;
  }

  return (
    applied.commandType === 'expire_session' &&
    command.type === 'expire_session'
  );
}

function appliedRotateCommand(
  command: RotateSessionCredentialCommand,
  result: SessionAppliedCommandResult,
): AppliedRotateCredentialCommand {
  return Object.freeze({
    sessionId: command.sessionId,
    commandId: command.commandId,
    commandType: command.type,
    requestDigest: command.requestDigest,
    appliedAt: command.now,
    presentedCredential: immutableCredentialReference(
      command.presentedCredential,
    ),
    nextCredential: immutableCredentialReference(command.nextCredential),
    result: immutableAppliedResult(result),
  });
}

function transitionToReuseDetected(
  state: ActiveSessionState | RevokedSessionState,
  command: RotateSessionCredentialCommand,
  consumed: ConsumedSessionCredential,
): SessionTransitionResult {
  const reuse = immutableReuse({
    detectedAt: command.now,
    generation: consumed.generation,
    digest: consumed.digest,
    commandId: command.commandId,
  });
  const result = immutableAppliedResult({
    type: 'reuse_detected',
    reuse,
  });
  const applied = appliedRotateCommand(command, result);
  const nextState: ReuseDetectedSessionState = Object.freeze({
    ...immutableStateBinding(
      state,
      state.currentCredential,
      state.consumedCredentials,
      [...state.appliedCommands, applied],
    ),
    status: 'reuse_detected',
    reuse,
  });
  const storedResult =
    nextState.appliedCommands[nextState.appliedCommands.length - 1].result;

  return {
    outcome: 'transitioned',
    transition: 'reuse_detected',
    state: nextState,
    result: storedResult,
  };
}

function rotateCredential(
  state: ActiveSessionState,
  command: RotateSessionCredentialCommand,
): SessionTransitionResult {
  const next = command.nextCredential;
  const expectedGeneration = state.currentCredential.generation + 1;
  if (
    !isSessionCredentialDigest(next.digest) ||
    !isSessionCredentialGeneration(next.generation) ||
    !Number.isSafeInteger(expectedGeneration) ||
    next.generation !== expectedGeneration ||
    next.digest === state.currentCredential.digest ||
    state.consumedCredentials.some(
      (credential) => credential.digest === next.digest,
    )
  ) {
    return {
      outcome: 'rejected',
      reason: 'invalid_next_credential',
      state,
    };
  }

  const consumed = immutableConsumedCredential({
    ...state.currentCredential,
    consumedAt: command.now,
    consumedByCommandId: command.commandId,
  });
  const currentCredential = immutableCredentialBinding({
    digest: next.digest,
    generation: next.generation,
    issuedAt: command.now,
  });
  const result = immutableAppliedResult({
    type: 'credential_rotated',
    credential: currentCredential,
  });
  const applied = appliedRotateCommand(command, result);
  const nextState: ActiveSessionState = Object.freeze({
    ...immutableStateBinding(
      state,
      currentCredential,
      [...state.consumedCredentials, consumed],
      [...state.appliedCommands, applied],
    ),
    status: 'active',
  });
  const storedResult =
    nextState.appliedCommands[nextState.appliedCommands.length - 1].result;

  return {
    outcome: 'transitioned',
    transition: 'credential_rotated',
    state: nextState,
    result: storedResult,
  };
}

function revokeSession(
  state: ActiveSessionState,
  command: Extract<SessionCommand, { readonly type: 'revoke_session' }>,
): SessionTransitionResult {
  const revocation = immutableRevocation({
    reason: command.reason,
    revokedAt: command.now,
    commandId: command.commandId,
  });
  const result = immutableAppliedResult({
    type: 'session_revoked',
    revocation,
  });
  const applied: AppliedRevokeSessionCommand = Object.freeze({
    sessionId: command.sessionId,
    commandId: command.commandId,
    commandType: command.type,
    requestDigest: command.requestDigest,
    appliedAt: command.now,
    reason: command.reason,
    result,
  });
  const nextState: RevokedSessionState = Object.freeze({
    ...immutableStateBinding(
      state,
      state.currentCredential,
      state.consumedCredentials,
      [...state.appliedCommands, applied],
    ),
    status: 'revoked',
    revocation,
  });
  const storedResult =
    nextState.appliedCommands[nextState.appliedCommands.length - 1].result;

  return {
    outcome: 'transitioned',
    transition: 'session_revoked',
    state: nextState,
    result: storedResult,
  };
}

function expireSession(
  state: ActiveSessionState,
  command: Extract<SessionCommand, { readonly type: 'expire_session' }>,
): SessionTransitionResult {
  const expiration = immutableExpiration({
    expiredAt: command.now,
    commandId: command.commandId,
  });
  const result = immutableAppliedResult({
    type: 'session_expired',
    expiration,
  });
  const applied: AppliedExpireSessionCommand = Object.freeze({
    sessionId: command.sessionId,
    commandId: command.commandId,
    commandType: command.type,
    requestDigest: command.requestDigest,
    appliedAt: command.now,
    result,
  });
  const nextState: ExpiredSessionState = Object.freeze({
    ...immutableStateBinding(
      state,
      state.currentCredential,
      state.consumedCredentials,
      [...state.appliedCommands, applied],
    ),
    status: 'expired',
    expiration,
  });
  const storedResult =
    nextState.appliedCommands[nextState.appliedCommands.length - 1].result;

  return {
    outcome: 'transitioned',
    transition: 'session_expired',
    state: nextState,
    result: storedResult,
  };
}

export function createActiveSession(
  binding: CreateActiveSessionBinding,
): CreateActiveSessionResult {
  const bindingReason = sessionBindingRejectionReason(binding);
  if (bindingReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_session_binding',
      bindingReason,
    };
  }

  const state: ActiveSessionState = Object.freeze({
    sessionId: binding.sessionId,
    authenticationOperationId: binding.authenticationOperationId,
    accountId: binding.accountId,
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt,
    currentCredential: immutableCredentialBinding(binding.currentCredential),
    consumedCredentials: Object.freeze([]),
    appliedCommands: Object.freeze([]),
    status: 'active',
  });

  return { outcome: 'created', state };
}

export function transitionSession(
  state: SessionState,
  command: SessionCommand,
): SessionTransitionResult {
  const stateReason = sessionStateRejectionReason(state);
  if (stateReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_session_state',
      stateReason,
      state,
    };
  }

  const commandReason = sessionCommandRejectionReason(command);
  if (commandReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason,
      state,
    };
  }

  if (state.sessionId !== command.sessionId) {
    return {
      outcome: 'rejected',
      reason: 'session_binding_conflict',
      state,
    };
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

    return {
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
      state,
    };
  }

  if (state.status === 'expired' || state.status === 'reuse_detected') {
    return {
      outcome: 'rejected',
      reason: 'forbidden_transition',
      state,
    };
  }

  const lastAppliedCommand =
    state.appliedCommands[state.appliedCommands.length - 1];
  if (
    command.now < state.createdAt ||
    (lastAppliedCommand !== undefined &&
      command.now < lastAppliedCommand.appliedAt)
  ) {
    return {
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason: 'invalid_time',
      state,
    };
  }

  if (command.type === 'rotate_credential') {
    const consumed = state.consumedCredentials.find((credential) =>
      referencesEqual(credential, command.presentedCredential),
    );
    if (consumed !== undefined) {
      if (!isCredentialReference(command.nextCredential)) {
        return {
          outcome: 'rejected',
          reason: 'invalid_next_credential',
          state,
        };
      }
      return transitionToReuseDetected(state, command, consumed);
    }
  }

  if (state.status !== 'active') {
    return {
      outcome: 'rejected',
      reason: 'forbidden_transition',
      state,
    };
  }

  if (command.type !== 'expire_session' && command.now >= state.expiresAt) {
    return {
      outcome: 'rejected',
      reason: 'session_expired',
      state,
    };
  }

  if (command.type === 'expire_session') {
    if (command.now < state.expiresAt) {
      return {
        outcome: 'rejected',
        reason: 'not_yet_expired',
        state,
      };
    }
    return expireSession(state, command);
  }

  if (command.type === 'revoke_session') {
    return revokeSession(state, command);
  }

  if (!referencesEqual(state.currentCredential, command.presentedCredential)) {
    return {
      outcome: 'rejected',
      reason: 'invalid_session_credential',
      state,
    };
  }

  return rotateCredential(state, command);
}
