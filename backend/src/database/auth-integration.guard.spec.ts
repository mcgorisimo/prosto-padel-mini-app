import { Pool, PoolConfig } from 'pg';
import {
  AUTH_INTEGRATION_BARRIER_TIMEOUT_MILLIS,
  twoPartyBarrier,
} from '../../test/auth-integration/auth-integration.fixture';
import {
  AuthIntegrationConfigurationError,
  AuthIntegrationEnvironmentSource,
  readAuthIntegrationEnvironment,
} from '../../test/auth-integration/auth-integration.env';
import {
  AUTH_INTEGRATION_JEST_TIMEOUT_MILLIS,
  AUTH_INTEGRATION_POOL_LIMITS,
  authIntegrationPoolOptions,
  createAuthIntegrationPostgresService,
  openGuardedAuthIntegrationDatabase,
} from '../../test/auth-integration/auth-integration.guard';
import {
  isValidAuthIntegrationCatalogEvidence,
  validAuthIntegrationCatalogEvidenceFixture,
} from '../../test/auth-integration/auth-integration.inventory';
import {
  AUTH_INTEGRATION_HTTP_CLEANUP_ERROR_MESSAGE,
  AuthIntegrationHttpCleanupError,
  runWithAuthIntegrationCleanup,
} from '../../test/auth-integration/auth-integration.lifecycle';
import { PostgresService } from './postgres.service';

const runnerUrl = require(
  '../../test/auth-integration/runner-url.cjs',
) as Readonly<{
  AUTH_INTEGRATION_RUNNER_DATABASE_NAME: string;
  buildAuthIntegrationDatabaseUrl(password: string): string;
}>;

const SAFE_URL =
  'postgresql://backend_auth_app:test-only@localhost/example_auth_integration_test';
const EXPECTED_DATABASE_NAME = 'example_auth_integration_test';

function enabledEnvironment(
  overrides: AuthIntegrationEnvironmentSource = {},
): AuthIntegrationEnvironmentSource {
  return {
    AUTH_INTEGRATION_TESTS_ENABLED: 'true',
    AUTH_INTEGRATION_DISPOSABLE_DATABASE: 'true',
    AUTH_INTEGRATION_DATABASE_URL: SAFE_URL,
    AUTH_INTEGRATION_EXPECTED_DATABASE_NAME:
      EXPECTED_DATABASE_NAME,
    ...overrides,
  };
}

async function expectRejectedBeforePool(
  source: AuthIntegrationEnvironmentSource,
): Promise<void> {
  const factory = jest.fn<never, [string]>();

  await expect(
    openGuardedAuthIntegrationDatabase(source, factory),
  ).rejects.toBeInstanceOf(AuthIntegrationConfigurationError);
  expect(factory).not.toHaveBeenCalled();
}

describe('auth integration environment guard', () => {
  it.each([
    'AUTH_INTEGRATION_TESTS_ENABLED',
    'AUTH_INTEGRATION_DISPOSABLE_DATABASE',
    'AUTH_INTEGRATION_DATABASE_URL',
    'AUTH_INTEGRATION_EXPECTED_DATABASE_NAME',
  ] as const)(
    'fails before creating PostgresService when %s is absent',
    async (missing) => {
      await expectRejectedBeforePool({
        ...enabledEnvironment(),
        [missing]: undefined,
      });
    },
  );

  it.each([
    ['leading space', ` ${SAFE_URL}`],
    ['trailing space', `${SAFE_URL} `],
    ['tab', SAFE_URL.replace('localhost', 'local\thost')],
    ['newline', SAFE_URL.replace('localhost', 'local\nhost')],
    ['control character', SAFE_URL.replace('localhost', 'local\u0001host')],
    [
      'noncanonical path round-trip',
      SAFE_URL.replace(
        '/example_auth_integration_test',
        '/segment/../example_auth_integration_test',
      ),
    ],
    [
      'noncanonical username',
      SAFE_URL.replace('backend_auth_app', 'backend%5Fauth_app'),
    ],
    [
      'noncanonical percent-encoded database name',
      SAFE_URL.replace(
        '/example_auth_integration_test',
        '/%65xample_auth_integration_test',
      ),
    ],
  ])('rejects %s before creating a Pool', async (_name, url) => {
    await expectRejectedBeforePool(
      enabledEnvironment({
        AUTH_INTEGRATION_DATABASE_URL: url,
      }),
    );
  });

  it.each([
    ['TRUE', 'true'],
    ['1', 'true'],
    ['true', 'TRUE'],
    ['true', '1'],
  ])(
    'requires exact boolean markers (%s, %s)',
    async (enabled, disposable) => {
      await expectRejectedBeforePool(
        enabledEnvironment({
          AUTH_INTEGRATION_TESTS_ENABLED: enabled,
          AUTH_INTEGRATION_DISPOSABLE_DATABASE: disposable,
        }),
      );
    },
  );

  it('rejects a non-disposable database name before creating a Pool', async () => {
    await expectRejectedBeforePool(
      enabledEnvironment({
        AUTH_INTEGRATION_DATABASE_URL:
          'postgresql://backend_auth_app:test-only@localhost/app',
        AUTH_INTEGRATION_EXPECTED_DATABASE_NAME: 'app',
      }),
    );
  });

  it('decodes the database path before rejecting noncanonical encoding', async () => {
    await expectRejectedBeforePool(
      enabledEnvironment({
        AUTH_INTEGRATION_DATABASE_URL:
          'postgresql://backend_auth_app:test-only@localhost/%65xample_auth_integration_test',
      }),
    );
  });

  it('accepts percent-encoded reserved password characters', () => {
    const databaseUrl =
      'postgresql://backend_auth_app:test%40only@localhost/example_auth_integration_test';

    const environment = readAuthIntegrationEnvironment(
      enabledEnvironment({
        AUTH_INTEGRATION_DATABASE_URL: databaseUrl,
      }),
    );

    expect(environment.databaseUrl === databaseUrl).toBe(true);
    expect(environment.expectedDatabaseName).toBe(
      EXPECTED_DATABASE_NAME,
    );
  });

  it.each([
    ['percent sign', 'test-%-password'],
    ['escape-like percent sequence', 'test-%2F-password'],
    ['dollar sign', 'test-$-password'],
    ['ampersand', 'test-&-password'],
    ['plus sign', 'test-+-password'],
    ['comma', 'test-,-password'],
    ['reserved URL characters', 'test-@-:-/-?-#-password'],
    ['space', 'test password'],
    ['tab', 'test\tpassword'],
    ['newline', 'test\npassword'],
    ['Unicode', 'тестовый-пароль'],
  ])(
    'builds a runner URL accepted by the canonical guard for %s',
    (_caseName, password) => {
      const databaseUrl =
        runnerUrl.buildAuthIntegrationDatabaseUrl(password);
      const parsed = new URL(databaseUrl);
      const environment = readAuthIntegrationEnvironment({
        AUTH_INTEGRATION_TESTS_ENABLED: 'true',
        AUTH_INTEGRATION_DISPOSABLE_DATABASE: 'true',
        AUTH_INTEGRATION_DATABASE_URL: databaseUrl,
        AUTH_INTEGRATION_EXPECTED_DATABASE_NAME:
          runnerUrl.AUTH_INTEGRATION_RUNNER_DATABASE_NAME,
      });

      expect(
        parsed.username === 'backend_auth_app' &&
          parsed.hostname === 'postgres' &&
          parsed.port === '5432' &&
          parsed.password === encodeURIComponent(password) &&
          decodeURIComponent(parsed.password) === password &&
          parsed.pathname ===
            `/${runnerUrl.AUTH_INTEGRATION_RUNNER_DATABASE_NAME}` &&
          parsed.toString() === databaseUrl &&
          environment.databaseUrl === databaseUrl,
      ).toBe(true);
    },
  );

  it('returns the exact checked canonical connection URL', () => {
    const environment = readAuthIntegrationEnvironment(
      enabledEnvironment(),
    );

    expect(environment.databaseUrl === SAFE_URL).toBe(true);
    expect(environment.expectedDatabaseName).toBe(
      EXPECTED_DATABASE_NAME,
    );
  });

  it('does not expose the database URL in a configuration error', async () => {
    const secretMarker = 'database-password-secret-marker';
    const factory = jest.fn<PostgresService, [string]>();

    let captured: unknown;
    try {
      await openGuardedAuthIntegrationDatabase(
        enabledEnvironment({
          AUTH_INTEGRATION_DATABASE_URL:
            `postgresql://backend_auth_app:${secretMarker}` +
            '@localhost/wrong_auth_integration_test',
        }),
        factory,
      );
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(AuthIntegrationConfigurationError);
    expect(JSON.stringify(captured).includes(secretMarker)).toBe(false);
    expect((captured as Error).message.includes(secretMarker)).toBe(
      false,
    );
    expect((captured as Error).stack?.includes(secretMarker)).toBe(
      false,
    );
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('auth integration migration inventory', () => {
  it('accepts the complete POSTCHECK-derived catalog evidence', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence(evidence),
    ).toBe(true);
    expect({
      tables: evidence.tables.length,
      columns: evidence.columns.length,
      functions: evidence.functions.length,
      triggers: evidence.triggers.length,
      indexes: evidence.indexes.length,
      constraints: evidence.constraints.length,
      keys: evidence.keys.length,
      foreignKeys: evidence.foreignKeys.length,
      columnAclEntries: evidence.columnAcl.length,
    }).toEqual({
      tables: 17,
      columns: 177,
      functions: 20,
      triggers: 33,
      indexes: 11,
      constraints: 154,
      keys: 33,
      foreignKeys: 30,
      columnAclEntries: 186,
    });
  });

  it('requires the migration 017 table, foreign key, and migration 018 editable ACL', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      evidence.tables.find(
        (table) => table.name === 'player_profile_details',
      ),
    ).toEqual({
      name: 'player_profile_details',
      fingerprintMatches: true,
    });
    expect(
      evidence.foreignKeys.find(
        (foreignKey) =>
          foreignKey.name ===
          'player_profile_details_account_id_fkey',
      ),
    ).toMatchObject({
      tableName: 'player_profile_details',
      sourceColumns: 'account_id',
      targetTable: 'player_profiles',
      targetColumns: 'account_id',
      onUpdate: 'a',
      onDelete: 'a',
      isDeferrable: false,
      isDeferred: false,
      isValidated: true,
    });
    const profileDetailsAcl = evidence.columnAcl.filter(
      (entry) => entry.tableName === 'player_profile_details',
    );
    expect(profileDetailsAcl).toHaveLength(13);
    expect(
      profileDetailsAcl
        .filter((entry) => entry.privilegeType === 'INSERT')
        .map((entry) => entry.columnName),
    ).toEqual([
      'account_id',
      'first_name',
      'last_name',
      'username',
      'photo_url',
      'language_code',
      'created_at',
      'updated_at',
    ]);
    expect(
      profileDetailsAcl
        .filter((entry) => entry.privilegeType === 'UPDATE')
        .map((entry) => entry.columnName),
    ).toEqual([
      'first_name',
      'last_name',
      'phone',
      'side_preference',
      'updated_at',
    ]);
    expect(
      profileDetailsAcl.every(
        (entry) =>
          entry.grantee === 'backend_auth_app' &&
          entry.isGrantable === false,
      ),
    ).toBe(true);
  });

  it('rejects a stale table marker with a mismatched relation fingerprint', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        tables: evidence.tables.map((table, index) =>
          index === 0
            ? { ...table, fingerprintMatches: false }
            : table,
        ),
      }),
    ).toBe(false);
  });

  it('rejects a mismatched function definition fingerprint', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        functions: evidence.functions.map((fn, index) =>
          index === 0
            ? { ...fn, fingerprintMatches: false }
            : fn,
        ),
      }),
    ).toBe(false);
  });

  it('rejects a missing security trigger', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        triggers: evidence.triggers.slice(1),
      }),
    ).toBe(false);
  });

  it('rejects an unexpected constraint', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        constraints: [
          ...evidence.constraints,
          {
            ...evidence.constraints[0],
            name: 'unexpected_constraint',
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects a primary or unique key with the right name but wrong columns', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        keys: evidence.keys.map((key, index) =>
          index === 0 ? { ...key, keyColumns: 'created_at' } : key,
        ),
      }),
    ).toBe(false);
  });

  it('rejects a composite unique key with reordered columns', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();
    const target = evidence.keys.find(
      (key) =>
        key.name === 'external_identities_binding_key',
    );
    expect(target === undefined).toBe(false);

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        keys: evidence.keys.map((key) =>
          key === target
            ? { ...key, keyColumns: 'provider,id,namespace' }
            : key,
        ),
      }),
    ).toBe(false);
  });

  it.each([
    ['target column', { targetColumns: 'account_id' }],
    ['delete action', { onDelete: 'c' }],
    ['deferrability', { isDeferrable: true }],
    ['validation state', { isValidated: false }],
  ])('rejects a foreign key with wrong %s', (_label, change) => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        foreignKeys: evidence.foreignKeys.map((foreignKey, index) =>
          index === 0 ? { ...foreignKey, ...change } : foreignKey,
        ),
      }),
    ).toBe(false);
  });

  it.each([
    ['type', { dataType: 'text' }],
    ['nullability', { notNull: false }],
    ['default', { defaultExpression: "'blocked'::text" }],
  ])('rejects a column with wrong %s', (_label, change) => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        columns: evidence.columns.map((column, index) =>
          index === 0 ? { ...column, ...change } : column,
        ),
      }),
    ).toBe(false);
  });

  it('rejects a missing required column privilege', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        columnAcl: evidence.columnAcl.slice(1),
      }),
    ).toBe(false);
  });

  it('rejects an extra PUBLIC privilege', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        tableAcl: [
          ...evidence.tableAcl,
          {
            schemaName: 'backend_auth',
            relationName: 'accounts',
            grantee: 'PUBLIC',
            privilegeType: 'SELECT',
            isGrantable: false,
          },
        ],
      }),
    ).toBe(false);
  });

  it('does not accept a table grant in place of a column privilege', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        columnAcl: evidence.columnAcl.slice(1),
        tableAcl: [
          ...evidence.tableAcl,
          {
            schemaName: 'backend_auth',
            relationName: 'accounts',
            grantee: 'backend_auth_app',
            privilegeType: 'INSERT',
            isGrantable: false,
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects an invalid runtime ACL boundary', () => {
    const evidence = validAuthIntegrationCatalogEvidenceFixture();

    expect(
      isValidAuthIntegrationCatalogEvidence({
        ...evidence,
        aclValid: false,
      }),
    ).toBe(false);
  });
});

describe('auth integration finite timeout boundary', () => {
  it('provides finite Pool and PostgreSQL session timeouts', () => {
    const options = authIntegrationPoolOptions(SAFE_URL);
    const limits = Object.values(AUTH_INTEGRATION_POOL_LIMITS);

    expect(options.connectionString === SAFE_URL).toBe(true);
    expect({
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 10_000,
      idleTimeoutMillis: 5_000,
      max: 8,
      options: '-c search_path=pg_catalog,pg_temp',
    }).toEqual({
      connectionTimeoutMillis: options.connectionTimeoutMillis,
      query_timeout: options.query_timeout,
      statement_timeout: options.statement_timeout,
      lock_timeout: options.lock_timeout,
      idle_in_transaction_session_timeout:
        options.idle_in_transaction_session_timeout,
      idleTimeoutMillis: options.idleTimeoutMillis,
      max: options.max,
      options: options.options,
    });
    expect(
      limits.every(
        (value) =>
          Number.isFinite(value) &&
          value > 0 &&
          value < AUTH_INTEGRATION_JEST_TIMEOUT_MILLIS,
      ),
    ).toBe(true);
  });

  it('passes only checked options to the test-only Pool factory', async () => {
    const end = jest.fn<Promise<void>, []>().mockResolvedValue();
    const pool = { end } as unknown as Pool;
    const poolFactory = jest.fn<Pool, [PoolConfig]>(() => pool);

    const postgres = createAuthIntegrationPostgresService(
      SAFE_URL,
      poolFactory,
    );

    expect(poolFactory).toHaveBeenCalledTimes(1);
    const calledOptions = poolFactory.mock.calls[0][0];
    expect(calledOptions.connectionString === SAFE_URL).toBe(true);
    expect(calledOptions.connectionTimeoutMillis).toBe(5_000);
    expect(calledOptions.query_timeout).toBe(10_000);
    expect(calledOptions.statement_timeout).toBe(10_000);
    expect(calledOptions.lock_timeout).toBe(5_000);
    expect(calledOptions.idle_in_transaction_session_timeout).toBe(
      10_000,
    );
    await postgres.onApplicationShutdown();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('closes the test Postgres service when the database guard fails', async () => {
    const secretMarker = 'raw-connect-error-secret';
    const close = jest.fn<Promise<void>, []>().mockResolvedValue();
    const connect = jest
      .fn()
      .mockRejectedValue(new Error(secretMarker));
    const postgres = {
      getPool: () => ({ connect }),
      onApplicationShutdown: close,
    } as unknown as PostgresService;

    let captured: unknown;
    try {
      await openGuardedAuthIntegrationDatabase(
        enabledEnvironment(),
        () => postgres,
      );
    } catch (error) {
      captured = error;
    }

    expect(close).toHaveBeenCalledTimes(1);
    expect(captured).toMatchObject({
      name: 'AuthIntegrationGuardError',
      reason: 'database_check_failed',
      message: 'Auth integration database safety check failed',
    });
    expect(JSON.stringify(captured).includes(secretMarker)).toBe(false);
  });

  it('gives the concurrency barrier a finite safety timeout', async () => {
    jest.useFakeTimers();
    try {
      const arrive = twoPartyBarrier();
      const waiting = arrive();
      const timedOut = expect(waiting).rejects.toThrow(
        'Auth integration concurrency barrier timed out',
      );

      await jest.advanceTimersByTimeAsync(
        AUTH_INTEGRATION_BARRIER_TIMEOUT_MILLIS,
      );

      await timedOut;
      expect(
        AUTH_INTEGRATION_BARRIER_TIMEOUT_MILLIS <
          AUTH_INTEGRATION_JEST_TIMEOUT_MILLIS,
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('auth integration HTTP fixture lifecycle', () => {
  it('closes an application when initialization fails', async () => {
    const initializationError = new Error(
      'controlled initialization failure',
    );
    const close = jest.fn<Promise<void>, []>().mockResolvedValue();

    await expect(
      runWithAuthIntegrationCleanup(async (registerCleanup) => {
        registerCleanup(close);
        throw initializationError;
      }),
    ).rejects.toBe(initializationError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes an application when the scenario fails', async () => {
    const scenarioError = new Error('controlled scenario failure');
    const close = jest.fn<Promise<void>, []>().mockResolvedValue();

    await expect(
      runWithAuthIntegrationCleanup(async (registerCleanup) => {
        registerCleanup(close);
        throw scenarioError;
      }),
    ).rejects.toBe(scenarioError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes an application exactly once after success', async () => {
    const close = jest.fn<Promise<void>, []>().mockResolvedValue();

    await expect(
      runWithAuthIntegrationCleanup(
        async (registerCleanup) => {
          registerCleanup(close);
          return 'completed';
        },
      ),
    ).resolves.toBe('completed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('uses a fixed safe error when cleanup alone fails', async () => {
    const secretMarker = 'raw-cleanup-secret';
    const close = jest
      .fn<Promise<void>, []>()
      .mockRejectedValue(new Error(secretMarker));
    let captured: unknown;

    try {
      await runWithAuthIntegrationCleanup(
        async (registerCleanup) => {
          registerCleanup(close);
          return 'completed';
        },
      );
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(
      AuthIntegrationHttpCleanupError,
    );
    expect((captured as Error).message).toBe(
      AUTH_INTEGRATION_HTTP_CLEANUP_ERROR_MESSAGE,
    );
    expect((captured as Error).message.includes(secretMarker)).toBe(
      false,
    );
    expect((captured as Error).stack?.includes(secretMarker)).toBe(
      false,
    );
    expect(JSON.stringify(captured).includes(secretMarker)).toBe(
      false,
    );
    expect(Object.values(captured as object).includes(secretMarker)).toBe(
      false,
    );
  });

  it('preserves the primary scenario failure when cleanup also fails', async () => {
    const primaryError = new Error('controlled primary failure');
    const close = jest
      .fn<Promise<void>, []>()
      .mockRejectedValue(new Error('raw cleanup failure'));

    await expect(
      runWithAuthIntegrationCleanup(async (registerCleanup) => {
        registerCleanup(close);
        throw primaryError;
      }),
    ).rejects.toBe(primaryError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes multiple resources in reverse creation order', async () => {
    const order: string[] = [];
    const closeFirst = jest.fn(async () => {
      order.push('first');
    });
    const closeSecond = jest.fn(async () => {
      order.push('second');
    });

    await runWithAuthIntegrationCleanup(
      async (registerCleanup) => {
        registerCleanup(closeFirst);
        registerCleanup(closeSecond);
      },
    );

    expect(order).toEqual(['second', 'first']);
  });

  it('continues closing remaining resources after one cleanup fails', async () => {
    const order: string[] = [];
    const closeFirst = jest.fn(async () => {
      order.push('first');
    });
    const closeSecond = jest.fn(async () => {
      order.push('second');
      throw new Error('raw second cleanup failure');
    });

    await expect(
      runWithAuthIntegrationCleanup(
        async (registerCleanup) => {
          registerCleanup(closeFirst);
          registerCleanup(closeSecond);
        },
      ),
    ).rejects.toBeInstanceOf(AuthIntegrationHttpCleanupError);
    expect(order).toEqual(['second', 'first']);
    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(closeSecond).toHaveBeenCalledTimes(1);
  });

  it('does not run cleanup when no application was created', async () => {
    const creationError = new Error('controlled creation failure');

    await expect(
      runWithAuthIntegrationCleanup(async () => {
        throw creationError;
      }),
    ).rejects.toBe(creationError);
  });
});
