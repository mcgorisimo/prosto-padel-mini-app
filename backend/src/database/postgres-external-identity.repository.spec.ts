import {
  QueryResult,
  QueryResultRow,
} from 'pg';
import { AccountId } from '../accounts/account.types';
import { ExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import {
  EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  ComputedExternalIdentityLookupDigest,
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../accounts/external-identity-lookup-digest.port';
import {
  ExternalIdentityNamespace,
  ExternalIdentityProvider,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from '../accounts/external-identity.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  ExternalIdentityPersistenceError,
  ExternalIdentityPersistenceFailure,
} from './external-identity.repository';
import { PostgresExternalIdentityResolutionRepository } from './postgres-external-identity.repository';
import { PostgresTransaction } from './postgres-transaction';

const IDENTITY_ID = deterministicUuid(
  'external-identity-resolution-identity',
) as ExternalIdentityId;
const OTHER_IDENTITY_ID = deterministicUuid(
  'external-identity-resolution-other-identity',
) as ExternalIdentityId;
const ACCOUNT_ID = deterministicUuid(
  'external-identity-resolution-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'external-identity-resolution-other-account',
) as AccountId;
const NAMESPACE = externalIdentityNamespace('telegram:bot:123');
const OTHER_NAMESPACE = externalIdentityNamespace('telegram:bot:456');

interface CandidateOptions {
  readonly digestCharacter?: string;
  readonly digestVersion?: number;
  readonly pepperVersion?: number;
  readonly provider?: ExternalIdentityProvider;
  readonly namespace?: ExternalIdentityNamespace;
}

function candidate(
  options: CandidateOptions = {},
): ComputedExternalIdentityLookupDigest {
  const {
    digestCharacter = 'a',
    digestVersion = 1,
    pepperVersion = 1,
    provider = 'telegram',
    namespace = NAMESPACE,
  } = options;
  return {
    algorithm: EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
    provider,
    namespace,
    digest: externalIdentityLookupDigest(digestCharacter.repeat(64)),
    digestVersion: externalIdentityLookupDigestVersion(digestVersion),
    pepperVersion:
      externalIdentityLookupDigestPepperVersion(pepperVersion),
  };
}

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
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

function persistedRow(
  matchedCandidate: ComputedExternalIdentityLookupDigest,
  overrides: Readonly<Record<string, unknown>> = {},
): QueryResultRow {
  return {
    input_order: '1',
    id: IDENTITY_ID,
    account_id: ACCOUNT_ID,
    identity_provider: matchedCandidate.provider,
    identity_namespace: matchedCandidate.namespace,
    status: 'linked',
    is_primary: true,
    alias_identity_id: IDENTITY_ID,
    algorithm: matchedCandidate.algorithm,
    alias_provider: matchedCandidate.provider,
    alias_namespace: matchedCandidate.namespace,
    digest: Buffer.from(matchedCandidate.digest, 'hex'),
    digest_version: matchedCandidate.digestVersion.toString(10),
    pepper_version: matchedCandidate.pepperVersion.toString(10),
    created_at: '1000',
    ...overrides,
  };
}

async function capturePersistenceError(
  promise: Promise<unknown>,
): Promise<ExternalIdentityPersistenceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExternalIdentityPersistenceError) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected ExternalIdentityPersistenceError');
}

function requireParameterArrays(
  values: readonly unknown[],
): readonly (readonly unknown[])[] {
  if (!values.every(Array.isArray)) {
    throw new Error('Expected query parameters to be arrays');
  }
  return values;
}

function requireDigestBuffers(values: readonly unknown[]): readonly Buffer[] {
  return values.map((value) => {
    if (!Buffer.isBuffer(value)) {
      throw new Error('Expected a digest Buffer');
    }
    return value;
  });
}

describe('PostgresExternalIdentityResolutionRepository', () => {
  const repository = new PostgresExternalIdentityResolutionRepository();

  it('rejects an empty candidate array before SQL', async () => {
    const transaction = new FakePostgresTransaction();

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, []),
    );

    expect(error.reason).toBe('invalid_input');
    expect(transaction.calls).toHaveLength(0);
  });

  it('rejects an invalid candidate before SQL', async () => {
    const invalidCandidate = {
      ...candidate(),
      digest: 'not-a-digest',
    } as unknown as ComputedExternalIdentityLookupDigest;
    const transaction = new FakePostgresTransaction();

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, [invalidCandidate]),
    );

    expect(error.reason).toBe('invalid_input');
    expect(transaction.calls).toHaveLength(0);
  });

  it('rejects candidates with different providers before SQL', async () => {
    const transaction = new FakePostgresTransaction();

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, [
        candidate(),
        candidate({
          digestCharacter: 'b',
          pepperVersion: 2,
          provider: 'google',
        }),
      ]),
    );

    expect(error.reason).toBe('invalid_input');
    expect(transaction.calls).toHaveLength(0);
  });

  it('rejects candidates with different namespaces before SQL', async () => {
    const transaction = new FakePostgresTransaction();

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, [
        candidate(),
        candidate({
          digestCharacter: 'b',
          pepperVersion: 2,
          namespace: OTHER_NAMESPACE,
        }),
      ]),
    );

    expect(error.reason).toBe('invalid_input');
    expect(transaction.calls).toHaveLength(0);
  });

  it('deduplicates an exact candidate before querying', async () => {
    const lookup = candidate();
    const transaction = new FakePostgresTransaction(
      result(persistedRow(lookup)),
    );

    await expect(
      repository.resolveByLookupDigests(transaction, [lookup, { ...lookup }]),
    ).resolves.toMatchObject({ outcome: 'linked' });

    const parameterArrays = requireParameterArrays(
      transaction.calls[0].values,
    );
    expect(parameterArrays).toHaveLength(6);
    for (const parameters of parameterArrays) {
      expect(parameters).toHaveLength(1);
    }
  });

  it('rejects one version pair with different digests before SQL', async () => {
    const transaction = new FakePostgresTransaction();

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, [
        candidate({ digestCharacter: 'a' }),
        candidate({ digestCharacter: 'b' }),
      ]),
    );

    expect(error.reason).toBe('invalid_input');
    expect(transaction.calls).toHaveLength(0);
  });

  it('uses one static parameterized UNNEST SELECT', async () => {
    const first = candidate();
    const second = candidate({
      digestCharacter: 'b',
      pepperVersion: 2,
    });
    const transaction = new FakePostgresTransaction(
      result(
        persistedRow(first),
        persistedRow(second, { input_order: '2' }),
      ),
    );

    await expect(
      repository.resolveByLookupDigests(transaction, [first, second]),
    ).resolves.toMatchObject({ outcome: 'linked' });

    expect(transaction.calls).toHaveLength(1);
    const [call] = transaction.calls;
    expect(call.text).toContain('pg_catalog.unnest');
    expect(call.text).toContain(
      'backend_auth.external_identity_lookup_digests',
    );
    expect(call.text).toContain('backend_auth.external_identities');
    for (let index = 1; index <= 6; index += 1) {
      expect(call.text).toContain(`$${index}`);
    }
    expect(call.text).not.toContain(first.digest);
    expect(call.text).not.toContain(second.digest);
    expect(call.text).not.toContain(IDENTITY_ID);
    expect(call.text).not.toMatch(/\bLIMIT\s+1\b/iu);
    expect(call.text).not.toMatch(/\bFOR\s+UPDATE\b/iu);
    expect(call.text).not.toMatch(
      /\b(?:BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE|TRUNCATE)\b/iu,
    );

    const parameterArrays = requireParameterArrays(call.values);
    expect(parameterArrays).toHaveLength(6);
    for (const parameters of parameterArrays) {
      expect(parameters).toHaveLength(2);
    }
    expect(parameterArrays[0]).toEqual([
      'hmac-sha-256',
      'hmac-sha-256',
    ]);
    expect(parameterArrays[1]).toEqual(['telegram', 'telegram']);
    expect(parameterArrays[2]).toEqual([NAMESPACE, NAMESPACE]);
    expect(requireDigestBuffers(parameterArrays[3])).toEqual([
      Buffer.from('a'.repeat(64), 'hex'),
      Buffer.from('b'.repeat(64), 'hex'),
    ]);
    expect(parameterArrays[4]).toEqual(['1', '1']);
    expect(parameterArrays[5]).toEqual(['1', '2']);
  });

  it('creates independent digest Buffers for every element and call', async () => {
    const first = candidate();
    const second = candidate({
      digestCharacter: 'b',
      pepperVersion: 2,
    });
    const candidates = [first, second] as const;
    const firstTransaction = new FakePostgresTransaction(
      result(
        persistedRow(first),
        persistedRow(second, { input_order: '2' }),
      ),
    );
    const secondTransaction = new FakePostgresTransaction(
      result(
        persistedRow(first),
        persistedRow(second, { input_order: '2' }),
      ),
    );

    await repository.resolveByLookupDigests(firstTransaction, candidates);
    await repository.resolveByLookupDigests(secondTransaction, candidates);

    const firstCallBuffers = requireDigestBuffers(
      requireParameterArrays(firstTransaction.calls[0].values)[3],
    );
    const secondCallBuffers = requireDigestBuffers(
      requireParameterArrays(secondTransaction.calls[0].values)[3],
    );
    const expectedFirstBytes = Buffer.from(first.digest, 'hex');
    const expectedSecondBytes = Buffer.from(second.digest, 'hex');
    const originalFirstDigest = first.digest;
    const originalSecondDigest = second.digest;

    expect(firstCallBuffers[0]).toEqual(expectedFirstBytes);
    expect(firstCallBuffers[1]).toEqual(expectedSecondBytes);
    expect(secondCallBuffers[0]).toEqual(expectedFirstBytes);
    expect(secondCallBuffers[1]).toEqual(expectedSecondBytes);
    expect(firstCallBuffers[0]).not.toBe(firstCallBuffers[1]);
    expect(firstCallBuffers[0]).not.toBe(secondCallBuffers[0]);
    expect(firstCallBuffers[1]).not.toBe(secondCallBuffers[1]);

    firstCallBuffers[0][0] = 0;

    expect(firstCallBuffers[0]).not.toEqual(expectedFirstBytes);
    expect(firstCallBuffers[1]).toEqual(expectedSecondBytes);
    expect(secondCallBuffers[0]).toEqual(expectedFirstBytes);
    expect(secondCallBuffers[1]).toEqual(expectedSecondBytes);
    expect(first.digest).toBe(originalFirstDigest);
    expect(second.digest).toBe(originalSecondDigest);
  });

  it('returns not_found when no alias matches', async () => {
    const transaction = new FakePostgresTransaction(result());

    await expect(
      repository.resolveByLookupDigests(transaction, [candidate()]),
    ).resolves.toEqual({ outcome: 'not_found' });
  });

  it('returns one safe linked identity', async () => {
    const lookup = candidate();
    const transaction = new FakePostgresTransaction(
      result(persistedRow(lookup)),
    );

    const resolution = await repository.resolveByLookupDigests(
      transaction,
      [lookup],
    );

    expect(resolution).toEqual({
      outcome: 'linked',
      identity: {
        identityId: IDENTITY_ID,
        accountId: ACCOUNT_ID,
        provider: 'telegram',
        namespace: NAMESPACE,
        isPrimary: true,
      },
    });
    expect(JSON.stringify(resolution)).not.toContain(lookup.digest);
    expect(resolution).not.toHaveProperty('digestVersion');
    expect(resolution).not.toHaveProperty('pepperVersion');
    expect(resolution).not.toHaveProperty('createdAt');
  });

  it('collapses multiple matching aliases for one identity', async () => {
    const first = candidate();
    const second = candidate({
      digestCharacter: 'b',
      pepperVersion: 2,
    });
    const transaction = new FakePostgresTransaction(
      result(
        persistedRow(first),
        persistedRow(second, { input_order: '2' }),
      ),
    );

    await expect(
      repository.resolveByLookupDigests(transaction, [first, second]),
    ).resolves.toEqual({
      outcome: 'linked',
      identity: {
        identityId: IDENTITY_ID,
        accountId: ACCOUNT_ID,
        provider: 'telegram',
        namespace: NAMESPACE,
        isPrimary: true,
      },
    });
  });

  it('returns an unlinked identity as a historical reservation', async () => {
    const lookup = candidate();
    const transaction = new FakePostgresTransaction(
      result(
        persistedRow(lookup, {
          status: 'unlinked',
          is_primary: false,
        }),
      ),
    );

    await expect(
      repository.resolveByLookupDigests(transaction, [lookup]),
    ).resolves.toEqual({
      outcome: 'historical_reservation',
      identity: {
        identityId: IDENTITY_ID,
        accountId: ACCOUNT_ID,
        provider: 'telegram',
        namespace: NAMESPACE,
        isPrimary: false,
      },
    });
  });

  it('returns a conflict for different identities of one account', async () => {
    const first = candidate();
    const second = candidate({
      digestCharacter: 'b',
      pepperVersion: 2,
    });
    const transaction = new FakePostgresTransaction(
      result(
        persistedRow(first),
        persistedRow(second, {
          input_order: '2',
          id: OTHER_IDENTITY_ID,
          alias_identity_id: OTHER_IDENTITY_ID,
        }),
      ),
    );

    await expect(
      repository.resolveByLookupDigests(transaction, [first, second]),
    ).resolves.toEqual({
      outcome: 'conflict',
      reason: 'multiple_identities_same_account',
    });
  });

  it('returns a conflict for identities of different accounts', async () => {
    const first = candidate();
    const second = candidate({
      digestCharacter: 'b',
      pepperVersion: 2,
    });
    const transaction = new FakePostgresTransaction(
      result(
        persistedRow(first),
        persistedRow(second, {
          input_order: '2',
          id: OTHER_IDENTITY_ID,
          alias_identity_id: OTHER_IDENTITY_ID,
          account_id: OTHER_ACCOUNT_ID,
        }),
      ),
    );

    await expect(
      repository.resolveByLookupDigests(transaction, [first, second]),
    ).resolves.toEqual({
      outcome: 'conflict',
      reason: 'multiple_accounts',
    });
  });

  it.each([
    ['identity UUID', { id: 'not-a-uuid' }],
    ['account UUID', { account_id: 'not-a-uuid' }],
    ['alias identity binding', { alias_identity_id: OTHER_IDENTITY_ID }],
    ['identity provider', { identity_provider: 'future-provider' }],
    ['identity namespace', { identity_namespace: ' namespace' }],
    ['status', { status: 'future-status' }],
    ['primary flag type', { is_primary: 1 }],
    [
      'unlinked primary invariant',
      { status: 'unlinked', is_primary: true },
    ],
    ['alias algorithm', { algorithm: 'sha-256' }],
    ['digest buffer length', { digest: Buffer.alloc(31) }],
    ['zero digest version', { digest_version: '0' }],
    ['negative digest version', { digest_version: '-1' }],
    ['unsafe digest version', { digest_version: '9007199254740992' }],
    ['zero pepper version', { pepper_version: '0' }],
    ['negative pepper version', { pepper_version: '-1' }],
    ['unsafe pepper version', { pepper_version: '9007199254740992' }],
    ['created_at format', { created_at: 'not-a-bigint' }],
    ['negative created_at', { created_at: '-1' }],
    ['alias provider binding', { alias_provider: 'google' }],
    ['alias namespace binding', { alias_namespace: OTHER_NAMESPACE }],
    ['input order', { input_order: '0' }],
    [
      'candidate binding',
      { digest: Buffer.from('b'.repeat(64), 'hex') },
    ],
  ])('rejects malformed persisted %s', async (_case, overrides) => {
    const lookup = candidate();
    const transaction = new FakePostgresTransaction(
      result(persistedRow(lookup, overrides)),
    );

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, [lookup]),
    );

    expect(error.reason).toBe('invalid_persisted_state');
    expect(error.message).toBe('External identity persistence failed');
  });

  it.each([
    ['primary flag', { is_primary: false }],
    ['status', { status: 'unlinked', is_primary: false }],
    [
      'provider',
      {
        identity_provider: 'google',
        alias_provider: 'google',
      },
    ],
    [
      'namespace',
      {
        identity_namespace: OTHER_NAMESPACE,
        alias_namespace: OTHER_NAMESPACE,
      },
    ],
  ])(
    'rejects inconsistent repeated rows for one identity: %s',
    async (_case, overrides) => {
      const first = candidate();
      const second = candidate({
        digestCharacter: 'b',
        pepperVersion: 2,
      });
      const contradictoryRow = persistedRow(second, {
        input_order: '2',
        ...overrides,
      });
      const transaction = new FakePostgresTransaction(
        result(persistedRow(first), contradictoryRow),
      );

      const error = await capturePersistenceError(
        repository.resolveByLookupDigests(transaction, [first, second]),
      );

      expect(error.reason).toBe('invalid_persisted_state');
      expect(error.message).toBe('External identity persistence failed');
      expect(Object.values(error)).not.toContain(contradictoryRow);
      const serialized = JSON.stringify(
        Object.fromEntries(
          Object.getOwnPropertyNames(error).map((propertyName) => [
            propertyName,
            Reflect.get(error, propertyName),
          ]),
        ),
      );
      for (const secret of [
        'google',
        NAMESPACE,
        OTHER_NAMESPACE,
        IDENTITY_ID,
        second.digest,
      ]) {
        expect(error.message).not.toContain(secret);
        expect(error.stack).not.toContain(secret);
        expect(serialized).not.toContain(secret);
      }
    },
  );

  it.each(
    [
      ['42501', 'permission_denied'],
      ['40001', 'transaction_conflict'],
      ['40P01', 'transaction_conflict'],
      ['08006', 'database_unavailable'],
      ['57P01', 'database_unavailable'],
      ['57014', 'database_unavailable'],
      ['22P02', 'storage_failure'],
      ['23505', 'storage_failure'],
      ['99999', 'storage_failure'],
    ] as const satisfies ReadonlyArray<
      readonly [string, ExternalIdentityPersistenceFailure]
    >,
  )('maps SQLSTATE %s to %s', async (code, reason) => {
    const transaction = new FakePostgresTransaction(
      failure({ code, message: 'raw PostgreSQL message' }),
    );

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, [candidate()]),
    );

    expect(error.reason).toBe(reason);
    expect(error.message).toBe('External identity persistence failed');
  });

  it('maps an ordinary Error to storage_failure', async () => {
    const transaction = new FakePostgresTransaction(
      failure(new Error('raw storage failure')),
    );

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, [candidate()]),
    );

    expect(error.reason).toBe('storage_failure');
    expect(error.message).toBe('External identity persistence failed');
  });

  it('does not retain or expose raw PostgreSQL data', async () => {
    const lookup = candidate();
    const rawCause = new Error('LEAK_CAUSE');
    const rawError = {
      code: '42501',
      message: 'LEAK_MESSAGE',
      detail: `LEAK_DETAIL_${IDENTITY_ID}`,
      hint: `LEAK_HINT_${lookup.digest}`,
      where: 'LEAK_WHERE',
      query: 'LEAK_QUERY',
      parameters: [lookup.digest, IDENTITY_ID],
      constraint: 'LEAK_CONSTRAINT',
      schema: 'LEAK_SCHEMA',
      table: 'LEAK_TABLE',
      column: 'LEAK_COLUMN',
      cause: rawCause,
    };
    const transaction = new FakePostgresTransaction(failure(rawError));

    const error = await capturePersistenceError(
      repository.resolveByLookupDigests(transaction, [lookup]),
    );

    expect(error).not.toBe(rawError);
    expect(error.reason).toBe('permission_denied');
    expect(error).not.toHaveProperty('cause');
    expect(error).not.toHaveProperty('rawError');
    for (const value of Object.values(error)) {
      expect(value).not.toBe(rawError);
      expect(value).not.toBe(rawCause);
    }

    const serialized = JSON.stringify(
      Object.fromEntries(
        Object.getOwnPropertyNames(error).map((propertyName) => [
          propertyName,
          Reflect.get(error, propertyName),
        ]),
      ),
    );
    for (const secret of [
      'LEAK_',
      lookup.digest,
      IDENTITY_ID,
      'raw PostgreSQL',
    ]) {
      expect(error.message).not.toContain(secret);
      expect(error.stack).not.toContain(secret);
      expect(serialized).not.toContain(secret);
    }
  });
});
