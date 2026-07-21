import {
  ExternalIdentityKey,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  AUTHENTICATION_INTENTS,
  AuthenticationIntent,
  AuthenticationOperationId,
  UnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';
import {
  CreateOtpChallengeResult,
  OtpTransitionResult,
  createOtpChallenge,
  transitionOtpChallenge,
} from './otp.state-machine';
import {
  MAX_OTP_ATTEMPTS,
  OTP_CANCEL_REASONS,
  CancelOtpCommand,
  CreateOtpChallengeBinding,
  ExpireOtpCommand,
  OtpChallengeId,
  OtpChallengeState,
  OtpCommand,
  OtpCommandId,
  OtpRequestDigest,
  OtpVerifierDigest,
  PendingOtpChallenge,
  SubmitOtpCommand,
} from './otp.types';

const CREATED_AT = unixEpochSeconds(1_784_700_000);
const BEFORE_EXPIRY = unixEpochSeconds(1_784_700_299);
const EXPIRES_AT = unixEpochSeconds(1_784_700_300);
const AFTER_EXPIRY = unixEpochSeconds(1_784_700_301);
const CORRECT_DIGEST = 'a'.repeat(64) as OtpVerifierDigest;
const WRONG_DIGEST = 'b'.repeat(64) as OtpVerifierDigest;
const OTHER_DIGEST = 'c'.repeat(64) as OtpVerifierDigest;
const CHALLENGE_REQUEST = 'd'.repeat(64) as OtpRequestDigest;
const COMMAND_REQUEST = 'e'.repeat(64) as OtpRequestDigest;
const OTHER_REQUEST = 'f'.repeat(64) as OtpRequestDigest;

function challengeId(value = 'otp-challenge-1'): OtpChallengeId {
  return value as OtpChallengeId;
}

function commandId(value = 'otp-command-1'): OtpCommandId {
  return value as OtpCommandId;
}

function operationId(value = 'auth-operation-1'): AuthenticationOperationId {
  return value as AuthenticationOperationId;
}

function phoneIdentity(): ExternalIdentityKey {
  return {
    provider: 'phone',
    namespace: externalIdentityNamespace('phone:e164:v1'),
    lookup: {
      kind: 'canonical_subject',
      subject: trustProviderCanonicalizedExternalIdentitySubject(
        '+79990000000',
      ),
    },
  };
}

function binding(
  overrides: Partial<CreateOtpChallengeBinding> = {},
): CreateOtpChallengeBinding {
  return {
    challengeId: challengeId(),
    intent: 'fresh_authentication',
    identityKey: phoneIdentity(),
    operationId: operationId(),
    requestDigest: CHALLENGE_REQUEST,
    verifierDigest: CORRECT_DIGEST,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    maxAttempts: 3,
    ...overrides,
  };
}

function pending(
  overrides: Partial<CreateOtpChallengeBinding> = {},
): PendingOtpChallenge {
  const result = createOtpChallenge(binding(overrides));
  if (result.outcome !== 'created') {
    throw new Error(`Expected pending OTP challenge: ${result.challengeReason}`);
  }
  return result.state;
}

function submitCommand(
  state: OtpChallengeState,
  overrides: Partial<SubmitOtpCommand> = {},
): SubmitOtpCommand {
  return {
    type: 'submit_otp',
    challengeId: state.challengeId,
    commandId: commandId(),
    now: BEFORE_EXPIRY,
    requestDigest: COMMAND_REQUEST,
    presentedDigest: CORRECT_DIGEST,
    ...overrides,
  };
}

function expireCommand(
  state: OtpChallengeState,
  overrides: Partial<ExpireOtpCommand> = {},
): ExpireOtpCommand {
  return {
    type: 'expire_otp',
    challengeId: state.challengeId,
    commandId: commandId(),
    now: EXPIRES_AT,
    requestDigest: COMMAND_REQUEST,
    ...overrides,
  };
}

function cancelCommand(
  state: OtpChallengeState,
  overrides: Partial<CancelOtpCommand> = {},
): CancelOtpCommand {
  return {
    type: 'cancel_otp',
    challengeId: state.challengeId,
    commandId: commandId(),
    now: BEFORE_EXPIRY,
    requestDigest: COMMAND_REQUEST,
    reason: 'user_cancelled',
    ...overrides,
  };
}

function runtimeCommand(value: unknown): OtpCommand {
  return value as OtpCommand;
}

function transitionedState<Status extends OtpChallengeState['status']>(
  result: OtpTransitionResult,
  status: Status,
): Extract<OtpChallengeState, { status: Status }> {
  expect(result).toMatchObject({ outcome: 'transitioned', state: { status } });
  if (result.outcome !== 'transitioned' || result.state.status !== status) {
    throw new Error(`Expected transitioned OTP challenge ${status}`);
  }
  return result.state as Extract<OtpChallengeState, { status: Status }>;
}

function expectRejected(
  result: OtpTransitionResult,
  state: OtpChallengeState,
  reason: string,
): void {
  expect(result).toMatchObject({ outcome: 'rejected', reason });
  expect(result.state).toBe(state);
}

function expectInvalidOtpState(value: unknown): void {
  const state = value as OtpChallengeState;
  const snapshot = structuredClone(value);
  const appliedCommands = state.appliedCommands;
  let result: OtpTransitionResult | undefined;

  expect(() => {
    result = transitionOtpChallenge(
      state,
      submitCommand(state, {
        commandId: commandId('state-validation-command'),
        presentedDigest: WRONG_DIGEST,
      }),
    );
  }).not.toThrow();
  expect(result).toMatchObject({
    outcome: 'rejected',
    reason: 'invalid_otp_state',
  });
  expect(result?.state).toBe(state);
  expect(value).toEqual(snapshot);
  expect(state.appliedCommands).toBe(appliedCommands);
}

function verifiedChallenge(): OtpChallengeState {
  const state = pending();
  return transitionedState(
    transitionOtpChallenge(state, submitCommand(state)),
    'verified',
  );
}

function expiredChallenge(): OtpChallengeState {
  const state = pending();
  return transitionedState(
    transitionOtpChallenge(state, expireCommand(state)),
    'expired',
  );
}

function exhaustedChallenge(): OtpChallengeState {
  const state = pending({ maxAttempts: 1 });
  return transitionedState(
    transitionOtpChallenge(
      state,
      submitCommand(state, { presentedDigest: WRONG_DIGEST }),
    ),
    'attempts_exhausted',
  );
}

function cancelledChallenge(): OtpChallengeState {
  const state = pending();
  return transitionedState(
    transitionOtpChallenge(state, cancelCommand(state)),
    'cancelled',
  );
}

describe('OTP challenge creation', () => {
  it.each(AUTHENTICATION_INTENTS)(
    'creates a phone challenge for intent %s',
    (intent) => {
      const result = createOtpChallenge(binding({ intent }));
      expect(result).toMatchObject({
        outcome: 'created',
        state: {
          status: 'pending',
          intent,
          identityKey: { provider: 'phone' },
          attemptsRemaining: 3,
          maxAttempts: 3,
          appliedCommands: [],
        },
      });
    },
  );

  it('rejects a non-phone identity', () => {
    const identityKey: ExternalIdentityKey = {
      ...phoneIdentity(),
      provider: 'google',
    };
    expect(createOtpChallenge(binding({ identityKey }))).toEqual({
      outcome: 'rejected',
      reason: 'invalid_otp_challenge',
      challengeReason: 'identity_provider_not_phone',
    });
  });

  it.each(['', ' ', 'line\nbreak', 'x'.repeat(257)])(
    'rejects invalid challenge ID %#',
    (value) => {
      expect(
        createOtpChallenge(binding({ challengeId: challengeId(value) })),
      ).toMatchObject({
        outcome: 'rejected',
        reason: 'invalid_otp_challenge',
        challengeReason: 'invalid_challenge_id',
      });
    },
  );

  it('rejects an invalid identity key', () => {
    expect(
      createOtpChallenge(
        binding({ identityKey: { provider: 'phone' } as ExternalIdentityKey }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      challengeReason: 'invalid_identity_key',
    });
  });

  it('rejects an arbitrary authentication intent', () => {
    expect(
      createOtpChallenge(
        binding({ intent: 'sms_login_button' as AuthenticationIntent }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      challengeReason: 'invalid_intent',
    });
  });

  it('rejects an invalid operation binding', () => {
    expect(
      createOtpChallenge(binding({ operationId: operationId(' ') })),
    ).toMatchObject({
      outcome: 'rejected',
      challengeReason: 'invalid_operation_id',
    });
  });

  it('rejects a malformed challenge request digest', () => {
    expect(
      createOtpChallenge(
        binding({ requestDigest: 'request' as OtpRequestDigest }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      challengeReason: 'invalid_request_digest',
    });
  });

  it.each(['short', 'A'.repeat(64), 'g'.repeat(64)])(
    'rejects malformed verifier digest %#',
    (value) => {
      expect(
        createOtpChallenge(
          binding({ verifierDigest: value as OtpVerifierDigest }),
        ),
      ).toMatchObject({
        outcome: 'rejected',
        challengeReason: 'invalid_verifier_digest',
      });
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects invalid createdAt %#',
    (value) => {
      expect(
        createOtpChallenge(
          binding({ createdAt: value as UnixEpochSeconds }),
        ),
      ).toMatchObject({
        outcome: 'rejected',
        challengeReason: 'invalid_created_at',
      });
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects invalid expiresAt %#',
    (value) => {
      expect(
        createOtpChallenge(
          binding({ expiresAt: value as UnixEpochSeconds }),
        ),
      ).toMatchObject({
        outcome: 'rejected',
        challengeReason: 'invalid_expires_at',
      });
    },
  );

  it.each([CREATED_AT, unixEpochSeconds(CREATED_AT - 1)])(
    'rejects a non-positive challenge window ending at %s',
    (expiresAt) => {
      expect(createOtpChallenge(binding({ expiresAt }))).toMatchObject({
        outcome: 'rejected',
        challengeReason: 'invalid_challenge_window',
      });
    },
  );

  it.each([0, -1, 1.5, MAX_OTP_ATTEMPTS + 1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid max attempts %#',
    (maxAttempts) => {
      expect(createOtpChallenge(binding({ maxAttempts }))).toMatchObject({
        outcome: 'rejected',
        challengeReason: 'invalid_max_attempts',
      });
    },
  );

  it('projects only declared challenge fields', () => {
    const result = createOtpChallenge({
      ...binding(),
      attemptsRemaining: 99,
      rawCode: '123456',
      phoneNumber: '+79990000000',
      smsProviderResponse: { id: 'message-1' },
      token: 'token',
      cookie: 'cookie',
      telegramInitData: 'init-data',
      ip: '192.0.2.1',
      userAgent: 'agent',
      httpError: 'http',
      sqlError: 'sql',
      debugMessage: 'debug',
    } as CreateOtpChallengeBinding);
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    expect(result.state.attemptsRemaining).toBe(3);
    for (const field of [
      'rawCode',
      'phoneNumber',
      'smsProviderResponse',
      'token',
      'cookie',
      'telegramInitData',
      'ip',
      'userAgent',
      'httpError',
      'sqlError',
      'debugMessage',
    ]) {
      expect(result.state).not.toHaveProperty(field);
    }
  });
});

describe('OTP submit and attempts', () => {
  it('verifies the correct digest on the first attempt', () => {
    const state = pending();
    const verified = transitionedState(
      transitionOtpChallenge(state, submitCommand(state)),
      'verified',
    );
    expect(verified.attemptsRemaining).toBe(3);
    expect(verified.verification).toEqual({
      verifiedAt: BEFORE_EXPIRY,
      commandId: 'otp-command-1',
    });
    expect(state.status).toBe('pending');
  });

  it('verifies on the final available attempt instead of exhausting', () => {
    let state: OtpChallengeState = pending({ maxAttempts: 3 });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      state = transitionedState(
        transitionOtpChallenge(
          state,
          submitCommand(state, {
            commandId: commandId(`wrong-${attempt}`),
            presentedDigest: WRONG_DIGEST,
          }),
        ),
        'pending',
      );
    }
    const verified = transitionedState(
      transitionOtpChallenge(
        state,
        submitCommand(state, { commandId: commandId('correct-final') }),
      ),
      'verified',
    );
    expect(verified.attemptsRemaining).toBe(1);
  });

  it('keeps verified metadata free of raw code and digests', () => {
    const state = verifiedChallenge();
    expect(state).toMatchObject({ verification: { commandId: 'otp-command-1' } });
    expect((state as Extract<OtpChallengeState, { status: 'verified' }>).verification)
      .not.toHaveProperty('presentedDigest');
    expect((state as Extract<OtpChallengeState, { status: 'verified' }>).verification)
      .not.toHaveProperty('verifierDigest');
    expect((state as Extract<OtpChallengeState, { status: 'verified' }>).verification)
      .not.toHaveProperty('rawCode');
  });

  it('decrements an incorrect attempt exactly once', () => {
    const state = pending();
    const result = transitionOtpChallenge(
      state,
      submitCommand(state, { presentedDigest: WRONG_DIGEST }),
    );
    const next = transitionedState(result, 'pending');
    expect(result).toMatchObject({
      transition: 'incorrect_code',
      result: { type: 'incorrect_code', attemptsRemaining: 2 },
    });
    expect(next.attemptsRemaining).toBe(2);
    expect(next.appliedCommands).toHaveLength(1);
  });

  it('supports several sequential incorrect attempts', () => {
    const initial = pending({ maxAttempts: 4 });
    const second = transitionedState(
      transitionOtpChallenge(
        initial,
        submitCommand(initial, {
          commandId: commandId('wrong-1'),
          presentedDigest: WRONG_DIGEST,
        }),
      ),
      'pending',
    );
    const third = transitionedState(
      transitionOtpChallenge(
        second,
        submitCommand(second, {
          commandId: commandId('wrong-2'),
          presentedDigest: OTHER_DIGEST,
        }),
      ),
      'pending',
    );
    expect(third.attemptsRemaining).toBe(2);
    expect(third.appliedCommands).toHaveLength(2);
  });

  it('moves the last incorrect attempt to attempts_exhausted', () => {
    const state = pending({ maxAttempts: 1 });
    const exhausted = transitionedState(
      transitionOtpChallenge(
        state,
        submitCommand(state, { presentedDigest: WRONG_DIGEST }),
      ),
      'attempts_exhausted',
    );
    expect(exhausted.attemptsRemaining).toBe(0);
    expect(exhausted.exhaustion).toEqual({
      exhaustedAt: BEFORE_EXPIRY,
      commandId: 'otp-command-1',
    });
    expect(exhausted.exhaustion).not.toHaveProperty('presentedDigest');
  });

  it('treats the same wrong digest under another command ID as a new attempt', () => {
    const first = pending();
    const second = transitionedState(
      transitionOtpChallenge(
        first,
        submitCommand(first, { presentedDigest: WRONG_DIGEST }),
      ),
      'pending',
    );
    const third = transitionedState(
      transitionOtpChallenge(
        second,
        submitCommand(second, {
          commandId: commandId('otp-command-2'),
          presentedDigest: WRONG_DIGEST,
        }),
      ),
      'pending',
    );
    expect(third.attemptsRemaining).toBe(1);
  });
});

describe('OTP idempotency', () => {
  it('does not decrement attempts for an exact retry of an incorrect code', () => {
    const initial = pending();
    const command = submitCommand(initial, { presentedDigest: WRONG_DIGEST });
    const first = transitionOtpChallenge(initial, command);
    const state = transitionedState(first, 'pending');
    const retry = transitionOtpChallenge(
      state,
      { ...command, now: AFTER_EXPIRY },
    );
    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      state: { attemptsRemaining: 2 },
      originalResult: { type: 'incorrect_code', attemptsRemaining: 2 },
    });
    expect(retry.state).toBe(state);
    expect(state.appliedCommands[0].appliedAt).toBe(BEFORE_EXPIRY);
  });

  it.each([
    ['presented digest', { presentedDigest: OTHER_DIGEST }],
    ['request digest', { requestDigest: OTHER_REQUEST }],
  ] as const)(
    'rejects reuse of a submit command ID with changed %s',
    (_field, change) => {
      const initial = pending();
      const command = submitCommand(initial, { presentedDigest: WRONG_DIGEST });
      const state = transitionedState(
        transitionOtpChallenge(initial, command),
        'pending',
      );
      const result = transitionOtpChallenge(state, { ...command, ...change });
      expectRejected(result, state, 'command_reuse_conflict');
    },
  );

  it('rejects a different command type under an applied command ID', () => {
    const initial = pending();
    const command = submitCommand(initial, { presentedDigest: WRONG_DIGEST });
    const state = transitionedState(
      transitionOtpChallenge(initial, command),
      'pending',
    );
    expectRejected(
      transitionOtpChallenge(
        state,
        expireCommand(state, { commandId: command.commandId }),
      ),
      state,
      'command_reuse_conflict',
    );
  });

  it('returns an exact verified retry after challenge expiry', () => {
    const initial = pending();
    const command = submitCommand(initial);
    const state = transitionedState(
      transitionOtpChallenge(initial, command),
      'verified',
    );
    const retry = transitionOtpChallenge(state, { ...command, now: AFTER_EXPIRY });
    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: { type: 'otp_verified' },
    });
    expect(retry.state).toBe(state);
    expect(state.appliedCommands[0].appliedAt).toBe(BEFORE_EXPIRY);
  });

  it('returns an exact retry of the command that exhausted attempts', () => {
    const initial = pending({ maxAttempts: 1 });
    const command = submitCommand(initial, {
      presentedDigest: WRONG_DIGEST,
    });
    const state = transitionedState(
      transitionOtpChallenge(initial, command),
      'attempts_exhausted',
    );
    const retry = transitionOtpChallenge(state, {
      ...command,
      now: AFTER_EXPIRY,
    });

    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: { type: 'otp_attempts_exhausted' },
    });
    expect(retry.state).toBe(state);
    expect(state.attemptsRemaining).toBe(0);
    expect(state.appliedCommands).toHaveLength(1);
    expect(state.appliedCommands[0].appliedAt).toBe(BEFORE_EXPIRY);
  });

  it('allows the same command ID in two different challenges', () => {
    const first = pending();
    const second = pending({ challengeId: challengeId('otp-challenge-2') });
    const firstResult = transitionOtpChallenge(
      first,
      submitCommand(first, { presentedDigest: WRONG_DIGEST }),
    );
    const secondResult = transitionOtpChallenge(
      second,
      submitCommand(second, { presentedDigest: WRONG_DIGEST }),
    );
    expect(firstResult).toMatchObject({ transition: 'incorrect_code' });
    expect(secondResult).toMatchObject({ transition: 'incorrect_code' });
  });
});

describe('OTP expiry', () => {
  it('accepts submit one second before expiry', () => {
    const state = pending();
    expect(
      transitionOtpChallenge(
        state,
        submitCommand(state, { now: BEFORE_EXPIRY }),
      ),
    ).toMatchObject({ transition: 'otp_verified' });
  });

  it.each([EXPIRES_AT, AFTER_EXPIRY])(
    'rejects submit at or after expiry %s without consuming an attempt',
    (now) => {
      const state = pending();
      const result = transitionOtpChallenge(
        state,
        submitCommand(state, { now, presentedDigest: WRONG_DIGEST }),
      );
      expectRejected(result, state, 'otp_expired');
      expect(state.attemptsRemaining).toBe(3);
      expect(state.appliedCommands).toHaveLength(0);
    },
  );

  it('does not compare either correct or incorrect digest on expiry', () => {
    for (const presentedDigest of [CORRECT_DIGEST, WRONG_DIGEST]) {
      const state = pending();
      const result = transitionOtpChallenge(
        state,
        submitCommand(state, { now: EXPIRES_AT, presentedDigest }),
      );
      expectRejected(result, state, 'otp_expired');
      expect(state.attemptsRemaining).toBe(state.maxAttempts);
    }
  });

  it('rejects early expiry without recording the command', () => {
    const state = pending();
    const result = transitionOtpChallenge(
      state,
      expireCommand(state, { now: BEFORE_EXPIRY }),
    );
    expectRejected(result, state, 'not_yet_expired');
    expect(state.appliedCommands).toHaveLength(0);
  });

  it('expires exactly at the boundary', () => {
    const state = pending();
    const expired = transitionedState(
      transitionOtpChallenge(state, expireCommand(state)),
      'expired',
    );
    expect(expired.expiration.expiredAt).toBe(EXPIRES_AT);
  });

  it('returns an exact expire retry', () => {
    const initial = pending();
    const command = expireCommand(initial);
    const state = transitionedState(
      transitionOtpChallenge(initial, command),
      'expired',
    );
    const retry = transitionOtpChallenge(state, { ...command, now: AFTER_EXPIRY });
    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: { type: 'otp_expired' },
    });
    expect(retry.state).toBe(state);
    expect(state.appliedCommands[0].appliedAt).toBe(EXPIRES_AT);
  });

  it('detects request-digest conflict for an applied expire command', () => {
    const initial = pending();
    const command = expireCommand(initial);
    const state = transitionedState(
      transitionOtpChallenge(initial, command),
      'expired',
    );
    expectRejected(
      transitionOtpChallenge(state, {
        ...command,
        requestDigest: OTHER_REQUEST,
      }),
      state,
      'command_reuse_conflict',
    );
  });
});

describe('OTP cancellation', () => {
  it.each(OTP_CANCEL_REASONS)('cancels for reason %s', (reason) => {
    const state = pending();
    const cancelled = transitionedState(
      transitionOtpChallenge(state, cancelCommand(state, { reason })),
      'cancelled',
    );
    expect(cancelled.cancellation).toEqual({
      reason,
      cancelledAt: BEFORE_EXPIRY,
      commandId: 'otp-command-1',
    });
  });

  it('returns an exact cancel retry', () => {
    const initial = pending();
    const command = cancelCommand(initial);
    const state = transitionedState(
      transitionOtpChallenge(initial, command),
      'cancelled',
    );
    const retry = transitionOtpChallenge(state, { ...command, now: AFTER_EXPIRY });
    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: { type: 'otp_cancelled' },
    });
  });

  it('rejects the same cancel command ID with another reason', () => {
    const initial = pending();
    const command = cancelCommand(initial);
    const state = transitionedState(
      transitionOtpChallenge(initial, command),
      'cancelled',
    );
    expectRejected(
      transitionOtpChallenge(state, { ...command, reason: 'security_event' }),
      state,
      'command_reuse_conflict',
    );
  });

  it('cancels one second before expiry', () => {
    const state = pending();
    expect(
      transitionOtpChallenge(
        state,
        cancelCommand(state, { now: BEFORE_EXPIRY }),
      ),
    ).toMatchObject({ transition: 'otp_cancelled' });
  });

  it.each([EXPIRES_AT, AFTER_EXPIRY])(
    'rejects cancel at or after expiry %s without a transition',
    (now) => {
      const state = pending();
      const result = transitionOtpChallenge(
        state,
        cancelCommand(state, { now }),
      );
      expectRejected(result, state, 'otp_expired');
      expect(state.appliedCommands).toHaveLength(0);
    },
  );

  it('detects request-digest conflict for an applied cancel command', () => {
    const initial = pending();
    const command = cancelCommand(initial);
    const state = transitionedState(
      transitionOtpChallenge(initial, command),
      'cancelled',
    );
    expectRejected(
      transitionOtpChallenge(state, {
        ...command,
        requestDigest: OTHER_REQUEST,
      }),
      state,
      'command_reuse_conflict',
    );
  });
});

describe('OTP runtime state validation', () => {
  it.each([0, -1, 4])(
    'rejects pending attemptsRemaining %# without underflow',
    (attemptsRemaining) => {
      const state = pending();
      expectInvalidOtpState({ ...state, attemptsRemaining });
    },
  );

  it('rejects a malformed stored verifier digest without RangeError', () => {
    const state = pending();
    expectInvalidOtpState({ ...state, verifierDigest: 'bad' });
  });

  it('rejects a malformed stored phone identity', () => {
    const state = pending();
    expectInvalidOtpState({
      ...state,
      identityKey: { provider: 'phone' },
    });
  });

  it('rejects malformed applied-command history', () => {
    const state = pending();
    expectInvalidOtpState({
      ...state,
      appliedCommands: [{ commandType: 'submit_otp' }],
    });
  });

  it('rejects incorrect_code history containing the verifier digest', () => {
    const initial = pending();
    const state = transitionedState(
      transitionOtpChallenge(
        initial,
        submitCommand(initial, { presentedDigest: WRONG_DIGEST }),
      ),
      'pending',
    );
    const history = structuredClone(state.appliedCommands);
    (
      history[0] as unknown as { presentedDigest: OtpVerifierDigest }
    ).presentedDigest = CORRECT_DIGEST;

    expectInvalidOtpState({ ...state, appliedCommands: history });
  });

  it('rejects attempts_exhausted history containing the verifier digest', () => {
    const state = exhaustedChallenge();
    const history = structuredClone(state.appliedCommands);
    (
      history[0] as unknown as { presentedDigest: OtpVerifierDigest }
    ).presentedDigest = CORRECT_DIGEST;

    expectInvalidOtpState({ ...state, appliedCommands: history });
  });

  it('rejects verified history containing an incorrect digest', () => {
    const state = verifiedChallenge();
    const history = structuredClone(state.appliedCommands);
    (
      history[history.length - 1] as unknown as {
        presentedDigest: OtpVerifierDigest;
      }
    ).presentedDigest = WRONG_DIGEST;

    expectInvalidOtpState({ ...state, appliedCommands: history });
  });

  it.each([
    unixEpochSeconds(CREATED_AT - 1),
    EXPIRES_AT,
    AFTER_EXPIRY,
  ])('rejects applied submit at impossible time %s', (appliedAt) => {
    const initial = pending();
    const state = transitionedState(
      transitionOtpChallenge(
        initial,
        submitCommand(initial, { presentedDigest: WRONG_DIGEST }),
      ),
      'pending',
    );
    const history = structuredClone(state.appliedCommands);
    (
      history[0] as unknown as { appliedAt: UnixEpochSeconds }
    ).appliedAt = appliedAt;

    expectInvalidOtpState({ ...state, appliedCommands: history });
  });

  it.each([
    unixEpochSeconds(CREATED_AT - 1),
    EXPIRES_AT,
    AFTER_EXPIRY,
  ])('rejects applied cancel at impossible time %s', (appliedAt) => {
    const state = cancelledChallenge();
    if (state.status !== 'cancelled') {
      throw new Error('Expected cancelled OTP challenge');
    }
    const forged = structuredClone(state) as unknown as {
      cancellation: { cancelledAt: UnixEpochSeconds };
      appliedCommands: Array<{
        appliedAt: UnixEpochSeconds;
        result: {
          type: 'otp_cancelled';
          cancellation: { cancelledAt: UnixEpochSeconds };
        };
      }>;
    };
    forged.cancellation.cancelledAt = appliedAt;
    forged.appliedCommands[0].appliedAt = appliedAt;
    forged.appliedCommands[0].result.cancellation.cancelledAt = appliedAt;

    expectInvalidOtpState(forged);
  });

  it('rejects an expire command recorded before expiry', () => {
    const state = expiredChallenge();
    if (state.status !== 'expired') {
      throw new Error('Expected expired OTP challenge');
    }
    const forged = structuredClone(state) as unknown as {
      expiration: { expiredAt: UnixEpochSeconds };
      appliedCommands: Array<{
        appliedAt: UnixEpochSeconds;
        result: {
          type: 'otp_expired';
          expiration: { expiredAt: UnixEpochSeconds };
        };
      }>;
    };
    forged.expiration.expiredAt = BEFORE_EXPIRY;
    forged.appliedCommands[0].appliedAt = BEFORE_EXPIRY;
    forged.appliedCommands[0].result.expiration.expiredAt = BEFORE_EXPIRY;

    expectInvalidOtpState(forged);
  });

  it('rejects inconsistent remaining-attempt values in history', () => {
    const initial = pending();
    const state = transitionedState(
      transitionOtpChallenge(
        initial,
        submitCommand(initial, { presentedDigest: WRONG_DIGEST }),
      ),
      'pending',
    );
    const history = structuredClone(state.appliedCommands);
    const result = history[0].result as unknown as Record<string, unknown>;
    result.attemptsRemaining = 3;

    expectInvalidOtpState({ ...state, appliedCommands: history });
  });

  it('rejects duplicate command IDs in applied-command history', () => {
    const initial = pending();
    const first = transitionedState(
      transitionOtpChallenge(
        initial,
        submitCommand(initial, {
          commandId: commandId('wrong-1'),
          presentedDigest: WRONG_DIGEST,
        }),
      ),
      'pending',
    );
    const second = transitionedState(
      transitionOtpChallenge(
        first,
        submitCommand(first, {
          commandId: commandId('wrong-2'),
          presentedDigest: OTHER_DIGEST,
        }),
      ),
      'pending',
    );
    const history = structuredClone(second.appliedCommands);
    (history[1] as unknown as Record<string, unknown>).commandId =
      history[0].commandId;

    expectInvalidOtpState({ ...second, appliedCommands: history });
  });

  it('rejects pending state carrying terminal metadata', () => {
    const state = pending();
    expectInvalidOtpState({
      ...state,
      verification: {
        verifiedAt: BEFORE_EXPIRY,
        commandId: commandId('terminal-command'),
      },
    });
  });

  it('rejects verified state without verification metadata', () => {
    const state = verifiedChallenge();
    const partial = { ...state } as Record<string, unknown>;
    delete partial.verification;
    expectInvalidOtpState(partial);
  });

  it('rejects verified state carrying another terminal metadata kind', () => {
    const state = verifiedChallenge();
    expectInvalidOtpState({
      ...state,
      expiration: {
        expiredAt: EXPIRES_AT,
        commandId: commandId('expire-command'),
      },
    });
  });

  it('rejects terminal metadata inconsistent with applied history', () => {
    const state = verifiedChallenge();
    if (state.status !== 'verified') {
      throw new Error('Expected verified OTP challenge');
    }
    expectInvalidOtpState({
      ...state,
      verification: {
        ...state.verification,
        commandId: commandId('another-command'),
      },
    });
  });

  it('rejects exhausted state with attempts remaining', () => {
    const state = exhaustedChallenge();
    expectInvalidOtpState({ ...state, attemptsRemaining: 1 });
  });

  it('rejects expired state without expiration metadata', () => {
    const state = expiredChallenge();
    const partial = { ...state } as Record<string, unknown>;
    delete partial.expiration;
    expectInvalidOtpState(partial);
  });

  it('rejects cancelled state with an arbitrary cancellation reason', () => {
    const state = cancelledChallenge();
    if (state.status !== 'cancelled') {
      throw new Error('Expected cancelled OTP challenge');
    }
    expectInvalidOtpState({
      ...state,
      cancellation: { ...state.cancellation, reason: 'provider_failure' },
    });
  });

  it('checks state before processing a malformed command', () => {
    const state = { ...pending(), attemptsRemaining: 0 } as OtpChallengeState;
    const result = transitionOtpChallenge(
      state,
      runtimeCommand({ type: 'unknown' }),
    );
    expectRejected(result, state, 'invalid_otp_state');
  });
});

describe('OTP terminal lifecycle', () => {
  const terminals = [
    ['verified', verifiedChallenge],
    ['expired', expiredChallenge],
    ['attempts_exhausted', exhaustedChallenge],
    ['cancelled', cancelledChallenge],
  ] as const;

  it.each(terminals)(
    'forbids a new submit from %s',
    (_status, stateFor) => {
      const state = stateFor();
      expectRejected(
        transitionOtpChallenge(
          state,
          submitCommand(state, { commandId: commandId('new-submit') }),
        ),
        state,
        'forbidden_transition',
      );
    },
  );

  it.each(terminals)(
    'forbids a new expire from %s',
    (_status, stateFor) => {
      const state = stateFor();
      expectRejected(
        transitionOtpChallenge(
          state,
          expireCommand(state, { commandId: commandId('new-expire') }),
        ),
        state,
        'forbidden_transition',
      );
    },
  );

  it.each(terminals)(
    'forbids a new cancel from %s',
    (_status, stateFor) => {
      const state = stateFor();
      expectRejected(
        transitionOtpChallenge(
          state,
          cancelCommand(state, { commandId: commandId('new-cancel') }),
        ),
        state,
        'forbidden_transition',
      );
    },
  );
});

describe('OTP malformed runtime commands', () => {
  it.each([
    ['unknown type', { type: 'resend_otp' }, 'invalid_command_type'],
    [
      'missing presented digest',
      { presentedDigest: undefined },
      'invalid_presented_digest',
    ],
    ['empty command ID', { commandId: '' }, 'invalid_command_id'],
    ['blank command ID', { commandId: ' ' }, 'invalid_command_id'],
    [
      'command ID with a control character',
      { commandId: 'command\n1' },
      'invalid_command_id',
    ],
    [
      'overlong command ID',
      { commandId: 'x'.repeat(257) },
      'invalid_command_id',
    ],
    [
      'malformed presented digest',
      { presentedDigest: 'BAD' },
      'invalid_presented_digest',
    ],
    ['malformed request digest', { requestDigest: 'BAD' }, 'invalid_request_digest'],
  ] as const)(
    'rejects %s',
    (_case, change, commandReason) => {
      const state = pending();
      const command = { ...submitCommand(state), ...change };
      const snapshot = structuredClone(state);
      let result: OtpTransitionResult | undefined;
      expect(() => {
        result = transitionOtpChallenge(state, runtimeCommand(command));
      }).not.toThrow();
      expect(result).toMatchObject({
        outcome: 'rejected',
        reason: 'invalid_otp_command',
        commandReason,
      });
      expect(result?.state).toBe(state);
      expect(state).toEqual(snapshot);
    },
  );

  it('rejects missing submit payload distinctly', () => {
    const state = pending();
    const command = {
      ...submitCommand(state),
    } as unknown as Record<string, unknown>;
    delete command.presentedDigest;
    const result = transitionOtpChallenge(state, runtimeCommand(command));
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_otp_command',
      commandReason: 'missing_presented_digest',
    });
    expect(result.state).toBe(state);
  });

  it('rejects a missing cancel reason', () => {
    const state = pending();
    const command = {
      ...cancelCommand(state),
    } as unknown as Record<string, unknown>;
    delete command.reason;
    expect(transitionOtpChallenge(state, runtimeCommand(command))).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_otp_command',
      commandReason: 'missing_cancel_reason',
    });
  });

  it('rejects an arbitrary cancel reason', () => {
    const state = pending();
    expect(
      transitionOtpChallenge(
        state,
        runtimeCommand({ ...cancelCommand(state), reason: 'provider_failure' }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_otp_command',
      commandReason: 'invalid_cancel_reason',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects invalid command time %#',
    (now) => {
      const state = pending();
      const result = transitionOtpChallenge(
        state,
        runtimeCommand({ ...submitCommand(state), now }),
      );
      expect(result).toMatchObject({
        outcome: 'rejected',
        reason: 'invalid_otp_command',
        commandReason: 'invalid_time',
      });
      expect(result.state).toBe(state);
    },
  );

  it('rejects a command bound to another challenge', () => {
    const state = pending();
    const result = transitionOtpChallenge(
      state,
      submitCommand(state, { challengeId: challengeId('otp-challenge-2') }),
    );
    expectRejected(result, state, 'otp_binding_conflict');
  });
});

describe('OTP immutability and data minimization', () => {
  it('does not retain mutable binding or identity references', () => {
    const identityKey = phoneIdentity();
    const mutableBinding = { ...binding({ identityKey }) };
    const result = createOtpChallenge(mutableBinding);
    if (result.outcome !== 'created') throw new Error('Expected challenge');

    (mutableBinding as { intent: AuthenticationIntent }).intent = 'sign_in';
    (identityKey as { provider: ExternalIdentityKey['provider'] }).provider =
      'google';
    (identityKey.lookup as { subject: string }).subject = '+70000000000';

    expect(result.state).toMatchObject({
      intent: 'fresh_authentication',
      identityKey: {
        provider: 'phone',
        lookup: { subject: '+79990000000' },
      },
    });
    expect(result.state.identityKey).not.toBe(identityKey);
  });

  it('does not retain mutable command fields or extras', () => {
    const state = pending();
    const command = {
      ...submitCommand(state),
      rawCode: '123456',
      smsProviderResponse: { id: 'message-1' },
      token: 'token',
      cookie: 'cookie',
      debugMessage: 'debug',
    };
    const result = transitionOtpChallenge(state, runtimeCommand(command));
    const verified = transitionedState(result, 'verified');

    command.commandId = commandId('changed');
    command.presentedDigest = WRONG_DIGEST;
    command.smsProviderResponse.id = 'changed';

    expect(verified.verification.commandId).toBe('otp-command-1');
    expect(verified.appliedCommands[0]).toMatchObject({
      commandId: 'otp-command-1',
      presentedDigest: CORRECT_DIGEST,
    });
    for (const field of [
      'rawCode',
      'smsProviderResponse',
      'token',
      'cookie',
      'debugMessage',
    ]) {
      expect(verified).not.toHaveProperty(field);
      expect(verified.appliedCommands[0]).not.toHaveProperty(field);
    }
  });

  it('does not retain a mutable applied-command history', () => {
    const initial = pending();
    const first = transitionedState(
      transitionOtpChallenge(
        initial,
        submitCommand(initial, { presentedDigest: WRONG_DIGEST }),
      ),
      'pending',
    );
    const mutableHistory = structuredClone(first.appliedCommands);
    const mutableState = {
      ...first,
      appliedCommands: mutableHistory,
    } as PendingOtpChallenge;
    const second = transitionedState(
      transitionOtpChallenge(
        mutableState,
        submitCommand(mutableState, {
          commandId: commandId('otp-command-2'),
          presentedDigest: OTHER_DIGEST,
        }),
      ),
      'pending',
    );

    (mutableHistory[0] as unknown as Record<string, unknown>).requestDigest =
      OTHER_REQUEST;
    expect(second.appliedCommands[0].requestDigest).toBe(COMMAND_REQUEST);
    expect(second.appliedCommands).not.toBe(mutableHistory);
  });

  it('returns the exact input state for a typed refusal', () => {
    const state = pending();
    const result = transitionOtpChallenge(
      state,
      expireCommand(state, { now: BEFORE_EXPIRY }),
    );
    expectRejected(result, state, 'not_yet_expired');
  });

  it('uses immutable epoch seconds and no Date values', () => {
    const state = verifiedChallenge();
    expect(state.createdAt).not.toBeInstanceOf(Date);
    expect(state.expiresAt).not.toBeInstanceOf(Date);
    expect((state as Extract<OtpChallengeState, { status: 'verified' }>).verification.verifiedAt)
      .not.toBeInstanceOf(Date);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.identityKey)).toBe(true);
    expect(Object.isFrozen(state.identityKey.lookup)).toBe(true);
    expect(Object.isFrozen(state.appliedCommands)).toBe(true);
  });

  it('does not put the transient sender request into OTP state', () => {
    const result: CreateOtpChallengeResult = createOtpChallenge(binding());
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    for (const field of ['destination', 'plaintextCode', 'channel', 'sender']) {
      expect(result.state).not.toHaveProperty(field);
    }
  });
});
