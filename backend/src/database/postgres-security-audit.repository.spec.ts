import {
  QueryResult,
  QueryResultRow,
} from 'pg';
import { AccountId } from '../accounts/account.types';
import { ExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import {
  AuthenticationOperationId,
  unixEpochSeconds,
} from '../auth/auth.types';
import { FreshAuthenticationEvidenceId } from '../auth/fresh-authentication.types';
import { OtpChallengeId } from '../auth/otp.types';
import { ScopedGrantId } from '../auth/scoped-grant.state-machine';
import {
  SecurityAuditEvent,
  SecurityAuditEventId,
  SecurityAuditEventType,
  SecurityAuditMetadata,
  SecurityAuditOutcome,
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from '../auth/security-audit.types';
import { SessionId } from '../auth/session.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { PostgresSecurityAuditRepository } from './postgres-security-audit.repository';
import { PostgresTransaction } from './postgres-transaction';
import {
  SecurityAuditPersistenceError,
  SecurityAuditPersistenceFailure,
} from './security-audit.repository';

const INSERT_COLUMNS = [
  'event_id',
  'event_type',
  'outcome',
  'occurred_at',
  'account_id',
  'role',
  'previous_status',
  'next_status',
  'identity_id',
  'provider',
  'reserved_account_id',
  'attempted_account_id',
  'operation_id',
  'attempted_operation_id',
  'intent',
  'terminal_status',
  'challenge_id',
  'otp_status',
  'session_id',
  'session_status',
  'generation',
  'evidence_id',
  'verification_method',
  'grant_id',
  'scope',
  'grant_status',
  'aggregate_type',
  'aggregate_id',
] as const;

const METADATA_COLUMNS = INSERT_COLUMNS.slice(4);
const EVENT_ID = deterministicUuid(
  'security-audit-event',
) as SecurityAuditEventId;
const ACCOUNT_ID = deterministicUuid(
  'security-audit-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'security-audit-other-account',
) as AccountId;
const IDENTITY_ID = deterministicUuid(
  'security-audit-identity',
) as ExternalIdentityId;
const OPERATION_ID = deterministicUuid(
  'security-audit-operation',
) as AuthenticationOperationId;
const ATTEMPTED_OPERATION_ID = deterministicUuid(
  'security-audit-attempted-operation',
) as AuthenticationOperationId;
const CHALLENGE_ID = deterministicUuid(
  'security-audit-challenge',
) as OtpChallengeId;
const SESSION_ID = deterministicUuid(
  'security-audit-session',
) as SessionId;
const OTHER_SESSION_ID = deterministicUuid(
  'security-audit-other-session',
) as SessionId;
const EVIDENCE_ID = deterministicUuid(
  'security-audit-evidence',
) as FreshAuthenticationEvidenceId;
const GRANT_ID = deterministicUuid(
  'security-audit-grant',
) as ScopedGrantId;
const AGGREGATE_ID = deterministicUuid('security-audit-aggregate');
const OCCURRED_AT = unixEpochSeconds(Number.MAX_SAFE_INTEGER);
const GENERATION = Number.MAX_SAFE_INTEGER;

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface ParsedInsertSql {
  readonly columns: readonly string[];
  readonly placeholders: readonly string[];
}

function parseInsertSql(text: string): ParsedInsertSql {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const match =
    /INSERT INTO backend_auth\.security_audit_events \(([^)]+)\) VALUES \(([^)]+)\)/u.exec(
      normalized,
    );
  if (match === null) {
    throw new Error('Expected the fixed security audit INSERT shape');
  }

  return {
    columns: match[1].split(',').map((column) => column.trim()),
    placeholders: match[2]
      .split(',')
      .map((placeholder) => placeholder.trim()),
  };
}

type QueuedQuery =
  | {
      readonly kind: 'result';
      readonly result: QueryResult<QueryResultRow>;
    }
  | {
      readonly kind: 'error';
      readonly error: unknown;
    };

class FakePostgresTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];
  private readonly queued: QueuedQuery[];

  constructor(...queued: QueuedQuery[]) {
    this.queued = [...queued];
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    const next = this.queued.shift();
    if (next === undefined) {
      throw new Error('Unexpected fake transaction query');
    }
    if (next.kind === 'error') {
      throw next.error;
    }

    return next.result as QueryResult<Row>;
  }
}

function queryResult<Row extends QueryResultRow>(
  rows: readonly Row[],
): QueryResult<QueryResultRow> {
  return {
    command: '',
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: [],
  };
}

function result(...rows: readonly QueryResultRow[]): QueuedQuery {
  return { kind: 'result', result: queryResult(rows) };
}

function failure(error: unknown): QueuedQuery {
  return { kind: 'error', error };
}

function auditEvent<EventType extends SecurityAuditEventType>(
  eventType: EventType,
  metadata: SecurityAuditMetadata<EventType>,
  outcome: SecurityAuditOutcome = 'success',
): SecurityAuditEvent<EventType> {
  return createSecurityAuditEvent({
    eventId: EVENT_ID,
    eventType,
    outcome,
    occurredAt: OCCURRED_AT,
    metadata,
  });
}

interface MappingCase {
  readonly event: SecurityAuditEvent<SecurityAuditEventType>;
  readonly expected: Readonly<Record<string, unknown>>;
}

const MAPPING_CASES: readonly MappingCase[] = [
  {
    event: auditEvent(
      'account_created',
      createSecurityAuditMetadata('account_created', {
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ),
    expected: { account_id: ACCOUNT_ID, role: 'player' },
  },
  {
    event: auditEvent(
      'account_status_changed',
      createSecurityAuditMetadata('account_status_changed', {
        accountId: ACCOUNT_ID,
        previousStatus: 'active',
        nextStatus: 'blocked',
      }),
    ),
    expected: {
      account_id: ACCOUNT_ID,
      previous_status: 'active',
      next_status: 'blocked',
    },
  },
  {
    event: auditEvent(
      'external_identity_linked',
      createSecurityAuditMetadata('external_identity_linked', {
        identityId: IDENTITY_ID,
        accountId: ACCOUNT_ID,
        provider: 'telegram',
      }),
    ),
    expected: {
      identity_id: IDENTITY_ID,
      account_id: ACCOUNT_ID,
      provider: 'telegram',
    },
  },
  {
    event: auditEvent(
      'external_identity_unlinked',
      createSecurityAuditMetadata('external_identity_unlinked', {
        identityId: IDENTITY_ID,
        accountId: ACCOUNT_ID,
        provider: 'google',
      }),
    ),
    expected: {
      identity_id: IDENTITY_ID,
      account_id: ACCOUNT_ID,
      provider: 'google',
    },
  },
  {
    event: auditEvent(
      'external_identity_transfer_blocked',
      createSecurityAuditMetadata(
        'external_identity_transfer_blocked',
        {
          identityId: IDENTITY_ID,
          reservedAccountId: ACCOUNT_ID,
          attemptedAccountId: OTHER_ACCOUNT_ID,
          provider: 'apple',
        },
      ),
    ),
    expected: {
      identity_id: IDENTITY_ID,
      reserved_account_id: ACCOUNT_ID,
      attempted_account_id: OTHER_ACCOUNT_ID,
      provider: 'apple',
    },
  },
  {
    event: auditEvent(
      'authentication_operation_terminal',
      createSecurityAuditMetadata('authentication_operation_terminal', {
        operationId: OPERATION_ID,
        intent: 'sign_in',
        terminalStatus: 'completed',
      }),
    ),
    expected: {
      operation_id: OPERATION_ID,
      intent: 'sign_in',
      terminal_status: 'completed',
    },
  },
  {
    event: auditEvent(
      'telegram_proof_consumption',
      createSecurityAuditMetadata('telegram_proof_consumption', {
        operationId: OPERATION_ID,
      }),
      'replay_detected',
    ),
    expected: {
      operation_id: OPERATION_ID,
      attempted_operation_id: null,
    },
  },
  {
    event: auditEvent(
      'telegram_proof_consumption',
      createSecurityAuditMetadata('telegram_proof_consumption', {
        attemptedOperationId: ATTEMPTED_OPERATION_ID,
      }),
      'replay_detected',
    ),
    expected: {
      operation_id: null,
      attempted_operation_id: ATTEMPTED_OPERATION_ID,
    },
  },
  {
    event: auditEvent(
      'otp_challenge_transition',
      createSecurityAuditMetadata('otp_challenge_transition', {
        challengeId: CHALLENGE_ID,
        status: 'incorrect_code',
      }),
    ),
    expected: {
      challenge_id: CHALLENGE_ID,
      otp_status: 'incorrect_code',
    },
  },
  {
    event: auditEvent(
      'session_family_created',
      createSecurityAuditMetadata('session_family_created', {
        sessionId: SESSION_ID,
        accountId: ACCOUNT_ID,
        authenticationOperationId: OPERATION_ID,
      }),
    ),
    expected: {
      session_id: SESSION_ID,
      account_id: ACCOUNT_ID,
      operation_id: OPERATION_ID,
    },
  },
  {
    event: auditEvent(
      'session_family_transition',
      createSecurityAuditMetadata('session_family_transition', {
        sessionId: SESSION_ID,
        status: 'reuse_detected',
      }),
    ),
    expected: {
      session_id: SESSION_ID,
      session_status: 'reuse_detected',
    },
  },
  {
    event: auditEvent(
      'session_credential_rotation',
      createSecurityAuditMetadata('session_credential_rotation', {
        sessionId: SESSION_ID,
        generation: GENERATION,
      }),
    ),
    expected: {
      session_id: SESSION_ID,
      generation: GENERATION.toString(10),
    },
  },
  {
    event: auditEvent(
      'fresh_authentication_issued',
      createSecurityAuditMetadata('fresh_authentication_issued', {
        evidenceId: EVIDENCE_ID,
        accountId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        verificationMethod: 'admin_totp',
      }),
    ),
    expected: {
      evidence_id: EVIDENCE_ID,
      account_id: ACCOUNT_ID,
      session_id: SESSION_ID,
      verification_method: 'admin_totp',
    },
  },
  {
    event: auditEvent(
      'reauthentication_grant_issued',
      createSecurityAuditMetadata('reauthentication_grant_issued', {
        grantId: GRANT_ID,
        accountId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        scope: 'change_primary_identity',
      }),
    ),
    expected: {
      grant_id: GRANT_ID,
      account_id: ACCOUNT_ID,
      session_id: SESSION_ID,
      scope: 'change_primary_identity',
    },
  },
  {
    event: auditEvent(
      'reauthentication_grant_transition',
      createSecurityAuditMetadata('reauthentication_grant_transition', {
        grantId: GRANT_ID,
        status: 'consumed',
      }),
    ),
    expected: {
      grant_id: GRANT_ID,
      grant_status: 'consumed',
    },
  },
  {
    event: auditEvent(
      'persisted_auth_state_rejected',
      createSecurityAuditMetadata('persisted_auth_state_rejected', {
        aggregateType: 'authentication_operation',
        aggregateId: AGGREGATE_ID,
      }),
    ),
    expected: {
      aggregate_type: 'authentication_operation',
      aggregate_id: AGGREGATE_ID,
    },
  },
];

function sessionRotationEvent(): SecurityAuditEvent<'session_credential_rotation'> {
  return auditEvent(
    'session_credential_rotation',
    createSecurityAuditMetadata('session_credential_rotation', {
      sessionId: SESSION_ID,
      generation: GENERATION,
    }),
  );
}

function persistedSessionRotationRow(
  overrides: Readonly<Record<string, unknown>> = {},
): QueryResultRow {
  return {
    event_id: EVENT_ID,
    event_type: 'session_credential_rotation',
    outcome: 'success',
    occurred_at: OCCURRED_AT.toString(10),
    account_id: null,
    role: null,
    previous_status: null,
    next_status: null,
    identity_id: null,
    provider: null,
    reserved_account_id: null,
    attempted_account_id: null,
    operation_id: null,
    attempted_operation_id: null,
    intent: null,
    terminal_status: null,
    challenge_id: null,
    otp_status: null,
    session_id: SESSION_ID,
    session_status: null,
    generation: GENERATION.toString(10),
    evidence_id: null,
    verification_method: null,
    grant_id: null,
    scope: null,
    grant_status: null,
    aggregate_type: null,
    aggregate_id: null,
    ...overrides,
  };
}

async function capturePersistenceError(
  promise: Promise<unknown>,
): Promise<SecurityAuditPersistenceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SecurityAuditPersistenceError) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected SecurityAuditPersistenceError');
}

describe('PostgresSecurityAuditRepository', () => {
  const repository = new PostgresSecurityAuditRepository();

  it.each(MAPPING_CASES)(
    'maps $event.eventType into the fixed parameterized INSERT',
    async ({ event, expected }) => {
      const transaction = new FakePostgresTransaction(
        result({ event_id: EVENT_ID }),
      );

      const appendResult = await repository.append(transaction, event);

      expect(appendResult).toEqual({ status: 'appended' });
      expect(Object.keys(appendResult)).toEqual(['status']);
      expect(transaction.calls).toHaveLength(1);
      const [insert] = transaction.calls;
      expect(insert.text).toMatch(
        /INSERT INTO backend_auth\.security_audit_events/u,
      );
      expect(insert.text).toContain(
        'ON CONFLICT (event_id) DO NOTHING',
      );
      expect(insert.text).toContain('RETURNING event_id');
      expect(insert.text).toContain('$1');
      expect(insert.text).toContain('$28');
      expect(insert.text).not.toContain(event.eventId);
      expect(insert.text).not.toContain('event_order');
      expect(insert.text).not.toMatch(
        /\b(?:BEGIN|COMMIT|ROLLBACK|UPDATE|DELETE)\b/u,
      );
      const parsedInsert = parseInsertSql(insert.text);
      expect(parsedInsert.columns).toEqual(INSERT_COLUMNS);
      expect(parsedInsert.columns).not.toContain('event_order');
      expect(parsedInsert.columns).toHaveLength(insert.values.length);
      expect(parsedInsert.placeholders).toEqual(
        INSERT_COLUMNS.map((_column, index) => `$${index + 1}`),
      );
      expect(parsedInsert.placeholders).toHaveLength(insert.values.length);
      expect(insert.values).toHaveLength(INSERT_COLUMNS.length);

      const inserted = Object.fromEntries(
        INSERT_COLUMNS.map((column, index) => [
          column,
          insert.values[index],
        ]),
      );
      expect(inserted).toMatchObject({
        event_id: event.eventId,
        event_type: event.eventType,
        outcome: event.outcome,
        occurred_at: OCCURRED_AT.toString(10),
      });
      for (const column of METADATA_COLUMNS) {
        expect(inserted[column]).toBe(
          Object.prototype.hasOwnProperty.call(expected, column)
            ? expected[column]
            : null,
        );
      }
    },
  );

  it('uses one private SELECT for an exact idempotent retry', async () => {
    const transaction = new FakePostgresTransaction(
      result(),
      result(
        persistedSessionRotationRow({
          event_order: '999',
        }),
      ),
    );

    await expect(
      repository.append(transaction, sessionRotationEvent()),
    ).resolves.toEqual({ status: 'idempotent_retry' });

    expect(transaction.calls).toHaveLength(2);
    const [insert, select] = transaction.calls;
    expect(insert.text).toMatch(/^\s*INSERT/u);
    expect(select.text).toMatch(/^\s*SELECT/u);
    expect(select.text).toContain('WHERE event_id = $1');
    expect(select.text).not.toContain('FOR UPDATE');
    expect(select.text).not.toContain('event_order');
    expect(select.values).toEqual([EVENT_ID]);
    expect(
      transaction.calls.some((call) =>
        /\b(?:BEGIN|COMMIT|ROLLBACK)\b/u.test(call.text),
      ),
    ).toBe(false);
  });

  it('returns event_id_conflict when a core field differs', async () => {
    const transaction = new FakePostgresTransaction(
      result(),
      result(persistedSessionRotationRow({ outcome: 'denied' })),
    );

    await expect(
      repository.append(transaction, sessionRotationEvent()),
    ).resolves.toEqual({ status: 'event_id_conflict' });
  });

  it.each([
    ['session identifier', { session_id: OTHER_SESSION_ID }],
    ['generation', { generation: '42' }],
  ])(
    'returns event_id_conflict when %s differs',
    async (_case, overrides) => {
      const transaction = new FakePostgresTransaction(
        result(),
        result(persistedSessionRotationRow(overrides)),
      );

      await expect(
        repository.append(transaction, sessionRotationEvent()),
      ).resolves.toEqual({ status: 'event_id_conflict' });
    },
  );

  it('treats NULL and value differences in valid rows as a conflict', async () => {
    const transaction = new FakePostgresTransaction(
      result(),
      result({
        ...persistedSessionRotationRow({
          event_type: 'persisted_auth_state_rejected',
          session_id: null,
          generation: null,
          aggregate_type: 'session_family',
          aggregate_id: SESSION_ID,
        }),
      }),
    );

    await expect(
      repository.append(transaction, sessionRotationEvent()),
    ).resolves.toEqual({ status: 'event_id_conflict' });
  });

  it('fails safely when the conflict reread finds no row', async () => {
    const transaction = new FakePostgresTransaction(result(), result());

    const error = await capturePersistenceError(
      repository.append(transaction, sessionRotationEvent()),
    );

    expect(error.reason).toBe('storage_failure');
    expect(transaction.calls).toHaveLength(2);
  });

  it.each([
    ['invalid event UUID', { event_id: 'not-a-uuid' }],
    ['invalid metadata UUID', { session_id: 'not-a-uuid' }],
    ['unsafe bigint', { occurred_at: '9007199254740992' }],
    ['zero generation', { generation: '0' }],
    ['negative generation', { generation: '-1' }],
    ['unknown event type', { event_type: 'future_event' }],
    ['unknown outcome', { outcome: 'future_outcome' }],
    [
      'unknown status',
      {
        event_type: 'session_family_transition',
        generation: null,
        session_status: 'future_status',
      },
    ],
  ])('rejects malformed persisted state: %s', async (_case, overrides) => {
    const transaction = new FakePostgresTransaction(
      result(),
      result(persistedSessionRotationRow(overrides)),
    );

    const error = await capturePersistenceError(
      repository.append(transaction, sessionRotationEvent()),
    );

    expect(error.reason).toBe('storage_failure');
    expect(error.message).toBe('Security audit persistence failed');
  });

  it.each(
    [
      ['23503', 'referential_integrity'],
      ['23514', 'invalid_audit_event'],
      ['23502', 'invalid_audit_event'],
      ['22P02', 'invalid_audit_event'],
      ['42501', 'permission_denied'],
      ['40001', 'transaction_conflict'],
      ['40P01', 'transaction_conflict'],
      ['08006', 'database_unavailable'],
      ['57P01', 'database_unavailable'],
      ['57014', 'database_unavailable'],
      ['23505', 'storage_failure'],
      ['99999', 'storage_failure'],
    ] as const satisfies ReadonlyArray<
      readonly [string, SecurityAuditPersistenceFailure]
    >,
  )('maps SQLSTATE %s to %s', async (code, reason) => {
    const transaction = new FakePostgresTransaction(
      failure({
        code,
        message: 'raw PostgreSQL OTP 123456',
        detail: `event=${EVENT_ID}`,
        parameters: ['telegram-subject'],
      }),
    );

    const error = await capturePersistenceError(
      repository.append(transaction, sessionRotationEvent()),
    );

    expect(error.reason).toBe(reason);
    expect(error.message).toBe('Security audit persistence failed');
    expect(error).not.toHaveProperty('cause');
    expect(error).not.toHaveProperty('rawError');
    expect(JSON.stringify(error)).not.toContain('123456');
    expect(JSON.stringify(error)).not.toContain(EVENT_ID);
    expect(JSON.stringify(error)).not.toContain('telegram-subject');
  });

  it('does not retain or expose raw PostgreSQL error data', async () => {
    const rawCause = new Error('LEAK_CAUSE_SECRET');
    const rawError = {
      code: '23503',
      message: 'LEAK_MESSAGE_SECRET',
      detail: 'LEAK_DETAIL_SECRET',
      hint: 'LEAK_HINT_SECRET',
      where: 'LEAK_WHERE_SECRET',
      query: 'LEAK_QUERY_SECRET',
      parameters: ['LEAK_PARAMETERS_SECRET'],
      constraint: 'LEAK_CONSTRAINT_SECRET',
      schema: 'LEAK_SCHEMA_SECRET',
      table: 'LEAK_TABLE_SECRET',
      column: 'LEAK_COLUMN_SECRET',
      cause: rawCause,
    };
    const transaction = new FakePostgresTransaction(failure(rawError));

    const error = await capturePersistenceError(
      repository.append(transaction, sessionRotationEvent()),
    );

    expect(error).not.toBe(rawError);
    expect(error).toBeInstanceOf(SecurityAuditPersistenceError);
    expect(error.name).toBe('SecurityAuditPersistenceError');
    expect(error.message).toBe('Security audit persistence failed');
    expect(error.reason).toBe('referential_integrity');

    const ownPropertyNames = Object.getOwnPropertyNames(error);
    expect(ownPropertyNames.sort()).toEqual([
      'message',
      'name',
      'reason',
      'stack',
    ]);
    for (const propertyName of ownPropertyNames) {
      expect(Reflect.get(error, propertyName)).not.toBe(rawError);
      expect(Reflect.get(error, propertyName)).not.toBe(rawCause);
    }
    for (const forbiddenProperty of [
      'cause',
      'constraint',
      'schema',
      'table',
      'column',
      'query',
      'parameters',
      'detail',
      'hint',
      'where',
    ]) {
      expect(error).not.toHaveProperty(forbiddenProperty);
    }

    const serialized = JSON.stringify(
      Object.fromEntries(
        ownPropertyNames.map((propertyName) => [
          propertyName,
          Reflect.get(error, propertyName),
        ]),
      ),
    );
    for (const secret of [
      'LEAK_MESSAGE_SECRET',
      'LEAK_DETAIL_SECRET',
      'LEAK_HINT_SECRET',
      'LEAK_WHERE_SECRET',
      'LEAK_QUERY_SECRET',
      'LEAK_PARAMETERS_SECRET',
      'LEAK_CONSTRAINT_SECRET',
      'LEAK_SCHEMA_SECRET',
      'LEAK_TABLE_SECRET',
      'LEAK_COLUMN_SECRET',
      'LEAK_CAUSE_SECRET',
      EVENT_ID,
      SESSION_ID,
    ]) {
      expect(error.message).not.toContain(secret);
      expect(error.stack).not.toContain(secret);
      expect(serialized).not.toContain(secret);
    }
  });

  it('maps an ordinary Error to storage_failure without retaining it', async () => {
    const rawError = new Error('credential and metadata leak');
    const transaction = new FakePostgresTransaction(failure(rawError));

    const error = await capturePersistenceError(
      repository.append(transaction, sessionRotationEvent()),
    );

    expect(error.reason).toBe('storage_failure');
    expect(error.message).toBe('Security audit persistence failed');
    expect(error).not.toHaveProperty('cause');
    expect(Object.values(error)).not.toContain(rawError);
    expect(JSON.stringify(error)).not.toContain('credential');
  });
});
