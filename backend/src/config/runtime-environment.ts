import {
  BackendRuntimeConfigurationError,
  FILE_SECRET_KEYS,
  FileSecretReader,
  resolveFileSecrets,
} from './file-secret.resolver';
import { envValidationSchema } from './env.validation';

const DATABASE_COMPONENT_KEYS = Object.freeze([
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
] as const);
const RUNTIME_SECRET_SOURCE_KEYS = Object.freeze([
  'DATABASE_URL',
  'DATABASE_PASSWORD',
  FILE_SECRET_KEYS.databasePassword,
  'PROFILE_PHOTO_STORAGE_ACCESS_KEY_ID',
  FILE_SECRET_KEYS.profilePhotoAccessKeyId,
  'PROFILE_PHOTO_STORAGE_SECRET_ACCESS_KEY',
  FILE_SECRET_KEYS.profilePhotoSecretAccessKey,
  'TELEGRAM_BOT_TOKEN',
  FILE_SECRET_KEYS.telegramBotToken,
  'TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64',
  FILE_SECRET_KEYS.telegramLookupPepper,
  'TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64',
  FILE_SECRET_KEYS.telegramWorkflowHmac,
] as const);
const ASCII_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const DATABASE_HOST_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u;
const POSTGRES_IDENTIFIER_MAX_UTF8_BYTES = 63;

function invalidConfiguration(): never {
  throw new BackendRuntimeConfigurationError();
}

function hasSuppliedKey(
  source: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(source, key) &&
    source[key] !== undefined
  );
}

function readDatabaseTextComponent(
  value: unknown,
  maximumUtf8Bytes: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    ASCII_CONTROL_CHARACTER_PATTERN.test(value) ||
    Buffer.byteLength(value, 'utf8') > maximumUtf8Bytes
  ) {
    return invalidConfiguration();
  }
  return value;
}

function readDatabaseHost(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !DATABASE_HOST_PATTERN.test(value)
  ) {
    return invalidConfiguration();
  }
  return value;
}

function readDatabasePort(value: unknown): number {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[0-9]{1,5}$/u.test(String(value))
  ) {
    return invalidConfiguration();
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return invalidConfiguration();
  }
  return port;
}

function encodeDatabaseUrlComponent(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    return invalidConfiguration();
  }
}

function createDatabaseUrl(
  source: Readonly<Record<string, unknown>>,
  password: string,
): string {
  if (ASCII_CONTROL_CHARACTER_PATTERN.test(password)) {
    return invalidConfiguration();
  }

  const host = readDatabaseHost(source.DATABASE_HOST);
  const port = readDatabasePort(source.DATABASE_PORT);
  const database = readDatabaseTextComponent(
    source.DATABASE_NAME,
    POSTGRES_IDENTIFIER_MAX_UTF8_BYTES,
  );
  const user = readDatabaseTextComponent(
    source.DATABASE_USER,
    POSTGRES_IDENTIFIER_MAX_UTF8_BYTES,
  );
  const encodedUser = encodeDatabaseUrlComponent(user);
  const encodedPassword = encodeDatabaseUrlComponent(password);
  const encodedDatabase = encodeDatabaseUrlComponent(database);
  const databaseUrl =
    `postgresql://${encodedUser}:${encodedPassword}` +
    `@${host}:${port}/${encodedDatabase}`;

  try {
    const parsed = new URL(databaseUrl);
    if (
      parsed.protocol !== 'postgresql:' ||
      parsed.toString() !== databaseUrl
    ) {
      return invalidConfiguration();
    }
  } catch {
    return invalidConfiguration();
  }

  return databaseUrl;
}

function resolveDatabaseConfiguration(
  source: Readonly<Record<string, unknown>>,
  databasePassword: string | undefined,
): Record<string, unknown> {
  const componentMode =
    DATABASE_COMPONENT_KEYS.some((key) => hasSuppliedKey(source, key)) ||
    databasePassword !== undefined;

  if (!componentMode) {
    if (hasSuppliedKey(source, 'DATABASE_PASSWORD')) {
      return invalidConfiguration();
    }
    return { ...source };
  }

  if (
    hasSuppliedKey(source, 'DATABASE_URL') ||
    hasSuppliedKey(source, 'DATABASE_PASSWORD') ||
    databasePassword === undefined ||
    !DATABASE_COMPONENT_KEYS.every((key) => hasSuppliedKey(source, key))
  ) {
    return invalidConfiguration();
  }

  const environment: Record<string, unknown> = { ...source };
  environment.DATABASE_URL = createDatabaseUrl(source, databasePassword);
  for (const key of DATABASE_COMPONENT_KEYS) {
    delete environment[key];
  }
  return environment;
}

export function validateRuntimeEnvironment(
  source: Record<string, unknown>,
  readSecretFile?: FileSecretReader,
): Record<string, unknown> {
  try {
    const resolved = resolveFileSecrets(source, readSecretFile);
    const databaseEnvironment = resolveDatabaseConfiguration(
      resolved.environment,
      resolved.databasePassword,
    );
    const validation = envValidationSchema.validate(databaseEnvironment, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: true,
    });
    if (validation.error) {
      return invalidConfiguration();
    }
    return validation.value as Record<string, unknown>;
  } catch {
    return invalidConfiguration();
  }
}

function clearRuntimeSecretSourceEnvironment(): void {
  for (const key of RUNTIME_SECRET_SOURCE_KEYS) {
    delete process.env[key];
  }
}

export function createRuntimeConfigurationLoader(
  readSecretFile?: FileSecretReader,
): () => Record<string, unknown> {
  return () => {
    const configuration = validateRuntimeEnvironment(
      { ...process.env },
      readSecretFile,
    );
    clearRuntimeSecretSourceEnvironment();
    return configuration;
  };
}
