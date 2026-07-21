import {
  AuthenticationIdempotencyKey,
  AuthenticationIntent,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationRequestDigest,
  TelegramProofVerificationOutcome,
  UnixEpochSeconds,
  isAuthenticationIdempotencyKey,
  isAuthenticationIntent,
  isAuthenticationOperationId,
  isAuthenticationProofFingerprint,
  isAuthenticationRequestDigest,
  isUnixEpochSeconds,
} from './auth.types';
import { isValidExternalIdentityKey } from './account-resolution.types';

export interface TelegramProofConsumptionRecord {
  readonly outcome: 'first_use';
  readonly proofFingerprint: AuthenticationProofFingerprint;
  readonly proofExpiresAt: UnixEpochSeconds;
  readonly intent: AuthenticationIntent;
  readonly idempotencyKey: AuthenticationIdempotencyKey;
  readonly requestDigest: AuthenticationRequestDigest;
  readonly operationId: AuthenticationOperationId;
  readonly consumedAt: UnixEpochSeconds;
}

/**
 * A future persistence adapter must atomically enforce uniqueness for both
 * proofFingerprint and idempotencyKey. This in-memory value only defines the
 * domain transition and does not provide cross-process concurrency control.
 */
export interface TelegramProofConsumptionState {
  readonly consumptions: readonly TelegramProofConsumptionRecord[];
}

export interface ConsumeTelegramProofCommand {
  readonly proof: TelegramProofVerificationOutcome;
  readonly intent: AuthenticationIntent;
  readonly idempotencyKey: AuthenticationIdempotencyKey;
  readonly requestDigest: AuthenticationRequestDigest;
  readonly operationId: AuthenticationOperationId;
  readonly now: UnixEpochSeconds;
}

export type TelegramProofConsumptionResult =
  | {
      readonly outcome: 'first_use';
      readonly state: TelegramProofConsumptionState;
      readonly consumption: TelegramProofConsumptionRecord;
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly state: TelegramProofConsumptionState;
      readonly consumption: TelegramProofConsumptionRecord;
    }
  | {
      readonly outcome: 'replay';
      readonly reason: 'proof_already_consumed';
      readonly state: TelegramProofConsumptionState;
    }
  | {
      readonly outcome: 'conflicting_reuse';
      readonly reason: 'idempotency_key_conflict';
      readonly state: TelegramProofConsumptionState;
    }
  | {
      readonly outcome: 'expired';
      readonly reason: 'proof_expired';
      readonly state: TelegramProofConsumptionState;
    }
  | {
      readonly outcome: 'invalid';
      readonly reason: 'invalid_proof' | 'invalid_time';
      readonly state: TelegramProofConsumptionState;
    }
  | {
      readonly outcome: 'invalid_proof_consumption_state';
      readonly reason:
        | 'invalid_state_shape'
        | 'invalid_consumption_record'
        | 'duplicate_proof_fingerprint'
        | 'duplicate_idempotency_key';
      readonly state: TelegramProofConsumptionState;
    }
  | {
      readonly outcome: 'invalid_proof_consumption_command';
      readonly reason:
        | 'invalid_command_shape'
        | 'invalid_proof'
        | 'invalid_intent'
        | 'invalid_idempotency_key'
        | 'invalid_request_digest'
        | 'invalid_operation_id'
        | 'invalid_time';
      readonly state: TelegramProofConsumptionState;
    };

export const EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE: TelegramProofConsumptionState =
  Object.freeze({
    consumptions: Object.freeze([]),
  });

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

function proofConsumptionStateRejectionReason(
  state: unknown,
):
  | 'invalid_state_shape'
  | 'invalid_consumption_record'
  | 'duplicate_proof_fingerprint'
  | 'duplicate_idempotency_key'
  | undefined {
  if (
    !isRecord(state) ||
    !hasExactlyKeys(state, ['consumptions']) ||
    !Array.isArray(state.consumptions)
  ) {
    return 'invalid_state_shape';
  }

  const fingerprints = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const consumption of state.consumptions) {
    if (
      !isRecord(consumption) ||
      !hasExactlyKeys(consumption, [
        'outcome',
        'proofFingerprint',
        'proofExpiresAt',
        'intent',
        'idempotencyKey',
        'requestDigest',
        'operationId',
        'consumedAt',
      ]) ||
      consumption.outcome !== 'first_use' ||
      !isAuthenticationProofFingerprint(consumption.proofFingerprint) ||
      !isUnixEpochSeconds(consumption.proofExpiresAt) ||
      !isAuthenticationIntent(consumption.intent) ||
      !isAuthenticationIdempotencyKey(consumption.idempotencyKey) ||
      !isAuthenticationRequestDigest(consumption.requestDigest) ||
      !isAuthenticationOperationId(consumption.operationId) ||
      !isUnixEpochSeconds(consumption.consumedAt) ||
      consumption.consumedAt >= consumption.proofExpiresAt
    ) {
      return 'invalid_consumption_record';
    }

    if (fingerprints.has(consumption.proofFingerprint)) {
      return 'duplicate_proof_fingerprint';
    }
    if (idempotencyKeys.has(consumption.idempotencyKey)) {
      return 'duplicate_idempotency_key';
    }
    fingerprints.add(consumption.proofFingerprint);
    idempotencyKeys.add(consumption.idempotencyKey);
  }

  return undefined;
}

function isTelegramProofVerificationOutcome(
  value: unknown,
): value is TelegramProofVerificationOutcome {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status === 'invalid') {
    return (
      hasExactlyKeys(value, ['status', 'reason']) &&
      value.reason === 'invalid_proof'
    );
  }

  if (value.status === 'expired') {
    return (
      hasExactlyKeys(value, [
        'status',
        'reason',
        'proofFingerprint',
        'expiresAt',
      ]) &&
      value.reason === 'expired_proof' &&
      isAuthenticationProofFingerprint(value.proofFingerprint) &&
      isUnixEpochSeconds(value.expiresAt)
    );
  }

  if (
    value.status !== 'verified' ||
    !hasExactlyKeys(value, ['status', 'proof']) ||
    !isRecord(value.proof) ||
    !hasExactlyKeys(value.proof, [
      'provider',
      'namespace',
      'identityKey',
      'authDate',
      'verifiedAt',
      'expiresAt',
      'proofFingerprint',
    ]) ||
    value.proof.provider !== 'telegram' ||
    !isValidExternalIdentityKey(value.proof.identityKey) ||
    value.proof.identityKey.provider !== 'telegram' ||
    value.proof.namespace !== value.proof.identityKey.namespace ||
    !isUnixEpochSeconds(value.proof.authDate) ||
    !isUnixEpochSeconds(value.proof.verifiedAt) ||
    !isUnixEpochSeconds(value.proof.expiresAt) ||
    value.proof.authDate >= value.proof.expiresAt ||
    value.proof.verifiedAt >= value.proof.expiresAt ||
    !isAuthenticationProofFingerprint(value.proof.proofFingerprint)
  ) {
    return false;
  }

  return true;
}

function proofConsumptionCommandRejectionReason(
  command: unknown,
):
  | 'invalid_command_shape'
  | 'invalid_proof'
  | 'invalid_intent'
  | 'invalid_idempotency_key'
  | 'invalid_request_digest'
  | 'invalid_operation_id'
  | 'invalid_time'
  | undefined {
  if (
    !isRecord(command) ||
    !hasExactlyKeys(command, [
      'proof',
      'intent',
      'idempotencyKey',
      'requestDigest',
      'operationId',
      'now',
    ])
  ) {
    return 'invalid_command_shape';
  }
  if (!isTelegramProofVerificationOutcome(command.proof)) {
    return 'invalid_proof';
  }
  if (!isAuthenticationIntent(command.intent)) {
    return 'invalid_intent';
  }
  if (!isAuthenticationIdempotencyKey(command.idempotencyKey)) {
    return 'invalid_idempotency_key';
  }
  if (!isAuthenticationRequestDigest(command.requestDigest)) {
    return 'invalid_request_digest';
  }
  if (!isAuthenticationOperationId(command.operationId)) {
    return 'invalid_operation_id';
  }
  if (!isUnixEpochSeconds(command.now)) {
    return 'invalid_time';
  }
  return undefined;
}

function isExactRetry(
  consumption: TelegramProofConsumptionRecord,
  command: ConsumeTelegramProofCommand,
  proofFingerprint: AuthenticationProofFingerprint,
): boolean {
  return (
    consumption.proofFingerprint === proofFingerprint &&
    consumption.intent === command.intent &&
    consumption.idempotencyKey === command.idempotencyKey &&
    consumption.requestDigest === command.requestDigest &&
    consumption.operationId === command.operationId
  );
}

export function consumeTelegramProof(
  state: TelegramProofConsumptionState,
  command: ConsumeTelegramProofCommand,
): TelegramProofConsumptionResult {
  const stateReason = proofConsumptionStateRejectionReason(state);
  if (stateReason !== undefined) {
    return {
      outcome: 'invalid_proof_consumption_state',
      reason: stateReason,
      state,
    };
  }

  const commandReason = proofConsumptionCommandRejectionReason(command);
  if (commandReason !== undefined) {
    if (commandReason === 'invalid_time') {
      return {
        outcome: 'invalid',
        reason: 'invalid_time',
        state,
      };
    }
    return {
      outcome: 'invalid_proof_consumption_command',
      reason: commandReason,
      state,
    };
  }

  if (command.proof.status === 'invalid') {
    return {
      outcome: 'invalid',
      reason: 'invalid_proof',
      state,
    };
  }

  const proofFingerprint =
    command.proof.status === 'verified'
      ? command.proof.proof.proofFingerprint
      : command.proof.proofFingerprint;
  const proofExpiresAt =
    command.proof.status === 'verified'
      ? command.proof.proof.expiresAt
      : command.proof.expiresAt;

  const consumptionByIdempotencyKey = state.consumptions.find(
    (consumption) =>
      consumption.idempotencyKey === command.idempotencyKey,
  );

  if (consumptionByIdempotencyKey !== undefined) {
    if (
      isExactRetry(
        consumptionByIdempotencyKey,
        command,
        proofFingerprint,
      )
    ) {
      return {
        outcome: 'idempotent_retry',
        state,
        consumption: consumptionByIdempotencyKey,
      };
    }

    return {
      outcome: 'conflicting_reuse',
      reason: 'idempotency_key_conflict',
      state,
    };
  }

  const consumptionByProof = state.consumptions.find(
    (consumption) => consumption.proofFingerprint === proofFingerprint,
  );

  if (consumptionByProof !== undefined) {
    return {
      outcome: 'replay',
      reason: 'proof_already_consumed',
      state,
    };
  }

  if (
    !isUnixEpochSeconds(command.now) ||
    !isUnixEpochSeconds(proofExpiresAt)
  ) {
    return {
      outcome: 'invalid',
      reason: 'invalid_time',
      state,
    };
  }

  if (
    command.proof.status === 'expired' ||
    command.now >= proofExpiresAt
  ) {
    return {
      outcome: 'expired',
      reason: 'proof_expired',
      state,
    };
  }

  const consumption: TelegramProofConsumptionRecord = Object.freeze({
    outcome: 'first_use',
    proofFingerprint,
    proofExpiresAt,
    intent: command.intent,
    idempotencyKey: command.idempotencyKey,
    requestDigest: command.requestDigest,
    operationId: command.operationId,
    consumedAt: command.now,
  });
  const nextState: TelegramProofConsumptionState = Object.freeze({
    consumptions: Object.freeze([...state.consumptions, consumption]),
  });

  return {
    outcome: 'first_use',
    state: nextState,
    consumption,
  };
}
