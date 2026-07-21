import {
  AuthenticationIdempotencyKey,
  AuthenticationIntent,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationRequestDigest,
  TelegramProofVerificationOutcome,
  UnixEpochSeconds,
  isUnixEpochSeconds,
} from './auth.types';

export interface TelegramProofConsumptionRecord {
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
    };

export const EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE: TelegramProofConsumptionState =
  Object.freeze({
    consumptions: Object.freeze([]),
  });

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
