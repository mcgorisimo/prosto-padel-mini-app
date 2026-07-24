import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import {
  ExternalIdentityKey,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from '../accounts/external-identity.types';
import {
  AccountResolutionOutcome,
  accountResolutionConflict,
  newAccountRequired,
  resolveExistingAccountStatus,
} from '../auth/account-resolution.types';
import {
  AuthenticationOperationCommand,
  AuthenticationOperationState,
  PendingAuthenticationOperation,
  transitionAuthenticationOperation,
} from '../auth/authentication-operation.state-machine';
import {
  AuthenticationCommandId,
  AuthenticationIdempotencyKey,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationRequestDigest,
  UnixEpochSeconds,
  otpAuthenticationProofReference,
  telegramAuthenticationProofReference,
  unixEpochSeconds,
} from '../auth/auth.types';
import { OtpChallengeId } from '../auth/otp.types';
import {
  SecurityAuditEvent,
  SecurityAuditEventId,
  SecurityAuditEventType,
} from '../auth/security-audit.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  ApplyAuthenticationOperationTerminalInput,
  AuthenticationOperationTerminalPersistenceError,
  AuthenticationOperationTerminalPersistenceFailure,
} from './authentication-operation-terminal.repository';
import { PostgresAuthenticationOperationTerminalRepository } from './postgres-authentication-operation-terminal.repository';
import { PostgresTransaction } from './postgres-transaction';
import {
  SecurityAuditAppendResult,
  SecurityAuditRepository,
} from './security-audit.repository';

const OPERATION_ID = deterministicUuid(
  'terminal-operation',
) as AuthenticationOperationId;
const OTHER_OPERATION_ID = deterministicUuid(
  'terminal-other-operation',
) as AuthenticationOperationId;
const COMMAND_ID = deterministicUuid(
  'terminal-command',
) as AuthenticationCommandId;
const OTHER_COMMAND_ID = deterministicUuid(
  'terminal-other-command',
) as AuthenticationCommandId;
const ACCOUNT_ID = deterministicUuid('terminal-account') as AccountId;
const AUDIT_EVENT_ID = deterministicUuid(
  'terminal-audit',
) as SecurityAuditEventId;
const CREATED_AT = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(1_800_000_300);
const BEFORE_EXPIRY = unixEpochSeconds(1_800_000_200);
const AT_EXPIRY = EXPIRES_AT;
const LOOKUP_DIGEST = externalIdentityLookupDigest('a'.repeat(64));
const FINGERPRINT = 'b'.repeat(64) as AuthenticationProofFingerprint;
const IDEMPOTENCY_KEY =
  'terminal-idempotency-key' as AuthenticationIdempotencyKey;
const REQUEST_DIGEST =
  'terminal-request-digest' as AuthenticationRequestDigest;
const NAMESPACE = externalIdentityNamespace('telegram:bot:123');

const IDENTITY_KEY: ExternalIdentityKey = Object.freeze({
  provider: 'telegram',
  namespace: NAMESPACE,
  lookup: Object.freeze({
    kind: 'lookup_digest',
    digest: LOOKUP_DIGEST,
  }),
});

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueuedQuery = QueryResult<QueryResultRow> | Error | Record<string, unknown>;

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly queued: QueuedQuery[],
    private readonly timeline?: string[],
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    this.timeline?.push(`query:${this.calls.length}`);
    const next = this.queued.shift();
    if (next === undefined) {
      throw new Error('Unexpected query');
    }
    if (next instanceof Error || !('rows' in next)) {
      throw next;
    }
    return next as unknown as QueryResult<Row>;
  }
}

class FakeAuditRepository implements SecurityAuditRepository {
  readonly calls: Array<{
    readonly transaction: PostgresTransaction;
    readonly event: SecurityAuditEvent<SecurityAuditEventType>;
  }> = [];

  constructor(
    private readonly result: SecurityAuditAppendResult | Error = {
      status: 'appended',
    },
    private readonly timeline?: string[],
  ) {}

  async append<EventType extends SecurityAuditEventType>(
    transaction: PostgresTransaction,
    event: SecurityAuditEvent<EventType>,
  ): Promise<SecurityAuditAppendResult> {
    this.timeline?.push('audit');
    this.calls.push({
      transaction,
      event: event as SecurityAuditEvent<SecurityAuditEventType>,
    });
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

function queryResult<Row extends QueryResultRow>(
  rows: readonly Row[],
): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function pendingOperation(
  overrides: Partial<PendingAuthenticationOperation> = {},
): PendingAuthenticationOperation {
  return {
    operationId: OPERATION_ID,
    intent: 'sign_in',
    identityKey: IDENTITY_KEY,
    proofReference: telegramAuthenticationProofReference(FINGERPRINT),
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestDigest: REQUEST_DIGEST,
    status: 'pending',
    ...overrides,
  };
}

function commandFor(
  state: PendingAuthenticationOperation,
  type: 'complete' | 'fail' | 'expire' = 'complete',
  overrides: Record<string, unknown> = {},
): AuthenticationOperationCommand {
  const base = {
    commandId: COMMAND_ID,
    type,
    binding: {
      operationId: state.operationId,
      intent: state.intent,
      identityKey: state.identityKey,
      proofReference: state.proofReference,
      idempotencyKey: state.idempotencyKey,
      requestDigest: state.requestDigest,
    },
    now: type === 'expire' ? AT_EXPIRY : BEFORE_EXPIRY,
  };
  if (type === 'complete') {
    return {
      ...base,
      resolution: resolveExistingAccountStatus(
        state.identityKey,
        ACCOUNT_ID,
        'active',
      ),
      ...overrides,
    } as AuthenticationOperationCommand;
  }
  if (type === 'fail') {
    return {
      ...base,
      reason: 'account_resolution_unavailable',
      ...overrides,
    } as AuthenticationOperationCommand;
  }
  return { ...base, ...overrides } as AuthenticationOperationCommand;
}

function input(
  command: AuthenticationOperationCommand = commandFor(
    pendingOperation(),
  ),
): ApplyAuthenticationOperationTerminalInput {
  return {
    command,
    audit: {
      eventId: AUDIT_EVENT_ID,
      occurredAt: BEFORE_EXPIRY,
    },
  };
}

function rowForState(
  state: AuthenticationOperationState,
): QueryResultRow {
  const row: Record<string, unknown> = {
    id: state.operationId,
    intent: state.intent,
    identity_provider: state.identityKey.provider,
    identity_namespace: state.identityKey.namespace,
    identity_lookup_digest:
      state.identityKey.lookup.kind === 'lookup_digest'
        ? Buffer.from(state.identityKey.lookup.digest, 'hex')
        : Buffer.alloc(32),
    proof_type: state.proofReference.type,
    telegram_proof_fingerprint:
      state.proofReference.type === 'telegram_proof'
        ? Buffer.from(state.proofReference.proofFingerprint, 'hex')
        : null,
    otp_challenge_id:
      state.proofReference.type === 'otp_challenge'
        ? state.proofReference.challengeId
        : null,
    created_at: String(state.createdAt),
    expires_at: String(state.expiresAt),
    idempotency_key: state.idempotencyKey,
    request_digest: state.requestDigest,
    status: state.status,
    resolution_type: null,
    resolution_account_id: null,
    resolution_account_status: null,
    resolution_initial_role: null,
    resolution_reason: null,
    failure_reason: null,
    terminal_command_id: null,
    terminal_command_type: null,
    terminal_applied_at: null,
  };
  if (state.status === 'completed') {
    row.resolution_type = state.resolution.type;
    switch (state.resolution.type) {
      case 'existing_account':
        row.resolution_account_id = state.resolution.accountId;
        row.resolution_account_status = state.resolution.accountStatus;
        break;
      case 'new_account_required':
        row.resolution_initial_role =
          state.resolution.accountDraft.initialRole;
        break;
      case 'blocked':
        row.resolution_account_id = state.resolution.accountId;
        row.resolution_account_status = state.resolution.accountStatus;
        row.resolution_reason = state.resolution.reason;
        break;
      case 'conflict':
        row.resolution_reason = state.resolution.reason;
        break;
    }
    row.terminal_command_id = state.appliedCommand.commandId;
    row.terminal_command_type = state.appliedCommand.commandType;
    row.terminal_applied_at = String(state.appliedCommand.appliedAt);
  } else if (state.status === 'failed') {
    row.failure_reason = state.failureReason;
    row.terminal_command_id = state.appliedCommand.commandId;
    row.terminal_command_type = state.appliedCommand.commandType;
    row.terminal_applied_at = String(state.appliedCommand.appliedAt);
  } else if (state.status === 'expired') {
    row.terminal_command_id = state.appliedCommand.commandId;
    row.terminal_command_type = state.appliedCommand.commandType;
    row.terminal_applied_at = String(state.appliedCommand.appliedAt);
  }
  return row;
}

function transitionedState(
  state: PendingAuthenticationOperation,
  command: AuthenticationOperationCommand,
): Exclude<AuthenticationOperationState, PendingAuthenticationOperation> {
  const result = transitionAuthenticationOperation(state, command);
  if (result.outcome !== 'transitioned' || result.state.status === 'pending') {
    throw new Error('Expected terminal transition');
  }
  return result.state;
}

function repository(
  audit = new FakeAuditRepository(),
): {
  readonly repository: PostgresAuthenticationOperationTerminalRepository;
  readonly audit: FakeAuditRepository;
} {
  return {
    repository:
      new PostgresAuthenticationOperationTerminalRepository(audit),
    audit,
  };
}

function runtimeInput(value: unknown): ApplyAuthenticationOperationTerminalInput {
  return value as ApplyAuthenticationOperationTerminalInput;
}

function expectPersistenceFailure(
  error: unknown,
  reason: AuthenticationOperationTerminalPersistenceFailure,
): void {
  expect(error).toBeInstanceOf(
    AuthenticationOperationTerminalPersistenceError,
  );
  expect(error).toMatchObject({ reason });
}

describe('PostgresAuthenticationOperationTerminalRepository input validation', () => {
  it.each([
    ['non-object input', null],
    ['missing audit', { command: input().command }],
    [
      'invalid operation ID',
      {
        ...input(),
        command: {
          ...input().command,
          binding: { ...input().command.binding, operationId: 'bad' },
        },
      },
    ],
    [
      'invalid command ID',
      { ...input(), command: { ...input().command, commandId: 42 } },
    ],
    [
      'invalid command type',
      { ...input(), command: { ...input().command, type: 'finish' } },
    ],
    [
      'invalid command time',
      { ...input(), command: { ...input().command, now: -1 } },
    ],
    [
      'invalid complete resolution',
      { ...input(), command: { ...input().command, resolution: {} } },
    ],
    [
      'invalid fail reason',
      {
        ...input(commandFor(pendingOperation(), 'fail')),
        command: {
          ...commandFor(pendingOperation(), 'fail'),
          reason: 'database_trace',
        },
      },
    ],
    [
      'expire with terminal payload',
      {
        ...input(commandFor(pendingOperation(), 'expire')),
        command: {
          ...commandFor(pendingOperation(), 'expire'),
          reason: 'operation_cancelled',
        },
      },
    ],
    [
      'invalid audit event ID',
      { ...input(), audit: { ...input().audit, eventId: 'bad' } },
    ],
    [
      'invalid audit time',
      { ...input(), audit: { ...input().audit, occurredAt: -1 } },
    ],
  ])('rejects %s before side effects', async (_name, value) => {
    const transaction = new FakeTransaction([]);
    const { repository: subject, audit } = repository();

    await expect(
      subject.applyTerminalCommand(
        transaction,
        runtimeInput(value),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
    expect(audit.calls).toHaveLength(0);
  });
});

describe('PostgresAuthenticationOperationTerminalRepository locking and hydration', () => {
  it('returns operation_not_found without audit', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    const { repository: subject, audit } = repository();

    await expect(
      subject.applyTerminalCommand(transaction, input()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'operation_not_found',
    });
    expect(transaction.calls).toHaveLength(1);
    expect(transaction.calls[0].values).toEqual([OPERATION_ID]);
    expect(transaction.calls[0].text).toMatch(/FOR\s+UPDATE/iu);
    expect(transaction.calls[0].text).not.toMatch(
      /\b(?:INSERT|DELETE|BEGIN|COMMIT|ROLLBACK)\b/iu,
    );
    for (const column of [
      'id',
      'intent',
      'identity_provider',
      'identity_namespace',
      'identity_lookup_digest',
      'proof_type',
      'telegram_proof_fingerprint',
      'otp_challenge_id',
      'created_at',
      'expires_at',
      'idempotency_key',
      'request_digest',
      'status',
      'resolution_type',
      'resolution_account_id',
      'resolution_account_status',
      'resolution_initial_role',
      'resolution_reason',
      'failure_reason',
      'terminal_command_id',
      'terminal_command_type',
      'terminal_applied_at',
    ]) {
      expect(transaction.calls[0].text).toMatch(
        new RegExp(`\\b${column}\\b`, 'u'),
      );
    }
    expect(audit.calls).toHaveLength(0);
  });

  it('hydrates a valid pending OTP-bound operation', async () => {
    const challengeId = deterministicUuid(
      'terminal-otp-challenge',
    ) as OtpChallengeId;
    const pending = pendingOperation({
      proofReference: otpAuthenticationProofReference(challengeId),
    });
    const command = commandFor(pending, 'fail');
    const terminal = transitionedState(pending, command);
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      queryResult([rowForState(terminal)]),
    ]);
    const { repository: subject } = repository();

    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).resolves.toEqual({
      outcome: 'transitioned',
      operationId: OPERATION_ID,
      status: 'failed',
    });
  });

  it.each([
    ['invalid UUID', { id: 'bad' }],
    ['invalid provider', { identity_provider: 'unknown' }],
    ['invalid namespace', { identity_namespace: 'bad\u0000namespace' }],
    ['invalid digest', { identity_lookup_digest: Buffer.alloc(31) }],
    [
      'invalid proof binding',
      { telegram_proof_fingerprint: null },
    ],
    ['invalid timestamp', { created_at: '01' }],
    ['invalid status', { status: 'done' }],
    [
      'invalid pending terminal shape',
      { terminal_command_id: COMMAND_ID },
    ],
  ])('rejects malformed persisted %s', async (_name, override) => {
    const transaction = new FakeTransaction([
      queryResult([{ ...rowForState(pendingOperation()), ...override }]),
    ]);
    const { repository: subject, audit } = repository();

    await expect(
      subject.applyTerminalCommand(transaction, input()),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
    expect(audit.calls).toHaveLength(0);
  });

  it.each(['completed', 'failed', 'expired'] as const)(
    'hydrates %s state for an exact retry',
    async (status) => {
      const pending = pendingOperation();
      const originalCommand =
        status === 'completed'
          ? commandFor(pending)
          : status === 'failed'
            ? commandFor(pending, 'fail')
            : commandFor(pending, 'expire');
      const terminal = transitionedState(pending, originalCommand);
      const retry = {
        ...originalCommand,
        now: unixEpochSeconds(Number(AT_EXPIRY) + 10),
      } as AuthenticationOperationCommand;
      const transaction = new FakeTransaction([
        queryResult([rowForState(terminal)]),
      ]);
      const { repository: subject, audit } = repository();

      await expect(
        subject.applyTerminalCommand(transaction, input(retry)),
      ).resolves.toEqual({
        outcome: 'idempotent_retry',
        operationId: OPERATION_ID,
        status,
      });
      expect(transaction.calls).toHaveLength(1);
      expect(audit.calls[0].event.outcome).toBe('idempotent_retry');
    },
  );

  it.each([
    ['bad completed resolution', { resolution_type: 'unknown' }],
    ['bad failed reason', { failure_reason: 'secret_failure' }],
    ['bad terminal command', { terminal_command_id: 'bad' }],
    ['bad terminal appliedAt', { terminal_applied_at: '-1' }],
  ])('rejects malformed terminal shape: %s', async (_name, override) => {
    const pending = pendingOperation();
    const command = commandFor(pending);
    const terminal = transitionedState(pending, command);
    const transaction = new FakeTransaction([
      queryResult([{ ...rowForState(terminal), ...override }]),
    ]);
    const { repository: subject } = repository();

    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });
});

describe('PostgresAuthenticationOperationTerminalRepository transitions', () => {
  const resolutionCases: readonly [
    string,
    'sign_in' | 'sign_up',
    (key: ExternalIdentityKey) => AccountResolutionOutcome,
    readonly unknown[],
  ][] = [
    [
      'existing_account',
      'sign_in',
      (key) => resolveExistingAccountStatus(key, ACCOUNT_ID, 'active'),
      [
        OPERATION_ID,
        'completed',
        'existing_account',
        ACCOUNT_ID,
        'active',
        null,
        null,
        null,
        COMMAND_ID,
        'complete',
        String(BEFORE_EXPIRY),
      ],
    ],
    [
      'new_account_required',
      'sign_up',
      (key) => newAccountRequired(key),
      [
        OPERATION_ID,
        'completed',
        'new_account_required',
        null,
        null,
        'player',
        null,
        null,
        COMMAND_ID,
        'complete',
        String(BEFORE_EXPIRY),
      ],
    ],
    [
      'blocked',
      'sign_in',
      (key) => resolveExistingAccountStatus(key, ACCOUNT_ID, 'blocked'),
      [
        OPERATION_ID,
        'completed',
        'blocked',
        ACCOUNT_ID,
        'blocked',
        null,
        'account_blocked',
        null,
        COMMAND_ID,
        'complete',
        String(BEFORE_EXPIRY),
      ],
    ],
    [
      'pending-deletion blocked',
      'sign_in',
      (key) =>
        resolveExistingAccountStatus(
          key,
          ACCOUNT_ID,
          'pending_deletion',
        ),
      [
        OPERATION_ID,
        'completed',
        'blocked',
        ACCOUNT_ID,
        'pending_deletion',
        null,
        'account_pending_deletion',
        null,
        COMMAND_ID,
        'complete',
        String(BEFORE_EXPIRY),
      ],
    ],
    [
      'conflict',
      'sign_in',
      (key) =>
        accountResolutionConflict(key, 'ambiguous_account_resolution'),
      [
        OPERATION_ID,
        'completed',
        'conflict',
        null,
        null,
        null,
        'ambiguous_account_resolution',
        null,
        COMMAND_ID,
        'complete',
        String(BEFORE_EXPIRY),
      ],
    ],
  ];

  it.each(resolutionCases)(
    'maps completed %s resolution',
    async (_name, intent, makeResolution, expectedTerminalValues) => {
      const pending = pendingOperation({ intent });
      const command = commandFor(pending, 'complete', {
        resolution: makeResolution(pending.identityKey),
      });
      const terminal = transitionedState(pending, command);
      const transaction = new FakeTransaction([
        queryResult([rowForState(pending)]),
        queryResult([rowForState(terminal)]),
      ]);
      const { repository: subject, audit } = repository();

      await expect(
        subject.applyTerminalCommand(transaction, input(command)),
      ).resolves.toEqual({
        outcome: 'transitioned',
        operationId: OPERATION_ID,
        status: 'completed',
      });
      expect(transaction.calls).toHaveLength(2);
      expect(transaction.calls[1].values).toEqual(
        expectedTerminalValues,
      );
      expect(audit.calls).toHaveLength(1);
      expect(audit.calls[0].transaction).toBe(transaction);
      expect(audit.calls[0].event).toMatchObject({
        eventType: 'authentication_operation_terminal',
        outcome: 'success',
        metadata: {
          operationId: OPERATION_ID,
          intent,
          terminalStatus: 'completed',
        },
      });
    },
  );

  it.each([
    [
      'fail',
      'failed',
      [
        OPERATION_ID,
        'failed',
        null,
        null,
        null,
        null,
        null,
        'account_resolution_unavailable',
        COMMAND_ID,
        'fail',
        String(BEFORE_EXPIRY),
      ],
      'success',
    ],
    [
      'expire',
      'expired',
      [
        OPERATION_ID,
        'expired',
        null,
        null,
        null,
        null,
        null,
        null,
        COMMAND_ID,
        'expire',
        String(AT_EXPIRY),
      ],
      'expired',
    ],
  ] as const)(
    'maps %s transition',
    async (commandType, status, expectedValues, auditOutcome) => {
      const pending = pendingOperation();
      const command = commandFor(pending, commandType);
      const terminal = transitionedState(pending, command);
      const transaction = new FakeTransaction([
        queryResult([rowForState(pending)]),
        queryResult([rowForState(terminal)]),
      ]);
      const { repository: subject, audit } = repository();

      await expect(
        subject.applyTerminalCommand(transaction, input(command)),
      ).resolves.toEqual({
        outcome: 'transitioned',
        operationId: OPERATION_ID,
        status,
      });
      expect(transaction.calls[1].values).toEqual(expectedValues);
      expect(audit.calls[0].event.outcome).toBe(auditOutcome);
      expect(audit.calls[0].event.metadata).toMatchObject({
        terminalStatus: status,
      });
    },
  );

  it('uses a static UPDATE with exact terminal placeholders', async () => {
    const pending = pendingOperation();
    const command = commandFor(pending);
    const terminal = transitionedState(pending, command);
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      queryResult([rowForState(terminal)]),
    ]);
    const { repository: subject } = repository();

    await subject.applyTerminalCommand(transaction, input(command));

    const normalized = transaction.calls[1].text.replace(/\s+/gu, ' ');
    const set = normalized.match(/ SET (.+?) WHERE /iu)?.[1];
    expect(set?.split(',').map((part) => part.trim())).toEqual([
      'status = $2',
      'resolution_type = $3',
      'resolution_account_id = $4',
      'resolution_account_status = $5',
      'resolution_initial_role = $6',
      'resolution_reason = $7',
      'failure_reason = $8',
      'terminal_command_id = $9',
      'terminal_command_type = $10',
      'terminal_applied_at = $11',
    ]);
    expect(normalized).toMatch(
      /WHERE id = \$1 AND status = 'pending' RETURNING/iu,
    );
    expect(normalized).not.toMatch(
      /SET .*?(?:intent|identity_provider|identity_namespace|identity_lookup_digest|proof_type|created_at|expires_at|idempotency_key|request_digest)\s*=/iu,
    );
    expect(normalized).not.toMatch(
      /\b(?:INSERT|DELETE|BEGIN|COMMIT|ROLLBACK)\b/iu,
    );
    const returning = normalized.match(/ RETURNING (.+)$/iu)?.[1];
    expect(returning?.split(',').map((part) => part.trim())).toEqual([
      'id',
      'intent',
      'identity_provider',
      'identity_namespace',
      'identity_lookup_digest',
      'proof_type',
      'telegram_proof_fingerprint',
      'otp_challenge_id',
      'created_at',
      'expires_at',
      'idempotency_key',
      'request_digest',
      'status',
      'resolution_type',
      'resolution_account_id',
      'resolution_account_status',
      'resolution_initial_role',
      'resolution_reason',
      'failure_reason',
      'terminal_command_id',
      'terminal_command_type',
      'terminal_applied_at',
    ]);
  });

  it('rejects zero UPDATE rows', async () => {
    const pending = pendingOperation();
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      queryResult([]),
    ]);
    const { repository: subject, audit } = repository();
    await expect(
      subject.applyTerminalCommand(
        transaction,
        input(commandFor(pending)),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
    expect(audit.calls).toHaveLength(0);
  });

  it('rejects multiple UPDATE rows', async () => {
    const pending = pendingOperation();
    const command = commandFor(pending);
    const terminalRow = rowForState(transitionedState(pending, command));
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      queryResult([terminalRow, terminalRow]),
    ]);
    const { repository: subject } = repository();
    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it('rejects inconsistent UPDATE rowCount', async () => {
    const pending = pendingOperation();
    const command = commandFor(pending);
    const terminalRow = rowForState(transitionedState(pending, command));
    const inconsistent = queryResult([terminalRow]);
    inconsistent.rowCount = 0;
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      inconsistent,
    ]);
    const { repository: subject } = repository();
    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it('rejects a RETURNING row different from state-machine output', async () => {
    const pending = pendingOperation();
    const command = commandFor(pending);
    const returned = {
      ...rowForState(transitionedState(pending, command)),
      terminal_applied_at: String(Number(BEFORE_EXPIRY) - 1),
    };
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      queryResult([returned]),
    ]);
    const { repository: subject } = repository();
    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });
});

describe('PostgresAuthenticationOperationTerminalRepository rejections and audit', () => {
  it.each([
    [
      'operation_binding_conflict',
      (pending: PendingAuthenticationOperation) =>
        commandFor(pending, 'complete', {
          binding: {
            ...commandFor(pending).binding,
            identityKey: {
              ...pending.identityKey,
              lookup: {
                kind: 'lookup_digest',
                digest: externalIdentityLookupDigest('c'.repeat(64)),
              },
            },
          },
        }),
      'conflict',
      'completed',
    ],
    [
      'operation_expired',
      (pending: PendingAuthenticationOperation) =>
        commandFor(pending, 'complete', { now: AT_EXPIRY }),
      'expired',
      'completed',
    ],
    [
      'operation_not_expired',
      (pending: PendingAuthenticationOperation) =>
        commandFor(pending, 'expire', { now: BEFORE_EXPIRY }),
      'denied',
      'expired',
    ],
  ] as const)(
    'returns %s and audits attempted status',
    async (reason, makeCommand, outcome, terminalStatus) => {
      const pending = pendingOperation();
      const command = makeCommand(pending);
      const transaction = new FakeTransaction([
        queryResult([rowForState(pending)]),
      ]);
      const { repository: subject, audit } = repository();

      await expect(
        subject.applyTerminalCommand(transaction, input(command)),
      ).resolves.toEqual({ outcome: 'rejected', reason });
      expect(transaction.calls).toHaveLength(1);
      expect(audit.calls[0].event).toMatchObject({
        outcome,
        metadata: { terminalStatus },
      });
    },
  );

  it('returns command_reuse_conflict without UPDATE', async () => {
    const pending = pendingOperation();
    const first = commandFor(pending, 'fail');
    const terminal = transitionedState(pending, first);
    const changed = commandFor(pending, 'complete');
    const transaction = new FakeTransaction([
      queryResult([rowForState(terminal)]),
    ]);
    const { repository: subject, audit } = repository();

    await expect(
      subject.applyTerminalCommand(transaction, input(changed)),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
    });
    expect(transaction.calls).toHaveLength(1);
    expect(audit.calls[0].event.outcome).toBe('conflict');
  });

  it.each([
    [
      'resolution_identity_conflict',
      accountResolutionConflict(
        {
          ...IDENTITY_KEY,
          lookup: {
            kind: 'lookup_digest',
            digest: externalIdentityLookupDigest('d'.repeat(64)),
          },
        },
        'ambiguous_account_resolution',
      ),
    ],
    [
      'intent_outcome_incompatible',
      newAccountRequired(IDENTITY_KEY),
    ],
  ] as const)('returns %s without UPDATE', async (reason, resolution) => {
    const pending = pendingOperation();
    const command = commandFor(pending, 'complete', { resolution });
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
    ]);
    const { repository: subject, audit } = repository();

    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).resolves.toEqual({ outcome: 'rejected', reason });
    expect(transaction.calls).toHaveLength(1);
    expect(audit.calls[0].event.outcome).toBe('conflict');
  });

  it('returns forbidden_transition for another terminal command', async () => {
    const pending = pendingOperation();
    const terminal = transitionedState(pending, commandFor(pending));
    const changed = commandFor(pending, 'fail', {
      commandId: OTHER_COMMAND_ID,
    });
    const transaction = new FakeTransaction([
      queryResult([rowForState(terminal)]),
    ]);
    const { repository: subject } = repository();

    await expect(
      subject.applyTerminalCommand(transaction, input(changed)),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'forbidden_transition',
    });
    expect(transaction.calls).toHaveLength(1);
  });

  it.each([
    [
      { status: 'appended' } as const,
      { outcome: 'transitioned', status: 'completed' },
    ],
    [
      { status: 'idempotent_retry' } as const,
      { outcome: 'transitioned', status: 'completed' },
    ],
  ])('accepts audit result %p', async (auditResult, expected) => {
    const pending = pendingOperation();
    const command = commandFor(pending);
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      queryResult([rowForState(transitionedState(pending, command))]),
    ]);
    const { repository: subject } = repository(
      new FakeAuditRepository(auditResult),
    );
    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).resolves.toMatchObject(expected);
  });

  it('turns audit event conflict into audit_conflict', async () => {
    const pending = pendingOperation();
    const command = commandFor(pending);
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      queryResult([rowForState(transitionedState(pending, command))]),
    ]);
    const { repository: subject } = repository(
      new FakeAuditRepository({ status: 'event_id_conflict' }),
    );
    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).rejects.toMatchObject({ reason: 'audit_conflict' });
  });

  it('wraps an audit exception without additional SQL', async () => {
    const pending = pendingOperation();
    const command = commandFor(pending);
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      queryResult([rowForState(transitionedState(pending, command))]),
    ]);
    const { repository: subject, audit } = repository(
      new FakeAuditRepository(new Error('audit secret')),
    );
    await expect(
      subject.applyTerminalCommand(transaction, input(command)),
    ).rejects.toMatchObject({ reason: 'storage_failure' });
    expect(transaction.calls).toHaveLength(2);
    expect(audit.calls).toHaveLength(1);
  });

  it('performs audit after SELECT and UPDATE using the same transaction', async () => {
    const timeline: string[] = [];
    const pending = pendingOperation();
    const command = commandFor(pending);
    const transaction = new FakeTransaction(
      [
        queryResult([rowForState(pending)]),
        queryResult([rowForState(transitionedState(pending, command))]),
      ],
      timeline,
    );
    const audit = new FakeAuditRepository(
      { status: 'appended' },
      timeline,
    );
    const subject =
      new PostgresAuthenticationOperationTerminalRepository(audit);

    await subject.applyTerminalCommand(transaction, input(command));

    expect(timeline).toEqual(['query:1', 'query:2', 'audit']);
    expect(audit.calls[0].transaction).toBe(transaction);
  });
});

describe('PostgresAuthenticationOperationTerminalRepository PostgreSQL failures', () => {
  it.each([
    ['23503', 'foreign_key_violation', 'referential_integrity'],
    ['42501', 'insufficient_privilege', 'permission_denied'],
    ['40001', 'serialization_failure', 'transaction_conflict'],
    ['40P01', 'deadlock_detected', 'transaction_conflict'],
    ['08006', 'connection_failure', 'database_unavailable'],
    ['57P01', 'admin_shutdown', 'database_unavailable'],
    ['57014', 'query_canceled', 'database_unavailable'],
    ['23514', 'check_violation', 'invalid_persisted_state'],
    ['23502', 'not_null_violation', 'invalid_persisted_state'],
    ['22P02', 'invalid_text_representation', 'invalid_persisted_state'],
    ['22023', 'invalid_parameter_value', 'invalid_persisted_state'],
    ['55000', 'object_not_ready', 'invalid_persisted_state'],
    ['23505', 'unique_violation', 'storage_failure'],
    ['99999', 'unknown', 'storage_failure'],
  ] as const)('maps SQLSTATE %s', async (code, message, reason) => {
    const postgresError = Object.assign(new Error(message), {
      code,
      constraint: 'secret_constraint',
      schema: 'backend_auth',
      table: 'authentication_operations',
      column: 'secret_column',
    });
    const transaction = new FakeTransaction([postgresError]);
    const { repository: subject, audit } = repository();

    await expect(
      subject.applyTerminalCommand(transaction, input()),
    ).rejects.toMatchObject({ reason });
    expect(audit.calls).toHaveLength(0);
  });

  it('maps an ordinary Error to storage_failure', async () => {
    const transaction = new FakeTransaction([
      new Error('ordinary secret error'),
    ]);
    const { repository: subject } = repository();
    await expect(
      subject.applyTerminalCommand(transaction, input()),
    ).rejects.toMatchObject({ reason: 'storage_failure' });
  });

  it('does not audit after an UPDATE PostgreSQL error', async () => {
    const pending = pendingOperation();
    const transaction = new FakeTransaction([
      queryResult([rowForState(pending)]),
      Object.assign(new Error('update failed'), { code: '23503' }),
    ]);
    const { repository: subject, audit } = repository();

    await expect(
      subject.applyTerminalCommand(
        transaction,
        input(commandFor(pending)),
      ),
    ).rejects.toMatchObject({ reason: 'referential_integrity' });
    expect(transaction.calls).toHaveLength(2);
    expect(audit.calls).toHaveLength(0);
  });

  it('does not leak raw PostgreSQL or operation data', async () => {
    const secretMarkers = [
      'raw-postgres-message',
      'raw-detail',
      'raw-hint',
      'raw-where',
      'raw-query-marker',
      'raw-parameters-marker',
      'raw-constraint-marker',
      'raw-schema-marker',
      'raw-table-marker',
      'raw-column-marker',
      'raw-cause-marker',
      OPERATION_ID,
      ACCOUNT_ID,
      AUDIT_EVENT_ID,
      LOOKUP_DIGEST,
      FINGERPRINT,
      IDEMPOTENCY_KEY,
      REQUEST_DIGEST,
      'telegram-subject-secret',
      'raw-init-data-secret',
    ];
    const raw = Object.assign(new Error(secretMarkers[0]), {
      code: '23503',
      detail: secretMarkers[1],
      hint: secretMarkers[2],
      where: secretMarkers[3],
      query: secretMarkers[4],
      parameters: [secretMarkers[5]],
      constraint: secretMarkers[6],
      schema: secretMarkers[7],
      table: secretMarkers[8],
      column: secretMarkers[9],
      cause: { marker: secretMarkers[10] },
    });
    const transaction = new FakeTransaction([raw]);
    const { repository: subject } = repository();

    let caught: unknown;
    try {
      await subject.applyTerminalCommand(transaction, input());
    } catch (error) {
      caught = error;
    }

    expectPersistenceFailure(caught, 'referential_integrity');
    expect(caught).not.toBe(raw);
    const ownPropertyNames = Object.getOwnPropertyNames(caught).sort();
    expect(ownPropertyNames).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
    const record = caught as Record<string, unknown>;
    const ownProperties = Object.fromEntries(
      ownPropertyNames.map((property) => [property, record[property]]),
    );
    expect(Object.values(ownProperties)).not.toContain(raw);
    expect(record).not.toHaveProperty('cause');
    const serialized = JSON.stringify(ownProperties);
    const text = [
      (caught as Error).message,
      (caught as Error).stack ?? '',
      serialized,
    ].join(' ');
    for (const marker of secretMarkers) {
      expect(text).not.toContain(marker);
    }
    for (const property of [
      'detail',
      'hint',
      'where',
      'query',
      'parameters',
      'constraint',
      'schema',
      'table',
      'column',
    ]) {
      expect(record).not.toHaveProperty(property);
    }
  });
});
