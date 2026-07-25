const DATABASE_NAME_PATTERN = /^[a-zA-Z0-9_]+$/u;
const DISPOSABLE_DATABASE_SUFFIX = '_auth_integration_test';
const RAW_ASCII_WHITESPACE_OR_CONTROL_PATTERN =
  /[\u0000-\u0020\u007f]/u;
const EXPECTED_DATABASE_USER = 'backend_auth_app';
const ALLOWED_QUERY_PARAMETERS = Object.freeze({
  sslmode: Object.freeze([
    'disable',
    'prefer',
    'require',
    'verify-ca',
    'verify-full',
  ]),
  sslnegotiation: Object.freeze(['postgres', 'direct']),
} as const);

export interface AuthIntegrationEnvironment {
  readonly databaseUrl: string;
  readonly expectedDatabaseName: string;
}

export type AuthIntegrationEnvironmentSource = Readonly<
  Record<string, string | undefined>
>;

export type AuthIntegrationConfigurationFailure =
  | 'not_enabled'
  | 'invalid_environment'
  | 'unsafe_database_target';

export class AuthIntegrationConfigurationError extends Error {
  readonly name = 'AuthIntegrationConfigurationError';

  constructor(readonly reason: AuthIntegrationConfigurationFailure) {
    super(
      reason === 'not_enabled'
        ? 'Auth integration tests are not explicitly enabled'
        : 'Auth integration test environment is invalid',
    );
  }
}

function failure(
  reason: AuthIntegrationConfigurationFailure,
): AuthIntegrationConfigurationError {
  return new AuthIntegrationConfigurationError(reason);
}

function canonicalDatabaseUrl(
  value: string,
): { readonly url: string; readonly databaseName: string } | undefined {
  try {
    if (
      value.length === 0 ||
      value.trim() !== value ||
      RAW_ASCII_WHITESPACE_OR_CONTROL_PATTERN.test(value)
    ) {
      return undefined;
    }

    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'postgres:' &&
        parsed.protocol !== 'postgresql:') ||
      parsed.hash.length !== 0 ||
      parsed.hostname.length === 0 ||
      parsed.toString() !== value
    ) {
      return undefined;
    }

    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const encodedDatabaseName = parsed.pathname.slice(1);
    const databaseName = decodeURIComponent(encodedDatabaseName);
    if (
      username !== EXPECTED_DATABASE_USER ||
      encodeURIComponent(username) !== parsed.username ||
      encodeURIComponent(password) !== parsed.password ||
      databaseName.length === 0 ||
      databaseName.includes('/') ||
      !DATABASE_NAME_PATTERN.test(databaseName) ||
      encodeURIComponent(databaseName) !== encodedDatabaseName
    ) {
      return undefined;
    }

    const seenQueryParameters = new Set<string>();
    for (const [name, queryValue] of parsed.searchParams.entries()) {
      if (
        seenQueryParameters.has(name) ||
        !Object.prototype.hasOwnProperty.call(
          ALLOWED_QUERY_PARAMETERS,
          name,
        ) ||
        !(
          ALLOWED_QUERY_PARAMETERS[
            name as keyof typeof ALLOWED_QUERY_PARAMETERS
          ] as readonly string[]
        ).includes(queryValue)
      ) {
        return undefined;
      }
      seenQueryParameters.add(name);
    }

    return Object.freeze({
      url: parsed.toString(),
      databaseName,
    });
  } catch {
    return undefined;
  }
}

export function readAuthIntegrationEnvironment(
  source: AuthIntegrationEnvironmentSource,
): AuthIntegrationEnvironment {
  if (
    source.AUTH_INTEGRATION_TESTS_ENABLED !== 'true' ||
    source.AUTH_INTEGRATION_DISPOSABLE_DATABASE !== 'true'
  ) {
    throw failure('not_enabled');
  }

  const databaseUrl = source.AUTH_INTEGRATION_DATABASE_URL;
  const expectedDatabaseName =
    source.AUTH_INTEGRATION_EXPECTED_DATABASE_NAME;
  if (
    typeof databaseUrl !== 'string' ||
    databaseUrl.length === 0 ||
    typeof expectedDatabaseName !== 'string' ||
    !DATABASE_NAME_PATTERN.test(expectedDatabaseName)
  ) {
    throw failure('invalid_environment');
  }

  const canonical = canonicalDatabaseUrl(databaseUrl);
  if (
    canonical === undefined ||
    !expectedDatabaseName.endsWith(DISPOSABLE_DATABASE_SUFFIX) ||
    canonical.databaseName !== expectedDatabaseName
  ) {
    throw failure('unsafe_database_target');
  }

  return Object.freeze({
    databaseUrl: canonical.url,
    expectedDatabaseName,
  });
}
