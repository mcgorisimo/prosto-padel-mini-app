import { randomUUID } from 'node:crypto';
import { QueryResultRow } from 'pg';
import {
  InitialSessionPersistenceError,
} from '../../src/database/initial-session.repository';
import { TelegramLoginResult } from '../../src/auth/telegram-login.types';
import {
  AuthIntegrationHarness,
  PreparedTelegramLogin,
  createSessionBinding,
  openAuthIntegrationHarness,
  twoPartyBarrier,
} from './auth-integration.fixture';

interface CountRow extends QueryResultRow {
  readonly count: string;
}

async function count(
  harness: AuthIntegrationHarness,
  text: string,
  values: readonly unknown[],
): Promise<number> {
  const result = await harness.query<CountRow>(text, values);
  expect(result.rows).toHaveLength(1);
  return Number(result.rows[0].count);
}

function safeSerialized(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
      own: Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== 'stack'),
      ),
    });
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'outcome' in value &&
    value.outcome === 'authenticated'
  ) {
    const result = value as Extract<
      TelegramLoginResult,
      { readonly outcome: 'authenticated' }
    >;
    return JSON.stringify({
      outcome: result.outcome,
      accountKind: result.accountKind,
      expiresAt: result.expiresAt,
    });
  }
  return JSON.stringify(value);
}

function safeLoginResult(
  result: TelegramLoginResult,
): Readonly<Record<string, unknown>> {
  return result.outcome === 'authenticated'
    ? Object.freeze({
        outcome: result.outcome,
        accountKind: result.accountKind,
        expiresAt: result.expiresAt,
      })
    : Object.freeze({
        outcome: result.outcome,
        reason: result.reason,
      });
}

function expectNoSensitiveData(
  value: unknown,
  prepared: readonly PreparedTelegramLogin[],
  databaseUrl: string,
): void {
  const serialized = safeSerialized(value);
  const password = new URL(databaseUrl).password;
  const markers = [
    databaseUrl,
    password,
    ...prepared.flatMap((item) => [
      item.rawInitData,
      item.subject,
      item.requestKey,
      item.proof.proofFingerprint,
      item.digests.primary.digest,
    ]),
    'SELECT ',
    'SQLSTATE',
    'constraint',
    'backend_auth.',
    '900000001:AUTH_INTEGRATION_TEST_ONLY_TOKEN',
    Buffer.alloc(32, 0x41).toString('hex'),
    Buffer.alloc(32, 0x57).toString('hex'),
  ].filter((marker) => marker.length > 0);

  for (const marker of markers) {
    expect(serialized.includes(marker)).toBe(false);
  }
}

async function simultaneousLogins(
  harness: AuthIntegrationHarness,
  first: PreparedTelegramLogin,
  second: PreparedTelegramLogin,
) {
  const arrive = twoPartyBarrier();
  const authenticate = async (prepared: PreparedTelegramLogin) => {
    await arrive();
    return harness.graph.service.authenticateWithTelegram({
      rawInitData: prepared.rawInitData,
      requestKey: prepared.requestKey,
      now: prepared.now,
    });
  };

  return Promise.all([authenticate(first), authenticate(second)]);
}

describe('Telegram login PostgreSQL concurrency integration', () => {
  let harness: AuthIntegrationHarness;

  beforeAll(async () => {
    harness = await openAuthIntegrationHarness();
  });

  afterAll(async () => {
    if (harness !== undefined) {
      await harness.close();
    }
  });

  it('serializes two first logins for one Telegram identity', async () => {
    const first = await harness.prepareLogin({
      subjectLabel: 'concurrent-first-login',
      proofLabel: 'concurrent-first-proof-a',
    });
    const second = await harness.prepareLogin({
      subjectLabel: 'concurrent-first-login',
      proofLabel: 'concurrent-first-proof-b',
    });

    const results = await simultaneousLogins(harness, first, second);
    for (const result of results) {
      expect(
        result.outcome === 'authenticated' ||
          (result.outcome === 'rejected' &&
            [
              'request_conflict',
              'temporary_conflict',
              'dependency_unavailable',
            ].includes(result.reason)),
      ).toBe(true);
      expectNoSensitiveData(
        result,
        [first, second],
        harness.database.environment.databaseUrl,
      );
    }
    expect(
      results.filter((result) => result.outcome === 'authenticated')
        .length,
    ).toBeGreaterThanOrEqual(1);

    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.external_identity_lookup_digests
          WHERE provider = $1
            AND namespace = $2
            AND digest = $3
        `,
        [
          first.digests.primary.provider,
          first.digests.primary.namespace,
          Buffer.from(first.digests.primary.digest, 'hex'),
        ],
      ),
    ).toBe(1);
    const candidateAccountIds = [
      first.bindings.accountId,
      second.bindings.accountId,
    ];
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.accounts
          WHERE id = ANY($1::uuid[])
        `,
        [candidateAccountIds],
      ),
    ).toBe(1);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.player_profiles
          WHERE account_id = ANY($1::uuid[])
        `,
        [candidateAccountIds],
      ),
    ).toBe(1);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.external_identities
          WHERE account_id = ANY($1::uuid[])
        `,
        [candidateAccountIds],
      ),
    ).toBe(1);
  });

  it('keeps one operation and one initial session for simultaneous identical requests', async () => {
    const prepared = await harness.prepareLogin({
      subjectLabel: 'identical-request',
      proofLabel: 'identical-proof',
    });
    const results = await simultaneousLogins(
      harness,
      prepared,
      prepared,
    );

    for (const result of results) {
      expect(
        result.outcome === 'authenticated' ||
          (result.outcome === 'rejected' &&
            ['request_conflict', 'temporary_conflict'].includes(
              result.reason,
            )),
      ).toBe(true);
      expectNoSensitiveData(
        result,
        [prepared],
        harness.database.environment.databaseUrl,
      );
    }
    expect(
      results.filter((result) => result.outcome === 'authenticated')
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.authentication_operations
          WHERE id = $1
        `,
        [prepared.bindings.operationId],
      ),
    ).toBe(1);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.auth_session_families
          WHERE authentication_operation_id = $1
        `,
        [prepared.bindings.operationId],
      ),
    ).toBe(1);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.auth_session_credentials c
          JOIN backend_auth.auth_session_families f
            ON f.id = c.family_id
          WHERE f.authentication_operation_id = $1
            AND c.generation = 1
            AND c.consumed_at IS NULL
        `,
        [prepared.bindings.operationId],
      ),
    ).toBe(1);
  });

  it('rejects one request key rebound to a different proof', async () => {
    const requestKey = randomUUID();
    const first = await harness.prepareLogin({
      subjectLabel: 'same-key-different-proof-a',
      proofLabel: 'same-key-proof-a',
      requestKey,
    });
    const second = await harness.prepareLogin({
      subjectLabel: 'same-key-different-proof-b',
      proofLabel: 'same-key-proof-b',
      requestKey,
    });

    const firstResult =
      await harness.graph.service.authenticateWithTelegram({
        rawInitData: first.rawInitData,
        requestKey: first.requestKey,
        now: first.now,
      });
    expect(firstResult.outcome).toBe('authenticated');
    const secondResult =
      await harness.graph.service.authenticateWithTelegram({
        rawInitData: second.rawInitData,
        requestKey: second.requestKey,
        now: second.now,
      });
    expect(safeLoginResult(secondResult)).toEqual({
      outcome: 'rejected',
      reason: 'request_conflict',
    });
    expectNoSensitiveData(
      secondResult,
      [first, second],
      harness.database.environment.databaseUrl,
    );
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.authentication_operations
          WHERE id = $1
        `,
        [second.bindings.operationId],
      ),
    ).toBe(0);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.auth_session_families
          WHERE authentication_operation_id = $1
        `,
        [second.bindings.operationId],
      ),
    ).toBe(0);
  });

  it('rejects one proof replayed with a different request key', async () => {
    const first = await harness.prepareLogin({
      subjectLabel: 'same-proof-different-key',
      proofLabel: 'shared-proof',
    });
    const replay = await harness.prepareLogin({
      subjectLabel: 'same-proof-different-key',
      rawInitData: first.rawInitData,
    });

    const firstResult =
      await harness.graph.service.authenticateWithTelegram({
        rawInitData: first.rawInitData,
        requestKey: first.requestKey,
        now: first.now,
      });
    expect(firstResult.outcome).toBe('authenticated');
    const replayResult =
      await harness.graph.service.authenticateWithTelegram({
        rawInitData: replay.rawInitData,
        requestKey: replay.requestKey,
        now: replay.now,
      });

    expect(safeLoginResult(replayResult)).toEqual({
      outcome: 'rejected',
      reason: 'proof_replayed',
    });
    expectNoSensitiveData(
      replayResult,
      [first, replay],
      harness.database.environment.databaseUrl,
    );
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.telegram_proof_consumptions
          WHERE proof_fingerprint = $1
        `,
        [Buffer.from(first.proof.proofFingerprint, 'hex')],
      ),
    ).toBe(1);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.auth_session_families
          WHERE authentication_operation_id = $1
        `,
        [replay.bindings.operationId],
      ),
    ).toBe(0);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.authentication_operations
          WHERE id = $1
        `,
        [replay.bindings.operationId],
      ),
    ).toBe(0);
  });

  it('serializes initial-session creation for one completed operation', async () => {
    const prepared = await harness.prepareLogin({
      subjectLabel: 'initial-session-concurrency',
      proofLabel: 'initial-session-proof',
    });
    await expect(harness.persistPending(prepared)).resolves.toMatchObject({
      outcome: 'created',
    });
    await harness.provisionAndComplete(prepared);
    const issued = harness.graph.credentialIssuer.issue();
    const binding = createSessionBinding(prepared, issued.digest);
    const arrive = twoPartyBarrier();
    const create = async () => {
      await arrive();
      return harness.createInitialSession(prepared, binding);
    };

    const settled = await Promise.allSettled([create(), create()]);
    for (const result of settled) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(
          InitialSessionPersistenceError,
        );
        expectNoSensitiveData(
          result.reason,
          [prepared],
          harness.database.environment.databaseUrl,
        );
        throw result.reason;
      }
      expect(['created', 'idempotent_retry']).toContain(
        result.value.outcome,
      );
    }
    expect(
      settled.filter(
        (result) =>
          result.status === 'fulfilled' &&
          result.value.outcome === 'created',
      ),
    ).toHaveLength(1);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.auth_session_families
          WHERE authentication_operation_id = $1
        `,
        [prepared.bindings.operationId],
      ),
    ).toBe(1);
    expect(
      await count(
        harness,
        `
          SELECT count(*)::text AS count
          FROM backend_auth.auth_session_credentials c
          WHERE c.family_id = $1
            AND c.generation = 1
            AND c.consumed_at IS NULL
        `,
        [prepared.bindings.sessionId],
      ),
    ).toBe(1);
  });
});
