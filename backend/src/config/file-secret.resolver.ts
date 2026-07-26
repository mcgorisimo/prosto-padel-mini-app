import { readFileSync } from 'node:fs';

export const BACKEND_RUNTIME_CONFIGURATION_ERROR =
  'Backend runtime configuration is invalid';
export const FILE_SECRET_MAX_UTF8_BYTES = 4_096;

export const FILE_SECRET_KEYS = Object.freeze({
  databasePassword: 'DATABASE_PASSWORD_FILE',
  telegramBotToken: 'TELEGRAM_BOT_TOKEN_FILE',
  telegramLookupPepper:
    'TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64_FILE',
  telegramWorkflowHmac:
    'TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64_FILE',
});

const DIRECT_SECRET_KEYS = Object.freeze({
  [FILE_SECRET_KEYS.telegramBotToken]: 'TELEGRAM_BOT_TOKEN',
  [FILE_SECRET_KEYS.telegramLookupPepper]:
    'TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64',
  [FILE_SECRET_KEYS.telegramWorkflowHmac]:
    'TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64',
});

const ALLOWED_FILE_KEYS = new Set<string>(Object.values(FILE_SECRET_KEYS));
const NON_SECRET_FILE_SUFFIX_KEYS = new Set(['BACKEND_IGNORE_ENV_FILE']);
const TRAILING_LINE_ENDINGS = /(?:(?:\r\n)|\r|\n)+$/u;

export type FileSecretReader = (path: string) => Buffer | string;

export type ResolvedFileSecrets = Readonly<{
  environment: Record<string, unknown>;
  databasePassword?: string;
}>;

export class BackendRuntimeConfigurationError extends Error {
  readonly name = 'BackendRuntimeConfigurationError';

  constructor() {
    super(BACKEND_RUNTIME_CONFIGURATION_ERROR);
  }
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

function invalidConfiguration(): never {
  throw new BackendRuntimeConfigurationError();
}

function defaultFileSecretReader(path: string): Buffer {
  return readFileSync(path);
}

function decodeUtf8(value: Buffer | string): string {
  if (typeof value === 'string') {
    if (
      Buffer.byteLength(value, 'utf8') > FILE_SECRET_MAX_UTF8_BYTES
    ) {
      return invalidConfiguration();
    }
    return value;
  }

  if (value.length > FILE_SECRET_MAX_UTF8_BYTES) {
    return invalidConfiguration();
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    return invalidConfiguration();
  }
}

function readSecret(
  pathValue: unknown,
  readSecretFile: FileSecretReader,
): string {
  if (
    typeof pathValue !== 'string' ||
    pathValue.length === 0 ||
    pathValue.trim() !== pathValue
  ) {
    return invalidConfiguration();
  }

  let raw: Buffer | string;
  try {
    raw = readSecretFile(pathValue);
  } catch {
    return invalidConfiguration();
  }

  const secret = decodeUtf8(raw).replace(TRAILING_LINE_ENDINGS, '');
  if (
    secret.length === 0 ||
    secret.trim().length === 0 ||
    Buffer.byteLength(secret, 'utf8') > FILE_SECRET_MAX_UTF8_BYTES
  ) {
    return invalidConfiguration();
  }

  return secret;
}

function rejectUnsupportedFileKeys(
  source: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.keys(source)) {
    if (
      key.endsWith('_FILE') &&
      !ALLOWED_FILE_KEYS.has(key) &&
      !NON_SECRET_FILE_SUFFIX_KEYS.has(key)
    ) {
      invalidConfiguration();
    }
  }
}

export function resolveFileSecrets(
  source: Readonly<Record<string, unknown>>,
  readSecretFile: FileSecretReader = defaultFileSecretReader,
): ResolvedFileSecrets {
  rejectUnsupportedFileKeys(source);
  const environment: Record<string, unknown> = { ...source };

  for (const [fileKey, directKey] of Object.entries(
    DIRECT_SECRET_KEYS,
  )) {
    if (!hasSuppliedKey(source, fileKey)) {
      continue;
    }
    if (hasSuppliedKey(source, directKey)) {
      return invalidConfiguration();
    }

    environment[directKey] = readSecret(
      source[fileKey],
      readSecretFile,
    );
    delete environment[fileKey];
  }

  let databasePassword: string | undefined;
  if (hasSuppliedKey(source, FILE_SECRET_KEYS.databasePassword)) {
    databasePassword = readSecret(
      source[FILE_SECRET_KEYS.databasePassword],
      readSecretFile,
    );
    delete environment[FILE_SECRET_KEYS.databasePassword];
  }

  return Object.freeze({
    environment,
    ...(databasePassword === undefined ? {} : { databasePassword }),
  });
}
