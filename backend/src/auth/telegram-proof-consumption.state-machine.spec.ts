import {
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  AuthenticationIdempotencyKey,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationRequestDigest,
  TelegramProofVerificationOutcome,
  UnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';
import {
  ConsumeTelegramProofCommand,
  EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
  TelegramProofConsumptionState,
  consumeTelegramProof,
} from './telegram-proof-consumption.state-machine';

const AUTH_DATE = unixEpochSeconds(1_784_635_200);
const EXPIRES_AT = unixEpochSeconds(AUTH_DATE + 300);
const BEFORE_EXPIRY = unixEpochSeconds(EXPIRES_AT - 1);
const AT_EXPIRY = EXPIRES_AT;
const AFTER_EXPIRY = unixEpochSeconds(EXPIRES_AT + 1);

function fingerprint(value: string): AuthenticationProofFingerprint {
  return value as AuthenticationProofFingerprint;
}

function idempotencyKey(value: string): AuthenticationIdempotencyKey {
  return value as AuthenticationIdempotencyKey;
}

function requestDigest(value: string): AuthenticationRequestDigest {
  return value as AuthenticationRequestDigest;
}

function operationId(value: string): AuthenticationOperationId {
  return value as AuthenticationOperationId;
}

function verifiedProof(
  proofFingerprint = fingerprint('proof-a'),
): TelegramProofVerificationOutcome {
  const namespace = externalIdentityNamespace('telegram:bot:123');
  const subject =
    trustProviderCanonicalizedExternalIdentitySubject('123456789');

  return {
    status: 'verified',
    proof: {
      provider: 'telegram',
      namespace,
      identityKey: {
        provider: 'telegram',
        namespace,
        lookup: { kind: 'canonical_subject', subject },
      },
      authDate: AUTH_DATE,
      verifiedAt: AUTH_DATE,
      expiresAt: EXPIRES_AT,
      proofFingerprint,
    },
  };
}

function expiredProof(
  proofFingerprint = fingerprint('proof-a'),
): TelegramProofVerificationOutcome {
  return {
    status: 'expired',
    reason: 'expired_proof',
    proofFingerprint,
    expiresAt: EXPIRES_AT,
  };
}

function command(
  overrides: Partial<ConsumeTelegramProofCommand> = {},
): ConsumeTelegramProofCommand {
  return {
    proof: verifiedProof(),
    intent: 'sign_in',
    idempotencyKey: idempotencyKey('idempotency-a'),
    requestDigest: requestDigest('request-a'),
    operationId: operationId('operation-a'),
    now: BEFORE_EXPIRY,
    ...overrides,
  };
}

function unsafeEpochSeconds(value: number): UnixEpochSeconds {
  return value as UnixEpochSeconds;
}

function firstUse(): {
  readonly state: TelegramProofConsumptionState;
  readonly command: ConsumeTelegramProofCommand;
} {
  const firstCommand = command();
  const result = consumeTelegramProof(
    EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
    firstCommand,
  );

  if (result.outcome !== 'first_use') {
    throw new Error('Expected first use');
  }

  return { state: result.state, command: firstCommand };
}

describe('Telegram proof consumption state machine', () => {
  it('records the first use of a verified proof', () => {
    const result = consumeTelegramProof(
      EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      command(),
    );

    expect(result.outcome).toBe('first_use');
    expect(result.state.consumptions).toHaveLength(1);
    expect(EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE.consumptions).toHaveLength(
      0,
    );
  });

  it('returns the stored consumption for an exact idempotent retry', () => {
    const first = firstUse();
    const result = consumeTelegramProof(first.state, first.command);

    expect(result.outcome).toBe('idempotent_retry');
    expect(result.state).toBe(first.state);
    if (result.outcome === 'idempotent_retry') {
      expect(result.consumption).toBe(first.state.consumptions[0]);
    }
  });

  it('recognizes an exact retry before checking the current proof TTL', () => {
    const first = firstUse();
    const result = consumeTelegramProof(
      first.state,
      command({ proof: expiredProof(), now: AFTER_EXPIRY }),
    );

    expect(result.outcome).toBe('idempotent_retry');
    expect(result.state).toBe(first.state);
  });

  it('rejects the same proof under only another idempotency key as replay', () => {
    const first = firstUse();
    const result = consumeTelegramProof(
      first.state,
      command({
        idempotencyKey: idempotencyKey('idempotency-b'),
      }),
    );

    expect(result).toMatchObject({
      outcome: 'replay',
      reason: 'proof_already_consumed',
      state: first.state,
    });
  });

  it('rejects the same proof for another operation as replay', () => {
    const first = firstUse();
    const result = consumeTelegramProof(
      first.state,
      command({
        idempotencyKey: idempotencyKey('idempotency-b'),
        operationId: operationId('operation-b'),
      }),
    );

    expect(result).toMatchObject({
      outcome: 'replay',
      reason: 'proof_already_consumed',
      state: first.state,
    });
  });

  it('rejects reuse of an idempotency key with another request digest', () => {
    const first = firstUse();
    const result = consumeTelegramProof(
      first.state,
      command({ requestDigest: requestDigest('request-b') }),
    );

    expect(result).toMatchObject({
      outcome: 'conflicting_reuse',
      reason: 'idempotency_key_conflict',
      state: first.state,
    });
  });

  it('rejects reuse of an idempotency key with another proof', () => {
    const first = firstUse();
    const result = consumeTelegramProof(
      first.state,
      command({ proof: verifiedProof(fingerprint('proof-b')) }),
    );

    expect(result).toMatchObject({
      outcome: 'conflicting_reuse',
      reason: 'idempotency_key_conflict',
      state: first.state,
    });
  });

  it('rejects reuse of an idempotency key with another intent', () => {
    const first = firstUse();
    const result = consumeTelegramProof(
      first.state,
      command({ intent: 'link_identity' }),
    );

    expect(result).toMatchObject({
      outcome: 'conflicting_reuse',
      reason: 'idempotency_key_conflict',
      state: first.state,
    });
  });

  it('rejects reuse of an idempotency key with another operation', () => {
    const first = firstUse();
    const result = consumeTelegramProof(
      first.state,
      command({ operationId: operationId('operation-b') }),
    );

    expect(result).toMatchObject({
      outcome: 'conflicting_reuse',
      reason: 'idempotency_key_conflict',
      state: first.state,
    });
  });

  it('prefers idempotency conflict when proof and key belong to different records', () => {
    const first = firstUse();
    const secondResult = consumeTelegramProof(
      first.state,
      command({
        proof: verifiedProof(fingerprint('proof-b')),
        idempotencyKey: idempotencyKey('idempotency-b'),
        requestDigest: requestDigest('request-b'),
        operationId: operationId('operation-b'),
      }),
    );
    if (secondResult.outcome !== 'first_use') {
      throw new Error('Expected second first use');
    }

    const result = consumeTelegramProof(
      secondResult.state,
      command({
        idempotencyKey: idempotencyKey('idempotency-b'),
        requestDigest: requestDigest('request-b'),
        operationId: operationId('operation-b'),
      }),
    );

    expect(result).toMatchObject({
      outcome: 'conflicting_reuse',
      reason: 'idempotency_key_conflict',
      state: secondResult.state,
    });
  });

  it('allows a new first use one second before expiry', () => {
    const result = consumeTelegramProof(
      EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      command({ now: BEFORE_EXPIRY }),
    );

    expect(result.outcome).toBe('first_use');
  });

  it('rejects a new first use exactly at expiresAt', () => {
    const result = consumeTelegramProof(
      EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      command({ now: AT_EXPIRY }),
    );

    expect(result).toMatchObject({
      outcome: 'expired',
      reason: 'proof_expired',
      state: EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
    });
  });

  it('rejects a new first use after proof expiry', () => {
    const result = consumeTelegramProof(
      EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      command({ now: AFTER_EXPIRY }),
    );

    expect(result).toMatchObject({
      outcome: 'expired',
      reason: 'proof_expired',
      state: EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
    });
  });

  it('rejects an internally classified expired proof', () => {
    const result = consumeTelegramProof(
      EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      command({ proof: expiredProof(), now: AFTER_EXPIRY }),
    );

    expect(result.outcome).toBe('expired');
    expect(result.state).toBe(EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE);
  });

  it('rejects an invalid proof without throwing', () => {
    const result = consumeTelegramProof(
      EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      command({
        proof: { status: 'invalid', reason: 'invalid_proof' },
      }),
    );

    expect(result).toMatchObject({
      outcome: 'invalid',
      reason: 'invalid_proof',
      state: EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
    });
  });

  it('rejects an invalid proof even with a known idempotency key', () => {
    const first = firstUse();
    const result = consumeTelegramProof(
      first.state,
      command({ proof: { status: 'invalid', reason: 'invalid_proof' } }),
    );

    expect(result).toMatchObject({
      outcome: 'invalid',
      reason: 'invalid_proof',
      state: first.state,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects invalid epoch-second current time %s',
    (now) => {
      const result = consumeTelegramProof(
        EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
        command({ now: unsafeEpochSeconds(now) }),
      );

      expect(result).toMatchObject({
        outcome: 'invalid',
        reason: 'invalid_time',
        state: EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      });
    },
  );

  it('does not mutate the input state', () => {
    const initialState: TelegramProofConsumptionState = {
      consumptions: [],
    };
    const snapshot = [...initialState.consumptions];

    const result = consumeTelegramProof(initialState, command());

    expect(initialState.consumptions).toEqual(snapshot);
    expect(result.state).not.toBe(initialState);
  });

  it('stores immutable primitive epoch-second timestamps', () => {
    const result = consumeTelegramProof(
      EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      command(),
    );
    if (result.outcome !== 'first_use') {
      throw new Error('Expected first use');
    }

    expect(result.consumption.consumedAt).toBe(BEFORE_EXPIRY);
    expect(result.consumption.proofExpiresAt).toBe(EXPIRES_AT);
    expect(result.consumption.consumedAt).not.toBeInstanceOf(Date);
    expect(Object.isFrozen(result.consumption)).toBe(true);
    expect(Object.isFrozen(result.state.consumptions)).toBe(true);
  });

  it('does not change saved state when a rejected command is repeated', () => {
    const first = firstUse();
    const savedSnapshot = first.state.consumptions.map((consumption) => ({
      ...consumption,
    }));
    const rejectedCommand = command({
      intent: 'link_identity',
      operationId: operationId('operation-b'),
    });
    const firstRejection = consumeTelegramProof(
      first.state,
      rejectedCommand,
    );
    const secondRejection = consumeTelegramProof(
      first.state,
      rejectedCommand,
    );

    expect(firstRejection.outcome).toBe('conflicting_reuse');
    expect(secondRejection.outcome).toBe('conflicting_reuse');
    expect(firstRejection.state).toBe(first.state);
    expect(secondRejection.state).toBe(first.state);
    expect(firstRejection.state.consumptions).toBe(
      first.state.consumptions,
    );
    expect(first.state.consumptions).toEqual(savedSnapshot);
  });
});
