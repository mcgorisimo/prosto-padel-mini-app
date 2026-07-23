const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/u;
const SAFE_POSTGRES_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u;

export type PostgresErrorCategory =
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'check_violation'
  | 'not_null_violation'
  | 'invalid_text_representation'
  | 'serialization_failure'
  | 'deadlock_detected'
  | 'object_not_in_prerequisite_state'
  | 'insufficient_privilege'
  | 'query_canceled'
  | 'admin_shutdown'
  | 'connection_exception'
  | 'unknown_postgres_error';

export interface PostgresErrorMetadata {
  readonly code: string;
  readonly constraint?: string;
  readonly schema?: string;
  readonly table?: string;
  readonly column?: string;
}

export interface ClassifiedPostgresError {
  readonly kind: 'postgres_error';
  readonly category: PostgresErrorCategory;
  readonly metadata: PostgresErrorMetadata;
}

export interface NonPostgresError {
  readonly kind: 'non_postgres_error';
}

export type PostgresErrorClassification =
  | ClassifiedPostgresError
  | NonPostgresError;

const NON_POSTGRES_ERROR: NonPostgresError = Object.freeze({
  kind: 'non_postgres_error',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSqlState(value: unknown): value is string {
  return typeof value === 'string' && SQLSTATE_PATTERN.test(value);
}

function readSafeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' &&
    SAFE_POSTGRES_IDENTIFIER_PATTERN.test(value)
    ? value
    : undefined;
}

function classifySqlState(code: string): PostgresErrorCategory {
  if (code.startsWith('08')) {
    return 'connection_exception';
  }

  switch (code) {
    case '23505':
      return 'unique_violation';
    case '23503':
      return 'foreign_key_violation';
    case '23514':
      return 'check_violation';
    case '23502':
      return 'not_null_violation';
    case '22P02':
      return 'invalid_text_representation';
    case '40001':
      return 'serialization_failure';
    case '40P01':
      return 'deadlock_detected';
    case '55000':
      return 'object_not_in_prerequisite_state';
    case '42501':
      return 'insufficient_privilege';
    case '57014':
      return 'query_canceled';
    case '57P01':
      return 'admin_shutdown';
    default:
      return 'unknown_postgres_error';
  }
}

export function classifyPostgresError(
  error: unknown,
): PostgresErrorClassification {
  if (!isRecord(error) || !isSqlState(error.code)) {
    return NON_POSTGRES_ERROR;
  }

  const constraint = readSafeIdentifier(error.constraint);
  const schema = readSafeIdentifier(error.schema);
  const table = readSafeIdentifier(error.table);
  const column = readSafeIdentifier(error.column);
  const metadata: PostgresErrorMetadata = Object.freeze({
    code: error.code,
    ...(constraint === undefined ? {} : { constraint }),
    ...(schema === undefined ? {} : { schema }),
    ...(table === undefined ? {} : { table }),
    ...(column === undefined ? {} : { column }),
  });

  return Object.freeze({
    kind: 'postgres_error',
    category: classifySqlState(error.code),
    metadata,
  });
}
