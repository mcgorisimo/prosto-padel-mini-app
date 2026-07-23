const CANONICAL_DECIMAL_PATTERN = /^(?:0|-?[1-9][0-9]*)$/u;
const LOWERCASE_DIGEST_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const POSTGRES_DIGEST_BYTE_LENGTH = 32;

export type PostgresCodecFailure =
  | 'bigint_format'
  | 'bigint_range'
  | 'bigint_negative'
  | 'bytea_digest_buffer'
  | 'bytea_digest_hex';

const POSTGRES_CODEC_ERROR_MESSAGES: Readonly<
  Record<PostgresCodecFailure, string>
> = Object.freeze({
  bigint_format:
    'Invalid persisted PostgreSQL bigint: expected a canonical decimal string',
  bigint_range:
    'Invalid persisted PostgreSQL bigint: outside the safe integer range',
  bigint_negative:
    'Invalid persisted PostgreSQL bigint: expected a non-negative value',
  bytea_digest_buffer:
    'Invalid persisted PostgreSQL bytea digest: expected a 32-byte Buffer',
  bytea_digest_hex:
    'Invalid PostgreSQL bytea digest encoding: expected 64 lowercase hexadecimal characters',
});

export class PostgresCodecError extends Error {
  readonly name = 'PostgresCodecError';

  constructor(readonly failure: PostgresCodecFailure) {
    super(POSTGRES_CODEC_ERROR_MESSAGES[failure]);
  }
}

export function decodePostgresBigint(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !CANONICAL_DECIMAL_PATTERN.test(value)
  ) {
    throw new PostgresCodecError('bigint_format');
  }

  const parsed = BigInt(value);
  if (parsed < MIN_SAFE_BIGINT || parsed > MAX_SAFE_BIGINT) {
    throw new PostgresCodecError('bigint_range');
  }

  return Number(parsed);
}

export function decodePostgresNonNegativeBigint(value: unknown): number {
  const decoded = decodePostgresBigint(value);
  if (decoded < 0) {
    throw new PostgresCodecError('bigint_negative');
  }

  return decoded;
}

export function decodePostgresByteaDigest(value: unknown): string {
  if (
    !Buffer.isBuffer(value) ||
    value.length !== POSTGRES_DIGEST_BYTE_LENGTH
  ) {
    throw new PostgresCodecError('bytea_digest_buffer');
  }

  return value.toString('hex');
}

export function encodePostgresByteaDigest(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    !LOWERCASE_DIGEST_HEX_PATTERN.test(value)
  ) {
    throw new PostgresCodecError('bytea_digest_hex');
  }

  return Buffer.from(value, 'hex');
}
