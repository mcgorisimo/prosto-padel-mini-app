import { createHash } from 'node:crypto';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SessionCredentialDigest,
  SessionId,
} from '../auth/session.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PostgresSessionAuthenticationRepository,
} from './postgres-session-authentication.repository';
import {
  SessionAuthenticationPersistenceError,
  SessionAuthenticationPersistenceFailure,
} from './session-authentication.repository';
import { PostgresTransaction } from './postgres-transaction';

const FAMILY_ID = deterministicUuid(
  'session-authentication-family',
) as SessionId;
const ACCOUNT_ID = deterministicUuid(
  'session-authentication-account',
) as AccountId;
const COMMAND_ID = deterministicUuid('session-authentication-command');
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PRESENTED_CREDENTIAL = Buffer.alloc(32, 0x41).toString('base64url');
const DIGEST = createHash('sha256')
  .update(PRESENTED_CREDENTIAL, 'utf8')
  .digest('hex') as SessionCredentialDigest;
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_POSTGRES_DETAIL';

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

  constructor(private readonly queued: QueuedQuery[]) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
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

function queryResult<Row extends QueryResultRow>(
  rows: readonly Row[],
  rowCount: number | null = rows.length,
): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function familyLookupRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return { family_id: FAMILY_ID, ...overrides };
}

function familyRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    family_id: FAMILY_ID,
    account_id: ACCOUNT_ID,
    session_status: 'active',
    current_credential_generation: '2',
    session_created_at: String(NOW - 600),
    expires_at: String(EXPIRES_AT),
    account_role: 'player',
    account_status: 'active',
    account_created_at: String(NOW - 1_000),
    account_updated_at: String(NOW - 100),
    ...overrides,
  };
}

function credentialRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    family_id: FAMILY_ID,
    generation: '2',
    digest: Buffer.from(DIGEST, 'hex'),
    issued_at: String(NOW - 100),
    consumed_at: null,
    consumed_by_command_id: null,
    ...overrides,
  };
}

function authenticatedTransaction(
  familyOverrides: Record<string, unknown> = {},
  credentialOverrides: Record<string, unknown> = {},
): FakeTransaction {
  return new FakeTransaction([
    queryResult([familyLookupRow()]),
    queryResult([familyRow(familyOverrides)]),
    queryResult([credentialRow(credentialOverrides)]),
  ]);
}

function input() {
  return {
    presentedCredentialDigest: DIGEST,
    now: NOW,
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function postgresError(code: string): Record<string, unknown> {
  return {
    code,
    message: PRIVATE_MARKER,
    detail: `${PRIVATE_MARKER}-detail`,
    query: `SELECT '${PRIVATE_MARKER}'`,
    constraint: 'private_constraint',
    schema: 'private_schema',
    table: 'private_table',
    cause: new Error(`${PRIVATE_MARKER}-cause`),
  };
}

function expectSafeError(
  value: unknown,
  reason: SessionAuthenticationPersistenceFailure,
): SessionAuthenticationPersistenceError {
  expect(value).toBeInstanceOf(SessionAuthenticationPersistenceError);
  const error = value as SessionAuthenticationPersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe('Session authentication persistence failed');
  expect('cause' in error).toBe(false);
  for (const marker of [
    PRIVATE_MARKER,
    PRESENTED_CREDENTIAL,
    DIGEST,
    FAMILY_ID,
    ACCOUNT_ID,
    'private_constraint',
    'private_schema',
    'private_table',
  ]) {
    expect(error.message).not.toContain(marker);
    expect(error.stack).not.toContain(marker);
    expect(JSON.stringify(error)).not.toContain(marker);
  }
  return error;
}

describe('PostgresSessionAuthenticationRepository', () => {
  it('authenticates only the current unconsumed credential of an active account', async () => {
    const transaction = authenticatedTransaction();
    const result =
      await new PostgresSessionAuthenticationRepository()
        .authenticatePresentedCredential(transaction, input());

    expect(result).toEqual({
      outcome: 'authenticated',
      accountId: ACCOUNT_ID,
      role: 'player',
      expiresAt: EXPIRES_AT,
    });
    expect(Object.keys(result)).toEqual([
      'outcome',
      'accountId',
      'role',
      'expiresAt',
    ]);
    expect(JSON.stringify(result)).not.toContain(DIGEST);
    expect(JSON.stringify(result)).not.toContain(FAMILY_ID);
    expect(JSON.stringify(result)).not.toContain(PRESENTED_CREDENTIAL);
  });

  it('uses digest lookup then family/account and credential row locks in order', async () => {
    const transaction = authenticatedTransaction();
    await new PostgresSessionAuthenticationRepository()
      .authenticatePresentedCredential(transaction, input());

    expect(transaction.calls).toHaveLength(3);
    const [lookup, family, credential] = transaction.calls.map((call) => ({
      sql: normalizeSql(call.text),
      values: call.values,
    }));
    expect(lookup.sql).toBe(
      'SELECT family_id FROM backend_auth.auth_session_credentials WHERE digest = $1 ORDER BY family_id',
    );
    expect(lookup.sql).not.toContain('FOR ');
    expect(family.sql).toContain(
      'FROM backend_auth.auth_session_families f JOIN backend_auth.accounts a',
    );
    expect(family.sql).toContain('FOR SHARE OF f, a');
    expect(credential.sql).toContain(
      'FROM backend_auth.auth_session_credentials',
    );
    expect(credential.sql).toContain('FOR SHARE');
    expect(Buffer.isBuffer(lookup.values[0])).toBe(true);
    expect(lookup.values[0]).toEqual(Buffer.from(DIGEST, 'hex'));
    expect(family.values).toEqual([FAMILY_ID]);
    expect(credential.values).toEqual([
      FAMILY_ID,
      Buffer.from(DIGEST, 'hex'),
    ]);

    const allSql = transaction.calls
      .map((call) => normalizeSql(call.text).toUpperCase())
      .join(' ');
    for (const forbidden of [
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
    ]) {
      expect(allSql).not.toContain(forbidden);
    }
    expect(allSql).not.toContain(PRESENTED_CREDENTIAL);
    expect(allSql).not.toContain(DIGEST.toUpperCase());
  });

  it('rejects an unknown digest without querying a family', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await expect(
      new PostgresSessionAuthenticationRepository()
        .authenticatePresentedCredential(transaction, input()),
    ).resolves.toEqual({ outcome: 'rejected' });
    expect(transaction.calls).toHaveLength(1);
  });

  it.each([
    ['revoked session', { session_status: 'revoked' }, {}],
    ['expired session', { session_status: 'expired' }, {}],
    ['reuse-detected session', { session_status: 'reuse_detected' }, {}],
    ['blocked account', { account_status: 'blocked' }, {}],
    ['pending-deletion account', { account_status: 'pending_deletion' }, {}],
    ['anonymized account', { account_status: 'anonymized' }, {}],
    ['old generation', { current_credential_generation: '3' }, {}],
    [
      'consumed credential',
      {},
      {
        consumed_at: String(NOW - 10),
        consumed_by_command_id: COMMAND_ID,
      },
    ],
    ['credential issued in the future', {}, { issued_at: String(NOW + 1) }],
  ] as const)(
    'rejects a %s without disclosing its state',
    async (_name, familyOverrides, credentialOverrides) => {
      const result =
        await new PostgresSessionAuthenticationRepository()
          .authenticatePresentedCredential(
            authenticatedTransaction(
              { ...familyOverrides },
              { ...credentialOverrides },
            ),
            input(),
          );
      expect(result).toEqual({ outcome: 'rejected' });
      expect(Object.keys(result)).toEqual(['outcome']);
    },
  );

  it('rejects exactly at expiresAt', async () => {
    const transaction = authenticatedTransaction(
      { expires_at: String(NOW) },
    );
    await expect(
      new PostgresSessionAuthenticationRepository()
        .authenticatePresentedCredential(transaction, input()),
    ).resolves.toEqual({ outcome: 'rejected' });
  });

  it.each([
    ['duplicate digest', [
      familyLookupRow(),
      familyLookupRow({ family_id: deterministicUuid('other-family') }),
    ]],
    ['malformed family ID', [familyLookupRow({ family_id: 'bad' })]],
  ] as const)('rejects persisted %s', async (_name, rows) => {
    const transaction = new FakeTransaction([queryResult(rows)]);
    await expect(
      new PostgresSessionAuthenticationRepository()
        .authenticatePresentedCredential(transaction, input()),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it.each([
    ['unknown session status', { session_status: 'unknown' }, {}],
    ['unknown account role', { account_role: 'owner' }, {}],
    ['malformed generation', { current_credential_generation: '02' }, {}],
    ['bad account timestamps', { account_updated_at: '1' }, {}],
    ['wrong credential family', {}, { family_id: deterministicUuid('wrong') }],
    ['wrong credential digest', {}, { digest: Buffer.alloc(32, 0x99) }],
    ['half-consumed credential', {}, { consumed_at: String(NOW - 10) }],
  ] as const)(
    'fails closed on %s',
    async (_name, familyOverrides, credentialOverrides) => {
      await expect(
        new PostgresSessionAuthenticationRepository()
          .authenticatePresentedCredential(
            authenticatedTransaction(
              { ...familyOverrides },
              { ...credentialOverrides },
            ),
            input(),
          ),
      ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
    },
  );

  it('rejects invalid input before SQL', async () => {
    const transaction = new FakeTransaction([]);
    await expect(
      new PostgresSessionAuthenticationRepository()
        .authenticatePresentedCredential(transaction, {
          ...input(),
          presentedCredentialDigest: 'not-a-digest' as SessionCredentialDigest,
        }),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    ['42501', 'permission_denied'],
    ['40001', 'transaction_conflict'],
    ['40P01', 'transaction_conflict'],
    ['08006', 'database_unavailable'],
    ['57P01', 'database_unavailable'],
    ['57014', 'database_unavailable'],
    ['23505', 'storage_failure'],
    ['99999', 'storage_failure'],
  ] as const)('maps SQLSTATE %s to %s without leakage', async (code, reason) => {
    const transaction = new FakeTransaction([postgresError(code)]);
    let caught: unknown;
    try {
      await new PostgresSessionAuthenticationRepository()
        .authenticatePresentedCredential(transaction, input());
    } catch (error) {
      caught = error;
    }
    expectSafeError(caught, reason);
  });

  it('maps ordinary failures to a safe storage error', async () => {
    const transaction = new FakeTransaction([
      new Error(PRIVATE_MARKER),
    ]);
    let caught: unknown;
    try {
      await new PostgresSessionAuthenticationRepository()
        .authenticatePresentedCredential(transaction, input());
    } catch (error) {
      caught = error;
    }
    expectSafeError(caught, 'storage_failure');
  });
});
