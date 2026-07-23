import {
  decodePostgresBigint,
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
  PostgresCodecError,
} from './postgres-codecs';

describe('PostgreSQL bigint codecs', () => {
  it.each([
    ['0', 0],
    ['42', 42],
    [Number.MAX_SAFE_INTEGER.toString(), Number.MAX_SAFE_INTEGER],
    [Number.MIN_SAFE_INTEGER.toString(), Number.MIN_SAFE_INTEGER],
  ])('decodes canonical safe bigint %s', (persisted, expected) => {
    expect(decodePostgresBigint(persisted)).toBe(expected);
  });

  it.each([
    ['empty string', ''],
    ['surrounding whitespace', ' 1'],
    ['explicit plus sign', '+1'],
    ['leading zero', '01'],
    ['negative leading zero', '-01'],
    ['negative zero', '-0'],
    ['fraction', '1.5'],
    ['exponent notation', '1e3'],
    ['NaN text', 'NaN'],
    ['above safe range', '9007199254740992'],
    ['below safe range', '-9007199254740992'],
    ['runtime number', 1],
    ['runtime null', null],
  ])('rejects %s', (_case, persisted) => {
    expect(() => decodePostgresBigint(persisted)).toThrow(
      PostgresCodecError,
    );
  });

  it.each([
    ['0', 0],
    ['42', 42],
    [Number.MAX_SAFE_INTEGER.toString(), Number.MAX_SAFE_INTEGER],
  ])('decodes non-negative bigint %s', (persisted, expected) => {
    expect(decodePostgresNonNegativeBigint(persisted)).toBe(expected);
  });

  it('rejects a negative bigint where a non-negative value is required', () => {
    expect(() => decodePostgresNonNegativeBigint('-1')).toThrow(
      new PostgresCodecError('bigint_negative'),
    );
  });
});

describe('PostgreSQL bytea digest codecs', () => {
  it('decodes a 32-byte Buffer as lowercase hexadecimal', () => {
    const persisted = Buffer.alloc(32, 0xab);

    expect(decodePostgresByteaDigest(persisted)).toBe('ab'.repeat(32));
  });

  it('encodes lowercase hexadecimal into an equal new Buffer', () => {
    const digest = '12'.repeat(32);

    const first = encodePostgresByteaDigest(digest);
    const second = encodePostgresByteaDigest(digest);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('returns Buffers with independent backing storage', () => {
    const digest = '34'.repeat(32);
    const first = encodePostgresByteaDigest(digest);
    const second = encodePostgresByteaDigest(digest);

    first[0] = 0;

    expect(first).not.toBe(second);
    expect(second).toEqual(Buffer.alloc(32, 0x34));
  });

  it('preserves digest content across a round trip', () => {
    const persisted = Buffer.from(
      Array.from({ length: 32 }, (_, index) => index),
    );

    const roundTrip = encodePostgresByteaDigest(
      decodePostgresByteaDigest(persisted),
    );

    expect(roundTrip).toEqual(persisted);
    expect(roundTrip).not.toBe(persisted);
  });

  it('does not expose the original mutable Buffer', () => {
    const persisted = Buffer.alloc(32, 0xcd);
    const decoded = decodePostgresByteaDigest(persisted);
    const encoded = encodePostgresByteaDigest(decoded);

    encoded[0] = 0;

    expect(persisted[0]).toBe(0xcd);
  });

  it('keeps decoded hexadecimal unchanged when the source Buffer mutates', () => {
    const persisted = Buffer.alloc(32, 0xef);
    const decoded = decodePostgresByteaDigest(persisted);

    persisted[0] = 0;

    expect(decoded).toBe('ef'.repeat(32));
  });

  it.each([
    ['empty Buffer', Buffer.alloc(0)],
    ['short Buffer', Buffer.alloc(31)],
    ['long Buffer', Buffer.alloc(33)],
    ['runtime string', 'ab'.repeat(32)],
    ['runtime null', null],
  ])('rejects %s', (_case, persisted) => {
    expect(() => decodePostgresByteaDigest(persisted)).toThrow(
      PostgresCodecError,
    );
  });

  it.each([
    ['empty string', ''],
    ['short hex', 'a'.repeat(62)],
    ['long hex', 'a'.repeat(66)],
    ['odd-length hex', 'a'.repeat(63)],
    ['uppercase hex', 'A'.repeat(64)],
    ['bytea prefix', `\\x${'a'.repeat(64)}`],
    ['surrounding whitespace', `${'a'.repeat(64)} `],
    ['non-hex characters', 'g'.repeat(64)],
    ['runtime Buffer', Buffer.alloc(32)],
    ['runtime null', null],
  ])('rejects %s', (_case, digest) => {
    expect(() => encodePostgresByteaDigest(digest)).toThrow(
      PostgresCodecError,
    );
  });

  it('does not include rejected digest or secret material in errors', () => {
    const rejectedDigest = 'A'.repeat(64);
    const secret = Buffer.from('plaintext-otp');

    let digestError: unknown;
    let bufferError: unknown;

    try {
      encodePostgresByteaDigest(rejectedDigest);
    } catch (error) {
      digestError = error;
    }

    try {
      decodePostgresByteaDigest(secret);
    } catch (error) {
      bufferError = error;
    }

    expect(digestError).toBeInstanceOf(PostgresCodecError);
    expect(bufferError).toBeInstanceOf(PostgresCodecError);
    expect((digestError as Error).message).not.toContain(rejectedDigest);
    expect((bufferError as Error).message).not.toContain(
      secret.toString('utf8'),
    );
    expect((bufferError as Error).message).not.toContain(
      secret.toString('hex'),
    );
  });
});
