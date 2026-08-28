import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { ContactVerificationSnapshotPersistenceError } from './contact-verification-snapshot.repository';
import { PostgresContactVerificationSnapshotRepository } from './postgres-contact-verification-snapshot.repository';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'contact-verification-snapshot-repository',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'contact-verification-snapshot-repository-other',
) as AccountId;
const VERIFIED_AT = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_CONTACT_SNAPSHOT_PRIVATE';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly queued: readonly (
      QueryResult<QueryResultRow> | Error | Record<string, unknown>
    )[],
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const next = this.queued[this.calls.length - 1];
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
  rowCount = rows.length,
): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT_ID,
    field: 'phone',
    contact_version: '3',
    status: 'unverified',
    verified_version: null,
    verified_method: null,
    verified_at: null,
    ...overrides,
  };
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

describe('PostgresContactVerificationSnapshotRepository', () => {
  const repository = new PostgresContactVerificationSnapshotRepository();

  it('returns both fields as missing from one owner-scoped read', async () => {
    const transaction = new FakeTransaction([queryResult([])]);

    await expect(
      repository.readCheckoutSnapshot(transaction, {
        accountId: ACCOUNT_ID,
      }),
    ).resolves.toEqual({
      accountId: ACCOUNT_ID,
      phone: { field: 'phone', status: 'missing' },
      email: { field: 'email', status: 'missing' },
    });

    expect(transaction.calls).toHaveLength(1);
    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID]);
    expect(normalizeSql(transaction.calls[0].text)).toContain(
      "WHERE contact.account_id = $1 AND contact.field IN ('phone', 'email') ) SELECT",
    );
  });

  it('hydrates verified phone and pending email without exposing proof data', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        row({
          status: 'verified',
          verified_version: '3',
          verified_method: 'phone_sms_otp',
          verified_at: String(VERIFIED_AT),
        }),
        row({
          field: 'email',
          contact_version: '7',
          status: 'pending',
        }),
      ]),
    ]);

    await expect(
      repository.readCheckoutSnapshot(transaction, {
        accountId: ACCOUNT_ID,
      }),
    ).resolves.toEqual({
      accountId: ACCOUNT_ID,
      phone: {
        field: 'phone',
        status: 'verified',
        contactVersion: 3,
        verifiedVersion: 3,
        method: 'phone_sms_otp',
        verifiedAt: VERIFIED_AT,
      },
      email: {
        field: 'email',
        status: 'pending',
        contactVersion: 7,
      },
    });
  });

  it('pins verified and pending states to the current contact binding', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await repository.readCheckoutSnapshot(transaction, {
      accountId: ACCOUNT_ID,
    });

    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql.match(/challenge\.contact_version = contact\.contact_version/gu)).toHaveLength(1);
    expect(sql.match(/pending\.contact_version = contact\.contact_version/gu)).toHaveLength(1);
    expect(sql.match(/subject_digest = contact\.subject_digest/gu)).toHaveLength(2);
    expect(
      sql.match(
        /subject_digest_key_version = contact\.subject_digest_key_version/gu,
      ),
    ).toHaveLength(2);
    expect(sql.match(/purpose = 'contact_ownership'/gu)).toHaveLength(2);
  });

  it('uses database time and exclusive expiry for pending while verified wins', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await repository.readCheckoutSnapshot(transaction, {
      accountId: ACCOUNT_ID,
    });

    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql).toContain(
      'FLOOR(EXTRACT(EPOCH FROM transaction_timestamp()))::bigint AS now_epoch',
    );
    expect(sql).not.toContain('statement_timestamp');
    expect(sql).toContain('database_time.now_epoch < pending.expires_at');
    expect(sql).toContain(
      "CASE WHEN verified.contact_version IS NOT NULL THEN 'verified' WHEN EXISTS",
    );
    expect(sql).toContain(
      'ORDER BY challenge.verified_at DESC, challenge.challenge_id DESC LIMIT 1',
    );
  });

  it('keeps phone and email verification methods discriminated', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await repository.readCheckoutSnapshot(transaction, {
      accountId: ACCOUNT_ID,
    });

    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql.match(/contact\.field = 'phone' AND \w+\.method = 'phone_sms_otp'/gu)).toHaveLength(2);
    expect(
      sql.match(
        /contact\.field = 'email' AND \w+\.method IN \('email_code', 'email_link'\)/gu,
      ),
    ).toHaveLength(2);
  });

  it('projects only coarse state and never reads delivery or audit storage', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await repository.readCheckoutSnapshot(transaction, {
      accountId: ACCOUNT_ID,
    });

    const sql = normalizeSql(transaction.calls[0].text);
    const projection = sql.slice(
      sql.lastIndexOf('SELECT snapshot.account_id'),
      sql.lastIndexOf('FROM contact_snapshot AS snapshot'),
    );
    expect(projection).not.toMatch(
      /ciphertext|nonce|auth_tag|digest|idempotency|provider|payload|proof/iu,
    );
    expect(sql).not.toMatch(
      /contact_verification_(?:commands|dispatches|rate_buckets|audit)/iu,
    );
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/iu);
  });

  it.each([
    ['stale verified version', { status: 'verified', verified_version: '2', verified_method: 'phone_sms_otp', verified_at: String(VERIFIED_AT) }],
    ['wrong phone method', { status: 'verified', verified_version: '3', verified_method: 'email_code', verified_at: String(VERIFIED_AT) }],
    ['partial verified projection', { status: 'verified', verified_version: '3', verified_method: null, verified_at: String(VERIFIED_AT) }],
    ['unexpected state', { status: 'accepted' }],
    ['foreign owner', { account_id: OTHER_ACCOUNT_ID }],
    ['leaking extra column', { value_ciphertext: PRIVATE_MARKER }],
  ])('fails closed for %s', async (_label, overrides) => {
    const transaction = new FakeTransaction([queryResult([row(overrides)])]);
    await expect(
      repository.readCheckoutSnapshot(transaction, {
        accountId: ACCOUNT_ID,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it('rejects duplicate fields and inconsistent row counts', async () => {
    const duplicate = new FakeTransaction([queryResult([row(), row()])]);
    await expect(
      repository.readCheckoutSnapshot(duplicate, { accountId: ACCOUNT_ID }),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });

    const inconsistent = new FakeTransaction([queryResult([row()], 2)]);
    await expect(
      repository.readCheckoutSnapshot(inconsistent, {
        accountId: ACCOUNT_ID,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it.each([
    null,
    {},
    { accountId: 'invalid' },
    { accountId: ACCOUNT_ID, extra: true },
  ])('rejects invalid input before querying: %p', async (input) => {
    const transaction = new FakeTransaction([]);
    await expect(
      repository.readCheckoutSnapshot(transaction, input as never),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    ['08006', 'database_unavailable'],
    ['40001', 'transaction_conflict'],
    ['42501', 'permission_denied'],
    ['23503', 'storage_failure'],
  ] as const)('maps PostgreSQL %s to a safe %s error', async (code, reason) => {
    const transaction = new FakeTransaction([
      {
        code,
        message: `${PRIVATE_MARKER}:${ACCOUNT_ID}`,
        detail: `${PRIVATE_MARKER}:contact-value`,
      },
    ]);
    let captured: unknown;
    try {
      await repository.readCheckoutSnapshot(transaction, {
        accountId: ACCOUNT_ID,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(
      ContactVerificationSnapshotPersistenceError,
    );
    expect(captured).toMatchObject({ reason });
    expect(inspect(captured)).not.toContain(PRIVATE_MARKER);
    expect(inspect(captured)).not.toContain(ACCOUNT_ID);
  });

  it('stays outside runtime database wiring', () => {
    const databaseModule = readFileSync(
      join(__dirname, 'database.module.ts'),
      'utf8',
    );
    expect(databaseModule).not.toMatch(/ContactVerificationSnapshot/gu);
  });
});
