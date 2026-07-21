import { timingSafeEqual } from 'crypto';
import { ExternalIdentityKey } from '../accounts/external-identity.types';
import { isValidExternalIdentityKey } from './account-resolution.types';
import { isAggregateCommandSequence } from './aggregate-command-sequence';
import {
  isAuthenticationIntent,
  isAuthenticationOperationId,
  isUnixEpochSeconds,
} from './auth.types';
import {
  AppliedCancelOtpCommand,
  AppliedExpireOtpCommand,
  AppliedOtpCommand,
  AppliedSubmitOtpCommand,
  AttemptsExhaustedOtpChallenge,
  CancelOtpCommand,
  CancelledOtpChallenge,
  CreateOtpChallengeBinding,
  ExpireOtpCommand,
  ExpiredOtpChallenge,
  MAX_OTP_ATTEMPTS,
  OtpAppliedResult,
  OtpAttemptsExhaustedMetadata,
  OtpCancellationMetadata,
  OtpChallengeState,
  OtpChallengeStateBinding,
  OtpCommand,
  OtpCommandPersistenceRecord,
  OtpExpirationMetadata,
  OtpVerificationMetadata,
  PendingOtpChallenge,
  SubmitOtpCommand,
  VerifiedOtpChallenge,
  isOtpAttemptCount,
  isOtpCancelReason,
  isOtpChallengeId,
  isOtpCommandId,
  isOtpRequestDigest,
  isOtpVerifierDigest,
} from './otp.types';

export const OTP_CHALLENGE_REJECTION_REASONS = Object.freeze([
  'invalid_binding_shape',
  'invalid_challenge_id',
  'invalid_intent',
  'invalid_identity_key',
  'identity_provider_not_phone',
  'invalid_operation_id',
  'invalid_request_digest',
  'invalid_verifier_digest',
  'invalid_created_at',
  'invalid_expires_at',
  'invalid_challenge_window',
  'invalid_max_attempts',
] as const);

export type OtpChallengeRejectionReason =
  (typeof OTP_CHALLENGE_REJECTION_REASONS)[number];

export const OTP_COMMAND_REJECTION_REASONS = Object.freeze([
  'invalid_command_shape',
  'invalid_challenge_id',
  'invalid_command_id',
  'invalid_command_type',
  'invalid_request_digest',
  'invalid_time',
  'missing_presented_digest',
  'invalid_presented_digest',
  'missing_cancel_reason',
  'invalid_cancel_reason',
] as const);

export type OtpCommandRejectionReason =
  (typeof OTP_COMMAND_REJECTION_REASONS)[number];

export type CreateOtpChallengeResult =
  | { readonly outcome: 'created'; readonly state: PendingOtpChallenge }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_otp_challenge';
      readonly challengeReason: OtpChallengeRejectionReason;
    };

export type OtpTransitionRejectionReason =
  | 'invalid_otp_state'
  | 'otp_binding_conflict'
  | 'command_reuse_conflict'
  | 'forbidden_transition'
  | 'otp_expired'
  | 'not_yet_expired';

export type OtpTransitionResult =
  | {
      readonly outcome: 'transitioned';
      readonly transition:
        | 'otp_verified'
        | 'incorrect_code'
        | 'otp_attempts_exhausted'
        | 'otp_expired'
        | 'otp_cancelled';
      readonly state: OtpChallengeState;
      readonly result: OtpAppliedResult;
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly state: OtpChallengeState;
      readonly originalResult: OtpAppliedResult;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_otp_command';
      readonly commandReason: OtpCommandRejectionReason;
      readonly state: OtpChallengeState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: OtpTransitionRejectionReason;
      readonly state: OtpChallengeState;
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

function isOtpVerificationMetadata(
  value: unknown,
): value is OtpVerificationMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['verifiedAt', 'commandId']) &&
    isUnixEpochSeconds(value.verifiedAt) &&
    isOtpCommandId(value.commandId)
  );
}

function isOtpExpirationMetadata(
  value: unknown,
): value is OtpExpirationMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['expiredAt', 'commandId']) &&
    isUnixEpochSeconds(value.expiredAt) &&
    isOtpCommandId(value.commandId)
  );
}

function isOtpExhaustionMetadata(
  value: unknown,
): value is OtpAttemptsExhaustedMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['exhaustedAt', 'commandId']) &&
    isUnixEpochSeconds(value.exhaustedAt) &&
    isOtpCommandId(value.commandId)
  );
}

function isOtpCancellationMetadata(
  value: unknown,
): value is OtpCancellationMetadata {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['reason', 'cancelledAt', 'commandId']) &&
    isOtpCancelReason(value.reason) &&
    isUnixEpochSeconds(value.cancelledAt) &&
    isOtpCommandId(value.commandId)
  );
}

function isOtpAppliedResult(
  value: unknown,
  maxAttempts: number,
): value is OtpAppliedResult {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.type) {
    case 'otp_verified':
      return (
        hasExactlyKeys(value, ['type', 'verification']) &&
        isOtpVerificationMetadata(value.verification)
      );
    case 'incorrect_code':
      return (
        hasExactlyKeys(value, ['type', 'attemptsRemaining']) &&
        typeof value.attemptsRemaining === 'number' &&
        Number.isSafeInteger(value.attemptsRemaining) &&
        value.attemptsRemaining >= 1 &&
        value.attemptsRemaining <= maxAttempts
      );
    case 'otp_attempts_exhausted':
      return (
        hasExactlyKeys(value, ['type', 'exhaustion']) &&
        isOtpExhaustionMetadata(value.exhaustion)
      );
    case 'otp_expired':
      return (
        hasExactlyKeys(value, ['type', 'expiration']) &&
        isOtpExpirationMetadata(value.expiration)
      );
    case 'otp_cancelled':
      return (
        hasExactlyKeys(value, ['type', 'cancellation']) &&
        isOtpCancellationMetadata(value.cancellation)
      );
    default:
      return false;
  }
}

function isOtpCommandPersistenceRecordForMaxAttempts(
  value: unknown,
  maxAttempts: number,
): value is OtpCommandPersistenceRecord {
  if (
    !isRecord(value) ||
    !isOtpChallengeId(value.challengeId) ||
    !isOtpCommandId(value.commandId) ||
    !isAggregateCommandSequence(value.commandSequence) ||
    !isOtpRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.appliedAt) ||
    !isOtpAppliedResult(value.result, maxAttempts)
  ) {
    return false;
  }

  switch (value.commandType) {
    case 'submit_otp':
      return (
        hasExactlyKeys(value, [
          'challengeId',
          'commandId',
          'commandSequence',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
          'presentedDigest',
        ]) &&
        isOtpVerifierDigest(value.presentedDigest) &&
        (value.result.type === 'otp_verified' ||
          value.result.type === 'incorrect_code' ||
          value.result.type === 'otp_attempts_exhausted')
      );
    case 'expire_otp':
      return (
        hasExactlyKeys(value, [
          'challengeId',
          'commandId',
          'commandSequence',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
        ]) && value.result.type === 'otp_expired'
      );
    case 'cancel_otp':
      return (
        hasExactlyKeys(value, [
          'challengeId',
          'commandId',
          'commandSequence',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
          'reason',
        ]) &&
        isOtpCancelReason(value.reason) &&
        value.result.type === 'otp_cancelled'
      );
    default:
      return false;
  }
}

function isAppliedOtpCommandShapeForMaxAttempts(
  value: unknown,
  maxAttempts: number,
): value is AppliedOtpCommand {
  if (
    !isRecord(value) ||
    !isOtpChallengeId(value.challengeId) ||
    !isOtpCommandId(value.commandId) ||
    !isOtpRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.appliedAt) ||
    !isOtpAppliedResult(value.result, maxAttempts)
  ) {
    return false;
  }

  switch (value.commandType) {
    case 'submit_otp':
      return (
        hasExactlyKeys(value, [
          'challengeId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
          'presentedDigest',
        ]) &&
        isOtpVerifierDigest(value.presentedDigest) &&
        (value.result.type === 'otp_verified' ||
          value.result.type === 'incorrect_code' ||
          value.result.type === 'otp_attempts_exhausted')
      );
    case 'expire_otp':
      return (
        hasExactlyKeys(value, [
          'challengeId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
        ]) && value.result.type === 'otp_expired'
      );
    case 'cancel_otp':
      return (
        hasExactlyKeys(value, [
          'challengeId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'result',
          'commandType',
          'reason',
        ]) &&
        isOtpCancelReason(value.reason) &&
        value.result.type === 'otp_cancelled'
      );
    default:
      return false;
  }
}

export function isOtpCommandPersistenceRecord(
  value: unknown,
): value is OtpCommandPersistenceRecord {
  return isOtpCommandPersistenceRecordForMaxAttempts(value, MAX_OTP_ATTEMPTS);
}

function appliedOtpCommandFromPersistenceRecord(
  record: OtpCommandPersistenceRecord,
): AppliedOtpCommand {
  const base = {
    challengeId: record.challengeId,
    commandId: record.commandId,
    requestDigest: record.requestDigest,
    appliedAt: record.appliedAt,
    result: record.result,
  };

  switch (record.commandType) {
    case 'submit_otp':
      return immutableAppliedCommand({
        ...base,
        commandType: record.commandType,
        presentedDigest: record.presentedDigest,
      });
    case 'expire_otp':
      return immutableAppliedCommand({
        ...base,
        commandType: record.commandType,
      });
    case 'cancel_otp':
      return immutableAppliedCommand({
        ...base,
        commandType: record.commandType,
        reason: record.reason,
      });
  }
}

export function hydrateAppliedOtpCommandHistory(
  records: unknown,
): readonly AppliedOtpCommand[] {
  if (!Array.isArray(records)) {
    throw new TypeError('OTP command persistence history is invalid');
  }

  const orderedRecords = records.map((record) => {
    if (!isOtpCommandPersistenceRecord(record)) {
      throw new TypeError('OTP command persistence record is invalid');
    }
    return record;
  });
  orderedRecords.sort(
    (left, right) => left.commandSequence - right.commandSequence,
  );

  for (const [index, record] of orderedRecords.entries()) {
    if (record.commandSequence !== index + 1) {
      throw new TypeError('OTP command persistence sequence is invalid');
    }
  }

  return Object.freeze(
    orderedRecords.map(appliedOtpCommandFromPersistenceRecord),
  );
}

export function hydrateOtpChallengeStateFromCommandPersistenceRecords(
  value: unknown,
): OtpChallengeState {
  if (!isRecord(value) || !Array.isArray(value.appliedCommands)) {
    throw new TypeError('OTP persistence state is invalid');
  }

  const candidate = Object.freeze({
    ...value,
    appliedCommands: hydrateAppliedOtpCommandHistory(value.appliedCommands),
  });
  if (!isOtpChallengeState(candidate)) {
    throw new TypeError('OTP persistence state is invalid');
  }

  return candidate;
}

function isAppliedOtpCommand(
  value: unknown,
  challengeId: string,
  verifierDigest: unknown,
  createdAt: number,
  expiresAt: number,
  maxAttempts: number,
): value is AppliedOtpCommand {
  if (
    !isAppliedOtpCommandShapeForMaxAttempts(value, maxAttempts) ||
    value.challengeId !== challengeId ||
    !isOtpAppliedResult(value.result, maxAttempts)
  ) {
    return false;
  }

  switch (value.commandType) {
    case 'submit_otp':
      if (value.appliedAt < createdAt || value.appliedAt >= expiresAt) {
        return false;
      }
      const digestMatches = digestsEqual(
        verifierDigest,
        value.presentedDigest,
      );
      if (value.result.type === 'otp_verified') {
        return (
          digestMatches &&
          value.result.verification.commandId === value.commandId &&
          value.result.verification.verifiedAt === value.appliedAt
        );
      }
      if (value.result.type === 'otp_attempts_exhausted') {
        return (
          !digestMatches &&
          value.result.exhaustion.commandId === value.commandId &&
          value.result.exhaustion.exhaustedAt === value.appliedAt
        );
      }
      return value.result.type === 'incorrect_code' && !digestMatches;
    case 'expire_otp':
      return (
        value.appliedAt >= expiresAt &&
        value.result.type === 'otp_expired' &&
        value.result.expiration.commandId === value.commandId &&
        value.result.expiration.expiredAt === value.appliedAt
      );
    case 'cancel_otp':
      return (
        value.appliedAt >= createdAt &&
        value.appliedAt < expiresAt &&
        value.result.type === 'otp_cancelled' &&
        value.result.cancellation.reason === value.reason &&
        value.result.cancellation.commandId === value.commandId &&
        value.result.cancellation.cancelledAt === value.appliedAt
      );
    default:
      return false;
  }
}

const OTP_STATE_BINDING_KEYS = Object.freeze([
  'challengeId',
  'intent',
  'identityKey',
  'operationId',
  'requestDigest',
  'verifierDigest',
  'createdAt',
  'expiresAt',
  'maxAttempts',
  'attemptsRemaining',
  'appliedCommands',
  'status',
] as const);

function terminalMetadataMatches(
  metadata: OtpVerificationMetadata | OtpExpirationMetadata |
    OtpAttemptsExhaustedMetadata | OtpCancellationMetadata,
  applied: AppliedOtpCommand,
): boolean {
  if (applied.result.type === 'otp_verified' && 'verifiedAt' in metadata) {
    return (
      metadata.commandId === applied.result.verification.commandId &&
      metadata.verifiedAt === applied.result.verification.verifiedAt
    );
  }
  if (applied.result.type === 'otp_expired' && 'expiredAt' in metadata) {
    return (
      metadata.commandId === applied.result.expiration.commandId &&
      metadata.expiredAt === applied.result.expiration.expiredAt
    );
  }
  if (
    applied.result.type === 'otp_attempts_exhausted' &&
    'exhaustedAt' in metadata
  ) {
    return (
      metadata.commandId === applied.result.exhaustion.commandId &&
      metadata.exhaustedAt === applied.result.exhaustion.exhaustedAt
    );
  }
  if (applied.result.type === 'otp_cancelled' && 'cancelledAt' in metadata) {
    return (
      metadata.commandId === applied.result.cancellation.commandId &&
      metadata.cancelledAt === applied.result.cancellation.cancelledAt &&
      metadata.reason === applied.result.cancellation.reason
    );
  }
  return false;
}

function incorrectHistoryIsSequential(
  commands: readonly AppliedOtpCommand[],
  maxAttempts: number,
): boolean {
  return commands.every(
    (command, index) =>
      command.result.type === 'incorrect_code' &&
      command.result.attemptsRemaining === maxAttempts - index - 1,
  );
}

function isOtpChallengeState(value: unknown): value is OtpChallengeState {
  if (
    !isRecord(value) ||
    !isOtpChallengeId(value.challengeId) ||
    !isAuthenticationIntent(value.intent) ||
    !isValidExternalIdentityKey(value.identityKey) ||
    value.identityKey.provider !== 'phone' ||
    !isAuthenticationOperationId(value.operationId) ||
    !isOtpRequestDigest(value.requestDigest) ||
    !isOtpVerifierDigest(value.verifierDigest) ||
    !isUnixEpochSeconds(value.createdAt) ||
    !isUnixEpochSeconds(value.expiresAt) ||
    value.createdAt >= value.expiresAt ||
    !isOtpAttemptCount(value.maxAttempts) ||
    typeof value.attemptsRemaining !== 'number' ||
    !Number.isSafeInteger(value.attemptsRemaining) ||
    value.attemptsRemaining < 0 ||
    value.attemptsRemaining > value.maxAttempts ||
    !Array.isArray(value.appliedCommands)
  ) {
    return false;
  }

  const challengeId = value.challengeId;
  const verifierDigest = value.verifierDigest;
  const createdAt = value.createdAt;
  const expiresAt = value.expiresAt;
  const maxAttempts = value.maxAttempts;
  if (
    !value.appliedCommands.every((command) =>
      isAppliedOtpCommand(
        command,
        challengeId,
        verifierDigest,
        createdAt,
        expiresAt,
        maxAttempts,
      ),
    )
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

  const lastApplied = value.appliedCommands[value.appliedCommands.length - 1];
  const priorApplied = value.appliedCommands.slice(0, -1);
  const allIncorrect = value.appliedCommands.every(
    (command) => command.result.type === 'incorrect_code',
  );
  const priorAllIncorrect = priorApplied.every(
    (command) => command.result.type === 'incorrect_code',
  );
  const expectedAttemptsRemaining =
    value.maxAttempts -
    value.appliedCommands.filter(
      (command) => command.result.type === 'incorrect_code',
    ).length;

  switch (value.status) {
    case 'pending':
      return (
        hasExactlyKeys(value, OTP_STATE_BINDING_KEYS) &&
        value.attemptsRemaining >= 1 &&
        allIncorrect &&
        incorrectHistoryIsSequential(
          value.appliedCommands,
          value.maxAttempts,
        ) &&
        value.attemptsRemaining === expectedAttemptsRemaining
      );
    case 'verified':
      return (
        hasExactlyKeys(value, [...OTP_STATE_BINDING_KEYS, 'verification']) &&
        value.attemptsRemaining >= 1 &&
        isOtpVerificationMetadata(value.verification) &&
        lastApplied?.result.type === 'otp_verified' &&
        priorAllIncorrect &&
        incorrectHistoryIsSequential(priorApplied, value.maxAttempts) &&
        value.attemptsRemaining === expectedAttemptsRemaining &&
        terminalMetadataMatches(value.verification, lastApplied)
      );
    case 'attempts_exhausted':
      return (
        hasExactlyKeys(value, [...OTP_STATE_BINDING_KEYS, 'exhaustion']) &&
        value.attemptsRemaining === 0 &&
        isOtpExhaustionMetadata(value.exhaustion) &&
        lastApplied?.result.type === 'otp_attempts_exhausted' &&
        priorAllIncorrect &&
        incorrectHistoryIsSequential(priorApplied, value.maxAttempts) &&
        priorApplied.length + 1 === value.maxAttempts &&
        terminalMetadataMatches(value.exhaustion, lastApplied)
      );
    case 'expired':
      return (
        hasExactlyKeys(value, [...OTP_STATE_BINDING_KEYS, 'expiration']) &&
        value.attemptsRemaining >= 1 &&
        isOtpExpirationMetadata(value.expiration) &&
        lastApplied?.result.type === 'otp_expired' &&
        priorAllIncorrect &&
        incorrectHistoryIsSequential(priorApplied, value.maxAttempts) &&
        value.attemptsRemaining === expectedAttemptsRemaining &&
        terminalMetadataMatches(value.expiration, lastApplied)
      );
    case 'cancelled':
      return (
        hasExactlyKeys(value, [...OTP_STATE_BINDING_KEYS, 'cancellation']) &&
        value.attemptsRemaining >= 1 &&
        isOtpCancellationMetadata(value.cancellation) &&
        lastApplied?.result.type === 'otp_cancelled' &&
        priorAllIncorrect &&
        incorrectHistoryIsSequential(priorApplied, value.maxAttempts) &&
        value.attemptsRemaining === expectedAttemptsRemaining &&
        terminalMetadataMatches(value.cancellation, lastApplied)
      );
    default:
      return false;
  }
}

function challengeRejectionReason(
  binding: unknown,
): OtpChallengeRejectionReason | undefined {
  if (!isRecord(binding)) {
    return 'invalid_binding_shape';
  }
  if (!isOtpChallengeId(binding.challengeId)) {
    return 'invalid_challenge_id';
  }
  if (!isAuthenticationIntent(binding.intent)) {
    return 'invalid_intent';
  }
  if (!isValidExternalIdentityKey(binding.identityKey)) {
    return 'invalid_identity_key';
  }
  if (binding.identityKey.provider !== 'phone') {
    return 'identity_provider_not_phone';
  }
  if (!isAuthenticationOperationId(binding.operationId)) {
    return 'invalid_operation_id';
  }
  if (!isOtpRequestDigest(binding.requestDigest)) {
    return 'invalid_request_digest';
  }
  if (!isOtpVerifierDigest(binding.verifierDigest)) {
    return 'invalid_verifier_digest';
  }
  if (!isUnixEpochSeconds(binding.createdAt)) {
    return 'invalid_created_at';
  }
  if (!isUnixEpochSeconds(binding.expiresAt)) {
    return 'invalid_expires_at';
  }
  if (binding.createdAt >= binding.expiresAt) {
    return 'invalid_challenge_window';
  }
  if (!isOtpAttemptCount(binding.maxAttempts)) {
    return 'invalid_max_attempts';
  }
  return undefined;
}

function commandRejectionReason(
  command: unknown,
): OtpCommandRejectionReason | undefined {
  if (!isRecord(command)) {
    return 'invalid_command_shape';
  }
  if (!isOtpChallengeId(command.challengeId)) {
    return 'invalid_challenge_id';
  }
  if (!isOtpCommandId(command.commandId)) {
    return 'invalid_command_id';
  }
  if (
    command.type !== 'submit_otp' &&
    command.type !== 'expire_otp' &&
    command.type !== 'cancel_otp'
  ) {
    return 'invalid_command_type';
  }
  if (!isOtpRequestDigest(command.requestDigest)) {
    return 'invalid_request_digest';
  }
  if (!isUnixEpochSeconds(command.now)) {
    return 'invalid_time';
  }
  if (command.type === 'submit_otp') {
    if (!Object.prototype.hasOwnProperty.call(command, 'presentedDigest')) {
      return 'missing_presented_digest';
    }
    if (!isOtpVerifierDigest(command.presentedDigest)) {
      return 'invalid_presented_digest';
    }
  }
  if (command.type === 'cancel_otp') {
    if (!Object.prototype.hasOwnProperty.call(command, 'reason')) {
      return 'missing_cancel_reason';
    }
    if (!isOtpCancelReason(command.reason)) {
      return 'invalid_cancel_reason';
    }
  }
  return undefined;
}

function immutableIdentityKey(
  identityKey: ExternalIdentityKey,
): ExternalIdentityKey & { readonly provider: 'phone' } {
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
    provider: 'phone' as const,
    namespace: identityKey.namespace,
    lookup,
  });
}

function immutableVerification(
  value: OtpVerificationMetadata,
): OtpVerificationMetadata {
  return Object.freeze({
    verifiedAt: value.verifiedAt,
    commandId: value.commandId,
  });
}

function immutableExpiration(
  value: OtpExpirationMetadata,
): OtpExpirationMetadata {
  return Object.freeze({
    expiredAt: value.expiredAt,
    commandId: value.commandId,
  });
}

function immutableExhaustion(
  value: OtpAttemptsExhaustedMetadata,
): OtpAttemptsExhaustedMetadata {
  return Object.freeze({
    exhaustedAt: value.exhaustedAt,
    commandId: value.commandId,
  });
}

function immutableCancellation(
  value: OtpCancellationMetadata,
): OtpCancellationMetadata {
  return Object.freeze({
    reason: value.reason,
    cancelledAt: value.cancelledAt,
    commandId: value.commandId,
  });
}

function immutableAppliedResult(result: OtpAppliedResult): OtpAppliedResult {
  switch (result.type) {
    case 'otp_verified':
      return Object.freeze({
        type: result.type,
        verification: immutableVerification(result.verification),
      });
    case 'incorrect_code':
      return Object.freeze({
        type: result.type,
        attemptsRemaining: result.attemptsRemaining,
      });
    case 'otp_attempts_exhausted':
      return Object.freeze({
        type: result.type,
        exhaustion: immutableExhaustion(result.exhaustion),
      });
    case 'otp_expired':
      return Object.freeze({
        type: result.type,
        expiration: immutableExpiration(result.expiration),
      });
    case 'otp_cancelled':
      return Object.freeze({
        type: result.type,
        cancellation: immutableCancellation(result.cancellation),
      });
  }
}

function immutableAppliedCommand(command: AppliedOtpCommand): AppliedOtpCommand {
  const base = {
    challengeId: command.challengeId,
    commandId: command.commandId,
    requestDigest: command.requestDigest,
    appliedAt: command.appliedAt,
    result: immutableAppliedResult(command.result),
  };
  switch (command.commandType) {
    case 'submit_otp':
      return Object.freeze({
        ...base,
        commandType: command.commandType,
        presentedDigest: command.presentedDigest,
      });
    case 'expire_otp':
      return Object.freeze({ ...base, commandType: command.commandType });
    case 'cancel_otp':
      return Object.freeze({
        ...base,
        commandType: command.commandType,
        reason: command.reason,
      });
  }
}

function immutableStateBinding(
  state: OtpChallengeState,
  attemptsRemaining: number = state.attemptsRemaining,
  appliedCommands: readonly AppliedOtpCommand[] = state.appliedCommands,
): OtpChallengeStateBinding {
  return {
    challengeId: state.challengeId,
    intent: state.intent,
    identityKey: immutableIdentityKey(state.identityKey),
    operationId: state.operationId,
    requestDigest: state.requestDigest,
    verifierDigest: state.verifierDigest,
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    maxAttempts: state.maxAttempts,
    attemptsRemaining,
    appliedCommands: Object.freeze(appliedCommands.map(immutableAppliedCommand)),
  };
}

function digestsEqual(left: unknown, right: unknown): boolean {
  if (!isOtpVerifierDigest(left) || !isOtpVerifierDigest(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isExactAppliedCommand(
  applied: AppliedOtpCommand,
  command: OtpCommand,
): boolean {
  if (
    applied.challengeId !== command.challengeId ||
    applied.commandId !== command.commandId ||
    applied.commandType !== command.type ||
    applied.requestDigest !== command.requestDigest
  ) {
    return false;
  }
  if (applied.commandType === 'submit_otp' && command.type === 'submit_otp') {
    return applied.presentedDigest === command.presentedDigest;
  }
  if (applied.commandType === 'cancel_otp' && command.type === 'cancel_otp') {
    return applied.reason === command.reason;
  }
  return applied.commandType === 'expire_otp' && command.type === 'expire_otp';
}

function appliedCommandFor(
  command: OtpCommand,
  result: OtpAppliedResult,
): AppliedOtpCommand {
  const base = {
    challengeId: command.challengeId,
    commandId: command.commandId,
    requestDigest: command.requestDigest,
    appliedAt: command.now,
    result: immutableAppliedResult(result),
  };
  switch (command.type) {
    case 'submit_otp':
      return Object.freeze({
        ...base,
        commandType: command.type,
        presentedDigest: command.presentedDigest,
      }) as AppliedSubmitOtpCommand;
    case 'expire_otp':
      return Object.freeze({
        ...base,
        commandType: command.type,
      }) as AppliedExpireOtpCommand;
    case 'cancel_otp':
      return Object.freeze({
        ...base,
        commandType: command.type,
        reason: command.reason,
      }) as AppliedCancelOtpCommand;
  }
}

function storedResult(state: OtpChallengeState): OtpAppliedResult {
  return state.appliedCommands[state.appliedCommands.length - 1].result;
}

export function createOtpChallenge(
  binding: CreateOtpChallengeBinding,
): CreateOtpChallengeResult {
  const challengeReason = challengeRejectionReason(binding);
  if (challengeReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_otp_challenge',
      challengeReason,
    };
  }

  const state: PendingOtpChallenge = Object.freeze({
    challengeId: binding.challengeId,
    intent: binding.intent,
    identityKey: immutableIdentityKey(binding.identityKey),
    operationId: binding.operationId,
    requestDigest: binding.requestDigest,
    verifierDigest: binding.verifierDigest,
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt,
    maxAttempts: binding.maxAttempts,
    attemptsRemaining: binding.maxAttempts,
    appliedCommands: Object.freeze([]),
    status: 'pending',
  });
  return { outcome: 'created', state };
}

function applySubmit(
  state: PendingOtpChallenge,
  command: SubmitOtpCommand,
): OtpTransitionResult {
  if (digestsEqual(state.verifierDigest, command.presentedDigest)) {
    const verification = immutableVerification({
      verifiedAt: command.now,
      commandId: command.commandId,
    });
    const result = immutableAppliedResult({
      type: 'otp_verified',
      verification,
    });
    const applied = appliedCommandFor(command, result);
    const verified: VerifiedOtpChallenge = Object.freeze({
      ...immutableStateBinding(state, state.attemptsRemaining, [
        ...state.appliedCommands,
        applied,
      ]),
      status: 'verified',
      verification,
    });
    return {
      outcome: 'transitioned',
      transition: 'otp_verified',
      state: verified,
      result: storedResult(verified),
    };
  }

  const attemptsRemaining = state.attemptsRemaining - 1;
  if (attemptsRemaining === 0) {
    const exhaustion = immutableExhaustion({
      exhaustedAt: command.now,
      commandId: command.commandId,
    });
    const result = immutableAppliedResult({
      type: 'otp_attempts_exhausted',
      exhaustion,
    });
    const applied = appliedCommandFor(command, result);
    const exhausted: AttemptsExhaustedOtpChallenge = Object.freeze({
      ...immutableStateBinding(state, 0, [...state.appliedCommands, applied]),
      status: 'attempts_exhausted',
      exhaustion,
    });
    return {
      outcome: 'transitioned',
      transition: 'otp_attempts_exhausted',
      state: exhausted,
      result: storedResult(exhausted),
    };
  }

  const result = immutableAppliedResult({
    type: 'incorrect_code',
    attemptsRemaining,
  });
  const applied = appliedCommandFor(command, result);
  const pending: PendingOtpChallenge = Object.freeze({
    ...immutableStateBinding(state, attemptsRemaining, [
      ...state.appliedCommands,
      applied,
    ]),
    status: 'pending',
  });
  return {
    outcome: 'transitioned',
    transition: 'incorrect_code',
    state: pending,
    result: storedResult(pending),
  };
}

function applyExpire(
  state: PendingOtpChallenge,
  command: ExpireOtpCommand,
): OtpTransitionResult {
  const expiration = immutableExpiration({
    expiredAt: command.now,
    commandId: command.commandId,
  });
  const result = immutableAppliedResult({ type: 'otp_expired', expiration });
  const applied = appliedCommandFor(command, result);
  const expired: ExpiredOtpChallenge = Object.freeze({
    ...immutableStateBinding(state, state.attemptsRemaining, [
      ...state.appliedCommands,
      applied,
    ]),
    status: 'expired',
    expiration,
  });
  return {
    outcome: 'transitioned',
    transition: 'otp_expired',
    state: expired,
    result: storedResult(expired),
  };
}

function applyCancel(
  state: PendingOtpChallenge,
  command: CancelOtpCommand,
): OtpTransitionResult {
  const cancellation = immutableCancellation({
    reason: command.reason,
    cancelledAt: command.now,
    commandId: command.commandId,
  });
  const result = immutableAppliedResult({
    type: 'otp_cancelled',
    cancellation,
  });
  const applied = appliedCommandFor(command, result);
  const cancelled: CancelledOtpChallenge = Object.freeze({
    ...immutableStateBinding(state, state.attemptsRemaining, [
      ...state.appliedCommands,
      applied,
    ]),
    status: 'cancelled',
    cancellation,
  });
  return {
    outcome: 'transitioned',
    transition: 'otp_cancelled',
    state: cancelled,
    result: storedResult(cancelled),
  };
}

export function transitionOtpChallenge(
  state: OtpChallengeState,
  command: OtpCommand,
): OtpTransitionResult {
  if (!isOtpChallengeState(state)) {
    return { outcome: 'rejected', reason: 'invalid_otp_state', state };
  }
  const commandReason = commandRejectionReason(command);
  if (commandReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_otp_command',
      commandReason,
      state,
    };
  }
  if (state.challengeId !== command.challengeId) {
    return { outcome: 'rejected', reason: 'otp_binding_conflict', state };
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

  if (state.status !== 'pending') {
    return { outcome: 'rejected', reason: 'forbidden_transition', state };
  }

  if (command.type === 'expire_otp') {
    if (command.now < state.expiresAt) {
      return { outcome: 'rejected', reason: 'not_yet_expired', state };
    }
    return applyExpire(state, command);
  }

  if (command.now >= state.expiresAt) {
    return { outcome: 'rejected', reason: 'otp_expired', state };
  }

  if (command.type === 'cancel_otp') {
    return applyCancel(state, command);
  }
  return applySubmit(state, command);
}
