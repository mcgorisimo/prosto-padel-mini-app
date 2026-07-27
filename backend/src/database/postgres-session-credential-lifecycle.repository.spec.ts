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
  SessionCommandId,
  SessionCredentialDigest,
  SessionRequestDigest,
} from '../auth/session.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { PostgresSessionCredentialLifecycleRepository } from './postgres-session-credential-lifecycle.repository';
import { PostgresTransaction } from './postgres-transaction';
import {
  ApplyPresentedSessionCredentialInput,
  SessionCredentialLifecyclePersistenceError,
  SessionCredentialLifecyclePersistenceFailure,
} from './session-credential-lifecycle.repository';
import {
  SecurityAuditAppendResult,
  SecurityAuditRepository,
} from './security-audit.repository';

const SESSION_ID = deterministicUuid('credential-lifecycle-session');
const ACCOUNT_ID = deterministicUuid(
  'credential-lifecycle-account',
) as AccountId;
const OPERATION_ID = deterministicUuid(
  'credential-lifecycle-operation',
) as AuthenticationOperationId;
const COMMAND_ID = deterministicUuid(
  'credential-lifecycle-command',
) as SessionCommandId;
const OTHER_COMMAND_ID = deterministicUuid(
  'credential-lifecycle-other-command',
) as SessionCommandId;
const REVOKE_COMMAND_ID = deterministicUuid(
  'credential-lifecycle-revoke-command',
) as SessionCommandId;
const AUDIT_EVENT_ID = deterministicUuid(
  'credential-lifecycle-audit',
) as SecurityAuditEventId;
const DIGEST_A = 'a'.repeat(64) as SessionCredentialDigest;
const DIGEST_B = 'b'.repeat(64) as SessionCredentialDigest;
const DIGEST_C = 'c'.repeat(64) as SessionCredentialDigest;
const REQUEST_DIGEST =
  'credential-lifecycle-request' as SessionRequestDigest;
const OTHER_REQUEST_DIGEST =
  'credential-lifecycle-other-request' as SessionRequestDigest;
const REVOKE_REQUEST_DIGEST =
  'credential-lifecycle-revoke-request' as SessionRequestDigest;
const CREATED_AT = unixEpochSeconds(1_800_000_000);
const ISSUED_AT = unixEpochSeconds(1_800_000_001);
const ROTATED_AT = unixEpochSeconds(1_800_000_100);
const REVOKED_AT = unixEpochSeconds(1_800_000_200);
const REUSED_AT = unixEpochSeconds(1_800_000_300);
const EXPIRES_AT = unixEpochSeconds(1_800_001_000);
const SYNTHETIC_PLAINTEXT =
  'SYNTHETIC_PLAINTEXT_SESSION_CREDENTIAL_SECRET';
const SYNTHETIC_DATABASE_DETAIL =
  'SYNTHETIC_DATABASE_DETAIL_SHOULD_NOT_ESCAPE';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueuedQuery = QueryResult<QueryResultRow> | Error;

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly queued: QueuedQuery[],
    private readonly timeline: string[] = [],
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    this.timeline.push(`query:${this.calls.length}`);
    const next = this.queued.shift();
    if (next === undefined) {
      throw new Error('Unexpected query');
    }
    if (next instanceof Error) {
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
    private readonly timeline: string[] = [],
  ) {}

  async append<EventType extends SecurityAuditEventType>(
    transaction: PostgresTransaction,
    event: SecurityAuditEvent<EventType>,
  ): Promise<SecurityAuditAppendResult> {
    this.timeline.push('audit');
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
  command = 'SELECT',
): QueryResult<Row> {
  return {
    command,
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function bytea(digest: SessionCredentialDigest): Buffer {
  return Buffer.from(digest, 'hex');
}

function familyRow(
  overrides: Readonly<Record<string, unknown>> = {},
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
    presented_generation: '1',
    ...overrides,
  };
}

function credentialRow(
  generation: number,
  digest: SessionCredentialDigest,
  issuedAt: UnixEpochSeconds,
  consumedAt: UnixEpochSeconds | null = null,
  consumedByCommandId: SessionCommandId | null = null,
): QueryResultRow {
  return {
    family_id: SESSION_ID,
    generation: generation.toString(10),
    digest: bytea(digest),
    issued_at: issuedAt.toString(10),
    consumed_at: consumedAt?.toString(10) ?? null,
    consumed_by_command_id: consumedByCommandId,
  };
}

function rotationCommandRow(
  overrides: Readonly<Record<string, unknown>> = {},
): QueryResultRow {
  return {
    family_id: SESSION_ID,
    command_id: COMMAND_ID,
    command_sequence: '1',
    request_digest: REQUEST_DIGEST,
    command_type: 'rotate_credential',
    applied_at: ROTATED_AT.toString(10),
    presented_generation: '1',
    presented_digest: bytea(DIGEST_A),
    next_generation: '2',
    next_digest: bytea(DIGEST_B),
    reason: null,
    result_type: 'credential_rotated',
    ...overrides,
  };
}

function revokeCommandRow(): QueryResultRow {
  return {
    family_id: SESSION_ID,
    command_id: REVOKE_COMMAND_ID,
    command_sequence: '1',
    request_digest: REVOKE_REQUEST_DIGEST,
    command_type: 'revoke_session',
    applied_at: REVOKED_AT.toString(10),
    presented_generation: null,
    presented_digest: null,
    next_generation: null,
    next_digest: null,
    reason: 'user_sign_out',
    result_type: 'session_revoked',
  };
}

function insertedCommandRow(
  commandId: SessionCommandId,
  sequence: number,
): QueryResultRow {
  return {
    family_id: SESSION_ID,
    command_id: commandId,
    command_sequence: sequence.toString(10),
  };
}

function input(
  overrides: Partial<ApplyPresentedSessionCredentialInput> = {},
): ApplyPresentedSessionCredentialInput {
  return {
    presentedCredentialDigest: DIGEST_A,
    nextCredentialDigest: DIGEST_B,
    commandId: COMMAND_ID,
    requestDigest: REQUEST_DIGEST,
    now: ROTATED_AT,
    audit: { eventId: AUDIT_EVENT_ID },
    ...overrides,
  };
}

function repository(
  queued: QueuedQuery[],
  options: {
    readonly auditResult?: SecurityAuditAppendResult | Error;
    readonly timeline?: string[];
  } = {},
) {
  const timeline = options.timeline ?? [];
  const transaction = new FakeTransaction(queued, timeline);
  const audit = new FakeAuditRepository(options.auditResult, timeline);
  return {
    subject: new PostgresSessionCredentialLifecycleRepository(audit),
    transaction,
    audit,
    timeline,
  };
}

function rotationQueue(): QueuedQuery[] {
  return [
    queryResult([familyRow()]),
    queryResult([credentialRow(1, DIGEST_A, ISSUED_AT)]),
    queryResult([]),
    queryResult([insertedCommandRow(COMMAND_ID, 1)], 'INSERT'),
    queryResult([
      credentialRow(1, DIGEST_A, ISSUED_AT, ROTATED_AT, COMMAND_ID),
    ], 'UPDATE'),
    queryResult([
      credentialRow(2, DIGEST_B, ROTATED_AT),
    ], 'INSERT'),
    queryResult([
      {
        id: SESSION_ID,
        status: 'active',
        current_credential_generation: '2',
      },
    ], 'UPDATE'),
  ];
}

function expectPersistenceFailure(
  error: unknown,
  reason: SessionCredentialLifecyclePersistenceFailure,
): void {
  expect(error).toBeInstanceOf(SessionCredentialLifecyclePersistenceError);
  expect(error).toMatchObject({
    name: 'SessionCredentialLifecyclePersistenceError',
    message: 'Session credential lifecycle persistence failed',
    reason,
  });
}

function postgresError(
  code: string,
  metadata: Readonly<Record<string, unknown>> = {},
): Error {
  return Object.assign(new Error(SYNTHETIC_DATABASE_DETAIL), {
    code,
    ...metadata,
  });
}

describe('PostgresSessionCredentialLifecycleRepository', () => {
  it('rotates generation 1 to 2 and persists one atomic aggregate transition', async () => {
    const harness = repository(rotationQueue());

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input(),
      ),
    ).resolves.toEqual({
      outcome: 'credential_rotated',
      persistence: 'applied',
      generation: 2,
      expiresAt: EXPIRES_AT,
    });

    expect(harness.transaction.calls).toHaveLength(7);
    expect(harness.transaction.calls[0].text).toContain(
      'FOR UPDATE OF f',
    );
    expect(harness.transaction.calls[0].values).toEqual([bytea(DIGEST_A)]);
    expect(harness.transaction.calls[0].values).not.toContain(SESSION_ID);
    expect(harness.transaction.calls[1].text).toContain('FOR UPDATE');
    expect(harness.transaction.calls[1].text).toContain(
      'backend_auth.auth_session_credentials',
    );
    expect(harness.transaction.calls[2].text).toContain(
      'backend_auth.auth_session_commands',
    );

    expect(harness.transaction.calls[3]).toMatchObject({
      text: expect.stringContaining(
        'INSERT INTO backend_auth.auth_session_commands',
      ),
    });
    expect(harness.transaction.calls[3].values).toEqual([
      SESSION_ID,
      COMMAND_ID,
      '1',
      REQUEST_DIGEST,
      'rotate_credential',
      ROTATED_AT.toString(10),
      '1',
      bytea(DIGEST_A),
      '2',
      bytea(DIGEST_B),
      null,
      'credential_rotated',
    ]);

    const consume = harness.transaction.calls[4];
    expect(consume.text).toContain(
      'UPDATE backend_auth.auth_session_credentials',
    );
    expect(consume.values).toEqual([
      SESSION_ID,
      '1',
      bytea(DIGEST_A),
      ROTATED_AT.toString(10),
      COMMAND_ID,
    ]);
    const insertCredential = harness.transaction.calls[5];
    expect(insertCredential.text).toContain(
      'INSERT INTO backend_auth.auth_session_credentials',
    );
    expect(insertCredential.values).toEqual([
      SESSION_ID,
      '2',
      bytea(DIGEST_B),
      ROTATED_AT.toString(10),
    ]);
    expect(harness.transaction.calls[6]).toMatchObject({
      text: expect.stringContaining(
        'UPDATE backend_auth.auth_session_families',
      ),
      values: [SESSION_ID, '2', '1'],
    });
    expect(harness.timeline).toEqual([
      'query:1',
      'query:2',
      'query:3',
      'query:4',
      'query:5',
      'query:6',
      'query:7',
      'audit',
    ]);
  });

  it('writes the existing session credential rotation audit event', async () => {
    const harness = repository(rotationQueue());

    await harness.subject.applyPresentedCredential(
      harness.transaction,
      input(),
    );

    expect(harness.audit.calls).toHaveLength(1);
    expect(harness.audit.calls[0]).toEqual({
      transaction: harness.transaction,
      event: {
        eventId: AUDIT_EVENT_ID,
        eventType: 'session_credential_rotation',
        outcome: 'success',
        occurredAt: ROTATED_AT,
        metadata: {
          sessionId: SESSION_ID,
          generation: 2,
        },
      },
    });
  });

  it('returns a safe rejection for an unknown digest without further reads or writes', async () => {
    const harness = repository([queryResult([])]);

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input(),
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'credential_not_found',
    });
    expect(harness.transaction.calls).toHaveLength(1);
    expect(harness.audit.calls).toHaveLength(0);
  });

  it('does not rotate an already revoked session', async () => {
    const harness = repository([
      queryResult([
        familyRow({
          status: 'revoked',
          terminal_command_id: REVOKE_COMMAND_ID,
          terminal_reason: 'user_sign_out',
          terminal_at: REVOKED_AT.toString(10),
        }),
      ]),
      queryResult([credentialRow(1, DIGEST_A, ISSUED_AT)]),
      queryResult([revokeCommandRow()]),
    ]);

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input({
          commandId: OTHER_COMMAND_ID,
          now: REUSED_AT,
        }),
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'session_closed',
    });
    expect(harness.transaction.calls).toHaveLength(3);
    expect(harness.audit.calls).toHaveLength(0);
  });

  it('expires an active session exactly at expiresAt without creating a credential', async () => {
    const harness = repository([
      queryResult([familyRow()]),
      queryResult([credentialRow(1, DIGEST_A, ISSUED_AT)]),
      queryResult([]),
      queryResult([insertedCommandRow(COMMAND_ID, 1)], 'INSERT'),
      queryResult([
        {
          id: SESSION_ID,
          status: 'expired',
          current_credential_generation: '1',
          terminal_command_id: COMMAND_ID,
        },
      ], 'UPDATE'),
    ]);

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input({ now: EXPIRES_AT }),
      ),
    ).resolves.toEqual({
      outcome: 'session_expired',
      persistence: 'applied',
      expiresAt: EXPIRES_AT,
    });
    expect(harness.transaction.calls).toHaveLength(5);
    expect(harness.transaction.calls[3].values).toEqual([
      SESSION_ID,
      COMMAND_ID,
      '1',
      REQUEST_DIGEST,
      'expire_session',
      EXPIRES_AT.toString(10),
      null,
      null,
      null,
      null,
      null,
      'session_expired',
    ]);
    expect(harness.transaction.calls[4].values).toEqual([
      SESSION_ID,
      'expired',
      COMMAND_ID,
      null,
      EXPIRES_AT.toString(10),
      null,
      null,
      'active',
      '1',
    ]);
    expect(
      harness.transaction.calls.some((call) =>
        call.text.includes('INSERT INTO backend_auth.auth_session_credentials'),
      ),
    ).toBe(false);
    expect(harness.audit.calls[0].event).toEqual({
      eventId: AUDIT_EVENT_ID,
      eventType: 'session_family_transition',
      outcome: 'expired',
      occurredAt: EXPIRES_AT,
      metadata: {
        sessionId: SESSION_ID,
        status: 'expired',
      },
    });
  });

  it('detects reuse of a consumed credential and does not create a credential', async () => {
    const harness = repository([
      queryResult([
        familyRow({
          current_credential_generation: '2',
          presented_generation: '1',
        }),
      ]),
      queryResult([
        credentialRow(1, DIGEST_A, ISSUED_AT, ROTATED_AT, COMMAND_ID),
        credentialRow(2, DIGEST_B, ROTATED_AT),
      ]),
      queryResult([rotationCommandRow()]),
      queryResult([insertedCommandRow(OTHER_COMMAND_ID, 2)], 'INSERT'),
      queryResult([
        {
          id: SESSION_ID,
          status: 'reuse_detected',
          current_credential_generation: '2',
          terminal_command_id: OTHER_COMMAND_ID,
        },
      ], 'UPDATE'),
    ]);

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input({
          commandId: OTHER_COMMAND_ID,
          requestDigest: OTHER_REQUEST_DIGEST,
          nextCredentialDigest: DIGEST_C,
          now: REUSED_AT,
        }),
      ),
    ).resolves.toEqual({
      outcome: 'credential_reuse_detected',
      persistence: 'applied',
      expiresAt: EXPIRES_AT,
    });
    expect(harness.transaction.calls[3].values).toEqual([
      SESSION_ID,
      OTHER_COMMAND_ID,
      '2',
      OTHER_REQUEST_DIGEST,
      'rotate_credential',
      REUSED_AT.toString(10),
      '1',
      bytea(DIGEST_A),
      '3',
      bytea(DIGEST_C),
      null,
      'reuse_detected',
    ]);
    expect(harness.transaction.calls[4].values).toEqual([
      SESSION_ID,
      'reuse_detected',
      OTHER_COMMAND_ID,
      null,
      REUSED_AT.toString(10),
      '1',
      bytea(DIGEST_A),
      'active',
      '2',
    ]);
    expect(
      harness.transaction.calls.some((call) =>
        call.text.includes('INSERT INTO backend_auth.auth_session_credentials'),
      ),
    ).toBe(false);
    expect(harness.audit.calls[0].event).toEqual({
      eventId: AUDIT_EVENT_ID,
      eventType: 'session_family_transition',
      outcome: 'replay_detected',
      occurredAt: REUSED_AT,
      metadata: {
        sessionId: SESSION_ID,
        status: 'reuse_detected',
      },
    });
  });

  it('returns the original rotation for an idempotent retry without writes or audit', async () => {
    const harness = repository([
      queryResult([
        familyRow({
          current_credential_generation: '2',
          presented_generation: '1',
        }),
      ]),
      queryResult([
        credentialRow(1, DIGEST_A, ISSUED_AT, ROTATED_AT, COMMAND_ID),
        credentialRow(2, DIGEST_B, ROTATED_AT),
      ]),
      queryResult([rotationCommandRow()]),
    ]);

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input({ now: REUSED_AT }),
      ),
    ).resolves.toEqual({
      outcome: 'credential_rotated',
      persistence: 'idempotent_retry',
      generation: 2,
      expiresAt: EXPIRES_AT,
    });
    expect(harness.transaction.calls).toHaveLength(3);
    expect(harness.audit.calls).toHaveLength(0);
  });

  it('returns command reuse conflict for the same commandId with a different requestDigest', async () => {
    const harness = repository([
      queryResult([
        familyRow({
          current_credential_generation: '2',
          presented_generation: '1',
        }),
      ]),
      queryResult([
        credentialRow(1, DIGEST_A, ISSUED_AT, ROTATED_AT, COMMAND_ID),
        credentialRow(2, DIGEST_B, ROTATED_AT),
      ]),
      queryResult([rotationCommandRow()]),
    ]);

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input({
          requestDigest: OTHER_REQUEST_DIGEST,
          now: REUSED_AT,
        }),
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
    });
    expect(harness.transaction.calls).toHaveLength(3);
    expect(harness.audit.calls).toHaveLength(0);
  });

  it('rejects client-supplied sessionId or generation before querying', async () => {
    const harness = repository([]);
    const unsafe = {
      ...input(),
      sessionId: SESSION_ID,
      generation: 1,
    } as unknown as ApplyPresentedSessionCredentialInput;

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        unsafe,
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(harness.transaction.calls).toHaveLength(0);
  });

  it('rejects corrupted persisted session history with a fixed error', async () => {
    const harness = repository([
      queryResult([
        familyRow({
          current_credential_generation: '2',
          presented_generation: '1',
        }),
      ]),
      queryResult([
        credentialRow(1, DIGEST_A, ISSUED_AT, ROTATED_AT, COMMAND_ID),
      ]),
      queryResult([]),
    ]);

    let caught: unknown;
    try {
      await harness.subject.applyPresentedCredential(
        harness.transaction,
        input(),
      );
    } catch (error) {
      caught = error;
    }
    expectPersistenceFailure(caught, 'invalid_persisted_state');
    expect(JSON.stringify(caught)).not.toContain(DIGEST_A);
  });

  it('maps PostgreSQL permission errors without leaking database details', async () => {
    const harness = repository([
      postgresError('42501', {
        schema: 'backend_auth',
        table: 'auth_session_credentials',
      }),
    ]);

    let caught: unknown;
    try {
      await harness.subject.applyPresentedCredential(
        harness.transaction,
        input(),
      );
    } catch (error) {
      caught = error;
    }
    expectPersistenceFailure(caught, 'permission_denied');
    const exposed = [
      JSON.stringify(caught),
      caught instanceof Error ? caught.message : '',
      caught instanceof Error ? caught.stack : '',
      caught instanceof Error ? String(caught.cause) : '',
    ].join('\n');
    expect(exposed).not.toContain(SYNTHETIC_DATABASE_DETAIL);
    expect(exposed).not.toContain('backend_auth');
    expect(exposed).not.toContain('auth_session_credentials');
  });

  it.each([
    ['serialization failure', '40001'],
    ['deadlock', '40P01'],
  ])('maps %s to transaction_conflict', async (_case, code) => {
    const harness = repository([postgresError(code)]);

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input(),
      ),
    ).rejects.toMatchObject({ reason: 'transaction_conflict' });
  });

  it('maps connection errors to database_unavailable', async () => {
    const harness = repository([postgresError('08006')]);

    await expect(
      harness.subject.applyPresentedCredential(
        harness.transaction,
        input(),
      ),
    ).rejects.toMatchObject({ reason: 'database_unavailable' });
  });

  it('never places plaintext credential material in SQL, values, results, audit, or errors', async () => {
    const rejectedHarness = repository([]);
    const unsafeInput = {
      ...input(),
      credential: SYNTHETIC_PLAINTEXT,
    } as unknown as ApplyPresentedSessionCredentialInput;
    let rejected: unknown;
    try {
      await rejectedHarness.subject.applyPresentedCredential(
        rejectedHarness.transaction,
        unsafeInput,
      );
    } catch (error) {
      rejected = error;
    }
    expectPersistenceFailure(rejected, 'invalid_input');
    expect(JSON.stringify(rejected)).not.toContain(SYNTHETIC_PLAINTEXT);
    expect(rejectedHarness.transaction.calls).toHaveLength(0);
    expect(rejectedHarness.audit.calls).toHaveLength(0);

    const harness = repository(rotationQueue());
    const result = await harness.subject.applyPresentedCredential(
      harness.transaction,
      input(),
    );

    const exposed = JSON.stringify({
      result,
      calls: harness.transaction.calls,
      audit: harness.audit.calls,
    });
    expect(exposed).not.toContain(SYNTHETIC_PLAINTEXT);
    expect(exposed).not.toContain(DIGEST_A);
    expect(exposed).not.toContain(DIGEST_B);
    for (const call of harness.transaction.calls) {
      expect(call.text).not.toContain(SYNTHETIC_PLAINTEXT);
      expect(call.text).not.toContain(DIGEST_A);
      expect(call.text).not.toContain(DIGEST_B);
      const referencedRelations = [
        ...call.text.matchAll(
          /(?:^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-z_][a-z0-9_.]*)|\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_.]*))/gimu,
        ),
      ].map((match) => match[1] ?? match[2]);
      expect(referencedRelations.length).toBeGreaterThan(0);
      expect(
        referencedRelations.every((relation) =>
          relation.startsWith('backend_auth.'),
        ),
      ).toBe(true);
    }
  });
});
