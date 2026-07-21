import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds, unixEpochSeconds } from './auth.types';
import {
  FreshAuthenticationEvidence,
  FreshAuthenticationEvidenceId,
  createFreshAuthenticationEvidence,
} from './fresh-authentication.types';
import {
  CreateScopedGrantBinding,
  ExpireGrantCommand,
  RevokeGrantCommand,
  SCOPED_GRANT_REVOKE_REASONS,
  SCOPED_GRANT_SCOPES,
  ScopedGrantCommand,
  ScopedGrantCommandId,
  ScopedGrantId,
  ScopedGrantRequestDigest,
  ScopedGrantResourceDigest,
  ScopedGrantRevokeReason,
  ScopedGrantScope,
  ScopedGrantState,
  ScopedGrantTransitionResult,
  ConsumeGrantCommand,
  createScopedGrant,
  transitionScopedGrant as transitionScopedGrantReducer,
} from './scoped-grant.state-machine';
import {
  createActiveSession,
  transitionSession,
} from './session.state-machine';
import {
  ActiveSessionState,
  CreateActiveSessionBinding,
  SessionCommandId,
  SessionCredentialDigest,
  SessionId,
  SessionRequestDigest,
  SessionState,
} from './session.types';

const ACCOUNT_ID = 'account-1' as AccountId;
const SESSION_ID = 'session-1' as SessionId;
const SESSION_CREATED_AT = unixEpochSeconds(1_784_635_000);
const EVIDENCE_AUTHENTICATED_AT = unixEpochSeconds(1_784_635_100);
const GRANT_CREATED_AT = unixEpochSeconds(1_784_635_200);
const CONSUME_AT = unixEpochSeconds(1_784_635_300);
const GRANT_EXPIRES_AT = unixEpochSeconds(1_784_635_400);
const EVIDENCE_EXPIRES_AT = unixEpochSeconds(1_784_635_500);
const SESSION_EXPIRES_AT = unixEpochSeconds(1_784_636_000);
const SESSION_DIGEST_A = '1'.repeat(64) as SessionCredentialDigest;
const SESSION_DIGEST_B = '2'.repeat(64) as SessionCredentialDigest;
const SESSION_DIGEST_C = '3'.repeat(64) as SessionCredentialDigest;
const RESOURCE_A = 'a'.repeat(64) as ScopedGrantResourceDigest;
const RESOURCE_B = 'b'.repeat(64) as ScopedGrantResourceDigest;
const REQUEST_A = 'c'.repeat(64) as ScopedGrantRequestDigest;
const REQUEST_B = 'd'.repeat(64) as ScopedGrantRequestDigest;

function grantId(value = 'grant-1'): ScopedGrantId {
  return value as ScopedGrantId;
}

function grantCommandId(value = 'grant-command-1'): ScopedGrantCommandId {
  return value as ScopedGrantCommandId;
}

function activeSession(
  overrides: Partial<CreateActiveSessionBinding> = {},
): ActiveSessionState {
  const result = createActiveSession({
    sessionId: SESSION_ID,
    accountId: ACCOUNT_ID,
    createdAt: SESSION_CREATED_AT,
    expiresAt: SESSION_EXPIRES_AT,
    currentCredential: {
      digest: SESSION_DIGEST_A,
      generation: 1,
      issuedAt: SESSION_CREATED_AT,
    },
    ...overrides,
  });
  if (result.outcome !== 'created') {
    throw new Error('Expected active test session');
  }
  return result.state;
}

function evidence(
  overrides: Partial<FreshAuthenticationEvidence> = {},
): FreshAuthenticationEvidence {
  const result = createFreshAuthenticationEvidence({
    evidenceId: 'evidence-1' as FreshAuthenticationEvidenceId,
    accountId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    verificationMethod: 'external_identity',
    authenticatedAt: EVIDENCE_AUTHENTICATED_AT,
    expiresAt: EVIDENCE_EXPIRES_AT,
    ...overrides,
  });
  if (result.outcome !== 'created') {
    throw new Error('Expected valid test evidence');
  }
  return result.evidence;
}

function grantBinding(
  overrides: Partial<CreateScopedGrantBinding> = {},
): CreateScopedGrantBinding {
  return {
    grantId: grantId(),
    evidence: evidence(),
    session: activeSession(),
    scope: 'link_identity',
    resourceDigest: RESOURCE_A,
    createdAt: GRANT_CREATED_AT,
    expiresAt: GRANT_EXPIRES_AT,
    ...overrides,
  };
}

function activeGrant(
  overrides: Partial<CreateScopedGrantBinding> = {},
): Extract<ScopedGrantState, { status: 'active' }> {
  const result = createScopedGrant(grantBinding(overrides));
  if (result.outcome !== 'created') {
    throw new Error(`Expected active test grant: ${result.reason}`);
  }
  return result.state;
}

function consumeCommand(
  state: ScopedGrantState,
  overrides: Partial<ConsumeGrantCommand> = {},
): ConsumeGrantCommand {
  return {
    type: 'consume_grant',
    grantId: state.grantId,
    commandId: grantCommandId(),
    now: CONSUME_AT,
    accountId: state.accountId,
    sessionId: state.sessionId,
    scope: state.scope,
    resourceDigest: state.resourceDigest,
    requestDigest: REQUEST_A,
    ...overrides,
  };
}

function revokeCommand(
  state: ScopedGrantState,
  overrides: Partial<RevokeGrantCommand> = {},
): RevokeGrantCommand {
  return {
    type: 'revoke_grant',
    grantId: state.grantId,
    commandId: grantCommandId(),
    now: CONSUME_AT,
    reason: 'user_cancelled',
    requestDigest: REQUEST_A,
    ...overrides,
  };
}

function expireCommand(
  state: ScopedGrantState,
  overrides: Partial<ExpireGrantCommand> = {},
): ExpireGrantCommand {
  return {
    type: 'expire_grant',
    grantId: state.grantId,
    commandId: grantCommandId(),
    now: GRANT_EXPIRES_AT,
    requestDigest: REQUEST_A,
    ...overrides,
  };
}

function runtimeCommand(value: unknown): ScopedGrantCommand {
  return value as ScopedGrantCommand;
}

function transitionScopedGrant(
  state: ScopedGrantState,
  command: ScopedGrantCommand,
  sessionContext?: SessionState,
): ScopedGrantTransitionResult {
  return transitionScopedGrantReducer(
    state,
    command,
    command.type === 'consume_grant'
      ? { session: sessionContext ?? activeSession() }
      : undefined,
  );
}

function transitionedState<Status extends ScopedGrantState['status']>(
  result: ScopedGrantTransitionResult,
  status: Status,
): Extract<ScopedGrantState, { status: Status }> {
  expect(result).toMatchObject({ outcome: 'transitioned', state: { status } });
  if (result.outcome !== 'transitioned' || result.state.status !== status) {
    throw new Error(`Expected transitioned ${status} grant`);
  }
  return result.state as Extract<ScopedGrantState, { status: Status }>;
}

function expectRejectedWithoutStateChange(
  result: ScopedGrantTransitionResult,
  state: ScopedGrantState,
  reason: string,
): void {
  expect(result).toMatchObject({ outcome: 'rejected', reason });
  expect(result.state).toBe(state);
}

function expectInvalidSessionContext(session: unknown): void {
  const active = activeGrant();
  const appliedCommands = active.appliedCommands;
  let result: ScopedGrantTransitionResult | undefined;

  expect(() => {
    result = transitionScopedGrantReducer(active, consumeCommand(active), {
      session: session as SessionState,
    });
  }).not.toThrow();
  expect(result).toBeDefined();
  expectRejectedWithoutStateChange(
    result as ScopedGrantTransitionResult,
    active,
    'invalid_session_context',
  );
  expect(active).not.toHaveProperty('consumption');
  expect(active.appliedCommands).toBe(appliedCommands);
  expect(active.appliedCommands).toHaveLength(0);
}

function terminalGrant(
  status: 'consumed' | 'expired' | 'revoked',
): Exclude<ScopedGrantState, { status: 'active' }> {
  const active = activeGrant();
  if (status === 'consumed') {
    return transitionedState(
      transitionScopedGrant(active, consumeCommand(active)),
      'consumed',
    );
  }
  if (status === 'expired') {
    return transitionedState(
      transitionScopedGrant(active, expireCommand(active)),
      'expired',
    );
  }
  return transitionedState(
    transitionScopedGrant(active, revokeCommand(active)),
    'revoked',
  );
}

function sessionCommandId(value: string): SessionCommandId {
  return value as SessionCommandId;
}

function sessionRequestDigest(value: string): SessionRequestDigest {
  return value as SessionRequestDigest;
}

function revokedSession(): SessionState {
  const active = activeSession();
  const result = transitionSession(active, {
    type: 'revoke_session',
    sessionId: active.sessionId,
    commandId: sessionCommandId('session-revoke'),
    now: GRANT_CREATED_AT,
    requestDigest: sessionRequestDigest('session-request'),
    reason: 'security_event',
  });
  return result.state;
}

function expiredSession(): SessionState {
  const active = activeSession();
  const result = transitionSession(active, {
    type: 'expire_session',
    sessionId: active.sessionId,
    commandId: sessionCommandId('session-expire'),
    now: SESSION_EXPIRES_AT,
    requestDigest: sessionRequestDigest('session-request'),
  });
  return result.state;
}

function reuseDetectedSession(): SessionState {
  const active = activeSession();
  const rotated = transitionSession(active, {
    type: 'rotate_credential',
    sessionId: active.sessionId,
    commandId: sessionCommandId('session-rotate'),
    now: CONSUME_AT,
    requestDigest: sessionRequestDigest('session-rotate-request'),
    presentedCredential: { digest: SESSION_DIGEST_A, generation: 1 },
    nextCredential: { digest: SESSION_DIGEST_B, generation: 2 },
  }).state;
  return transitionSession(rotated, {
    type: 'rotate_credential',
    sessionId: rotated.sessionId,
    commandId: sessionCommandId('session-reuse'),
    now: unixEpochSeconds(CONSUME_AT + 1),
    requestDigest: sessionRequestDigest('session-reuse-request'),
    presentedCredential: { digest: SESSION_DIGEST_A, generation: 1 },
    nextCredential: { digest: SESSION_DIGEST_C, generation: 3 },
  }).state;
}

describe('scoped grant creation', () => {
  it.each(SCOPED_GRANT_SCOPES)('creates an active grant for scope %s', (scope) => {
    const result = createScopedGrant(grantBinding({ scope }));

    expect(result).toMatchObject({
      outcome: 'created',
      state: {
        status: 'active',
        grantId: 'grant-1',
        evidenceId: 'evidence-1',
        accountId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        scope,
        resourceDigest: RESOURCE_A,
        appliedCommands: [],
      },
    });
  });

  it.each([
    ['revoked', revokedSession],
    ['expired', expiredSession],
    ['reuse_detected', reuseDetectedSession],
  ] as const)('rejects a %s session', (_status, sessionFor) => {
    expect(createScopedGrant(grantBinding({ session: sessionFor() }))).toEqual({
      outcome: 'rejected',
      reason: 'session_not_active',
    });
  });

  it('rejects a formally active session exactly at its expiry', () => {
    const session = activeSession({ expiresAt: GRANT_CREATED_AT });

    expect(createScopedGrant(grantBinding({ session }))).toEqual({
      outcome: 'rejected',
      reason: 'session_expired',
    });
  });

  it('rejects a formally active session after its expiry', () => {
    const session = activeSession({
      expiresAt: unixEpochSeconds(GRANT_CREATED_AT - 1),
    });

    expect(createScopedGrant(grantBinding({ session }))).toEqual({
      outcome: 'rejected',
      reason: 'session_expired',
    });
  });

  it('rejects grant expiry later than session expiry', () => {
    const session = activeSession({
      expiresAt: unixEpochSeconds(GRANT_EXPIRES_AT - 1),
    });

    expect(createScopedGrant(grantBinding({ session }))).toEqual({
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'grant_expiry_exceeds_session',
    });
  });

  it('allows grant expiry exactly at session expiry', () => {
    const session = activeSession({ expiresAt: GRANT_EXPIRES_AT });

    expect(createScopedGrant(grantBinding({ session }))).toMatchObject({
      outcome: 'created',
      state: { status: 'active', expiresAt: GRANT_EXPIRES_AT },
    });
  });

  it('rejects grant creation before the session starts', () => {
    const sessionStartsAt = unixEpochSeconds(GRANT_CREATED_AT + 1);
    const session = activeSession({
      createdAt: sessionStartsAt,
      currentCredential: {
        digest: SESSION_DIGEST_A,
        generation: 1,
        issuedAt: sessionStartsAt,
      },
    });

    expect(createScopedGrant(grantBinding({ session }))).toEqual({
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'grant_created_before_session',
    });
  });

  it('rejects grant creation before fresh authentication', () => {
    const futureEvidence = evidence({
      authenticatedAt: unixEpochSeconds(GRANT_CREATED_AT + 1),
    });

    expect(
      createScopedGrant(grantBinding({ evidence: futureEvidence })),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'grant_created_before_evidence',
    });
  });

  it('allows grant creation exactly at fresh authentication time', () => {
    const currentEvidence = evidence({ authenticatedAt: GRANT_CREATED_AT });

    expect(
      createScopedGrant(grantBinding({ evidence: currentEvidence })),
    ).toMatchObject({ outcome: 'created', state: { status: 'active' } });
  });

  it('rejects evidence account mismatch', () => {
    const session = activeSession({ accountId: 'account-2' as AccountId });
    expect(createScopedGrant(grantBinding({ session }))).toEqual({
      outcome: 'rejected',
      reason: 'evidence_binding_mismatch',
    });
  });

  it('rejects evidence session mismatch', () => {
    const session = activeSession({ sessionId: 'session-2' as SessionId });
    expect(createScopedGrant(grantBinding({ session }))).toEqual({
      outcome: 'rejected',
      reason: 'evidence_binding_mismatch',
    });
  });

  it('rejects expired evidence', () => {
    const expiredEvidence = evidence({ expiresAt: GRANT_CREATED_AT });
    expect(
      createScopedGrant(grantBinding({ evidence: expiredEvidence })),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_fresh_authentication_evidence',
    });
  });

  it('rejects grant expiry later than evidence expiry', () => {
    expect(
      createScopedGrant(
        grantBinding({ expiresAt: unixEpochSeconds(EVIDENCE_EXPIRES_AT + 1) }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'grant_expiry_exceeds_evidence',
    });
  });

  it.each([
    ['grantId', '', 'invalid_grant_id'],
    ['scope', 'delete_immediately', 'invalid_scope'],
    ['resourceDigest', 'not-a-digest', 'invalid_resource_digest'],
    ['createdAt', Number.NaN, 'invalid_created_at'],
    ['expiresAt', Number.POSITIVE_INFINITY, 'invalid_expires_at'],
  ] as const)('rejects invalid grant binding %s', (field, value, bindingReason) => {
    expect(
      createScopedGrant(
        grantBinding({ [field]: value } as Partial<CreateScopedGrantBinding>),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason,
    });
  });

  it('rejects an invalid grant time window', () => {
    expect(
      createScopedGrant(
        grantBinding({
          createdAt: GRANT_EXPIRES_AT,
          expiresAt: GRANT_EXPIRES_AT,
        }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_scoped_grant_binding',
      bindingReason: 'invalid_grant_window',
    });
  });

  it('drops additional runtime fields from grant state', () => {
    const runtimeBinding = {
      ...grantBinding(),
      rawProof: 'proof',
      telegramInitData: 'init-data',
      otpCode: '123456',
      rawToken: 'token',
      cookie: 'cookie',
      httpError: 'http',
      sqlError: 'sql',
      ip: '192.0.2.1',
      userAgent: 'agent',
      debugMessage: 'debug',
      nested: { mutable: true },
    };
    const result = createScopedGrant(runtimeBinding);
    if (result.outcome !== 'created') {
      throw new Error('Expected active grant');
    }

    for (const field of [
      'rawProof',
      'telegramInitData',
      'otpCode',
      'rawToken',
      'cookie',
      'httpError',
      'sqlError',
      'ip',
      'userAgent',
      'debugMessage',
      'nested',
      'evidence',
      'session',
    ]) {
      expect(result.state).not.toHaveProperty(field);
    }
  });
});

describe('scoped grant consume', () => {
  it('consumes with the same current active session', () => {
    const session = activeSession();
    const active = activeGrant({ session });
    const result = transitionScopedGrant(
      active,
      consumeCommand(active),
      session,
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'grant_consumed',
    });
  });

  it('consumes a matching active grant exactly once', () => {
    const active = activeGrant();
    const result = transitionScopedGrant(active, consumeCommand(active));
    const consumed = transitionedState(result, 'consumed');

    expect(consumed).toMatchObject({
      status: 'consumed',
      consumption: {
        consumedAt: CONSUME_AT,
        commandId: 'grant-command-1',
      },
      appliedCommands: [{ commandType: 'consume_grant' }],
    });
    expect(active.status).toBe('active');
    expect(active.appliedCommands).toHaveLength(0);
  });

  it.each([
    ['revoked', revokedSession],
    ['expired', expiredSession],
    ['reuse_detected', reuseDetectedSession],
  ] as const)(
    'rejects consume with a current %s session',
    (_status, sessionFor) => {
      const active = activeGrant();
      const result = transitionScopedGrant(
        active,
        consumeCommand(active),
        sessionFor(),
      );

      expectRejectedWithoutStateChange(result, active, 'session_not_active');
      expect(active).not.toHaveProperty('consumption');
      expect(active.appliedCommands).toHaveLength(0);
    },
  );

  it('rejects consume when a formally active session reaches expiry', () => {
    const active = activeGrant();
    const expiredActiveSession = activeSession({ expiresAt: CONSUME_AT });
    const result = transitionScopedGrant(
      active,
      consumeCommand(active, { now: CONSUME_AT }),
      expiredActiveSession,
    );

    expectRejectedWithoutStateChange(result, active, 'session_expired');
    expect(active).not.toHaveProperty('consumption');
    expect(active.appliedCommands).toHaveLength(0);
  });

  it.each([
    [
      'session ID',
      () => activeSession({ sessionId: 'session-2' as SessionId }),
    ],
    [
      'account ID',
      () => activeSession({ accountId: 'account-2' as AccountId }),
    ],
  ] as const)(
    'rejects consume with a current session %s mismatch',
    (_field, sessionFor) => {
      const active = activeGrant();
      const result = transitionScopedGrant(
        active,
        consumeCommand(active),
        sessionFor(),
      );

      expectRejectedWithoutStateChange(
        result,
        active,
        'session_binding_mismatch',
      );
      expect(active).not.toHaveProperty('consumption');
      expect(active.appliedCommands).toHaveLength(0);
    },
  );

  it('rejects consume without current session context', () => {
    const active = activeGrant();
    const result = transitionScopedGrantReducer(
      active,
      consumeCommand(active),
    );

    expectRejectedWithoutStateChange(
      result,
      active,
      'invalid_session_context',
    );
    expect(active.appliedCommands).toHaveLength(0);
  });

  it('rejects malformed current session context', () => {
    expectInvalidSessionContext({});
  });

  it('rejects an active session context without current credential', () => {
    const { currentCredential: _currentCredential, ...partial } =
      activeSession();

    expectInvalidSessionContext(partial);
  });

  it('rejects an active session context without consumed history', () => {
    const { consumedCredentials: _consumedCredentials, ...partial } =
      activeSession();

    expectInvalidSessionContext(partial);
  });

  it('rejects an active session context without applied command history', () => {
    const { appliedCommands: _appliedCommands, ...partial } = activeSession();

    expectInvalidSessionContext(partial);
  });

  it('rejects an active session context with malformed current digest', () => {
    const session = activeSession();

    expectInvalidSessionContext({
      ...session,
      currentCredential: { ...session.currentCredential, digest: 'not-a-digest' },
    });
  });

  it('rejects an active session context with invalid current generation', () => {
    const session = activeSession();

    expectInvalidSessionContext({
      ...session,
      currentCredential: { ...session.currentCredential, generation: 0 },
    });
  });

  it('rejects an active session context with malformed consumed history', () => {
    const session = activeSession();

    expectInvalidSessionContext({
      ...session,
      consumedCredentials: [
        {
          digest: 'not-a-digest',
          generation: 1,
          issuedAt: SESSION_CREATED_AT,
          consumedAt: CONSUME_AT,
          consumedByCommandId: sessionCommandId('session-rotate'),
        },
      ],
    });
  });

  it('rejects an active session context with malformed applied history', () => {
    const session = activeSession();

    expectInvalidSessionContext({
      ...session,
      appliedCommands: [{ commandType: 'rotate_credential' }],
    });
  });

  it.each([
    ['revoked', revokedSession, 'revocation'],
    ['expired', expiredSession, 'expiration'],
    ['reuse_detected', reuseDetectedSession, 'reuse'],
  ] as const)(
    'rejects a partial %s session context without terminal metadata',
    (_status, sessionFor, metadataField) => {
      const session = sessionFor();
      const partial = { ...session } as Record<string, unknown>;
      delete partial[metadataField];

      expectInvalidSessionContext(partial);
    },
  );

  it('accepts a complete active SessionState context', () => {
    const session = activeSession();
    const active = activeGrant({ session });
    const result = transitionScopedGrant(
      active,
      consumeCommand(active),
      session,
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'grant_consumed',
    });
  });

  it.each([
    ['accountId', 'account-2', 'account_mismatch'],
    ['sessionId', 'session-2', 'session_mismatch'],
    ['scope', 'unlink_identity', 'scope_mismatch'],
    ['resourceDigest', RESOURCE_B, 'resource_mismatch'],
  ] as const)('rejects consume %s mismatch', (field, value, reason) => {
    const active = activeGrant();
    const result = transitionScopedGrant(
      active,
      consumeCommand(active, {
        [field]: value,
      } as Partial<ConsumeGrantCommand>),
    );

    expectRejectedWithoutStateChange(result, active, reason);
    expect(active.appliedCommands).toHaveLength(0);
  });

  it('consumes one second before expiry', () => {
    const active = activeGrant();
    const result = transitionScopedGrant(
      active,
      consumeCommand(active, {
        now: unixEpochSeconds(GRANT_EXPIRES_AT - 1),
      }),
    );
    expect(result).toMatchObject({ outcome: 'transitioned' });
  });

  it('rejects consume exactly at expiry', () => {
    const active = activeGrant();
    const result = transitionScopedGrant(
      active,
      consumeCommand(active, { now: GRANT_EXPIRES_AT }),
    );
    expectRejectedWithoutStateChange(result, active, 'grant_expired');
  });

  it('forbids a second consume with another command ID', () => {
    const active = activeGrant();
    const consumed = transitionedState(
      transitionScopedGrant(active, consumeCommand(active)),
      'consumed',
    );
    const result = transitionScopedGrant(
      consumed,
      consumeCommand(consumed, {
        commandId: grantCommandId('grant-command-2'),
      }),
    );
    expectRejectedWithoutStateChange(result, consumed, 'forbidden_transition');
    expect(consumed.appliedCommands).toHaveLength(1);
  });
});

describe('scoped grant revoke and expiry', () => {
  it.each(SCOPED_GRANT_REVOKE_REASONS)('revokes grant for %s', (reason) => {
    const active = activeGrant();
    const result = transitionScopedGrant(
      active,
      revokeCommand(active, { reason }),
    );
    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'grant_revoked',
      state: { status: 'revoked', revocation: { reason } },
    });
  });

  it('rejects early expiry', () => {
    const active = activeGrant();
    const result = transitionScopedGrant(
      active,
      expireCommand(active, {
        now: unixEpochSeconds(GRANT_EXPIRES_AT - 1),
      }),
    );
    expectRejectedWithoutStateChange(result, active, 'not_yet_expired');
  });

  it('expires grant exactly at boundary', () => {
    const active = activeGrant();
    const result = transitionScopedGrant(active, expireCommand(active));
    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'grant_expired',
      state: { status: 'expired', expiration: { expiredAt: GRANT_EXPIRES_AT } },
    });
  });

  it.each([
    ['consumed', 'consume_grant'],
    ['consumed', 'revoke_grant'],
    ['consumed', 'expire_grant'],
    ['expired', 'consume_grant'],
    ['expired', 'revoke_grant'],
    ['expired', 'expire_grant'],
    ['revoked', 'consume_grant'],
    ['revoked', 'revoke_grant'],
    ['revoked', 'expire_grant'],
  ] as const)('forbids %s command after %s', (status, commandType) => {
    const terminal = terminalGrant(status);
    const command =
      commandType === 'consume_grant'
        ? consumeCommand(terminal, {
            commandId: grantCommandId('new-command'),
          })
        : commandType === 'revoke_grant'
          ? revokeCommand(terminal, {
              commandId: grantCommandId('new-command'),
            })
          : expireCommand(terminal, {
              commandId: grantCommandId('new-command'),
            });
    const result = transitionScopedGrant(terminal, command);

    expectRejectedWithoutStateChange(
      result,
      terminal,
      'forbidden_transition',
    );
    expect(terminal.appliedCommands).toHaveLength(1);
  });
});

describe('scoped grant idempotency', () => {
  it('returns exact consume result after expiry', () => {
    const active = activeGrant();
    const command = consumeCommand(active);
    const first = transitionScopedGrant(active, command);
    const retry = transitionScopedGrant(first.state, {
      ...command,
      now: GRANT_EXPIRES_AT,
    });

    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: { type: 'grant_consumed' },
    });
    expect(retry.state).toBe(first.state);
  });

  it.each([
    ['revoked', revokedSession],
    ['expired', expiredSession],
    ['reuse_detected', reuseDetectedSession],
  ] as const)(
    'returns exact consume retry after session becomes %s',
    (_status, sessionFor) => {
      const currentSession = activeSession();
      const active = activeGrant({ session: currentSession });
      const command = consumeCommand(active);
      const first = transitionScopedGrant(active, command, currentSession);
      const retry = transitionScopedGrantReducer(
        first.state,
        { ...command, now: GRANT_EXPIRES_AT },
        { session: sessionFor() },
      );

      expect(retry).toMatchObject({
        outcome: 'idempotent_retry',
        originalResult: { type: 'grant_consumed' },
      });
      expect(retry.state).toBe(first.state);
      expect(retry.state.appliedCommands).toHaveLength(1);
    },
  );

  it('returns exact revoke result after expiry', () => {
    const active = activeGrant();
    const command = revokeCommand(active);
    const first = transitionScopedGrant(active, command);
    const retry = transitionScopedGrant(first.state, {
      ...command,
      now: GRANT_EXPIRES_AT,
    });
    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: { type: 'grant_revoked' },
    });
    expect(retry.state).toBe(first.state);
  });

  it('returns exact expire result', () => {
    const active = activeGrant();
    const command = expireCommand(active);
    const first = transitionScopedGrant(active, command);
    const retry = transitionScopedGrant(first.state, {
      ...command,
      now: unixEpochSeconds(GRANT_EXPIRES_AT + 1),
    });
    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: { type: 'grant_expired' },
    });
    expect(retry.state).toBe(first.state);
  });

  it.each([
    ['account ID', (command: ConsumeGrantCommand) => ({
      ...command,
      accountId: 'account-2' as AccountId,
    })],
    ['session ID', (command: ConsumeGrantCommand) => ({
      ...command,
      sessionId: 'session-2' as SessionId,
    })],
    ['scope', (command: ConsumeGrantCommand) => ({
      ...command,
      scope: 'unlink_identity' as ScopedGrantScope,
    })],
    ['resource digest', (command: ConsumeGrantCommand) => ({
      ...command,
      resourceDigest: RESOURCE_B,
    })],
    ['request digest', (command: ConsumeGrantCommand) => ({
      ...command,
      requestDigest: REQUEST_B,
    })],
  ] as const)('rejects command ID reuse with changed %s', (_field, change) => {
    const active = activeGrant();
    const command = consumeCommand(active);
    const first = transitionScopedGrant(active, command);
    const result = transitionScopedGrant(first.state, change(command));

    expectRejectedWithoutStateChange(
      result,
      first.state,
      'command_reuse_conflict',
    );
  });

  it('rejects revoke command ID reuse with another reason', () => {
    const active = activeGrant();
    const command = revokeCommand(active, { reason: 'user_cancelled' });
    const first = transitionScopedGrant(active, command);
    const result = transitionScopedGrant(first.state, {
      ...command,
      reason: 'security_event',
    });

    expectRejectedWithoutStateChange(
      result,
      first.state,
      'command_reuse_conflict',
    );
  });

  it('rejects another command type with the same command ID', () => {
    const active = activeGrant();
    const command = consumeCommand(active);
    const first = transitionScopedGrant(active, command);
    const result = transitionScopedGrant(
      first.state,
      revokeCommand(first.state, {
        commandId: command.commandId,
        requestDigest: command.requestDigest,
      }),
    );
    expectRejectedWithoutStateChange(
      result,
      first.state,
      'command_reuse_conflict',
    );
  });

  it('allows the same command ID in two grants', () => {
    const first = activeGrant({ grantId: grantId('grant-1') });
    const second = activeGrant({ grantId: grantId('grant-2') });
    const firstResult = transitionScopedGrant(first, consumeCommand(first));
    const secondResult = transitionScopedGrant(second, consumeCommand(second));

    expect(firstResult).toMatchObject({ outcome: 'transitioned' });
    expect(secondResult).toMatchObject({ outcome: 'transitioned' });
    expect(firstResult.state.grantId).toBe('grant-1');
    expect(secondResult.state.grantId).toBe('grant-2');
  });
});

describe('scoped grant runtime validation and minimization', () => {
  it.each([
    ['unknown command type', { type: 'restore_grant' }, 'invalid_command_type'],
    ['empty grant ID', { grantId: '' }, 'invalid_grant_id'],
    ['padded grant ID', { grantId: ' grant-1 ' }, 'invalid_grant_id'],
    ['control grant ID', { grantId: 'grant\n1' }, 'invalid_grant_id'],
    ['long grant ID', { grantId: 'g'.repeat(257) }, 'invalid_grant_id'],
    ['empty command ID', { commandId: '' }, 'invalid_command_id'],
    ['padded command ID', { commandId: ' command-1 ' }, 'invalid_command_id'],
    ['control command ID', { commandId: 'command\n1' }, 'invalid_command_id'],
    [
      'long command ID',
      { commandId: 'c'.repeat(257) },
      'invalid_command_id',
    ],
    ['invalid request digest', { requestDigest: 'bad' }, 'invalid_request_digest'],
    ['NaN time', { now: Number.NaN }, 'invalid_time'],
    ['infinite time', { now: Number.POSITIVE_INFINITY }, 'invalid_time'],
    ['negative time', { now: -1 }, 'invalid_time'],
    ['fractional time', { now: CONSUME_AT + 0.5 }, 'invalid_time'],
    ['unknown scope', { scope: 'delete_immediately' }, 'invalid_scope'],
    ['invalid resource digest', { resourceDigest: 'bad' }, 'invalid_resource_digest'],
  ] as const)('rejects %s', (_description, changes, commandReason) => {
    const active = activeGrant();
    const result = transitionScopedGrant(
      active,
      runtimeCommand({ ...consumeCommand(active), ...changes }),
    );
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_grant_command',
      commandReason,
    });
    expect(result.state).toBe(active);
  });

  it('rejects a command bound to another grant', () => {
    const active = activeGrant();
    const result = transitionScopedGrant(
      active,
      consumeCommand(active, { grantId: grantId('grant-2') }),
    );

    expectRejectedWithoutStateChange(
      result,
      active,
      'grant_binding_conflict',
    );
    expect(active.appliedCommands).toHaveLength(0);
  });

  it('rejects consume with missing payload', () => {
    const active = activeGrant();
    const command = consumeCommand(active) as unknown as Record<string, unknown>;
    delete command.scope;
    const result = transitionScopedGrant(active, runtimeCommand(command));
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_grant_command',
      commandReason: 'missing_consume_binding',
    });
    expect(result.state).toBe(active);
  });

  it('rejects unknown revoke reason', () => {
    const active = activeGrant();
    const result = transitionScopedGrant(
      active,
      runtimeCommand({ ...revokeCommand(active), reason: 'database_error' }),
    );
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_grant_command',
      commandReason: 'invalid_revoke_reason',
    });
    expect(result.state).toBe(active);
  });

  it('does not preserve additional command fields', () => {
    const active = activeGrant();
    const runtimeConsume = {
      ...consumeCommand(active),
      rawProof: 'proof',
      telegramInitData: 'init-data',
      otpCode: '123456',
      rawToken: 'token',
      cookie: 'cookie',
      httpError: 'http',
      sqlError: 'sql',
      ip: '192.0.2.1',
      userAgent: 'agent',
      debugMessage: 'debug',
      nested: { mutable: true },
    };
    const result = transitionScopedGrant(active, runtimeCommand(runtimeConsume));
    const consumed = transitionedState(result, 'consumed');
    const applied = consumed.appliedCommands[0];

    for (const field of [
      'rawProof',
      'telegramInitData',
      'otpCode',
      'rawToken',
      'cookie',
      'httpError',
      'sqlError',
      'ip',
      'userAgent',
      'debugMessage',
      'nested',
    ]) {
      expect(consumed).not.toHaveProperty(field);
      expect(applied).not.toHaveProperty(field);
    }
  });
});

describe('scoped grant immutability', () => {
  it('does not retain mutable session or grant binding references', () => {
    const sourceSession = activeSession();
    const mutableSession = {
      ...sourceSession,
      currentCredential: { ...sourceSession.currentCredential },
      consumedCredentials: [...sourceSession.consumedCredentials],
      appliedCommands: [...sourceSession.appliedCommands],
    } as ActiveSessionState;
    const mutableBinding = {
      ...grantBinding({ session: mutableSession }),
      evidence: { ...evidence() },
    };
    const result = createScopedGrant(mutableBinding);
    if (result.outcome !== 'created') {
      throw new Error('Expected active grant');
    }

    (mutableSession as { accountId: AccountId }).accountId =
      'account-2' as AccountId;
    (mutableBinding.evidence as { sessionId: SessionId }).sessionId =
      'session-2' as SessionId;
    mutableBinding.scope = 'unlink_identity';
    mutableBinding.resourceDigest = RESOURCE_B;

    expect(result.state).toMatchObject({
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      scope: 'link_identity',
      resourceDigest: RESOURCE_A,
    });
  });

  it('uses current session context without retaining its state or metadata', () => {
    const sourceSession = activeSession();
    const mutableContext = {
      ...sourceSession,
      currentCredential: { ...sourceSession.currentCredential },
      consumedCredentials: [...sourceSession.consumedCredentials],
      appliedCommands: [...sourceSession.appliedCommands],
      rawToken: 'raw-session-token',
      sessionMetadata: { mutable: true },
    } as ActiveSessionState & Record<string, unknown>;
    const active = activeGrant({ session: sourceSession });
    const result = transitionScopedGrantReducer(
      active,
      consumeCommand(active),
      { session: mutableContext },
    );
    const consumed = transitionedState(result, 'consumed');

    (mutableContext as { accountId: AccountId }).accountId =
      'account-2' as AccountId;
    (mutableContext as { sessionId: SessionId }).sessionId =
      'session-2' as SessionId;
    (mutableContext.currentCredential as { digest: SessionCredentialDigest }).digest =
      SESSION_DIGEST_C;
    mutableContext.sessionMetadata = { mutable: false };

    expect(consumed).toMatchObject({
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      status: 'consumed',
    });
    for (const field of [
      'session',
      'currentCredential',
      'consumedCredentials',
      'sessionMetadata',
      'rawToken',
      'revocation',
      'reuse',
    ]) {
      expect(consumed).not.toHaveProperty(field);
      expect(consumed.appliedCommands[0]).not.toHaveProperty(field);
    }
  });

  it('does not retain mutable command references', () => {
    const active = activeGrant();
    const mutableCommand = {
      ...consumeCommand(active),
      scope: active.scope as ScopedGrantScope,
      resourceDigest: active.resourceDigest,
    };
    const result = transitionScopedGrant(active, runtimeCommand(mutableCommand));
    const consumed = transitionedState(result, 'consumed');

    mutableCommand.scope = 'unlink_identity';
    mutableCommand.resourceDigest = RESOURCE_B;
    mutableCommand.accountId = 'account-2' as AccountId;

    expect(consumed).toMatchObject({
      scope: 'link_identity',
      resourceDigest: RESOURCE_A,
      accountId: ACCOUNT_ID,
      consumption: { commandId: 'grant-command-1' },
    });
    expect(consumed.appliedCommands[0]).toMatchObject({
      scope: 'link_identity',
      resourceDigest: RESOURCE_A,
      accountId: ACCOUNT_ID,
    });
  });

  it('returns the original state for typed refusal', () => {
    const active = activeGrant();
    const snapshot = structuredClone(active);
    const result = transitionScopedGrant(
      active,
      consumeCommand(active, { scope: 'unlink_identity' }),
    );

    expectRejectedWithoutStateChange(result, active, 'scope_mismatch');
    expect(active).toEqual(snapshot);
  });

  it('stores epoch seconds and no Date instances', () => {
    const active = activeGrant();
    const consumed = transitionedState(
      transitionScopedGrant(active, consumeCommand(active)),
      'consumed',
    );

    expect(consumed.createdAt).not.toBeInstanceOf(Date);
    expect(consumed.expiresAt).not.toBeInstanceOf(Date);
    expect(consumed.consumption.consumedAt).not.toBeInstanceOf(Date);
    expect(consumed.appliedCommands[0].appliedAt).not.toBeInstanceOf(Date);
    expect(Number.isSafeInteger(consumed.consumption.consumedAt)).toBe(true);
    expect(Object.isFrozen(consumed)).toBe(true);
    expect(Object.isFrozen(consumed.appliedCommands)).toBe(true);
    expect(Object.isFrozen(consumed.appliedCommands[0])).toBe(true);
  });
});
