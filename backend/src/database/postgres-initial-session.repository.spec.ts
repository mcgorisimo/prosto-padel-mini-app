import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import {
  AuthenticationOperationId,
  UnixEpochSeconds,
  unixEpochSeconds,
} from '../auth/auth.types';
import {
  SecurityAuditEvent,
  SecurityAuditEventId,
  SecurityAuditEventType,
} from '../auth/security-audit.types';
import {
  CreateActiveSessionBinding,
  SessionCredentialDigest,
  SessionId,
} from '../auth/session.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  CreateInitialSessionInput,
  InitialSessionPersistenceError,
  InitialSessionPersistenceFailure,
} from './initial-session.repository';
import { PostgresInitialSessionRepository } from './postgres-initial-session.repository';
import { PostgresTransaction } from './postgres-transaction';
import {
  SecurityAuditAppendResult,
  SecurityAuditRepository,
} from './security-audit.repository';

const SESSION_ID = deterministicUuid('initial-session') as SessionId;
const OTHER_SESSION_ID = deterministicUuid(
  'initial-other-session',
) as SessionId;
const OPERATION_ID = deterministicUuid(
  'initial-session-operation',
) as AuthenticationOperationId;
const OTHER_OPERATION_ID = deterministicUuid(
  'initial-other-operation',
) as AuthenticationOperationId;
const ACCOUNT_ID = deterministicUuid(
  'initial-session-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'initial-other-account',
) as AccountId;
const COMMAND_ID = deterministicUuid('initial-session-command');
const AUDIT_EVENT_ID = deterministicUuid(
  'initial-session-audit',
) as SecurityAuditEventId;
const CREATED_AT = unixEpochSeconds(1_800_000_000);
const ISSUED_AT = unixEpochSeconds(1_800_000_001);
const EXPIRES_AT = unixEpochSeconds(1_800_086_400);
const DIGEST = 'a'.repeat(64) as SessionCredentialDigest;
const OTHER_DIGEST = 'b'.repeat(64) as SessionCredentialDigest;
const PLAINTEXT_CREDENTIAL = 'plaintext-session-credential-secret';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueuedQuery =
  | QueryResult<QueryResultRow>
  | Error
  | Record<string, unknown>;

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

function binding(
  overrides: Partial<CreateActiveSessionBinding> = {},
): CreateActiveSessionBinding {
  return {
    sessionId: SESSION_ID,
    authenticationOperationId: OPERATION_ID,
    accountId: ACCOUNT_ID,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    currentCredential: {
      digest: DIGEST,
      generation: 1,
      issuedAt: ISSUED_AT,
    },
    ...overrides,
  };
}

function input(
  overrides: Partial<CreateInitialSessionInput> = {},
): CreateInitialSessionInput {
  return {
    binding: binding(),
    audit: {
      eventId: AUDIT_EVENT_ID,
      occurredAt: ISSUED_AT,
    },
    ...overrides,
  };
}

function completedExistingOperation(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: OPERATION_ID,
    status: 'completed',
    resolution_type: 'existing_account',
    resolution_account_id: ACCOUNT_ID,
    resolution_account_status: 'active',
    resolution_initial_role: null,
    resolution_reason: null,
    ...overrides,
  };
}

function completedNewAccountOperation(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: OPERATION_ID,
    status: 'completed',
    resolution_type: 'new_account_required',
    resolution_account_id: null,
    resolution_account_status: null,
    resolution_initial_role: 'player',
    resolution_reason: null,
    ...overrides,
  };
}

function nonCompletedOperation(
  status: 'pending' | 'failed' | 'expired',
): QueryResultRow {
  return {
    id: OPERATION_ID,
    status,
    resolution_type: null,
    resolution_account_id: null,
    resolution_account_status: null,
    resolution_initial_role: null,
    resolution_reason: null,
  };
}

function activeAccount(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: ACCOUNT_ID,
    status: 'active',
    ...overrides,
  };
}

function existingSessionRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    family_id: SESSION_ID,
    account_id: ACCOUNT_ID,
    authentication_operation_id: OPERATION_ID,
    status: 'active',
    current_credential_generation: '1',
    created_at: CREATED_AT.toString(10),
    expires_at: EXPIRES_AT.toString(10),
    terminal_command_id: null,
    terminal_reason: null,
    terminal_at: null,
    terminal_reuse_generation: null,
    terminal_reuse_digest: null,
    credential_family_id: SESSION_ID,
    credential_generation: '1',
    credential_digest: Buffer.from(DIGEST, 'hex'),
    credential_issued_at: ISSUED_AT.toString(10),
    credential_consumed_at: null,
    consumed_by_command_id: null,
    command_count: '0',
    ...overrides,
  };
}

function insertedCredentialRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    family_id: SESSION_ID,
    generation: '1',
    digest: Buffer.from(DIGEST, 'hex'),
    issued_at: ISSUED_AT.toString(10),
    consumed_at: null,
    consumed_by_command_id: null,
    ...overrides,
  };
}

function createdQueue(
  operation: QueryResultRow = completedExistingOperation(),
): QueuedQuery[] {
  return [
    queryResult([operation]),
    queryResult([activeAccount()]),
    queryResult([]),
    queryResult([{ id: SESSION_ID }]),
    queryResult([insertedCredentialRow()]),
  ];
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function parseInsert(
  text: string,
  table: string,
): {
  readonly columns: readonly string[];
  readonly placeholders: readonly string[];
} {
  const normalized = normalizeSql(text);
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(
    `INSERT INTO ${escapedTable} \\(([^)]+)\\) VALUES \\(([^)]+)\\)`,
    'u',
  ).exec(normalized);
  if (match === null) {
    throw new Error(`Expected static INSERT for ${table}`);
  }
  return {
    columns: match[1].split(',').map((value) => value.trim()),
    placeholders: match[2].split(',').map((value) => value.trim()),
  };
}

async function expectPersistenceFailure(
  promise: Promise<unknown>,
  reason: InitialSessionPersistenceFailure,
): Promise<InitialSessionPersistenceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(InitialSessionPersistenceError);
    expect(error).toMatchObject({ reason });
    return error as InitialSessionPersistenceError;
  }
  throw new Error('Expected InitialSessionPersistenceError');
}

describe('PostgresInitialSessionRepository', () => {
  it.each([
    [
      'extra plaintext credential',
      {
        ...input(),
        binding: {
          ...binding(),
          plaintextCredential: PLAINTEXT_CREDENTIAL,
        },
      },
    ],
    [
      'invalid session UUID',
      {
        ...input(),
        binding: { ...binding(), sessionId: 'invalid-session-id' },
      },
    ],
    [
      'invalid operation UUID',
      {
        ...input(),
        binding: {
          ...binding(),
          authenticationOperationId: 42,
        },
      },
    ],
    [
      'invalid account UUID',
      {
        ...input(),
        binding: { ...binding(), accountId: {} },
      },
    ],
    [
      'invalid digest',
      {
        ...input(),
        binding: {
          ...binding(),
          currentCredential: {
            ...binding().currentCredential,
            digest: 'not-a-digest',
          },
        },
      },
    ],
    [
      'generation other than one',
      {
        ...input(),
        binding: {
          ...binding(),
          currentCredential: {
            ...binding().currentCredential,
            generation: 2,
          },
        },
      },
    ],
    [
      'invalid session window',
      {
        ...input(),
        binding: {
          ...binding(),
          createdAt: EXPIRES_AT,
          expiresAt: CREATED_AT,
        },
      },
    ],
    [
      'invalid audit event UUID',
      {
        ...input(),
        audit: { ...input().audit, eventId: 'bad-event-id' },
      },
    ],
    [
      'invalid audit timestamp',
      {
        ...input(),
        audit: { ...input().audit, occurredAt: -1 },
      },
    ],
  ])('rejects %s before SQL or audit', async (_name, runtimeInput) => {
    const transaction = new FakeTransaction([]);
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expectPersistenceFailure(
      repository.createInitialSession(
        transaction,
        runtimeInput as unknown as CreateInitialSessionInput,
      ),
      'invalid_input',
    );

    expect(transaction.calls).toHaveLength(0);
    expect(audit.calls).toHaveLength(0);
  });

  it('creates the family and generation-one credential in strict order', async () => {
    const timeline: string[] = [];
    const transaction = new FakeTransaction(createdQueue(), timeline);
    const audit = new FakeAuditRepository(
      { status: 'appended' },
      timeline,
    );
    const repository = new PostgresInitialSessionRepository(audit);

    const result = await repository.createInitialSession(
      transaction,
      input(),
    );

    expect(result).toEqual({
      outcome: 'created',
      sessionId: SESSION_ID,
      generation: 1,
      expiresAt: EXPIRES_AT,
    });
    expect(timeline).toEqual([
      'query:1',
      'query:2',
      'query:3',
      'query:4',
      'query:5',
      'audit',
    ]);
    expect(transaction.calls).toHaveLength(5);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].transaction).toBe(transaction);
  });

  it('locks the operation and account before checking the session family', async () => {
    const transaction = new FakeTransaction(createdQueue());
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    await repository.createInitialSession(transaction, input());

    const operationSql = normalizeSql(transaction.calls[0].text);
    expect(operationSql).toContain(
      'FROM backend_auth.authentication_operations',
    );
    expect(operationSql).toMatch(/WHERE id = \$1 FOR UPDATE$/u);
    expect(transaction.calls[0].values).toEqual([OPERATION_ID]);

    const accountSql = normalizeSql(transaction.calls[1].text);
    expect(accountSql).toContain('FROM backend_auth.accounts');
    expect(accountSql).toMatch(/WHERE id = \$1 FOR UPDATE$/u);
    expect(transaction.calls[1].values).toEqual([ACCOUNT_ID]);

    const existingSql = normalizeSql(transaction.calls[2].text);
    expect(existingSql).toContain(
      'FROM backend_auth.auth_session_families f',
    );
    expect(existingSql).toContain(
      'LEFT JOIN backend_auth.auth_session_credentials c',
    );
    expect(existingSql).toContain(
      'FROM backend_auth.auth_session_commands command',
    );
    expect(existingSql).toContain('FOR UPDATE OF f');
    expect(transaction.calls[2].values).toEqual([
      SESSION_ID,
      OPERATION_ID,
    ]);
  });

  it('maps the family INSERT columns, placeholders and bigint strings exactly', async () => {
    const transaction = new FakeTransaction(createdQueue());
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    await repository.createInitialSession(transaction, input());

    const call = transaction.calls[3];
    expect(
      parseInsert(
        call.text,
        'backend_auth.auth_session_families',
      ),
    ).toEqual({
      columns: [
        'id',
        'account_id',
        'authentication_operation_id',
        'current_credential_generation',
        'created_at',
        'expires_at',
      ],
      placeholders: ['$1', '$2', '$3', '$4', '$5', '$6'],
    });
    expect(call.values).toEqual([
      SESSION_ID,
      ACCOUNT_ID,
      OPERATION_ID,
      '1',
      CREATED_AT.toString(10),
      EXPIRES_AT.toString(10),
    ]);
    const sql = normalizeSql(call.text);
    expect(sql).not.toMatch(/\bstatus\b/u);
    expect(sql).not.toMatch(/\bterminal_/u);
  });

  it('maps only the initial credential columns with a fresh digest Buffer', async () => {
    const transaction = new FakeTransaction(createdQueue());
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    await repository.createInitialSession(transaction, input());

    const call = transaction.calls[4];
    expect(
      parseInsert(
        call.text,
        'backend_auth.auth_session_credentials',
      ),
    ).toEqual({
      columns: ['family_id', 'generation', 'digest', 'issued_at'],
      placeholders: ['$1', '$2', '$3', '$4'],
    });
    expect(call.values.slice(0, 2)).toEqual([SESSION_ID, '1']);
    expect(call.values[2]).toBeInstanceOf(Buffer);
    expect((call.values[2] as Buffer).toString('hex')).toBe(DIGEST);
    expect(call.values[3]).toBe(ISSUED_AT.toString(10));
    const insertBeforeReturning =
      normalizeSql(call.text).split(/\bRETURNING\b/u)[0];
    expect(insertBeforeReturning).not.toMatch(/\bconsumed_/u);
  });

  it('creates independent digest Buffers across calls without changing the hex digest', async () => {
    const firstTransaction = new FakeTransaction(createdQueue());
    const secondTransaction = new FakeTransaction(createdQueue());
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    await repository.createInitialSession(firstTransaction, input());
    await repository.createInitialSession(secondTransaction, input());

    const first = firstTransaction.calls[4].values[2] as Buffer;
    const second = secondTransaction.calls[4].values[2] as Buffer;
    expect(first).not.toBe(second);
    expect(first.toString('hex')).toBe(DIGEST);
    expect(second.toString('hex')).toBe(DIGEST);
    first[0] ^= 0xff;
    expect(second.toString('hex')).toBe(DIGEST);
    expect(DIGEST).toBe('a'.repeat(64));
  });

  it('does not insert an initial session command or write transaction lifecycle SQL', async () => {
    const transaction = new FakeTransaction(createdQueue());
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    await repository.createInitialSession(transaction, input());

    const sql = transaction.calls.map(({ text }) => normalizeSql(text));
    expect(sql.some((text) =>
      /INSERT INTO backend_auth\.auth_session_commands/u.test(text),
    )).toBe(false);
    for (const statement of sql) {
      expect(statement).not.toMatch(
        /^(?:BEGIN|COMMIT|ROLLBACK)\b|\bDELETE FROM\b|\bUPDATE backend_auth\./u,
      );
    }
  });

  it('accepts a completed new-account-required operation', async () => {
    const transaction = new FakeTransaction(
      createdQueue(completedNewAccountOperation()),
    );
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    await expect(
      repository.createInitialSession(transaction, input()),
    ).resolves.toMatchObject({ outcome: 'created' });
  });

  it('returns operation_not_found without account SQL or audit', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expect(
      repository.createInitialSession(transaction, input()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'operation_not_found',
    });
    expect(transaction.calls).toHaveLength(1);
    expect(audit.calls).toHaveLength(0);
  });

  it.each(['pending', 'failed', 'expired'] as const)(
    'rejects a %s operation before account SQL',
    async (status) => {
      const transaction = new FakeTransaction([
        queryResult([nonCompletedOperation(status)]),
      ]);
      const audit = new FakeAuditRepository();
      const repository = new PostgresInitialSessionRepository(audit);

      await expect(
        repository.createInitialSession(transaction, input()),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: 'operation_not_completed',
      });
      expect(transaction.calls).toHaveLength(1);
      expect(audit.calls).toHaveLength(0);
    },
  );

  it.each([
    [
      'blocked',
      completedExistingOperation({
        resolution_type: 'blocked',
        resolution_account_status: 'blocked',
        resolution_reason: 'account_blocked',
      }),
    ],
    [
      'conflict',
      completedExistingOperation({
        resolution_type: 'conflict',
        resolution_account_id: null,
        resolution_account_status: null,
        resolution_reason: 'ambiguous_account_resolution',
      }),
    ],
  ])('rejects a completed %s resolution before account SQL', async (_name, row) => {
    const transaction = new FakeTransaction([queryResult([row])]);
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expect(
      repository.createInitialSession(transaction, input()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'operation_resolution_ineligible',
    });
    expect(transaction.calls).toHaveLength(1);
    expect(audit.calls).toHaveLength(0);
  });

  it('rejects a missing account before family SQL', async () => {
    const transaction = new FakeTransaction([
      queryResult([completedExistingOperation()]),
      queryResult([]),
    ]);
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expect(
      repository.createInitialSession(transaction, input()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'account_not_found',
    });
    expect(transaction.calls).toHaveLength(2);
    expect(audit.calls).toHaveLength(0);
  });

  it.each(['blocked', 'pending_deletion', 'anonymized'] as const)(
    'rejects a %s account before family SQL',
    async (status) => {
      const transaction = new FakeTransaction([
        queryResult([completedExistingOperation()]),
        queryResult([activeAccount({ status })]),
      ]);
      const audit = new FakeAuditRepository();
      const repository = new PostgresInitialSessionRepository(audit);

      await expect(
        repository.createInitialSession(transaction, input()),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: 'account_not_active',
      });
      expect(transaction.calls).toHaveLength(2);
      expect(audit.calls).toHaveLength(0);
    },
  );

  it('rejects an existing-account operation bound to another account', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        completedExistingOperation({
          resolution_account_id: OTHER_ACCOUNT_ID,
        }),
      ]),
      queryResult([activeAccount()]),
    ]);
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expect(
      repository.createInitialSession(transaction, input()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'account_binding_conflict',
    });
    expect(transaction.calls).toHaveLength(2);
    expect(audit.calls).toHaveLength(0);
  });

  it('recognizes only a fully identical initial aggregate as an idempotent retry', async () => {
    const timeline: string[] = [];
    const transaction = new FakeTransaction(
      [
        queryResult([completedExistingOperation()]),
        queryResult([activeAccount()]),
        queryResult([existingSessionRow()]),
      ],
      timeline,
    );
    const audit = new FakeAuditRepository(
      { status: 'idempotent_retry' },
      timeline,
    );
    const repository = new PostgresInitialSessionRepository(audit);

    const result = await repository.createInitialSession(
      transaction,
      input(),
    );

    expect(result).toEqual({
      outcome: 'idempotent_retry',
      sessionId: SESSION_ID,
      generation: 1,
      expiresAt: EXPIRES_AT,
    });
    expect(transaction.calls).toHaveLength(3);
    expect(timeline).toEqual(['query:1', 'query:2', 'query:3', 'audit']);
    expect(audit.calls[0].event).toMatchObject({
      eventType: 'session_family_created',
      outcome: 'idempotent_retry',
      metadata: {
        sessionId: SESSION_ID,
        accountId: ACCOUNT_ID,
        authenticationOperationId: OPERATION_ID,
      },
    });
  });

  it.each([
    ['account binding', { account_id: OTHER_ACCOUNT_ID }],
    ['operation binding', { authentication_operation_id: OTHER_OPERATION_ID }],
    ['created timestamp', { created_at: String(CREATED_AT + 1) }],
    ['expiry timestamp', { expires_at: String(EXPIRES_AT + 1) }],
    ['current generation', { current_credential_generation: '2' }],
    ['command history', { command_count: '1' }],
  ])('returns session_binding_conflict for different %s', async (_name, override) => {
    const transaction = new FakeTransaction([
      queryResult([completedExistingOperation()]),
      queryResult([activeAccount()]),
      queryResult([existingSessionRow(override)]),
    ]);
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expect(
      repository.createInitialSession(transaction, input()),
    ).resolves.toEqual({
      outcome: 'conflict',
      reason: 'session_binding_conflict',
    });
    expect(audit.calls).toHaveLength(0);
  });

  it.each([
    [
      'digest',
      { credential_digest: Buffer.from(OTHER_DIGEST, 'hex') },
    ],
    ['generation', { credential_generation: '2' }],
    ['issued timestamp', { credential_issued_at: String(ISSUED_AT + 1) }],
    [
      'consumption state',
      {
        credential_consumed_at: String(ISSUED_AT + 1),
        consumed_by_command_id: COMMAND_ID,
      },
    ],
  ])('returns credential_conflict for different %s', async (_name, override) => {
    const transaction = new FakeTransaction([
      queryResult([completedExistingOperation()]),
      queryResult([activeAccount()]),
      queryResult([existingSessionRow(override)]),
    ]);
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expect(
      repository.createInitialSession(transaction, input()),
    ).resolves.toEqual({
      outcome: 'conflict',
      reason: 'credential_conflict',
    });
    expect(audit.calls).toHaveLength(0);
  });

  it('returns session_binding_conflict rather than choosing one of two matching families', async () => {
    const transaction = new FakeTransaction([
      queryResult([completedExistingOperation()]),
      queryResult([activeAccount()]),
      queryResult([
        existingSessionRow(),
        existingSessionRow({
          family_id: OTHER_SESSION_ID,
          credential_family_id: OTHER_SESSION_ID,
        }),
      ]),
    ]);
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    await expect(
      repository.createInitialSession(transaction, input()),
    ).resolves.toEqual({
      outcome: 'conflict',
      reason: 'session_binding_conflict',
    });
  });

  it.each([
    ['malformed operation UUID', 0, { id: 'bad-operation-id' }],
    [
      'malformed family bigint',
      2,
      { current_credential_generation: '01' },
    ],
    [
      'malformed credential digest',
      2,
      { credential_digest: Buffer.alloc(31) },
    ],
    [
      'credential outside the family window',
      2,
      { credential_issued_at: String(EXPIRES_AT) },
    ],
    [
      'malformed account status',
      1,
      { status: 'unknown-account-status' },
    ],
  ])('rejects %s as invalid persisted state', async (_name, queryIndex, override) => {
    const queued: QueuedQuery[] = [
      queryResult([completedExistingOperation()]),
      queryResult([activeAccount()]),
      queryResult([existingSessionRow()]),
    ];
    if (queryIndex === 0) {
      queued[0] = queryResult([completedExistingOperation(override)]);
    } else if (queryIndex === 1) {
      queued[1] = queryResult([activeAccount(override)]);
    } else {
      queued[2] = queryResult([existingSessionRow(override)]);
    }
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expectPersistenceFailure(
      repository.createInitialSession(
        new FakeTransaction(queued),
        input(),
      ),
      'invalid_persisted_state',
    );
    expect(audit.calls).toHaveLength(0);
  });

  it('rejects malformed INSERT RETURNING state without audit', async () => {
    const transaction = new FakeTransaction([
      queryResult([completedExistingOperation()]),
      queryResult([activeAccount()]),
      queryResult([]),
      queryResult([{ id: OTHER_SESSION_ID }]),
    ]);
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await expectPersistenceFailure(
      repository.createInitialSession(transaction, input()),
      'invalid_persisted_state',
    );
    expect(transaction.calls).toHaveLength(4);
    expect(audit.calls).toHaveLength(0);
  });

  it('builds the success audit from safe bindings and calls it last', async () => {
    const transaction = new FakeTransaction(createdQueue());
    const audit = new FakeAuditRepository();
    const repository = new PostgresInitialSessionRepository(audit);

    await repository.createInitialSession(transaction, input());

    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toEqual({
      transaction,
      event: expect.objectContaining({
        eventId: AUDIT_EVENT_ID,
        eventType: 'session_family_created',
        outcome: 'success',
        occurredAt: ISSUED_AT,
        metadata: {
          sessionId: SESSION_ID,
          accountId: ACCOUNT_ID,
          authenticationOperationId: OPERATION_ID,
        },
      }),
    });
    const serialized = JSON.stringify(audit.calls[0].event);
    expect(serialized).not.toContain(DIGEST);
    expect(serialized).not.toContain(PLAINTEXT_CREDENTIAL);
  });

  it('accepts an exact audit retry but rejects an audit event ID conflict', async () => {
    const retryRepository = new PostgresInitialSessionRepository(
      new FakeAuditRepository({ status: 'idempotent_retry' }),
    );
    await expect(
      retryRepository.createInitialSession(
        new FakeTransaction(createdQueue()),
        input(),
      ),
    ).resolves.toMatchObject({ outcome: 'created' });

    const conflictRepository = new PostgresInitialSessionRepository(
      new FakeAuditRepository({ status: 'event_id_conflict' }),
    );
    await expectPersistenceFailure(
      conflictRepository.createInitialSession(
        new FakeTransaction(createdQueue()),
        input(),
      ),
      'audit_conflict',
    );
  });

  it('maps an audit error to a safe storage failure', async () => {
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(new Error('raw audit secret')),
    );

    const error = await expectPersistenceFailure(
      repository.createInitialSession(
        new FakeTransaction(createdQueue()),
        input(),
      ),
      'storage_failure',
    );
    expect(error.message).not.toContain('raw audit secret');
    expect(error).not.toHaveProperty('cause');
  });

  it.each([
    ['23503', undefined, 'referential_integrity'],
    ['23514', undefined, 'invalid_persisted_state'],
    ['23502', undefined, 'invalid_persisted_state'],
    ['22P02', undefined, 'invalid_persisted_state'],
    ['55000', undefined, 'invalid_persisted_state'],
    ['42501', undefined, 'permission_denied'],
    ['40001', undefined, 'transaction_conflict'],
    ['40P01', undefined, 'transaction_conflict'],
    ['08006', undefined, 'database_unavailable'],
    ['57P01', undefined, 'database_unavailable'],
    ['57014', undefined, 'database_unavailable'],
    ['23505', 'unknown_constraint', 'storage_failure'],
    ['ZZ999', undefined, 'storage_failure'],
  ] as const)(
    'maps PostgreSQL %s/%s to %s',
    async (code, constraint, reason) => {
      const raw = {
        code,
        ...(constraint === undefined ? {} : { constraint }),
      };
      const repository = new PostgresInitialSessionRepository(
        new FakeAuditRepository(),
      );
      await expectPersistenceFailure(
        repository.createInitialSession(
          new FakeTransaction([
            queryResult([completedExistingOperation()]),
            queryResult([activeAccount()]),
            queryResult([]),
            raw,
          ]),
          input(),
        ),
        reason,
      );
    },
  );

  it.each([
    ['auth_session_families_pkey', 'session_binding_conflict'],
    [
      'auth_session_families_operation_id_key',
      'session_binding_conflict',
    ],
    [
      'auth_session_families_id_account_key',
      'session_binding_conflict',
    ],
  ] as const)(
    'maps family unique constraint %s safely',
    async (constraint, reason) => {
      const repository = new PostgresInitialSessionRepository(
        new FakeAuditRepository(),
      );
      await expectPersistenceFailure(
        repository.createInitialSession(
          new FakeTransaction([
            queryResult([completedExistingOperation()]),
            queryResult([activeAccount()]),
            queryResult([]),
            { code: '23505', constraint },
          ]),
          input(),
        ),
        reason,
      );
    },
  );

  it.each([
    'auth_session_credentials_pkey',
    'auth_session_credentials_family_digest_key',
    'auth_session_credentials_one_unconsumed_uidx',
  ] as const)(
    'maps credential unique constraint %s safely',
    async (constraint) => {
      const repository = new PostgresInitialSessionRepository(
        new FakeAuditRepository(),
      );
      await expectPersistenceFailure(
        repository.createInitialSession(
          new FakeTransaction([
            queryResult([completedExistingOperation()]),
            queryResult([activeAccount()]),
            queryResult([]),
            queryResult([{ id: SESSION_ID }]),
            { code: '23505', constraint },
          ]),
          input(),
        ),
        'credential_conflict',
      );
    },
  );

  it('maps an ordinary Error to storage_failure without querying again', async () => {
    const transaction = new FakeTransaction([
      new Error('ordinary database failure'),
    ]);
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    await expectPersistenceFailure(
      repository.createInitialSession(transaction, input()),
      'storage_failure',
    );
    expect(transaction.calls).toHaveLength(1);
  });

  it('does not retain raw PostgreSQL fields, identifiers, digests or plaintext', async () => {
    const raw = {
      code: '23503',
      message: `raw-message-${PLAINTEXT_CREDENTIAL}`,
      detail: `detail-${DIGEST}`,
      hint: `hint-${OPERATION_ID}`,
      where: `where-${SESSION_ID}`,
      query: 'INSERT secret SQL',
      parameters: [ACCOUNT_ID, DIGEST],
      constraint: 'auth_session_families_account_id_fkey',
      schema: 'backend_auth',
      table: 'auth_session_families',
      column: 'account_id',
      cause: new Error(`cause-${AUDIT_EVENT_ID}`),
    };
    const repository = new PostgresInitialSessionRepository(
      new FakeAuditRepository(),
    );

    const error = await expectPersistenceFailure(
      repository.createInitialSession(
        new FakeTransaction([raw]),
        input(),
      ),
      'referential_integrity',
    );

    expect(error).not.toBe(raw);
    expect(Object.getOwnPropertyNames(error).sort()).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
    expect(error).not.toHaveProperty('cause');
    for (const property of [
      'constraint',
      'schema',
      'table',
      'column',
      'detail',
      'hint',
      'where',
      'query',
      'parameters',
    ]) {
      expect(error).not.toHaveProperty(property);
    }
    const exposed = [
      error.message,
      error.stack ?? '',
      JSON.stringify(error),
    ].join(' ');
    for (const secret of [
      PLAINTEXT_CREDENTIAL,
      DIGEST,
      OPERATION_ID,
      SESSION_ID,
      ACCOUNT_ID,
      AUDIT_EVENT_ID,
      'INSERT secret SQL',
      'backend_auth',
    ]) {
      expect(exposed).not.toContain(secret);
    }
  });
});
