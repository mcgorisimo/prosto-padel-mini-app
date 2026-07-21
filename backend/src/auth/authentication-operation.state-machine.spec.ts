import { AccountId } from '../accounts/account.types';
import {
  ExternalIdentityKey,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  AccountResolutionOutcome,
  accountResolutionConflict,
  newAccountRequired,
  resolveExistingAccountStatus,
} from './account-resolution.types';
import {
  AUTHENTICATION_INTENTS,
  AuthenticationCommandId,
  AuthenticationIdempotencyKey,
  AuthenticationIntent,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationRequestDigest,
  UnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';
import {
  AUTHENTICATION_OPERATION_FAILURE_REASONS,
  AuthenticationOperationBinding,
  AuthenticationOperationCommand,
  AuthenticationOperationCommandBinding,
  AuthenticationOperationState,
  CompleteAuthenticationOperationCommand,
  ExpireAuthenticationOperationCommand,
  FailAuthenticationOperationCommand,
  PendingAuthenticationOperation,
  createAuthenticationOperation,
  transitionAuthenticationOperation,
} from './authentication-operation.state-machine';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001' as AccountId;
const CREATED_AT = unixEpochSeconds(1_784_635_200);
const EXPIRES_AT = unixEpochSeconds(1_784_635_500);
const BEFORE_EXPIRY = unixEpochSeconds(1_784_635_499);
const PROOF_FINGERPRINT = 'a'.repeat(64) as AuthenticationProofFingerprint;

function operationId(value = 'operation-1'): AuthenticationOperationId {
  return value as AuthenticationOperationId;
}

function commandId(value = 'command-1'): AuthenticationCommandId {
  return value as AuthenticationCommandId;
}

function proofFingerprint(
  value: string = PROOF_FINGERPRINT,
): AuthenticationProofFingerprint {
  return value as AuthenticationProofFingerprint;
}

function idempotencyKey(
  value = 'idempotency-key-1',
): AuthenticationIdempotencyKey {
  return value as AuthenticationIdempotencyKey;
}

function requestDigest(value = 'request-digest-1'): AuthenticationRequestDigest {
  return value as AuthenticationRequestDigest;
}

function identityKey(
  provider: ExternalIdentityKey['provider'] = 'telegram',
  namespace = 'telegram:bot:123456789',
  subject = '987654321',
): ExternalIdentityKey {
  return {
    provider,
    namespace: externalIdentityNamespace(namespace),
    lookup: {
      kind: 'canonical_subject',
      subject: trustProviderCanonicalizedExternalIdentitySubject(subject),
    },
  };
}

function digestIdentityKey(
  digest = 'c'.repeat(64),
  namespace = 'telegram:bot:123456789',
  provider: ExternalIdentityKey['provider'] = 'telegram',
): ExternalIdentityKey {
  return {
    provider,
    namespace: externalIdentityNamespace(namespace),
    lookup: {
      kind: 'lookup_digest',
      digest: externalIdentityLookupDigest(digest),
    },
  };
}

function resolutionFor(
  type: AccountResolutionOutcome['type'],
  key: ExternalIdentityKey,
): AccountResolutionOutcome {
  switch (type) {
    case 'existing_account':
      return resolveExistingAccountStatus(key, ACCOUNT_ID, 'active');
    case 'new_account_required':
      return newAccountRequired(key);
    case 'blocked':
      return resolveExistingAccountStatus(key, ACCOUNT_ID, 'blocked');
    case 'conflict':
      return accountResolutionConflict(key, 'ambiguous_account_resolution');
  }
}

function runtimeCommand(value: unknown): AuthenticationOperationCommand {
  return value as AuthenticationOperationCommand;
}

function operationBinding(
  overrides: Partial<AuthenticationOperationBinding> = {},
): AuthenticationOperationBinding {
  return {
    operationId: operationId(),
    intent: 'sign_in',
    identityKey: identityKey(),
    proofFingerprint: proofFingerprint(),
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    idempotencyKey: idempotencyKey(),
    requestDigest: requestDigest(),
    ...overrides,
  };
}

function pendingOperation(
  overrides: Partial<AuthenticationOperationBinding> = {},
): PendingAuthenticationOperation {
  const result = createAuthenticationOperation(operationBinding(overrides));
  if (result.outcome !== 'created') {
    throw new Error(`Test operation was not created: ${result.reason}`);
  }
  return result.state;
}

function commandBinding(
  state: AuthenticationOperationState,
  overrides: Partial<AuthenticationOperationCommandBinding> = {},
): AuthenticationOperationCommandBinding {
  return {
    operationId: state.operationId,
    intent: state.intent,
    identityKey: state.identityKey,
    proofFingerprint: state.proofFingerprint,
    idempotencyKey: state.idempotencyKey,
    requestDigest: state.requestDigest,
    ...overrides,
  };
}

function completeCommand(
  state: AuthenticationOperationState,
  overrides: Partial<CompleteAuthenticationOperationCommand> = {},
): CompleteAuthenticationOperationCommand {
  return {
    type: 'complete',
    commandId: commandId(),
    binding: commandBinding(state),
    now: BEFORE_EXPIRY,
    resolution: resolveExistingAccountStatus(
      state.identityKey,
      ACCOUNT_ID,
      'active',
    ),
    ...overrides,
  };
}

function failCommand(
  state: AuthenticationOperationState,
  overrides: Partial<FailAuthenticationOperationCommand> = {},
): FailAuthenticationOperationCommand {
  return {
    type: 'fail',
    commandId: commandId(),
    binding: commandBinding(state),
    now: BEFORE_EXPIRY,
    reason: 'account_resolution_unavailable',
    ...overrides,
  };
}

function expireCommand(
  state: AuthenticationOperationState,
  overrides: Partial<ExpireAuthenticationOperationCommand> = {},
): ExpireAuthenticationOperationCommand {
  return {
    type: 'expire',
    commandId: commandId(),
    binding: commandBinding(state),
    now: EXPIRES_AT,
    ...overrides,
  };
}

function expectRejectedWithoutStateChange(
  result: ReturnType<typeof transitionAuthenticationOperation>,
  state: AuthenticationOperationState,
  reason: string,
): void {
  expect(result).toMatchObject({ outcome: 'rejected', reason });
  expect(result.state).toBe(state);
}

describe('authentication operation creation', () => {
  it('creates only an immutable pending operation with provider-neutral intent', () => {
    const sourceKey = identityKey('google', 'google:client:123', 'subject-1');
    const result = createAuthenticationOperation(
      operationBinding({ intent: 'fresh_authentication', identityKey: sourceKey }),
    );

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') {
      return;
    }
    expect(result.state).toMatchObject({
      status: 'pending',
      intent: 'fresh_authentication',
      identityKey: {
        provider: 'google',
        namespace: 'google:client:123',
      },
    });
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.identityKey)).toBe(true);
    expect(Object.isFrozen(result.state.identityKey.lookup)).toBe(true);
  });

  it.each([
    [EXPIRES_AT, EXPIRES_AT, 'invalid_operation_window'],
    [EXPIRES_AT, CREATED_AT, 'invalid_operation_window'],
    [Number.NaN as UnixEpochSeconds, EXPIRES_AT, 'invalid_created_at'],
    [CREATED_AT, Number.POSITIVE_INFINITY as UnixEpochSeconds, 'invalid_expires_at'],
    [-1 as UnixEpochSeconds, EXPIRES_AT, 'invalid_created_at'],
    [CREATED_AT, 1_784_635_500.5 as UnixEpochSeconds, 'invalid_expires_at'],
  ])(
    'rejects invalid operation time (%p, %p)',
    (createdAt, expiresAt, bindingReason) => {
      expect(
        createAuthenticationOperation(
          operationBinding({ createdAt, expiresAt }),
        ),
      ).toEqual({
        outcome: 'rejected',
        reason: 'invalid_operation_binding',
        bindingReason,
      });
    },
  );

  it.each([
    ['operationId', '' as AuthenticationOperationId, 'invalid_operation_id'],
    [
      'intent',
      'telegram_login' as AuthenticationIntent,
      'invalid_intent',
    ],
    [
      'identityKey',
      {
        ...identityKey(),
        namespace: ' invalid-namespace',
      } as ExternalIdentityKey,
      'invalid_identity_key',
    ],
    [
      'idempotencyKey',
      '' as AuthenticationIdempotencyKey,
      'invalid_idempotency_key',
    ],
    [
      'requestDigest',
      ' invalid-request' as AuthenticationRequestDigest,
      'invalid_request_digest',
    ],
    [
      'proofFingerprint',
      'not-a-sha-256-digest' as AuthenticationProofFingerprint,
      'invalid_proof_fingerprint',
    ],
  ] as const)(
    'rejects invalid runtime binding field %s',
    (field, value, bindingReason) => {
      const result = createAuthenticationOperation(
        operationBinding({ [field]: value }),
      );

      expect(result).toEqual({
        outcome: 'rejected',
        reason: 'invalid_operation_binding',
        bindingReason,
      });
    },
  );

  it('copies only declared binding fields into pending state', () => {
    const runtimeBinding = {
      ...operationBinding(),
      status: 'completed',
      rawProof: 'raw-proof-must-not-survive',
      token: 'token-must-not-survive',
      debugMessage: 'debug-must-not-survive',
      arbitraryObject: { mutable: true },
    } as AuthenticationOperationBinding;
    const result = createAuthenticationOperation(runtimeBinding);

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') {
      return;
    }
    expect(result.state.status).toBe('pending');
    expect(result.state).not.toHaveProperty('rawProof');
    expect(result.state).not.toHaveProperty('token');
    expect(result.state).not.toHaveProperty('debugMessage');
    expect(result.state).not.toHaveProperty('arbitraryObject');
  });
});

describe('authentication operation lifecycle', () => {
  const outcomeTypes: readonly AccountResolutionOutcome['type'][] = [
    'existing_account',
    'new_account_required',
    'blocked',
    'conflict',
  ];
  const allowedOutcomes: Readonly<
    Record<AuthenticationIntent, readonly AccountResolutionOutcome['type'][]>
  > = {
    sign_in: ['existing_account', 'blocked', 'conflict'],
    sign_up: [
      'existing_account',
      'new_account_required',
      'blocked',
      'conflict',
    ],
    link_identity: ['existing_account', 'blocked', 'conflict'],
    fresh_authentication: ['existing_account', 'blocked', 'conflict'],
    account_recovery: ['existing_account', 'blocked', 'conflict'],
  };
  const matrixCases = AUTHENTICATION_INTENTS.flatMap((intent) =>
    outcomeTypes.map((outcomeType) => [
      intent,
      outcomeType,
      allowedOutcomes[intent].includes(outcomeType),
    ] as const),
  );

  it.each(matrixCases)(
    'applies intent/outcome policy for %s + %s',
    (intent, outcomeType, isAllowed) => {
      const pending = pendingOperation({ intent });
      const result = transitionAuthenticationOperation(
        pending,
        completeCommand(pending, {
          resolution: resolutionFor(outcomeType, pending.identityKey),
        }),
      );

      if (isAllowed) {
        expect(result).toMatchObject({
          outcome: 'transitioned',
          state: { status: 'completed', resolution: { type: outcomeType } },
        });
        return;
      }

      expectRejectedWithoutStateChange(
        result,
        pending,
        'intent_outcome_incompatible',
      );
      expect(result.state).not.toHaveProperty('appliedCommand');
    },
  );

  it('distinguishes technical failure from a completed domain outcome', () => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(pending, failCommand(pending));

    expect(AUTHENTICATION_OPERATION_FAILURE_REASONS).toEqual([
      'proof_validation_unavailable',
      'account_resolution_unavailable',
      'internal_dependency_unavailable',
      'operation_cancelled',
    ]);
    expect(result).toMatchObject({
      outcome: 'transitioned',
      state: {
        status: 'failed',
        failureReason: 'account_resolution_unavailable',
      },
    });
  });

  it.each([EXPIRES_AT, unixEpochSeconds(1_784_635_501)])(
    'expires pending at or after the expiry boundary (%p)',
    (now) => {
      const pending = pendingOperation();
      const result = transitionAuthenticationOperation(
        pending,
        expireCommand(pending, { now }),
      );

      expect(result).toMatchObject({
        outcome: 'transitioned',
        state: { status: 'expired' },
      });
    },
  );

  it('allows completion one second before expiry', () => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, { now: BEFORE_EXPIRY }),
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      state: { status: 'completed' },
    });
  });

  it('allows failure one second before expiry', () => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      failCommand(pending, { now: BEFORE_EXPIRY }),
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      state: { status: 'failed' },
    });
  });

  it('rejects completion at the expiry boundary without changing state', () => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, { now: EXPIRES_AT }),
    );

    expectRejectedWithoutStateChange(result, pending, 'operation_expired');
  });

  it('rejects failure at the expiry boundary without changing state', () => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      failCommand(pending, { now: EXPIRES_AT }),
    );

    expectRejectedWithoutStateChange(result, pending, 'operation_expired');
  });

  it.each(['complete', 'fail'] as const)(
    'keeps repeated expired %s commands pending without recording them',
    (commandType) => {
      const pending = pendingOperation();
      const expiredCommand =
        commandType === 'complete'
          ? completeCommand(pending, { now: EXPIRES_AT })
          : failCommand(pending, { now: EXPIRES_AT });

      const first = transitionAuthenticationOperation(pending, expiredCommand);
      const second = transitionAuthenticationOperation(pending, expiredCommand);

      expectRejectedWithoutStateChange(first, pending, 'operation_expired');
      expectRejectedWithoutStateChange(second, pending, 'operation_expired');
      expect(pending).not.toHaveProperty('appliedCommand');
    },
  );

  it('does not record command reuse while an expired operation remains pending', () => {
    const pending = pendingOperation({ intent: 'sign_up' });
    const first = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, {
        now: EXPIRES_AT,
        resolution: newAccountRequired(pending.identityKey),
      }),
    );
    const changedPayload = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, {
        now: EXPIRES_AT,
        resolution: resolveExistingAccountStatus(
          pending.identityKey,
          ACCOUNT_ID,
          'active',
        ),
      }),
    );

    expectRejectedWithoutStateChange(first, pending, 'operation_expired');
    expectRejectedWithoutStateChange(
      changedPayload,
      pending,
      'operation_expired',
    );
  });

  it('rejects expiry before the deadline without changing state', () => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      expireCommand(pending, { now: BEFORE_EXPIRY }),
    );

    expectRejectedWithoutStateChange(result, pending, 'operation_not_expired');
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    1_784_635_200.5,
  ])('rejects invalid command time %p', (now) => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      failCommand(pending, { now: now as UnixEpochSeconds }),
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_command',
      commandReason: 'invalid_time',
    });
    expect(result.state).toBe(pending);
  });

  it.each([
    [
      'provider',
      identityKey('google', 'telegram:bot:123456789', '987654321'),
    ],
    [
      'namespace',
      identityKey('telegram', 'telegram:bot:999999999', '987654321'),
    ],
    [
      'lookup kind',
      digestIdentityKey('c'.repeat(64)),
    ],
    [
      'canonical subject',
      identityKey('telegram', 'telegram:bot:123456789', '987654322'),
    ],
  ] as const)('rejects resolution identity changed only by %s', (_field, otherKey) => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, {
        resolution: resolveExistingAccountStatus(
          otherKey,
          ACCOUNT_ID,
          'active',
        ),
      }),
    );

    expectRejectedWithoutStateChange(result, pending, 'resolution_identity_conflict');
  });

  it('rejects resolution identity changed only by lookup digest', () => {
    const pending = pendingOperation({
      identityKey: digestIdentityKey('c'.repeat(64)),
    });
    const result = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, {
        resolution: resolveExistingAccountStatus(
          digestIdentityKey('d'.repeat(64)),
          ACCOUNT_ID,
          'active',
        ),
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      pending,
      'resolution_identity_conflict',
    );
  });
});

describe('authentication operation runtime validation', () => {
  it('rejects completion without a resolution', () => {
    const pending = pendingOperation();
    const command = completeCommand(pending);
    const { resolution: _resolution, ...withoutResolution } = command;
    const result = transitionAuthenticationOperation(
      pending,
      runtimeCommand(withoutResolution),
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_command',
      commandReason: 'missing_resolution',
    });
    expect(result.state).toBe(pending);
  });

  it('rejects failure without a reason', () => {
    const pending = pendingOperation();
    const command = failCommand(pending);
    const { reason: _reason, ...withoutReason } = command;
    const result = transitionAuthenticationOperation(
      pending,
      runtimeCommand(withoutReason),
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_command',
      commandReason: 'missing_failure_reason',
    });
    expect(result.state).toBe(pending);
  });

  it.each([
    [
      'arbitrary command type',
      (state: AuthenticationOperationState) => ({
        ...completeCommand(state),
        type: 'cancel_operation',
      }),
      'invalid_command_type',
    ],
    [
      'arbitrary failure reason',
      (state: AuthenticationOperationState) => ({
        ...failCommand(state),
        reason: 'database_timeout: customers table',
      }),
      'invalid_failure_reason',
    ],
    [
      'whitespace command ID',
      (state: AuthenticationOperationState) => ({
        ...failCommand(state),
        commandId: '   ',
      }),
      'invalid_command_id',
    ],
    [
      'empty operation ID in command binding',
      (state: AuthenticationOperationState) => ({
        ...failCommand(state),
        binding: {
          ...commandBinding(state),
          operationId: '',
        },
      }),
      'invalid_operation_id',
    ],
  ] as const)('rejects %s', (_name, commandFor, commandReason) => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      runtimeCommand(commandFor(pending)),
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_command',
      commandReason,
    });
    expect(result.state).toBe(pending);
  });

  it('rejects a valid command bound to another operation', () => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, {
        binding: commandBinding(pending, {
          operationId: operationId('operation-2'),
        }),
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      pending,
      'operation_binding_conflict',
    );
  });

  it.each([
    [
      'arbitrary conflict reason',
      (key: ExternalIdentityKey) => ({
        type: 'conflict',
        reason: 'database_conflict',
        identityKey: key,
      }),
    ],
    [
      'existing account with empty AccountId',
      (key: ExternalIdentityKey) => ({
        type: 'existing_account',
        accountId: '',
        accountStatus: 'active',
        identityKey: key,
      }),
    ],
    [
      'existing account with blocked status',
      (key: ExternalIdentityKey) => ({
        type: 'existing_account',
        accountId: ACCOUNT_ID,
        accountStatus: 'blocked',
        identityKey: key,
      }),
    ],
    [
      'existing account with pending-deletion status',
      (key: ExternalIdentityKey) => ({
        type: 'existing_account',
        accountId: ACCOUNT_ID,
        accountStatus: 'pending_deletion',
        identityKey: key,
      }),
    ],
    [
      'existing account with anonymized status',
      (key: ExternalIdentityKey) => ({
        type: 'existing_account',
        accountId: ACCOUNT_ID,
        accountStatus: 'anonymized',
        identityKey: key,
      }),
    ],
    [
      'new account with club admin role',
      (key: ExternalIdentityKey) => ({
        type: 'new_account_required',
        identityKey: key,
        accountDraft: { initialRole: 'club_admin' },
      }),
    ],
    [
      'new account with runtime AccountId',
      (key: ExternalIdentityKey) => ({
        type: 'new_account_required',
        identityKey: key,
        accountDraft: { initialRole: 'player' },
        accountId: ACCOUNT_ID,
      }),
    ],
    [
      'new account without a draft',
      (key: ExternalIdentityKey) => ({
        type: 'new_account_required',
        identityKey: key,
      }),
    ],
    [
      'blocked outcome with active status',
      (key: ExternalIdentityKey) => ({
        type: 'blocked',
        reason: 'account_blocked',
        accountId: ACCOUNT_ID,
        accountStatus: 'active',
        identityKey: key,
      }),
    ],
    [
      'blocked outcome with anonymized status',
      (key: ExternalIdentityKey) => ({
        type: 'blocked',
        reason: 'account_blocked',
        accountId: ACCOUNT_ID,
        accountStatus: 'anonymized',
        identityKey: key,
      }),
    ],
    [
      'blocked outcome with an empty AccountId',
      (key: ExternalIdentityKey) => ({
        type: 'blocked',
        reason: 'account_blocked',
        accountId: '   ',
        accountStatus: 'blocked',
        identityKey: key,
      }),
    ],
    [
      'blocked outcome with arbitrary reason',
      (key: ExternalIdentityKey) => ({
        type: 'blocked',
        reason: 'manual_database_block',
        accountId: ACCOUNT_ID,
        accountStatus: 'blocked',
        identityKey: key,
      }),
    ],
    [
      'conflict outcome with undeclared account IDs',
      (key: ExternalIdentityKey) => ({
        type: 'conflict',
        reason: 'ambiguous_account_resolution',
        identityKey: key,
        accountIds: [ACCOUNT_ID],
      }),
    ],
    [
      'conflict outcome without identity key',
      () => ({
        type: 'conflict',
        reason: 'ambiguous_account_resolution',
      }),
    ],
  ] as const)('rejects malformed resolution: %s', (_name, resolutionForKey) => {
    const pending = pendingOperation({ intent: 'sign_up' });
    const result = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, {
        resolution: resolutionForKey(
          pending.identityKey,
        ) as unknown as AccountResolutionOutcome,
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      pending,
      'invalid_resolution_outcome',
    );
  });
});

describe('authentication operation command idempotency', () => {
  it('returns the same completed state for an exact completion retry', () => {
    const pending = pendingOperation();
    const command = completeCommand(pending);
    const first = transitionAuthenticationOperation(pending, command);
    const retry = transitionAuthenticationOperation(first.state, {
      ...command,
      now: EXPIRES_AT,
    });

    expect(retry.outcome).toBe('idempotent_retry');
    expect(retry.state).toBe(first.state);
  });

  it('returns the same failed state for an exact failure retry', () => {
    const pending = pendingOperation();
    const command = failCommand(pending);
    const first = transitionAuthenticationOperation(pending, command);
    const retry = transitionAuthenticationOperation(first.state, {
      ...command,
      now: EXPIRES_AT,
    });

    expect(retry.outcome).toBe('idempotent_retry');
    expect(retry.state).toBe(first.state);
  });

  it('returns the same expired state for an exact expiry retry', () => {
    const pending = pendingOperation();
    const command = expireCommand(pending);
    const first = transitionAuthenticationOperation(pending, command);
    const retry = transitionAuthenticationOperation(first.state, command);

    expect(retry.outcome).toBe('idempotent_retry');
    expect(retry.state).toBe(first.state);
  });

  it('rejects the same command ID with another resolution outcome', () => {
    const pending = pendingOperation();
    const first = transitionAuthenticationOperation(pending, completeCommand(pending));
    const result = transitionAuthenticationOperation(
      first.state,
      completeCommand(first.state, {
        resolution: newAccountRequired(first.state.identityKey),
      }),
    );

    expectRejectedWithoutStateChange(result, first.state, 'command_reuse_conflict');
  });

  it('rejects the same command ID with a changed account ID', () => {
    const pending = pendingOperation();
    const first = transitionAuthenticationOperation(
      pending,
      completeCommand(pending),
    );
    const otherAccountId =
      '00000000-0000-4000-8000-000000000002' as AccountId;
    const result = transitionAuthenticationOperation(
      first.state,
      completeCommand(first.state, {
        resolution: resolveExistingAccountStatus(
          first.state.identityKey,
          otherAccountId,
          'active',
        ),
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      first.state,
      'command_reuse_conflict',
    );
  });

  it('rejects the same command ID with another failure reason', () => {
    const pending = pendingOperation();
    const first = transitionAuthenticationOperation(pending, failCommand(pending));
    const result = transitionAuthenticationOperation(
      first.state,
      failCommand(first.state, { reason: 'internal_dependency_unavailable' }),
    );

    expectRejectedWithoutStateChange(result, first.state, 'command_reuse_conflict');
  });

  it('rejects the same command ID reused for another command type', () => {
    const pending = pendingOperation();
    const first = transitionAuthenticationOperation(pending, completeCommand(pending));
    const result = transitionAuthenticationOperation(first.state, failCommand(first.state));

    expectRejectedWithoutStateChange(result, first.state, 'command_reuse_conflict');
  });

  it('rejects an invalid changed draft before classifying command reuse', () => {
    const pending = pendingOperation({ intent: 'sign_up' });
    const first = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, {
        resolution: newAccountRequired(pending.identityKey),
      }),
    );
    const invalidDraft = {
      type: 'new_account_required',
      identityKey: first.state.identityKey,
      accountDraft: { initialRole: 'club_admin' },
    } as unknown as AccountResolutionOutcome;
    const result = transitionAuthenticationOperation(
      first.state,
      completeCommand(first.state, { resolution: invalidDraft }),
    );

    expectRejectedWithoutStateChange(
      result,
      first.state,
      'invalid_resolution_outcome',
    );
  });

  it('rejects a second completion with a different command ID', () => {
    const pending = pendingOperation();
    const first = transitionAuthenticationOperation(pending, completeCommand(pending));
    const result = transitionAuthenticationOperation(
      first.state,
      completeCommand(first.state, { commandId: commandId('command-2') }),
    );

    expectRejectedWithoutStateChange(result, first.state, 'forbidden_transition');
  });

  it('allows the same command ID in two isolated operations', () => {
    const firstPending = pendingOperation({
      operationId: operationId('operation-1'),
    });
    const secondPending = pendingOperation({
      operationId: operationId('operation-2'),
    });
    const first = transitionAuthenticationOperation(
      firstPending,
      completeCommand(firstPending, { commandId: commandId('shared-command') }),
    );
    const second = transitionAuthenticationOperation(
      secondPending,
      completeCommand(secondPending, { commandId: commandId('shared-command') }),
    );

    expect(first).toMatchObject({
      outcome: 'transitioned',
      state: { status: 'completed', operationId: 'operation-1' },
    });
    expect(second).toMatchObject({
      outcome: 'transitioned',
      state: { status: 'completed', operationId: 'operation-2' },
    });
    expect(first.state).not.toBe(second.state);
  });

  it('rejects an incompatible second expire command', () => {
    const pending = pendingOperation();
    const first = transitionAuthenticationOperation(
      pending,
      expireCommand(pending),
    );
    const result = transitionAuthenticationOperation(
      first.state,
      expireCommand(first.state, { commandId: commandId('command-2') }),
    );

    expectRejectedWithoutStateChange(
      result,
      first.state,
      'forbidden_transition',
    );
  });
});

describe('authentication operation binding', () => {
  it.each([
    ['operationId', operationId('operation-2')],
    ['intent', 'link_identity' as AuthenticationIntent],
    ['identityKey', identityKey('telegram', 'telegram:bot:999', '987654321')],
    ['proofFingerprint', proofFingerprint('b'.repeat(64))],
    ['idempotencyKey', idempotencyKey('idempotency-key-2')],
    ['requestDigest', requestDigest('request-digest-2')],
  ] as const)('rejects a command that changes %s', (field, value) => {
    const pending = pendingOperation();
    const binding = commandBinding(pending, { [field]: value });
    const result = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, { binding }),
    );

    expectRejectedWithoutStateChange(result, pending, 'operation_binding_conflict');
  });
});

describe('authentication operation forbidden terminal transitions', () => {
  function terminalState(status: 'completed' | 'failed' | 'expired'): AuthenticationOperationState {
    const pending = pendingOperation();
    const command =
      status === 'completed'
        ? completeCommand(pending)
        : status === 'failed'
          ? failCommand(pending)
          : expireCommand(pending);
    return transitionAuthenticationOperation(pending, command).state;
  }

  it.each([
    ['completed', 'fail'],
    ['completed', 'expire'],
    ['failed', 'complete'],
    ['failed', 'expire'],
    ['expired', 'complete'],
    ['expired', 'fail'],
  ] as const)('rejects %s -> %s', (initialStatus, commandType) => {
    const state = terminalState(initialStatus);
    const nextCommand =
      commandType === 'complete'
        ? completeCommand(state, { commandId: commandId('command-2') })
        : commandType === 'fail'
          ? failCommand(state, { commandId: commandId('command-2') })
          : expireCommand(state, { commandId: commandId('command-2') });
    const snapshot = structuredClone(state);
    const result = transitionAuthenticationOperation(state, nextCommand);

    expectRejectedWithoutStateChange(result, state, 'forbidden_transition');
    expect(state).toEqual(snapshot);
  });

  it('rejects completed -> completed with another result', () => {
    const pending = pendingOperation();
    const completed = transitionAuthenticationOperation(
      pending,
      completeCommand(pending),
    ).state;
    const result = transitionAuthenticationOperation(
      completed,
      completeCommand(completed, {
        commandId: commandId('command-2'),
        resolution: accountResolutionConflict(
          completed.identityKey,
          'ambiguous_account_resolution',
        ),
      }),
    );

    expectRejectedWithoutStateChange(
      result,
      completed,
      'forbidden_transition',
    );
  });

  it('rejects failed -> failed with another reason', () => {
    const pending = pendingOperation();
    const failed = transitionAuthenticationOperation(
      pending,
      failCommand(pending),
    ).state;
    const result = transitionAuthenticationOperation(
      failed,
      failCommand(failed, {
        commandId: commandId('command-2'),
        reason: 'internal_dependency_unavailable',
      }),
    );

    expectRejectedWithoutStateChange(result, failed, 'forbidden_transition');
  });
});

describe('authentication operation immutability', () => {
  it('does not mutate pending input and stores immutable epoch-second values', () => {
    const pending = pendingOperation();
    const snapshot = structuredClone(pending);
    const result = transitionAuthenticationOperation(pending, completeCommand(pending));

    expect(pending).toEqual(snapshot);
    expect(result.state).not.toBe(pending);
    expect(result.state.createdAt).toBe(CREATED_AT);
    expect(result.state.expiresAt).toBe(EXPIRES_AT);
    expect(result.state.createdAt).not.toBeInstanceOf(Date);
    expect(result.state.expiresAt).not.toBeInstanceOf(Date);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(result.state.status).toBe('completed');
    if (result.state.status !== 'completed') {
      throw new Error('Expected a completed operation');
    }
    expect(Object.isFrozen(result.state.identityKey)).toBe(true);
    expect(Object.isFrozen(result.state.identityKey.lookup)).toBe(true);
    expect(Object.isFrozen(result.state.resolution)).toBe(true);
    expect(Object.isFrozen(result.state.appliedCommand)).toBe(true);
    expect(result.state.appliedCommand.appliedAt).not.toBeInstanceOf(Date);
  });

  it('clones mutable resolution, draft, and identity input', () => {
    const mutableIdentity = identityKey();
    const mutableDraft: { initialRole: 'player' | 'club_admin' } = {
      initialRole: 'player',
    };
    const mutableResolution = {
      type: 'new_account_required',
      identityKey: mutableIdentity,
      accountDraft: mutableDraft,
    } as unknown as AccountResolutionOutcome;
    const pending = pendingOperation({
      intent: 'sign_up',
      identityKey: mutableIdentity,
    });
    const result = transitionAuthenticationOperation(
      pending,
      completeCommand(pending, { resolution: mutableResolution }),
    );

    expect(result.state.status).toBe('completed');
    if (
      result.state.status !== 'completed' ||
      result.state.resolution.type !== 'new_account_required'
    ) {
      throw new Error('Expected new-account-required completion');
    }
    const savedResolution = result.state.resolution;

    mutableDraft.initialRole = 'club_admin';
    (mutableIdentity as { namespace: string }).namespace =
      'telegram:bot:999999999';
    (mutableIdentity.lookup as { subject: string }).subject = 'changed-subject';
    (mutableResolution as unknown as Record<string, unknown>).accountId =
      ACCOUNT_ID;

    expect(savedResolution).toEqual({
      type: 'new_account_required',
      identityKey: {
        provider: 'telegram',
        namespace: 'telegram:bot:123456789',
        lookup: {
          kind: 'canonical_subject',
          subject: '987654321',
        },
      },
      accountDraft: { initialRole: 'player' },
    });
    expect(savedResolution).not.toBe(mutableResolution);
    expect(savedResolution.identityKey).not.toBe(mutableIdentity);
    expect(savedResolution.accountDraft).not.toBe(mutableDraft);
    expect(Object.isFrozen(savedResolution.accountDraft)).toBe(true);
  });

  it('does not copy additional command fields into failed state or metadata', () => {
    const pending = pendingOperation();
    const runtimeFailure = {
      ...failCommand(pending),
      rawProof: 'raw-proof-must-not-survive',
      token: 'token-must-not-survive',
      debugMessage: 'debug-must-not-survive',
      arbitraryObject: { mutable: true },
    };
    const result = transitionAuthenticationOperation(
      pending,
      runtimeCommand(runtimeFailure),
    );

    expect(result.state.status).toBe('failed');
    if (result.state.status !== 'failed') {
      throw new Error('Expected a failed operation');
    }
    expect(result.state).not.toHaveProperty('rawProof');
    expect(result.state).not.toHaveProperty('token');
    expect(result.state).not.toHaveProperty('debugMessage');
    expect(result.state).not.toHaveProperty('arbitraryObject');
    expect(result.state.appliedCommand).toEqual({
      operationId: operationId(),
      commandId: commandId(),
      commandType: 'fail',
      appliedAt: BEFORE_EXPIRY,
    });
  });

  it('preserves the original state for repeated rejected commands', () => {
    const state = terminalStateForImmutability();
    const snapshot = structuredClone(state);
    const rejectedCommand = failCommand(state, { commandId: commandId('command-2') });

    const first = transitionAuthenticationOperation(state, rejectedCommand);
    const second = transitionAuthenticationOperation(state, rejectedCommand);

    expectRejectedWithoutStateChange(first, state, 'forbidden_transition');
    expectRejectedWithoutStateChange(second, state, 'forbidden_transition');
    expect(state).toEqual(snapshot);
  });
});

function terminalStateForImmutability(): AuthenticationOperationState {
  const pending = pendingOperation();
  return transitionAuthenticationOperation(pending, completeCommand(pending)).state;
}

describe('authentication operation persisted state guard', () => {
  function forgedState(value: unknown): AuthenticationOperationState {
    return value as AuthenticationOperationState;
  }

  function expectInvalidState(state: AuthenticationOperationState): void {
    const result = transitionAuthenticationOperation(
      state,
      failCommand(pendingOperation()),
    );
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_authentication_operation_state',
      state,
    });
    expect(result.state).toBe(state);
  }

  it('rejects a terminal state without appliedCommand without throwing', () => {
    const completed = terminalStateForImmutability();
    if (completed.status !== 'completed') {
      throw new Error('Expected completed operation');
    }
    const { appliedCommand: _removed, ...withoutApplied } = completed;
    const state = forgedState(withoutApplied);
    expect(() => expectInvalidState(state)).not.toThrow();
  });

  it('rejects completed without resolution', () => {
    const completed = terminalStateForImmutability();
    if (completed.status !== 'completed') {
      throw new Error('Expected completed operation');
    }
    const { resolution: _removed, ...withoutResolution } = completed;
    expectInvalidState(forgedState(withoutResolution));
  });

  it('rejects completed with an incompatible intent/outcome', () => {
    const pending = pendingOperation();
    const completed = transitionAuthenticationOperation(
      pending,
      completeCommand(pending),
    ).state;
    const state = forgedState({
      ...completed,
      resolution: newAccountRequired(completed.identityKey),
    });
    expectInvalidState(state);
  });

  it('rejects failed with an arbitrary failure reason', () => {
    const pending = pendingOperation();
    const failed = transitionAuthenticationOperation(
      pending,
      failCommand(pending),
    ).state;
    expectInvalidState(
      forgedState({ ...failed, failureReason: 'database_stack_trace' }),
    );
  });

  it('rejects expired with appliedAt before expiry', () => {
    const pending = pendingOperation();
    const expired = transitionAuthenticationOperation(
      pending,
      expireCommand(pending),
    ).state;
    if (expired.status !== 'expired') {
      throw new Error('Expected expired operation');
    }
    expectInvalidState(
      forgedState({
        ...expired,
        appliedCommand: { ...expired.appliedCommand, appliedAt: BEFORE_EXPIRY },
      }),
    );
  });

  it('rejects pending with terminal metadata', () => {
    expectInvalidState(
      forgedState({
        ...pendingOperation(),
        appliedCommand: {
          operationId: operationId(),
          commandId: commandId(),
          commandType: 'fail',
          appliedAt: BEFORE_EXPIRY,
        },
      }),
    );
  });

  it('rejects terminal applied metadata bound to another operation', () => {
    const completed = terminalStateForImmutability();
    if (completed.status !== 'completed') {
      throw new Error('Expected completed operation');
    }
    expectInvalidState(
      forgedState({
        ...completed,
        appliedCommand: {
          ...completed.appliedCommand,
          operationId: operationId('operation-2'),
        },
      }),
    );
  });

  it('rejects identity mismatch in a stored resolution', () => {
    const completed = terminalStateForImmutability();
    if (completed.status !== 'completed') {
      throw new Error('Expected completed operation');
    }
    expectInvalidState(
      forgedState({
        ...completed,
        resolution: resolveExistingAccountStatus(
          identityKey('telegram', 'telegram:bot:999'),
          ACCOUNT_ID,
          'active',
        ),
      }),
    );
  });

  it('rejects duplicate terminal command history represented at runtime', () => {
    const completed = terminalStateForImmutability();
    if (completed.status !== 'completed') {
      throw new Error('Expected completed operation');
    }
    expectInvalidState(
      forgedState({
        ...completed,
        appliedCommands: [completed.appliedCommand, completed.appliedCommand],
      }),
    );
  });

  it('does not mutate malformed state or its terminal metadata', () => {
    const completed = terminalStateForImmutability();
    if (completed.status !== 'completed') {
      throw new Error('Expected completed operation');
    }
    const state = forgedState({ ...completed, resolution: undefined });
    const snapshot = structuredClone(state);
    const result = transitionAuthenticationOperation(
      state,
      failCommand(pendingOperation()),
    );
    expect(result.state).toBe(state);
    expect(state).toEqual(snapshot);
  });

  it('rejects a new command before the operation creation time', () => {
    const pending = pendingOperation();
    const result = transitionAuthenticationOperation(
      pending,
      failCommand(pending, {
        now: unixEpochSeconds(CREATED_AT - 1),
      }),
    );
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_command',
      commandReason: 'invalid_time',
      state: pending,
    });
    expect(result.state).toBe(pending);
  });
});
