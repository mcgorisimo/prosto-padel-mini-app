import { inspect } from 'node:util';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BACKEND_RUNTIME_CONFIGURATION_ERROR,
  FILE_SECRET_KEYS,
  FileSecretReader,
} from './file-secret.resolver';
import {
  createRuntimeConfigurationLoader,
  validateRuntimeEnvironment,
} from './runtime-environment';
import { TELEGRAM_LOGIN_CONFIG_KEYS } from './telegram-login.config';
import { PostgresService } from '../database/postgres.service';

const TEST_DATABASE_URL =
  'postgresql://test-only.invalid/prosto_padel';
const TEST_DATABASE_PASSWORD = 'synthetic-db-password';
const TEST_BOT_TOKEN =
  '123456789:AA_TEST_ONLY_FAKE_TELEGRAM_BOT_TOKEN';
const TEST_LOOKUP_PEPPER = Buffer.alloc(32, 0x31).toString('base64');
const TEST_WORKFLOW_SECRET = Buffer.alloc(32, 0x42).toString('base64');
const TEST_UUID_NAMESPACE = '12345678-1234-5678-9234-567812345678';

const DIRECT_DATABASE_ENVIRONMENT = Object.freeze({
  DATABASE_ENABLED: 'true',
  DATABASE_URL: TEST_DATABASE_URL,
});

const DIRECT_TELEGRAM_ENVIRONMENT = Object.freeze({
  TELEGRAM_AUTH_ENABLED: 'true',
  TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]: TEST_LOOKUP_PEPPER,
  [TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64]:
    TEST_WORKFLOW_SECRET,
  [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]: TEST_UUID_NAMESPACE,
});

const COMPONENT_DATABASE_ENVIRONMENT = Object.freeze({
  DATABASE_ENABLED: 'true',
  DATABASE_HOST: 'postgres',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'prosto_padel_test_migration_cycle',
  DATABASE_USER: 'backend_auth_app',
  [FILE_SECRET_KEYS.databasePassword]: '/synthetic/database-password',
});

function readerFrom(
  files: Readonly<Record<string, Buffer | string>>,
): jest.MockedFunction<FileSecretReader> {
  return jest.fn((path: string) => {
    if (!Object.prototype.hasOwnProperty.call(files, path)) {
      throw new Error(`Synthetic missing file: ${path}`);
    }
    return files[path];
  });
}

function restoreProcessEnvironment(
  snapshot: Readonly<Record<string, string | undefined>>,
): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function expectFixedFailure(
  action: () => unknown,
  forbidden: readonly string[] = [],
): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  const error = caught instanceof Error ? caught : undefined;
  const message = error?.message ?? '';
  const stack = error?.stack ?? '';
  const cause =
    error === undefined
      ? undefined
      : (error as Error & { cause?: unknown }).cause;
  const ownPropertyInspection =
    error === undefined
      ? ''
      : Object.getOwnPropertyNames(error)
          .map(
            (name) =>
              `${name}:${inspect(
                Reflect.get(error, name) as unknown,
                { depth: 4 },
              )}`,
          )
          .join('\n');
  let serialized = '';
  let serializationSucceeded = true;
  try {
    serialized = JSON.stringify(caught);
  } catch {
    serializationSucceeded = false;
  }
  const inspected = inspect(caught, { depth: 4 });
  const diagnosticSurfaces = [
    message,
    stack,
    inspect(cause, { depth: 4 }),
    ownPropertyInspection,
    serialized,
    inspected,
  ];
  expect({
    isError: error !== undefined,
    fixedMessage: message === BACKEND_RUNTIME_CONFIGURATION_ERROR,
    hasCause: cause !== undefined,
    serializationSucceeded,
    containsForbiddenValue: forbidden.some((value) =>
      diagnosticSurfaces.some((surface) => surface.includes(value)),
    ),
  }).toEqual({
    isError: true,
    fixedMessage: true,
    hasCause: false,
    serializationSucceeded: true,
    containsForbiddenValue: false,
  });
}

describe('runtime environment validation', () => {
  it('keeps Telegram authentication disabled by default without reading files', () => {
    const reader = jest.fn<
      ReturnType<FileSecretReader>,
      Parameters<FileSecretReader>
    >();

    const result = validateRuntimeEnvironment({}, reader);

    expect({
      databaseEnabled: result.DATABASE_ENABLED,
      telegramEnabled: result.TELEGRAM_AUTH_ENABLED,
    }).toEqual({
      databaseEnabled: false,
      telegramEnabled: false,
    });
    expect(reader).not.toHaveBeenCalled();
  });

  it.each([
    FILE_SECRET_KEYS.databasePassword,
    FILE_SECRET_KEYS.telegramBotToken,
    FILE_SECRET_KEYS.telegramLookupPepper,
    FILE_SECRET_KEYS.telegramWorkflowHmac,
  ])(
    'fails closed for an explicitly configured missing %s while features are disabled',
    (fileKey) => {
      const path = '/synthetic/disabled-feature-missing-secret';
      const readerMessage = 'synthetic disabled read failure';

      expectFixedFailure(
        () =>
          validateRuntimeEnvironment({ [fileKey]: path }, () => {
            throw new Error(readerMessage);
          }),
        [path, readerMessage],
      );
    },
  );

  it('preserves direct DATABASE_URL compatibility', () => {
    const result = validateRuntimeEnvironment(
      DIRECT_DATABASE_ENVIRONMENT,
    );

    expect({
      enabled: result.DATABASE_ENABLED,
      urlMatches: result.DATABASE_URL === TEST_DATABASE_URL,
    }).toEqual({ enabled: true, urlMatches: true });
  });

  it('builds a backend-only PostgreSQL URL from validated components', () => {
    const result = validateRuntimeEnvironment(
      COMPONENT_DATABASE_ENVIRONMENT,
      readerFrom({
        '/synthetic/database-password': TEST_DATABASE_PASSWORD,
      }),
    );

    expect(
      result.DATABASE_URL ===
        'postgresql://backend_auth_app:synthetic-db-password@postgres:5432/prosto_padel_test_migration_cycle',
    ).toBe(true);
    expect(
      Object.values(result).includes(TEST_DATABASE_PASSWORD),
    ).toBe(false);
    for (const key of [
      'DATABASE_HOST',
      'DATABASE_PORT',
      'DATABASE_NAME',
      'DATABASE_USER',
      FILE_SECRET_KEYS.databasePassword,
    ]) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
    }
  });

  it('percent-encodes username and password exactly once', () => {
    const password = 'p@ss:%2F/$&+,';
    const result = validateRuntimeEnvironment(
      {
        ...COMPONENT_DATABASE_ENVIRONMENT,
        DATABASE_USER: 'backend+auth@app',
      },
      readerFrom({
        '/synthetic/database-password': password,
      }),
    );
    const expected =
      'postgresql://backend%2Bauth%40app:' +
      'p%40ss%3A%252F%2F%24%26%2B%2C' +
      '@postgres:5432/prosto_padel_test_migration_cycle';

    expect(result.DATABASE_URL === expected).toBe(true);
    const parsed = new URL(String(result.DATABASE_URL));
    expect({
      userRoundTrip:
        decodeURIComponent(parsed.username) === 'backend+auth@app',
      passwordRoundTrip: decodeURIComponent(parsed.password) === password,
    }).toEqual({ userRoundTrip: true, passwordRoundTrip: true });
  });

  it.each([
    ['host', { DATABASE_HOST: 'postgres..internal' }],
    ['port', { DATABASE_PORT: '0' }],
    ['database name', { DATABASE_NAME: ' migration_cycle' }],
    ['database user', { DATABASE_USER: 'backend\nauth' }],
  ])('rejects an invalid database %s', (_label, override) => {
    expectFixedFailure(() =>
      validateRuntimeEnvironment(
        { ...COMPONENT_DATABASE_ENVIRONMENT, ...override },
        readerFrom({
          '/synthetic/database-password': TEST_DATABASE_PASSWORD,
        }),
      ),
    );
  });

  it('rejects direct DATABASE_URL together with component mode', () => {
    expectFixedFailure(() =>
      validateRuntimeEnvironment(
        {
          ...COMPONENT_DATABASE_ENVIRONMENT,
          DATABASE_URL: TEST_DATABASE_URL,
        },
        readerFrom({
          '/synthetic/database-password': TEST_DATABASE_PASSWORD,
        }),
      ),
    );
  });

  it('rejects component mode without every required component', () => {
    const environment: Record<string, unknown> = {
      ...COMPONENT_DATABASE_ENVIRONMENT,
    };
    delete environment.DATABASE_USER;

    expectFixedFailure(() =>
      validateRuntimeEnvironment(
        environment,
        readerFrom({
          '/synthetic/database-password': TEST_DATABASE_PASSWORD,
        }),
      ),
    );
  });

  it('rejects a direct database password', () => {
    const password = 'direct-password-must-not-be-supported';

    expectFixedFailure(
      () =>
        validateRuntimeEnvironment({
          ...DIRECT_DATABASE_ENVIRONMENT,
          DATABASE_PASSWORD: password,
        }),
      [password],
    );
  });

  it('does not place a file password or assembled URL in process.env', () => {
    const originalUrl = process.env.DATABASE_URL;
    const originalPassword = process.env.DATABASE_PASSWORD;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_PASSWORD;

    try {
      validateRuntimeEnvironment(
        COMPONENT_DATABASE_ENVIRONMENT,
        readerFrom({
          '/synthetic/database-password': TEST_DATABASE_PASSWORD,
        }),
      );

      expect({
        urlWasWritten: process.env.DATABASE_URL !== undefined,
        passwordWasWritten:
          process.env.DATABASE_PASSWORD !== undefined,
      }).toEqual({ urlWasWritten: false, passwordWasWritten: false });
    } finally {
      if (originalUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalUrl;
      }
      if (originalPassword === undefined) {
        delete process.env.DATABASE_PASSWORD;
      } else {
        process.env.DATABASE_PASSWORD = originalPassword;
      }
    }
  });

  it('keeps resolved file secrets only in the real ConfigModule internal store', async () => {
    const originalEnvironment = { ...process.env };
    const paths = {
      database: '/synthetic/lifecycle-database-password',
      token: '/synthetic/lifecycle-telegram-token',
      pepper: '/synthetic/lifecycle-lookup-pepper',
      hmac: '/synthetic/lifecycle-workflow-hmac',
    };
    const databasePassword = 'lifecycle-db-password:%2F';
    const arbitraryKey = 'RUNTIME_CONFIG_UNRELATED_TEST_KEY';
    let moduleRef: TestingModule | undefined;

    try {
      for (const key of [
        'DATABASE_URL',
        'DATABASE_PASSWORD',
        FILE_SECRET_KEYS.databasePassword,
        'TELEGRAM_BOT_TOKEN',
        FILE_SECRET_KEYS.telegramBotToken,
        TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64,
        FILE_SECRET_KEYS.telegramLookupPepper,
        TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64,
        FILE_SECRET_KEYS.telegramWorkflowHmac,
        arbitraryKey,
      ]) {
        delete process.env[key];
      }
      Object.assign(process.env, {
        DATABASE_ENABLED: 'true',
        DATABASE_HOST: 'postgres',
        DATABASE_PORT: '5432',
        DATABASE_NAME: 'prosto_padel_test_migration_cycle',
        DATABASE_USER: 'backend_auth_app',
        [FILE_SECRET_KEYS.databasePassword]: paths.database,
        TELEGRAM_AUTH_ENABLED: 'true',
        [FILE_SECRET_KEYS.telegramBotToken]: paths.token,
        TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
        [FILE_SECRET_KEYS.telegramLookupPepper]: paths.pepper,
        [FILE_SECRET_KEYS.telegramWorkflowHmac]: paths.hmac,
        [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]:
          TEST_UUID_NAMESPACE,
        [arbitraryKey]: 'must-not-be-readable-through-config-service',
      });
      const reader = readerFrom({
        [paths.database]: databasePassword,
        [paths.token]: TEST_BOT_TOKEN,
        [paths.pepper]: TEST_LOOKUP_PEPPER,
        [paths.hmac]: TEST_WORKFLOW_SECRET,
      });

      expect({
        databaseUrlPresent: process.env.DATABASE_URL !== undefined,
        telegramTokenPresent:
          process.env.TELEGRAM_BOT_TOKEN !== undefined,
        lookupPepperPresent:
          process.env[
            TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64
          ] !== undefined,
        workflowSecretPresent:
          process.env[
            TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64
          ] !== undefined,
      }).toEqual({
        databaseUrlPresent: false,
        telegramTokenPresent: false,
        lookupPepperPresent: false,
        workflowSecretPresent: false,
      });

      moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            cache: true,
            ignoreEnvFile: true,
            isGlobal: true,
            load: [createRuntimeConfigurationLoader(reader)],
            skipProcessEnv: true,
          }),
        ],
      }).compile();
      const config = moduleRef.get(ConfigService);
      const expectedDatabaseUrl =
        'postgresql://backend_auth_app:' +
        'lifecycle-db-password%3A%252F' +
        '@postgres:5432/prosto_padel_test_migration_cycle';
      const postgres = new PostgresService(config);

      expect({
        databaseUrlMatches:
          config.get<string>('DATABASE_URL') === expectedDatabaseUrl,
        telegramTokenMatches:
          config.get<string>('TELEGRAM_BOT_TOKEN') === TEST_BOT_TOKEN,
        lookupPepperMatches:
          config.get<string>(
            TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64,
          ) === TEST_LOOKUP_PEPPER,
        workflowSecretMatches:
          config.get<string>(
            TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64,
          ) === TEST_WORKFLOW_SECRET,
        namespaceMatches:
          config.get<string>(
            TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace,
          ) === TEST_UUID_NAMESPACE,
        maxAge:
          config.get<number>('TELEGRAM_INIT_DATA_MAX_AGE_SECONDS'),
        databaseEnabled: postgres.isEnabled(),
        databaseUrlMatchesConsumer:
          Reflect.get(postgres, 'connectionString') ===
          expectedDatabaseUrl,
        postgresPoolCreated:
          Reflect.get(postgres, 'pool') !== undefined,
        readCount: reader.mock.calls.length,
      }).toEqual({
        databaseUrlMatches: true,
        telegramTokenMatches: true,
        lookupPepperMatches: true,
        workflowSecretMatches: true,
        namespaceMatches: true,
        maxAge: 300,
        databaseEnabled: true,
        databaseUrlMatchesConsumer: true,
        postgresPoolCreated: false,
        readCount: 4,
      });

      const secretSourceKeys = [
        'DATABASE_URL',
        'DATABASE_PASSWORD',
        FILE_SECRET_KEYS.databasePassword,
        'TELEGRAM_BOT_TOKEN',
        FILE_SECRET_KEYS.telegramBotToken,
        TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64,
        FILE_SECRET_KEYS.telegramLookupPepper,
        TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64,
        FILE_SECRET_KEYS.telegramWorkflowHmac,
      ] as const;
      expect({
        sourceKeysRemainInProcessEnvironment: secretSourceKeys.some(
          (key) => process.env[key] !== undefined,
        ),
        filePathsAvailableThroughConfigService: [
          FILE_SECRET_KEYS.databasePassword,
          FILE_SECRET_KEYS.telegramBotToken,
          FILE_SECRET_KEYS.telegramLookupPepper,
          FILE_SECRET_KEYS.telegramWorkflowHmac,
        ].some((key) => config.get(key) !== undefined),
        arbitraryProcessEnvironmentFallback:
          config.get(arbitraryKey) !== undefined,
      }).toEqual({
        sourceKeysRemainInProcessEnvironment: false,
        filePathsAvailableThroughConfigService: false,
        arbitraryProcessEnvironmentFallback: false,
      });
    } finally {
      await moduleRef?.close();
      restoreProcessEnvironment(originalEnvironment);
    }

    const currentKeys = new Set(Object.keys(process.env));
    const originalKeys = new Set(Object.keys(originalEnvironment));
    expect(
      currentKeys.size === originalKeys.size &&
        [...originalKeys].every(
          (key) => process.env[key] === originalEnvironment[key],
        ),
    ).toBe(true);
  });

  it('does not write resolved file secrets when the runtime loader fails', () => {
    const originalEnvironment = { ...process.env };
    const paths = {
      database: '/synthetic/failing-database-password',
      token: '/synthetic/failing-telegram-token',
      pepper: '/synthetic/failing-lookup-pepper',
      hmac: '/synthetic/failing-workflow-hmac',
    };
    const databasePassword = 'failing-lifecycle-db-password';

    try {
      for (const key of [
        'DATABASE_URL',
        'DATABASE_PASSWORD',
        'TELEGRAM_BOT_TOKEN',
        TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64,
        TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64,
      ]) {
        delete process.env[key];
      }
      Object.assign(process.env, {
        DATABASE_ENABLED: 'true',
        DATABASE_HOST: 'postgres',
        DATABASE_PORT: '5432',
        DATABASE_NAME: 'prosto_padel_test_migration_cycle',
        DATABASE_USER: 'backend_auth_app',
        [FILE_SECRET_KEYS.databasePassword]: paths.database,
        TELEGRAM_AUTH_ENABLED: 'true',
        [FILE_SECRET_KEYS.telegramBotToken]: paths.token,
        TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
        [FILE_SECRET_KEYS.telegramLookupPepper]: paths.pepper,
        [FILE_SECRET_KEYS.telegramWorkflowHmac]: paths.hmac,
        [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]:
          'invalid-lifecycle-namespace',
      });

      expectFixedFailure(
        () =>
          createRuntimeConfigurationLoader(
            readerFrom({
              [paths.database]: databasePassword,
              [paths.token]: TEST_BOT_TOKEN,
              [paths.pepper]: TEST_LOOKUP_PEPPER,
              [paths.hmac]: TEST_WORKFLOW_SECRET,
            }),
          )(),
        [
          ...Object.values(paths),
          databasePassword,
          TEST_BOT_TOKEN,
          TEST_LOOKUP_PEPPER,
          TEST_WORKFLOW_SECRET,
        ],
      );
      expect({
        databaseUrlPresent: process.env.DATABASE_URL !== undefined,
        telegramTokenPresent:
          process.env.TELEGRAM_BOT_TOKEN !== undefined,
        lookupPepperPresent:
          process.env[
            TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64
          ] !== undefined,
        workflowSecretPresent:
          process.env[
            TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64
          ] !== undefined,
      }).toEqual({
        databaseUrlPresent: false,
        telegramTokenPresent: false,
        lookupPepperPresent: false,
        workflowSecretPresent: false,
      });
    } finally {
      restoreProcessEnvironment(originalEnvironment);
    }
  });

  it('removes direct secrets only after creating the internal snapshot', () => {
    const originalEnvironment = { ...process.env };

    try {
      for (const key of [
        ...Object.values(FILE_SECRET_KEYS),
        'DATABASE_HOST',
        'DATABASE_PORT',
        'DATABASE_NAME',
        'DATABASE_USER',
        'DATABASE_PASSWORD',
      ]) {
        delete process.env[key];
      }
      Object.assign(process.env, {
        ...DIRECT_DATABASE_ENVIRONMENT,
        ...DIRECT_TELEGRAM_ENVIRONMENT,
      });

      const configuration = createRuntimeConfigurationLoader()();

      expect({
        databaseUrlMatches:
          configuration.DATABASE_URL === TEST_DATABASE_URL,
        telegramTokenMatches:
          configuration.TELEGRAM_BOT_TOKEN === TEST_BOT_TOKEN,
        lookupPepperMatches:
          configuration[
            TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64
          ] === TEST_LOOKUP_PEPPER,
        workflowSecretMatches:
          configuration[
            TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64
          ] === TEST_WORKFLOW_SECRET,
        directSecretsRemainInProcessEnvironment: [
          'DATABASE_URL',
          'TELEGRAM_BOT_TOKEN',
          TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64,
          TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64,
        ].some((key) => process.env[key] !== undefined),
        nonSecretFlagsRemain:
          process.env.DATABASE_ENABLED === 'true' &&
          process.env.TELEGRAM_AUTH_ENABLED === 'true' &&
          process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS === '300',
      }).toEqual({
        databaseUrlMatches: true,
        telegramTokenMatches: true,
        lookupPepperMatches: true,
        workflowSecretMatches: true,
        directSecretsRemainInProcessEnvironment: false,
        nonSecretFlagsRemain: true,
      });
    } finally {
      restoreProcessEnvironment(originalEnvironment);
    }
  });

  it('accepts the complete enabled Telegram configuration via direct values', () => {
    const result = validateRuntimeEnvironment({
      ...DIRECT_DATABASE_ENVIRONMENT,
      ...DIRECT_TELEGRAM_ENVIRONMENT,
    });

    expect({
      enabled: result.TELEGRAM_AUTH_ENABLED,
      tokenMatches: result.TELEGRAM_BOT_TOKEN === TEST_BOT_TOKEN,
      maxAge: result.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
      pepperMatches:
        result[TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64] ===
        TEST_LOOKUP_PEPPER,
      hmacMatches:
        result[TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64] ===
        TEST_WORKFLOW_SECRET,
      namespace:
        result[TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace],
    }).toEqual({
      enabled: true,
      tokenMatches: true,
      maxAge: 300,
      pepperMatches: true,
      hmacMatches: true,
      namespace: TEST_UUID_NAMESPACE,
    });
  });

  it('accepts the complete enabled Telegram configuration via files', () => {
    const paths = {
      database: '/synthetic/database-password',
      token: '/synthetic/telegram-token',
      pepper: '/synthetic/lookup-pepper',
      hmac: '/synthetic/workflow-hmac',
    };
    const reader = readerFrom({
      [paths.database]: `${TEST_DATABASE_PASSWORD}\r\n`,
      [paths.token]: `${TEST_BOT_TOKEN}\r\n`,
      [paths.pepper]: `${TEST_LOOKUP_PEPPER}\n`,
      [paths.hmac]: `${TEST_WORKFLOW_SECRET}\n`,
    });

    const result = validateRuntimeEnvironment(
      {
        ...COMPONENT_DATABASE_ENVIRONMENT,
        [FILE_SECRET_KEYS.telegramBotToken]: paths.token,
        [FILE_SECRET_KEYS.telegramLookupPepper]: paths.pepper,
        [FILE_SECRET_KEYS.telegramWorkflowHmac]: paths.hmac,
        TELEGRAM_AUTH_ENABLED: 'true',
        TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
        [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]:
          TEST_UUID_NAMESPACE,
      },
      reader,
    );

    expect({
      enabled: result.TELEGRAM_AUTH_ENABLED,
      tokenMatches: result.TELEGRAM_BOT_TOKEN === TEST_BOT_TOKEN,
      pepperMatches:
        result[TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64] ===
        TEST_LOOKUP_PEPPER,
      hmacMatches:
        result[TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64] ===
        TEST_WORKFLOW_SECRET,
      readCount: reader.mock.calls.length,
    }).toEqual({
      enabled: true,
      tokenMatches: true,
      pepperMatches: true,
      hmacMatches: true,
      readCount: 4,
    });
  });

  it.each([
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_INIT_DATA_MAX_AGE_SECONDS',
    TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64,
    TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64,
    TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace,
  ])('rejects enabled Telegram auth without %s', (missingKey) => {
    const environment: Record<string, unknown> = {
      ...DIRECT_DATABASE_ENVIRONMENT,
      ...DIRECT_TELEGRAM_ENVIRONMENT,
    };
    delete environment[missingKey];

    expectFixedFailure(() => validateRuntimeEnvironment(environment));
  });

  it('rejects direct and file Telegram secret ambiguity', () => {
    const path = '/synthetic/telegram-token';

    expectFixedFailure(
      () =>
        validateRuntimeEnvironment(
          {
            ...DIRECT_DATABASE_ENVIRONMENT,
            ...DIRECT_TELEGRAM_ENVIRONMENT,
            [FILE_SECRET_KEYS.telegramBotToken]: path,
          },
          readerFrom({ [path]: TEST_BOT_TOKEN }),
        ),
      [path, TEST_BOT_TOKEN],
    );
  });

  it.each([
    'obviously-fake-test-token',
    '012345:invalid_leading_zero',
    '123456:token:with:extra:separator',
    '123456:token.with.invalid.characters',
    ' 123456:token',
  ])('rejects invalid Telegram bot token format', (token) => {
    expectFixedFailure(
      () =>
        validateRuntimeEnvironment({
          ...DIRECT_DATABASE_ENVIRONMENT,
          ...DIRECT_TELEGRAM_ENVIRONMENT,
          TELEGRAM_BOT_TOKEN: token,
        }),
      [token],
    );
  });

  it('rejects invalid canonical base64 without leaking it', () => {
    const invalidSecret = 'not-canonical-base64-secret';

    expectFixedFailure(
      () =>
        validateRuntimeEnvironment({
          ...DIRECT_DATABASE_ENVIRONMENT,
          ...DIRECT_TELEGRAM_ENVIRONMENT,
          [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]:
            invalidSecret,
        }),
      [invalidSecret],
    );
  });

  it('rejects an invalid UUID namespace without leaking it', () => {
    const invalidNamespace =
      '12345678-1234-5678-9234-56781234567Z';

    expectFixedFailure(
      () =>
        validateRuntimeEnvironment({
          ...DIRECT_DATABASE_ENVIRONMENT,
          ...DIRECT_TELEGRAM_ENVIRONMENT,
          [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]:
            invalidNamespace,
        }),
      [invalidNamespace],
    );
  });

  it('does not expose a file path or reader error in startup failure', () => {
    const path = '/synthetic/private-telegram-token';
    const readerMessage = 'reader-error-with-sensitive-metadata';

    expectFixedFailure(
      () =>
        validateRuntimeEnvironment(
          {
            ...DIRECT_DATABASE_ENVIRONMENT,
            TELEGRAM_AUTH_ENABLED: 'true',
            [FILE_SECRET_KEYS.telegramBotToken]: path,
          },
          () => {
            throw new Error(readerMessage);
          },
        ),
      [path, readerMessage],
    );
  });
});
