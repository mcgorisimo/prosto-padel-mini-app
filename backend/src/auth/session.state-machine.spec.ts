import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds, unixEpochSeconds } from './auth.types';
import {
  ActiveSessionState,
  CreateActiveSessionBinding,
  ExpireSessionCommand,
  RevokeSessionCommand,
  RotateSessionCredentialCommand,
  SessionCommand,
  SessionCommandId,
  SessionCredentialBinding,
  SessionCredentialDigest,
  SessionId,
  SessionRequestDigest,
  SessionRevokeReason,
  SessionState,
} from './session.types';
import {
  SessionTransitionResult,
  createActiveSession,
  transitionSession,
} from './session.state-machine';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001' as AccountId;
const CREATED_AT = unixEpochSeconds(1_784_635_200);
const EXPIRES_AT = unixEpochSeconds(1_784_635_500);
const BEFORE_EXPIRY = unixEpochSeconds(1_784_635_499);
const ROTATION_TIME_1 = unixEpochSeconds(1_784_635_300);
const ROTATION_TIME_2 = unixEpochSeconds(1_784_635_400);
const DIGEST_A = 'a'.repeat(64) as SessionCredentialDigest;
const DIGEST_B = 'b'.repeat(64) as SessionCredentialDigest;
const DIGEST_C = 'c'.repeat(64) as SessionCredentialDigest;
const DIGEST_D = 'd'.repeat(64) as SessionCredentialDigest;

function sessionId(value = 'session-1'): SessionId {
  return value as SessionId;
}

function commandId(value = 'command-1'): SessionCommandId {
  return value as SessionCommandId;
}

function requestDigest(value = 'request-1'): SessionRequestDigest {
  return value as SessionRequestDigest;
}

function credential(
  digest: SessionCredentialDigest = DIGEST_A,
  generation = 1,
  issuedAt: UnixEpochSeconds = CREATED_AT,
): SessionCredentialBinding {
  return { digest, generation, issuedAt };
}

function activeBinding(
  overrides: Partial<CreateActiveSessionBinding> = {},
): CreateActiveSessionBinding {
  return {
    sessionId: sessionId(),
    accountId: ACCOUNT_ID,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    currentCredential: credential(),
    ...overrides,
  };
}

function activeSession(
  overrides: Partial<CreateActiveSessionBinding> = {},
): ActiveSessionState {
  const result = createActiveSession(activeBinding(overrides));
  if (result.outcome !== 'created') {
    throw new Error(`Test session was not created: ${result.bindingReason}`);
  }
  return result.state;
}

function nextDigestForGeneration(generation: number): SessionCredentialDigest {
  return [DIGEST_A, DIGEST_B, DIGEST_C, DIGEST_D][generation] ?? DIGEST_D;
}

function rotateCommand(
  state: SessionState,
  overrides: Partial<RotateSessionCredentialCommand> = {},
): RotateSessionCredentialCommand {
  return {
    type: 'rotate_credential',
    sessionId: state.sessionId,
    commandId: commandId(),
    now: ROTATION_TIME_1,
    requestDigest: requestDigest(),
    presentedCredential: {
      digest: state.currentCredential.digest,
      generation: state.currentCredential.generation,
    },
    nextCredential: {
      digest: nextDigestForGeneration(state.currentCredential.generation),
      generation: state.currentCredential.generation + 1,
    },
    ...overrides,
  };
}

function revokeCommand(
  state: SessionState,
  overrides: Partial<RevokeSessionCommand> = {},
): RevokeSessionCommand {
  return {
    type: 'revoke_session',
    sessionId: state.sessionId,
    commandId: commandId(),
    now: ROTATION_TIME_1,
    requestDigest: requestDigest(),
    reason: 'user_sign_out',
    ...overrides,
  };
}

function expireCommand(
  state: SessionState,
  overrides: Partial<ExpireSessionCommand> = {},
): ExpireSessionCommand {
  return {
    type: 'expire_session',
    sessionId: state.sessionId,
    commandId: commandId(),
    now: EXPIRES_AT,
    requestDigest: requestDigest(),
    ...overrides,
  };
}

function runtimeCommand(value: unknown): SessionCommand {
  return value as SessionCommand;
}

function expectRejectedWithoutStateChange(
  result: SessionTransitionResult,
  state: SessionState,
  reason: string,
): void {
  expect(result).toMatchObject({ outcome: 'rejected', reason });
  expect(result.state).toBe(state);
}

function transitionedState<Status extends SessionState['status']>(
  result: SessionTransitionResult,
  status: Status,
): Extract<SessionState, { status: Status }> {
  expect(result).toMatchObject({ outcome: 'transitioned', state: { status } });
  if (result.outcome !== 'transitioned' || result.state.status !== status) {
    throw new Error(`Expected transitioned ${status} session`);
  }
  return result.state as Extract<SessionState, { status: Status }>;
}

function reuseDetectedSession(): Extract<
  SessionState,
  { status: 'reuse_detected' }
> {
  const initial = activeSession();
  const rotated = transitionedState(
    transitionSession(initial, rotateCommand(initial)),
    'active',
  );
  return transitionedState(
    transitionSession(
      rotated,
      rotateCommand(rotated, {
        commandId: commandId('reuse-command'),
        presentedCredential: { digest: DIGEST_A, generation: 1 },
        nextCredential: { digest: DIGEST_D, generation: 3 },
      }),
    ),
    'reuse_detected',
  );
}

describe('active session creation', () => {
  it('creates an immutable active domain value with generation one', () => {
    const result = createActiveSession(activeBinding());

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') {
      return;
    }
    expect(result.state).toEqual({
      sessionId: 'session-1',
      accountId: ACCOUNT_ID,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      currentCredential: {
        digest: DIGEST_A,
        generation: 1,
        issuedAt: CREATED_AT,
      },
      consumedCredentials: [],
      appliedCommands: [],
      status: 'active',
    });
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.currentCredential)).toBe(true);
    expect(Object.isFrozen(result.state.consumedCredentials)).toBe(true);
    expect(Object.isFrozen(result.state.appliedCommands)).toBe(true);
  });

  it.each([
    [
      'sessionId',
      '' as SessionId,
      'invalid_session_id',
    ],
    [
      'sessionId',
      ' padded ' as SessionId,
      'invalid_session_id',
    ],
    [
      'accountId',
      '' as AccountId,
      'invalid_account_id',
    ],
    [
      'currentCredential',
      credential('not-a-digest' as SessionCredentialDigest),
      'invalid_current_credential',
    ],
    [
      'currentCredential',
      credential(DIGEST_A, 2),
      'invalid_initial_generation',
    ],
  ] as const)(
    'rejects invalid binding field %s',
    (field, value, bindingReason) => {
      expect(createActiveSession(activeBinding({ [field]: value }))).toEqual({
        outcome: 'rejected',
        reason: 'invalid_session_binding',
        bindingReason,
      });
    },
  );

  it.each([
    [Number.NaN as UnixEpochSeconds, EXPIRES_AT, 'invalid_created_at'],
    [CREATED_AT, Number.POSITIVE_INFINITY as UnixEpochSeconds, 'invalid_expires_at'],
    [-1 as UnixEpochSeconds, EXPIRES_AT, 'invalid_created_at'],
    [CREATED_AT, 1_784_635_500.5 as UnixEpochSeconds, 'invalid_expires_at'],
    [EXPIRES_AT, EXPIRES_AT, 'invalid_session_window'],
    [EXPIRES_AT, CREATED_AT, 'invalid_session_window'],
  ])(
    'rejects invalid session time (%p, %p)',
    (createdAt, expiresAt, bindingReason) => {
      expect(
        createActiveSession(activeBinding({ createdAt, expiresAt })),
      ).toEqual({
        outcome: 'rejected',
        reason: 'invalid_session_binding',
        bindingReason,
      });
    },
  );

  it.each([
    [
      'before session creation',
      unixEpochSeconds(CREATED_AT - 1),
      'rejected',
    ],
    ['at session creation', CREATED_AT, 'created'],
    ['one second before session expiry', BEFORE_EXPIRY, 'created'],
    ['at session expiry', EXPIRES_AT, 'rejected'],
  ] as const)(
    'handles initial credential issuedAt %s',
    (_description, issuedAt, expectedOutcome) => {
      const result = createActiveSession(
        activeBinding({ currentCredential: credential(DIGEST_A, 1, issuedAt) }),
      );

      expect(result.outcome).toBe(expectedOutcome);
      if (expectedOutcome === 'rejected') {
        expect(result).toEqual({
          outcome: 'rejected',
          reason: 'invalid_session_binding',
          bindingReason: 'invalid_credential_issued_at',
        });
      }
    },
  );

  it('does not preserve additional runtime fields', () => {
    const runtimeBinding = {
      ...activeBinding(),
      rawToken: 'raw-token',
      cookie: 'session=cookie',
      authorizationHeader: 'Bearer secret',
      rawProof: 'raw-proof',
      telegramInitData: 'init-data',
      ip: '192.0.2.1',
      userAgent: 'test-agent',
      sqlError: 'database detail',
      httpError: 'http detail',
      debugMessage: 'debug detail',
      arbitraryObject: { mutable: true },
    } as CreateActiveSessionBinding;
    const result = createActiveSession(runtimeBinding);

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') {
      return;
    }
    for (const field of [
      'rawToken',
      'cookie',
      'authorizationHeader',
      'rawProof',
      'telegramInitData',
      'ip',
      'userAgent',
      'sqlError',
      'httpError',
      'debugMessage',
      'arbitraryObject',
    ]) {
      expect(result.state).not.toHaveProperty(field);
    }
  });

  it('clones the initial credential instead of retaining a mutable reference', () => {
    const mutableCredential = credential();
    const result = createActiveSession(
      activeBinding({ currentCredential: mutableCredential }),
    );

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') {
      return;
    }
    (mutableCredential as { digest: string }).digest = DIGEST_D;
    (mutableCredential as { generation: number }).generation = 99;

    expect(result.state.currentCredential).toEqual({
      digest: DIGEST_A,
      generation: 1,
      issuedAt: CREATED_AT,
    });
    expect(result.state.currentCredential).not.toBe(mutableCredential);
  });
});

describe('session credential rotation', () => {
  it('rotates current credential and consumes the previous generation', () => {
    const state = activeSession();
    const command = rotateCommand(state);
    const result = transitionSession(state, command);
    const next = transitionedState(result, 'active');

    expect(next.currentCredential).toEqual({
      digest: DIGEST_B,
      generation: 2,
      issuedAt: ROTATION_TIME_1,
    });
    expect(next.consumedCredentials).toEqual([
      {
        digest: DIGEST_A,
        generation: 1,
        issuedAt: CREATED_AT,
        consumedAt: ROTATION_TIME_1,
        consumedByCommandId: commandId(),
      },
    ]);
    expect(state.status).toBe('active');
    expect(state.currentCredential.digest).toBe(DIGEST_A);
    expect(state.consumedCredentials).toEqual([]);
  });

  it('supports multiple sequential rotations', () => {
    const initial = activeSession();
    const first = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const second = transitionedState(
      transitionSession(
        first,
        rotateCommand(first, {
          commandId: commandId('command-2'),
          now: ROTATION_TIME_2,
        }),
      ),
      'active',
    );

    expect(second.currentCredential).toMatchObject({
      digest: DIGEST_C,
      generation: 3,
      issuedAt: ROTATION_TIME_2,
    });
    expect(second.consumedCredentials.map(({ digest, generation }) => ({
      digest,
      generation,
    }))).toEqual([
      { digest: DIGEST_A, generation: 1 },
      { digest: DIGEST_B, generation: 2 },
    ]);
  });

  it.each([
    [
      'unknown digest',
      (state: SessionState) => ({
        digest: DIGEST_D,
        generation: state.currentCredential.generation,
      }),
    ],
    [
      'correct digest with wrong generation',
      (state: SessionState) => ({
        digest: state.currentCredential.digest,
        generation: state.currentCredential.generation + 1,
      }),
    ],
    [
      'correct generation with wrong digest',
      (state: SessionState) => ({
        digest: DIGEST_D,
        generation: state.currentCredential.generation,
      }),
    ],
  ] as const)('rejects invalid presented credential: %s', (_name, presentedFor) => {
    const state = activeSession();
    const result = transitionSession(
      state,
      rotateCommand(state, {
        presentedCredential: presentedFor(state),
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      state,
      'invalid_session_credential',
    );
  });

  it.each([
    [
      'malformed digest',
      (state: SessionState) => ({
        digest: 'not-a-digest' as SessionCredentialDigest,
        generation: state.currentCredential.generation + 1,
      }),
    ],
    [
      'same digest as current',
      (state: SessionState) => ({
        digest: state.currentCredential.digest,
        generation: state.currentCredential.generation + 1,
      }),
    ],
    [
      'skipped generation',
      (state: SessionState) => ({
        digest: DIGEST_B,
        generation: state.currentCredential.generation + 2,
      }),
    ],
    [
      'generation not increased',
      (state: SessionState) => ({
        digest: DIGEST_B,
        generation: state.currentCredential.generation,
      }),
    ],
  ] as const)('rejects invalid next credential: %s', (_name, nextFor) => {
    const state = activeSession();
    const result = transitionSession(
      state,
      rotateCommand(state, { nextCredential: nextFor(state) }),
    );

    expectRejectedWithoutStateChange(
      result,
      state,
      'invalid_next_credential',
    );
  });

  it('rejects a next digest already present in consumed history', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const result = transitionSession(
      rotated,
      rotateCommand(rotated, {
        commandId: commandId('command-2'),
        now: ROTATION_TIME_2,
        nextCredential: { digest: DIGEST_A, generation: 3 },
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      rotated,
      'invalid_next_credential',
    );
  });

  it('does not detect reuse for a consumed digest with another generation', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const consumedSnapshot = structuredClone(rotated.consumedCredentials);
    const result = transitionSession(
      rotated,
      rotateCommand(rotated, {
        commandId: commandId('wrong-pair-command'),
        presentedCredential: { digest: DIGEST_A, generation: 2 },
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      rotated,
      'invalid_session_credential',
    );
    expect(result.outcome).not.toBe('transitioned');
    expect(rotated.status).toBe('active');
    expect(rotated.currentCredential).toMatchObject({
      digest: DIGEST_B,
      generation: 2,
    });
    expect(rotated.consumedCredentials).toEqual(consumedSnapshot);
    expect(rotated.appliedCommands).toHaveLength(1);
  });

  it('does not detect reuse for a consumed generation with another digest', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const consumedSnapshot = structuredClone(rotated.consumedCredentials);
    const result = transitionSession(
      rotated,
      rotateCommand(rotated, {
        commandId: commandId('wrong-pair-command'),
        presentedCredential: { digest: DIGEST_B, generation: 1 },
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      rotated,
      'invalid_session_credential',
    );
    expect(result.outcome).not.toBe('transitioned');
    expect(rotated.status).toBe('active');
    expect(rotated.currentCredential).toMatchObject({
      digest: DIGEST_B,
      generation: 2,
    });
    expect(rotated.consumedCredentials).toEqual(consumedSnapshot);
    expect(rotated.appliedCommands).toHaveLength(1);
  });

  it('repeats an invalid consumed credential pair deterministically', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const command = rotateCommand(rotated, {
      commandId: commandId('wrong-pair-command'),
      presentedCredential: { digest: DIGEST_A, generation: 2 },
    });
    const first = transitionSession(rotated, command);
    const second = transitionSession(rotated, command);

    expectRejectedWithoutStateChange(
      first,
      rotated,
      'invalid_session_credential',
    );
    expectRejectedWithoutStateChange(
      second,
      rotated,
      'invalid_session_credential',
    );
    expect(second.outcome).not.toBe('idempotent_retry');
    expect(rotated.appliedCommands).toHaveLength(1);
  });
});

describe('session credential reuse detection', () => {
  it('moves active session to reuse_detected for a consumed credential', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const reuseCommand = rotateCommand(rotated, {
      commandId: commandId('reuse-command'),
      now: ROTATION_TIME_2,
      presentedCredential: { digest: DIGEST_A, generation: 1 },
      nextCredential: { digest: DIGEST_D, generation: 3 },
    });
    const result = transitionSession(rotated, reuseCommand);
    const reused = transitionedState(result, 'reuse_detected');

    expect(reused).toMatchObject({
      status: 'reuse_detected',
      reuse: {
        detectedAt: ROTATION_TIME_2,
        generation: 1,
        digest: DIGEST_A,
        commandId: 'reuse-command',
      },
      currentCredential: { digest: DIGEST_B, generation: 2 },
    });
    expect(reused.reuse).not.toHaveProperty('rawToken');
    expect(reused.reuse).not.toHaveProperty('token');
  });

  it('detects an older consumed credential after multiple rotations', () => {
    const initial = activeSession();
    const first = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const second = transitionedState(
      transitionSession(
        first,
        rotateCommand(first, {
          commandId: commandId('command-2'),
          now: ROTATION_TIME_2,
        }),
      ),
      'active',
    );
    const result = transitionSession(
      second,
      rotateCommand(second, {
        commandId: commandId('reuse-command'),
        now: BEFORE_EXPIRY,
        presentedCredential: { digest: DIGEST_A, generation: 1 },
        nextCredential: { digest: DIGEST_D, generation: 4 },
      }),
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'reuse_detected',
      state: { status: 'reuse_detected', reuse: { generation: 1 } },
    });
  });

  it('detects consumed credential reuse after revoke', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const revoked = transitionedState(
      transitionSession(
        rotated,
        revokeCommand(rotated, { commandId: commandId('revoke-command') }),
      ),
      'revoked',
    );
    const result = transitionSession(
      revoked,
      rotateCommand(revoked, {
        commandId: commandId('reuse-command'),
        now: ROTATION_TIME_2,
        presentedCredential: { digest: DIGEST_A, generation: 1 },
        nextCredential: { digest: DIGEST_D, generation: 3 },
      }),
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'reuse_detected',
      state: { status: 'reuse_detected' },
    });
  });

  it('does not restore revoked session when current credential is presented', () => {
    const initial = activeSession();
    const revoked = transitionedState(
      transitionSession(initial, revokeCommand(initial)),
      'revoked',
    );
    const result = transitionSession(
      revoked,
      rotateCommand(revoked, { commandId: commandId('rotate-after-revoke') }),
    );

    expectRejectedWithoutStateChange(
      result,
      revoked,
      'forbidden_transition',
    );
  });

  it('does not restore revoked session for an unknown credential', () => {
    const initial = activeSession();
    const revoked = transitionedState(
      transitionSession(initial, revokeCommand(initial)),
      'revoked',
    );
    const appliedCount = revoked.appliedCommands.length;
    const result = transitionSession(
      revoked,
      rotateCommand(revoked, {
        commandId: commandId('unknown-credential-command'),
        presentedCredential: { digest: DIGEST_D, generation: 1 },
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      revoked,
      'forbidden_transition',
    );
    expect(revoked.status).toBe('revoked');
    expect(revoked.appliedCommands).toHaveLength(appliedCount);
  });

  it('forbids expiry after revoke', () => {
    const initial = activeSession();
    const revoked = transitionedState(
      transitionSession(initial, revokeCommand(initial)),
      'revoked',
    );
    const appliedCount = revoked.appliedCommands.length;
    const result = transitionSession(
      revoked,
      expireCommand(revoked, { commandId: commandId('expire-command') }),
    );

    expectRejectedWithoutStateChange(
      result,
      revoked,
      'forbidden_transition',
    );
    expect(revoked.status).toBe('revoked');
    expect(revoked.appliedCommands).toHaveLength(appliedCount);
  });

  it('never classifies an exact successful rotation retry as reuse', () => {
    const initial = activeSession();
    const command = rotateCommand(initial);
    const first = transitionSession(initial, command);
    const retry = transitionSession(first.state, {
      ...command,
      now: EXPIRES_AT,
    });

    expect(retry.outcome).toBe('idempotent_retry');
    expect(retry.state).toBe(first.state);
    expect(retry).toMatchObject({
      originalResult: { type: 'credential_rotated' },
    });
  });

  it('forbids a new rotation from reuse_detected', () => {
    const reused = reuseDetectedSession();
    const reuseSnapshot = structuredClone(reused.reuse);
    const appliedCount = reused.appliedCommands.length;
    const result = transitionSession(
      reused,
      rotateCommand(reused, { commandId: commandId('another-command') }),
    );

    expectRejectedWithoutStateChange(
      result,
      reused,
      'forbidden_transition',
    );
    expect(reused.reuse).toEqual(reuseSnapshot);
    expect(reused.appliedCommands).toHaveLength(appliedCount);
  });

  it('forbids revoke from reuse_detected', () => {
    const reused = reuseDetectedSession();
    const reuseSnapshot = structuredClone(reused.reuse);
    const appliedCount = reused.appliedCommands.length;
    const result = transitionSession(
      reused,
      revokeCommand(reused, { commandId: commandId('another-command') }),
    );

    expectRejectedWithoutStateChange(
      result,
      reused,
      'forbidden_transition',
    );
    expect(reused.reuse).toEqual(reuseSnapshot);
    expect(reused.appliedCommands).toHaveLength(appliedCount);
  });

  it('forbids expiry from reuse_detected', () => {
    const reused = reuseDetectedSession();
    const reuseSnapshot = structuredClone(reused.reuse);
    const appliedCount = reused.appliedCommands.length;
    const result = transitionSession(
      reused,
      expireCommand(reused, { commandId: commandId('another-command') }),
    );

    expectRejectedWithoutStateChange(
      result,
      reused,
      'forbidden_transition',
    );
    expect(reused.reuse).toEqual(reuseSnapshot);
    expect(reused.appliedCommands).toHaveLength(appliedCount);
  });

  it('repeats a forbidden terminal command deterministically', () => {
    const reused = reuseDetectedSession();
    const command = revokeCommand(reused, {
      commandId: commandId('forbidden-revoke-command'),
    });
    const appliedCount = reused.appliedCommands.length;
    const first = transitionSession(reused, command);
    const second = transitionSession(reused, command);

    expectRejectedWithoutStateChange(
      first,
      reused,
      'forbidden_transition',
    );
    expectRejectedWithoutStateChange(
      second,
      reused,
      'forbidden_transition',
    );
    expect(second.outcome).not.toBe('idempotent_retry');
    expect(reused.appliedCommands).toHaveLength(appliedCount);
  });
});

describe('session expiry', () => {
  it('allows rotation one second before expiry', () => {
    const state = activeSession();
    const result = transitionSession(
      state,
      rotateCommand(state, { now: BEFORE_EXPIRY }),
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'credential_rotated',
    });
  });

  it('rejects rotation exactly at expiry and leaves session active', () => {
    const state = activeSession();
    const result = transitionSession(
      state,
      rotateCommand(state, { now: EXPIRES_AT }),
    );

    expectRejectedWithoutStateChange(result, state, 'session_expired');
    expect(state.status).toBe('active');
  });

  it('rejects expire one second before expiry', () => {
    const state = activeSession();
    const result = transitionSession(
      state,
      expireCommand(state, { now: BEFORE_EXPIRY }),
    );

    expectRejectedWithoutStateChange(result, state, 'not_yet_expired');
  });

  it('expires active session exactly at expiry', () => {
    const state = activeSession();
    const result = transitionSession(state, expireCommand(state));

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'session_expired',
      state: {
        status: 'expired',
        expiration: { expiredAt: EXPIRES_AT, commandId: 'command-1' },
      },
    });
  });

  it('returns an idempotent retry for the exact expire command', () => {
    const state = activeSession();
    const command = expireCommand(state);
    const first = transitionSession(state, command);
    const retry = transitionSession(first.state, {
      ...command,
      now: unixEpochSeconds(EXPIRES_AT + 1),
    });

    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: {
        type: 'session_expired',
        expiration: { expiredAt: EXPIRES_AT, commandId: 'command-1' },
      },
    });
    expect(retry.state).toBe(first.state);
  });

  it('returns exact successful rotation result after expiry', () => {
    const state = activeSession();
    const command = rotateCommand(state);
    const first = transitionSession(state, command);
    const retry = transitionSession(first.state, {
      ...command,
      now: EXPIRES_AT,
    });

    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: {
        type: 'credential_rotated',
        credential: { digest: DIGEST_B, generation: 2 },
      },
    });
    expect(retry.state).toBe(first.state);
  });

  it('forbids rotation of an expired session', () => {
    const active = activeSession();
    const expired = transitionedState(
      transitionSession(active, expireCommand(active)),
      'expired',
    );
    const appliedCount = expired.appliedCommands.length;

    expectRejectedWithoutStateChange(
      transitionSession(
        expired,
        rotateCommand(expired, { commandId: commandId('rotate-command') }),
      ),
      expired,
      'forbidden_transition',
    );
    expect(expired.appliedCommands).toHaveLength(appliedCount);
  });

  it('forbids revoke of an expired session', () => {
    const active = activeSession();
    const expired = transitionedState(
      transitionSession(active, expireCommand(active)),
      'expired',
    );
    const appliedCount = expired.appliedCommands.length;

    expectRejectedWithoutStateChange(
      transitionSession(
        expired,
        revokeCommand(expired, { commandId: commandId('revoke-command') }),
      ),
      expired,
      'forbidden_transition',
    );
    expect(expired.appliedCommands).toHaveLength(appliedCount);
  });

  it('forbids a new expire command for an expired session', () => {
    const active = activeSession();
    const expired = transitionedState(
      transitionSession(active, expireCommand(active)),
      'expired',
    );
    const appliedCount = expired.appliedCommands.length;
    const result = transitionSession(
      expired,
      expireCommand(expired, { commandId: commandId('expire-command-2') }),
    );

    expectRejectedWithoutStateChange(
      result,
      expired,
      'forbidden_transition',
    );
    expect(expired.appliedCommands).toHaveLength(appliedCount);
  });

  it('does not change expired state when a consumed credential is reused', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const expired = transitionedState(
      transitionSession(
        rotated,
        expireCommand(rotated, { commandId: commandId('expire-command') }),
      ),
      'expired',
    );
    const result = transitionSession(
      expired,
      rotateCommand(expired, {
        commandId: commandId('reuse-command'),
        presentedCredential: { digest: DIGEST_A, generation: 1 },
        nextCredential: { digest: DIGEST_D, generation: 3 },
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      expired,
      'forbidden_transition',
    );
    expect(expired.status).toBe('expired');
    expect(expired.appliedCommands).toHaveLength(2);
  });

  it('repeats a rejected expiry-boundary rotation deterministically', () => {
    const state = activeSession();
    const command = rotateCommand(state, { now: EXPIRES_AT });
    const first = transitionSession(state, command);
    const second = transitionSession(state, command);

    expectRejectedWithoutStateChange(first, state, 'session_expired');
    expectRejectedWithoutStateChange(second, state, 'session_expired');
    expect(state.appliedCommands).toHaveLength(0);
  });
});

describe('session revoke', () => {
  it.each([
    'user_sign_out',
    'administrator',
    'account_blocked',
    'security_event',
    'superseded',
  ] as const)('revokes active session for %s', (reason) => {
    const state = activeSession();
    const result = transitionSession(
      state,
      revokeCommand(state, { reason }),
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'session_revoked',
      state: {
        status: 'revoked',
        revocation: { reason, commandId: 'command-1' },
      },
    });
  });

  it('returns idempotent retry for the same revoke command', () => {
    const state = activeSession();
    const command = revokeCommand(state);
    const first = transitionSession(state, command);
    const retry = transitionSession(first.state, {
      ...command,
      now: EXPIRES_AT,
    });

    expect(retry.outcome).toBe('idempotent_retry');
    expect(retry.state).toBe(first.state);
    expect(retry).toMatchObject({
      originalResult: { type: 'session_revoked' },
    });
  });

  it('rejects same revoke command ID with another reason', () => {
    const state = activeSession();
    const first = transitionSession(state, revokeCommand(state));
    const result = transitionSession(
      first.state,
      revokeCommand(first.state, { reason: 'administrator' }),
    );

    expectRejectedWithoutStateChange(
      result,
      first.state,
      'command_reuse_conflict',
    );
    expect(first.state.appliedCommands).toHaveLength(1);
  });

  it('forbids a different revoke command after terminal transition', () => {
    const state = activeSession();
    const revoked = transitionedState(
      transitionSession(state, revokeCommand(state)),
      'revoked',
    );
    const result = transitionSession(
      revoked,
      revokeCommand(revoked, { commandId: commandId('command-2') }),
    );

    expectRejectedWithoutStateChange(
      result,
      revoked,
      'forbidden_transition',
    );
  });
});

describe('session command idempotency', () => {
  it('returns saved result for an exact rotate retry after later rotation', () => {
    const initial = activeSession();
    const firstCommand = rotateCommand(initial);
    const first = transitionedState(
      transitionSession(initial, firstCommand),
      'active',
    );
    const second = transitionedState(
      transitionSession(
        first,
        rotateCommand(first, {
          commandId: commandId('command-2'),
          now: ROTATION_TIME_2,
        }),
      ),
      'active',
    );
    const retry = transitionSession(second, {
      ...firstCommand,
      now: BEFORE_EXPIRY,
    });

    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      state: { currentCredential: { digest: DIGEST_C, generation: 3 } },
      originalResult: {
        type: 'credential_rotated',
        credential: { digest: DIGEST_B, generation: 2 },
      },
    });
    expect(retry.state).toBe(second);
  });

  it.each([
    [
      'presented digest',
      (state: SessionState, command: RotateSessionCredentialCommand) => ({
        ...command,
        presentedCredential: {
          ...command.presentedCredential,
          digest: DIGEST_D,
        },
      }),
    ],
    [
      'presented generation',
      (_state: SessionState, command: RotateSessionCredentialCommand) => ({
        ...command,
        presentedCredential: {
          ...command.presentedCredential,
          generation: command.presentedCredential.generation + 1,
        },
      }),
    ],
    [
      'next digest',
      (_state: SessionState, command: RotateSessionCredentialCommand) => ({
        ...command,
        nextCredential: { ...command.nextCredential, digest: DIGEST_C },
      }),
    ],
    [
      'next generation',
      (_state: SessionState, command: RotateSessionCredentialCommand) => ({
        ...command,
        nextCredential: {
          ...command.nextCredential,
          generation: command.nextCredential.generation + 1,
        },
      }),
    ],
    [
      'request digest',
      (_state: SessionState, command: RotateSessionCredentialCommand) => ({
        ...command,
        requestDigest: requestDigest('request-2'),
      }),
    ],
    [
      'command type',
      (state: SessionState, command: RotateSessionCredentialCommand) =>
        revokeCommand(state, {
          commandId: command.commandId,
          requestDigest: command.requestDigest,
        }),
    ],
  ] as const)('rejects command ID reuse with changed %s', (_field, changedFor) => {
    const initial = activeSession();
    const command = rotateCommand(initial);
    const first = transitionSession(initial, command);
    const changed = runtimeCommand(changedFor(first.state, command));
    const result = transitionSession(first.state, changed);

    expectRejectedWithoutStateChange(
      result,
      first.state,
      'command_reuse_conflict',
    );
  });

  it('allows the same command ID in two isolated sessions', () => {
    const first = activeSession({ sessionId: sessionId('session-1') });
    const second = activeSession({ sessionId: sessionId('session-2') });
    const firstResult = transitionSession(
      first,
      rotateCommand(first, { commandId: commandId('shared-command') }),
    );
    const secondResult = transitionSession(
      second,
      rotateCommand(second, { commandId: commandId('shared-command') }),
    );

    expect(firstResult).toMatchObject({
      outcome: 'transitioned',
      state: { sessionId: 'session-1' },
    });
    expect(secondResult).toMatchObject({
      outcome: 'transitioned',
      state: { sessionId: 'session-2' },
    });
    expect(firstResult.state).not.toBe(secondResult.state);
  });
});

describe('session runtime command validation', () => {
  it.each([
    [
      'unknown command type',
      (state: SessionState) => ({
        ...rotateCommand(state),
        type: 'restore_session',
      }),
      'invalid_command_type',
    ],
    [
      'arbitrary revoke reason',
      (state: SessionState) => ({
        ...revokeCommand(state),
        reason: 'database_error',
      }),
      'invalid_revoke_reason',
    ],
    [
      'empty command ID',
      (state: SessionState) => ({
        ...rotateCommand(state),
        commandId: '',
      }),
      'invalid_command_id',
    ],
    [
      'invalid request digest',
      (state: SessionState) => ({
        ...rotateCommand(state),
        requestDigest: ' padded ',
      }),
      'invalid_request_digest',
    ],
  ] as const)('rejects %s without throwing', (_name, commandFor, commandReason) => {
    const state = activeSession();
    const result = transitionSession(state, runtimeCommand(commandFor(state)));

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason,
    });
    expect(result.state).toBe(state);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative epoch seconds', -1],
    ['fractional epoch seconds', ROTATION_TIME_1 + 0.5],
  ] as const)('rejects command time %s', (_description, now) => {
    const state = activeSession();
    const result = transitionSession(
      state,
      runtimeCommand({ ...rotateCommand(state), now }),
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason: 'invalid_time',
    });
    expect(result.state).toBe(state);
    expect(state.appliedCommands).toHaveLength(0);
  });

  it.each([
    ['digest with wrong length', 'digest', 'a'.repeat(63)],
    ['uppercase digest', 'digest', 'A'.repeat(64)],
    ['non-hex digest', 'digest', 'g'.repeat(64)],
    ['zero generation', 'generation', 0],
    ['negative generation', 'generation', -1],
    ['fractional generation', 'generation', 1.5],
    [
      'unsafe generation',
      'generation',
      Number.MAX_SAFE_INTEGER + 1,
    ],
  ] as const)(
    'rejects malformed presented credential: %s',
    (_description, field, value) => {
      const state = activeSession();
      const command = rotateCommand(state);
      const result = transitionSession(
        state,
        runtimeCommand({
          ...command,
          presentedCredential: {
            ...command.presentedCredential,
            [field]: value,
          },
        }),
      );

      expect(result).toMatchObject({
        outcome: 'rejected',
        reason: 'invalid_session_command',
        commandReason: 'invalid_presented_credential',
      });
      expect(result.state).toBe(state);
      expect(state.appliedCommands).toHaveLength(0);
    },
  );

  it.each([
    ['digest with wrong length', 'digest', 'b'.repeat(63)],
    ['uppercase digest', 'digest', 'B'.repeat(64)],
    ['non-hex digest', 'digest', 'g'.repeat(64)],
    ['zero generation', 'generation', 0],
    ['negative generation', 'generation', -1],
    ['fractional generation', 'generation', 2.5],
    [
      'unsafe generation',
      'generation',
      Number.MAX_SAFE_INTEGER + 1,
    ],
  ] as const)(
    'rejects malformed next credential: %s',
    (_description, field, value) => {
      const state = activeSession();
      const command = rotateCommand(state);
      const result = transitionSession(
        state,
        runtimeCommand({
          ...command,
          nextCredential: {
            ...command.nextCredential,
            [field]: value,
          },
        }),
      );

      expectRejectedWithoutStateChange(
        result,
        state,
        'invalid_next_credential',
      );
      expect(state.appliedCommands).toHaveLength(0);
    },
  );

  it('repeats a malformed command deterministically', () => {
    const state = activeSession();
    const command = runtimeCommand({
      ...rotateCommand(state),
      presentedCredential: { digest: 'A'.repeat(64), generation: 1 },
    });
    const first = transitionSession(state, command);
    const second = transitionSession(state, command);

    expect(first).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason: 'invalid_presented_credential',
    });
    expect(second).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason: 'invalid_presented_credential',
    });
    expect(first.state).toBe(state);
    expect(second.state).toBe(state);
    expect(second.outcome).not.toBe('idempotent_retry');
    expect(state.appliedCommands).toHaveLength(0);
  });

  it('rejects a command bound to another session', () => {
    const state = activeSession();
    const result = transitionSession(
      state,
      rotateCommand(state, { sessionId: sessionId('session-2') }),
    );

    expectRejectedWithoutStateChange(
      result,
      state,
      'session_binding_conflict',
    );
  });

  it.each([
    ['presentedCredential', 'missing_presented_credential'],
    ['nextCredential', 'missing_next_credential'],
  ] as const)('rejects rotate command missing %s', (field, commandReason) => {
    const state = activeSession();
    const command = rotateCommand(state) as unknown as Record<string, unknown>;
    delete command[field];
    const result = transitionSession(state, runtimeCommand(command));

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason,
    });
    expect(result.state).toBe(state);
  });

  it('rejects revoke command missing its reason', () => {
    const state = activeSession();
    const command = revokeCommand(state) as unknown as Record<string, unknown>;
    delete command.reason;
    const result = transitionSession(state, runtimeCommand(command));

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason: 'missing_revoke_reason',
    });
    expect(result.state).toBe(state);
  });

  it('does not preserve additional runtime command fields', () => {
    const state = activeSession();
    const runtimeRotation = {
      ...rotateCommand(state),
      rawToken: 'raw-token',
      cookie: 'session=cookie',
      authorizationHeader: 'Bearer secret',
      rawProof: 'raw-proof',
      telegramInitData: 'init-data',
      ip: '192.0.2.1',
      userAgent: 'test-agent',
      sqlError: 'database detail',
      httpError: 'http detail',
      debugMessage: 'debug detail',
      arbitraryObject: { mutable: true },
    };
    const result = transitionSession(state, runtimeCommand(runtimeRotation));
    const next = transitionedState(result, 'active');
    const applied = next.appliedCommands[0];

    for (const field of [
      'rawToken',
      'cookie',
      'authorizationHeader',
      'rawProof',
      'telegramInitData',
      'ip',
      'userAgent',
      'sqlError',
      'httpError',
      'debugMessage',
      'arbitraryObject',
    ]) {
      expect(next).not.toHaveProperty(field);
      expect(applied).not.toHaveProperty(field);
    }
  });
});

describe('session state immutability', () => {
  it('does not retain mutable rotate command references', () => {
    const state = activeSession();
    const mutableCommand = {
      ...rotateCommand(state),
      presentedCredential: { digest: DIGEST_A, generation: 1 },
      nextCredential: { digest: DIGEST_B, generation: 2 },
    };
    const result = transitionSession(state, runtimeCommand(mutableCommand));
    const next = transitionedState(result, 'active');

    mutableCommand.presentedCredential.digest = DIGEST_D;
    mutableCommand.presentedCredential.generation = 99;
    mutableCommand.nextCredential.digest = DIGEST_D;
    mutableCommand.nextCredential.generation = 99;

    expect(next.currentCredential).toMatchObject({
      digest: DIGEST_B,
      generation: 2,
    });
    expect(next.consumedCredentials[0]).toMatchObject({
      digest: DIGEST_A,
      generation: 1,
    });
    expect(next.appliedCommands[0]).toMatchObject({
      presentedCredential: { digest: DIGEST_A, generation: 1 },
      nextCredential: { digest: DIGEST_B, generation: 2 },
    });
  });

  it('clones an existing mutable consumed history during transition', () => {
    const initial = activeSession();
    const first = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    if (first.status !== 'active') {
      throw new Error('Expected active session');
    }
    const mutableConsumed = first.consumedCredentials.map((entry) => ({
      ...entry,
    }));
    const mutableState = {
      ...first,
      currentCredential: { ...first.currentCredential },
      consumedCredentials: mutableConsumed,
      appliedCommands: [...first.appliedCommands],
    } as ActiveSessionState;
    const second = transitionedState(
      transitionSession(
        mutableState,
        rotateCommand(mutableState, {
          commandId: commandId('command-2'),
          now: ROTATION_TIME_2,
        }),
      ),
      'active',
    );

    mutableConsumed[0].digest = DIGEST_D;
    mutableConsumed[0].generation = 99;

    expect(second.consumedCredentials[0]).toMatchObject({
      digest: DIGEST_A,
      generation: 1,
    });
    expect(second.consumedCredentials[0]).not.toBe(mutableConsumed[0]);
  });

  it('does not retain mutable revoke or reuse command metadata', () => {
    const active = activeSession();
    const mutableRevoke = {
      ...revokeCommand(active),
      reason: 'security_event' as SessionRevokeReason,
    };
    const revoked = transitionedState(
      transitionSession(active, runtimeCommand(mutableRevoke)),
      'revoked',
    );
    mutableRevoke.reason = 'administrator';

    expect(revoked).toMatchObject({
      status: 'revoked',
      revocation: { reason: 'security_event' },
    });

    const rotatedInitial = activeSession();
    const rotated = transitionedState(
      transitionSession(rotatedInitial, rotateCommand(rotatedInitial)),
      'active',
    );
    const mutableReuse = {
      ...rotateCommand(rotated, {
        commandId: commandId('reuse-command'),
        presentedCredential: { digest: DIGEST_A, generation: 1 },
        nextCredential: { digest: DIGEST_D, generation: 3 },
      }),
      presentedCredential: { digest: DIGEST_A, generation: 1 },
    };
    const reused = transitionedState(
      transitionSession(rotated, runtimeCommand(mutableReuse)),
      'reuse_detected',
    );
    mutableReuse.presentedCredential.digest = DIGEST_D;
    mutableReuse.presentedCredential.generation = 99;

    expect(reused).toMatchObject({
      status: 'reuse_detected',
      reuse: { digest: DIGEST_A, generation: 1 },
    });
  });

  it('returns the original state for typed refusal', () => {
    const state = activeSession();
    const snapshot = structuredClone(state);
    const command = rotateCommand(state, {
      presentedCredential: { digest: DIGEST_D, generation: 1 },
    });
    const first = transitionSession(state, command);
    const second = transitionSession(state, command);

    expectRejectedWithoutStateChange(
      first,
      state,
      'invalid_session_credential',
    );
    expectRejectedWithoutStateChange(
      second,
      state,
      'invalid_session_credential',
    );
    expect(state).toEqual(snapshot);
  });

  it('stores only epoch-second numbers and no Date instances', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );

    expect(rotated.createdAt).not.toBeInstanceOf(Date);
    expect(rotated.expiresAt).not.toBeInstanceOf(Date);
    expect(rotated.currentCredential.issuedAt).not.toBeInstanceOf(Date);
    expect(rotated.consumedCredentials[0].issuedAt).not.toBeInstanceOf(Date);
    expect(rotated.consumedCredentials[0].consumedAt).not.toBeInstanceOf(Date);
    expect(rotated.appliedCommands[0].appliedAt).not.toBeInstanceOf(Date);
    expect(Number.isSafeInteger(rotated.currentCredential.issuedAt)).toBe(true);
    expect(Number.isSafeInteger(rotated.appliedCommands[0].appliedAt)).toBe(true);
  });
});

describe('session persisted state guard', () => {
  function forgedState(value: unknown): SessionState {
    return value as SessionState;
  }

  function twiceRotatedSession(): ActiveSessionState {
    const initial = activeSession();
    const first = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    return transitionedState(
      transitionSession(
        first,
        rotateCommand(first, {
          commandId: commandId('command-2'),
          now: ROTATION_TIME_2,
        }),
      ),
      'active',
    );
  }

  function expectInvalidState(state: SessionState): void {
    const result = transitionSession(state, revokeCommand(activeSession()));
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_state',
      state,
    });
    expect(result.state).toBe(state);
  }

  it('rejects missing appliedCommands without throwing', () => {
    const active = activeSession();
    const { appliedCommands: _removed, ...withoutHistory } = active;
    const state = forgedState(withoutHistory);
    expect(() => expectInvalidState(state)).not.toThrow();
  });

  it('rejects a malformed current credential', () => {
    const active = activeSession();
    expectInvalidState(
      forgedState({
        ...active,
        currentCredential: { ...active.currentCredential, digest: 'bad' },
      }),
    );
  });

  it.each([
    [
      'duplicate consumed digest',
      (state: ActiveSessionState) => ({
        ...state,
        consumedCredentials: [
          state.consumedCredentials[0],
          {
            ...state.consumedCredentials[1],
            digest: state.consumedCredentials[0].digest,
          },
        ],
      }),
    ],
    [
      'duplicate consumed generation',
      (state: ActiveSessionState) => ({
        ...state,
        consumedCredentials: [
          state.consumedCredentials[0],
          {
            ...state.consumedCredentials[1],
            generation: state.consumedCredentials[0].generation,
          },
        ],
      }),
    ],
    [
      'a generation gap',
      (state: ActiveSessionState) => ({
        ...state,
        consumedCredentials: [
          state.consumedCredentials[0],
          { ...state.consumedCredentials[1], generation: 3 },
        ],
      }),
    ],
    [
      'current digest in consumed history',
      (state: ActiveSessionState) => ({
        ...state,
        currentCredential: {
          ...state.currentCredential,
          digest: state.consumedCredentials[0].digest,
        },
      }),
    ],
  ])('rejects %s', (_label, forge) => {
    expectInvalidState(forgedState(forge(twiceRotatedSession())));
  });

  it('rejects rotation history inconsistent with consumed credentials', () => {
    const state = twiceRotatedSession();
    const firstApplied = state.appliedCommands[0];
    if (firstApplied.commandType !== 'rotate_credential') {
      throw new Error('Expected rotation history');
    }
    expectInvalidState(
      forgedState({
        ...state,
        appliedCommands: [
          {
            ...firstApplied,
            nextCredential: { ...firstApplied.nextCredential, digest: DIGEST_D },
          },
          state.appliedCommands[1],
        ],
      }),
    );
  });

  it('rejects active state with terminal metadata', () => {
    expectInvalidState(
      forgedState({
        ...activeSession(),
        expiration: { expiredAt: EXPIRES_AT, commandId: commandId() },
      }),
    );
  });

  it('rejects expired state without expiration metadata', () => {
    const active = activeSession();
    const expired = transitionedState(
      transitionSession(active, expireCommand(active)),
      'expired',
    );
    const { expiration: _removed, ...withoutExpiration } = expired;
    expectInvalidState(forgedState(withoutExpiration));
  });

  it('rejects revoked state with an arbitrary reason', () => {
    const active = activeSession();
    const revoked = transitionedState(
      transitionSession(active, revokeCommand(active)),
      'revoked',
    );
    expectInvalidState(
      forgedState({
        ...revoked,
        revocation: { ...revoked.revocation, reason: 'database_error' },
      }),
    );
  });

  it('rejects reuse metadata for a credential absent from consumed history', () => {
    const reused = reuseDetectedSession();
    const appliedCommands = reused.appliedCommands.map((applied, index) => {
      if (
        index !== reused.appliedCommands.length - 1 ||
        applied.commandType !== 'rotate_credential' ||
        applied.result.type !== 'reuse_detected'
      ) {
        return applied;
      }
      const reuse = {
        ...applied.result.reuse,
        digest: DIGEST_D,
        generation: 1,
      };
      return {
        ...applied,
        presentedCredential: { digest: DIGEST_D, generation: 1 },
        result: { type: 'reuse_detected', reuse },
      };
    });
    expectInvalidState(
      forgedState({
        ...reused,
        reuse: { ...reused.reuse, digest: DIGEST_D, generation: 1 },
        appliedCommands,
      }),
    );
  });

  it('rejects duplicate applied command IDs', () => {
    const state = twiceRotatedSession();
    expectInvalidState(
      forgedState({
        ...state,
        appliedCommands: [
          state.appliedCommands[0],
          {
            ...state.appliedCommands[1],
            commandId: state.appliedCommands[0].commandId,
          },
        ],
      }),
    );
  });

  it('rejects a terminal state without the command that created it', () => {
    const active = activeSession();
    const expired = transitionedState(
      transitionSession(active, expireCommand(active)),
      'expired',
    );
    expectInvalidState(forgedState({ ...expired, appliedCommands: [] }));
  });

  it('preserves malformed state and history by reference and value', () => {
    const valid = twiceRotatedSession();
    const state = forgedState({
      ...valid,
      consumedCredentials: [
        valid.consumedCredentials[0],
        {
          ...valid.consumedCredentials[1],
          generation: valid.consumedCredentials[0].generation,
        },
      ],
    });
    const snapshot = structuredClone(state);
    const result = transitionSession(state, revokeCommand(activeSession()));
    expect(result.state).toBe(state);
    expect(state).toEqual(snapshot);
  });

  it('rejects a new command before session creation', () => {
    const active = activeSession();
    const result = transitionSession(
      active,
      revokeCommand(active, { now: unixEpochSeconds(CREATED_AT - 1) }),
    );
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason: 'invalid_time',
      state: active,
    });
  });

  it('rejects a command older than the latest applied transition', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const result = transitionSession(
      rotated,
      revokeCommand(rotated, {
        commandId: commandId('command-2'),
        now: unixEpochSeconds(ROTATION_TIME_1 - 1),
      }),
    );
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_command',
      commandReason: 'invalid_time',
      state: rotated,
    });
  });

  it('does not persist a malformed next credential during reuse detection', () => {
    const initial = activeSession();
    const rotated = transitionedState(
      transitionSession(initial, rotateCommand(initial)),
      'active',
    );
    const result = transitionSession(
      rotated,
      rotateCommand(rotated, {
        commandId: commandId('reuse-command'),
        presentedCredential: { digest: DIGEST_A, generation: 1 },
        nextCredential: {
          digest: 'bad' as SessionCredentialDigest,
          generation: 3,
        },
      }),
    );
    expectRejectedWithoutStateChange(
      result,
      rotated,
      'invalid_next_credential',
    );
  });
});
