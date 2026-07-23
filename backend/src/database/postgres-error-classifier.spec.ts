import { DatabaseError } from 'pg';
import {
  classifyPostgresError,
  PostgresErrorCategory,
} from './postgres-error-classifier';

describe('classifyPostgresError', () => {
  it.each(
    [
      ['23505', 'unique_violation'],
      ['23503', 'foreign_key_violation'],
      ['23514', 'check_violation'],
      ['23502', 'not_null_violation'],
      ['22P02', 'invalid_text_representation'],
      ['40001', 'serialization_failure'],
      ['40P01', 'deadlock_detected'],
      ['55000', 'object_not_in_prerequisite_state'],
      ['42501', 'insufficient_privilege'],
      ['57014', 'query_canceled'],
      ['57P01', 'admin_shutdown'],
    ] as const satisfies ReadonlyArray<
      readonly [string, PostgresErrorCategory]
    >,
  )('classifies SQLSTATE %s as %s', (code, category) => {
    expect(classifyPostgresError({ code })).toEqual({
      kind: 'postgres_error',
      category,
      metadata: { code },
    });
  });

  it.each(['08006', '08001', '08P01'])(
    'classifies SQLSTATE %s as a connection exception',
    (code) => {
      expect(classifyPostgresError({ code })).toEqual({
        kind: 'postgres_error',
        category: 'connection_exception',
        metadata: { code },
      });
    },
  );

  it('does not mistake a similar SQLSTATE for a connection exception', () => {
    expect(classifyPostgresError({ code: '18006' })).toEqual({
      kind: 'postgres_error',
      category: 'unknown_postgres_error',
      metadata: { code: '18006' },
    });
  });

  it('classifies an installed pg DatabaseError by structured fields', () => {
    const error = new DatabaseError('duplicate secret value', 0, 'error');
    error.code = '23505';
    error.constraint = 'external_identity_lookup_digests_global_key';

    expect(classifyPostgresError(error)).toEqual({
      kind: 'postgres_error',
      category: 'unique_violation',
      metadata: {
        code: '23505',
        constraint: 'external_identity_lookup_digests_global_key',
      },
    });
  });

  it('preserves only allowed structured metadata', () => {
    const error = {
      code: '23505',
      constraint: 'authentication_operations_idempotency_key_key',
      schema: 'backend_auth',
      table: 'authentication_operations',
      column: 'idempotency_key',
      message: 'duplicate OTP 123456',
      detail: 'digest=secret-digest',
      hint: 'retry with another credential',
      where: 'secret trigger context',
      query: 'insert into secret values ($1)',
      parameters: ['telegram-subject'],
      cause: new Error('credential material'),
      arbitrary: 'raw PostgreSQL row',
    };

    const classified = classifyPostgresError(error);

    expect(classified).toEqual({
      kind: 'postgres_error',
      category: 'unique_violation',
      metadata: {
        code: '23505',
        constraint: 'authentication_operations_idempotency_key_key',
        schema: 'backend_auth',
        table: 'authentication_operations',
        column: 'idempotency_key',
      },
    });
    expect(JSON.stringify(classified)).not.toContain('123456');
    expect(JSON.stringify(classified)).not.toContain('secret-digest');
    expect(JSON.stringify(classified)).not.toContain('telegram-subject');
    expect(JSON.stringify(classified)).not.toContain('credential material');
  });

  it('omits absent and malformed metadata instead of stringifying it', () => {
    expect(
      classifyPostgresError({
        code: '23505',
        constraint: undefined,
        schema: null,
        table: 42,
        column: 'otp subject',
      }),
    ).toEqual({
      kind: 'postgres_error',
      category: 'unique_violation',
      metadata: { code: '23505' },
    });
  });

  it('does not reveal the message of an ordinary Error', () => {
    const classified = classifyPostgresError(
      new Error('OTP 123456 and telegram-subject'),
    );

    expect(classified).toEqual({ kind: 'non_postgres_error' });
    expect(JSON.stringify(classified)).not.toContain('123456');
    expect(JSON.stringify(classified)).not.toContain('telegram-subject');
  });

  it.each([
    ['string', '23505'],
    ['number', 23505],
    ['null', null],
    ['array', [{ code: '23505' }]],
    ['object without SQLSTATE', { constraint: 'accounts_pkey' }],
    ['numeric SQLSTATE', { code: 23505 }],
    ['short SQLSTATE', { code: '2350' }],
    ['long SQLSTATE', { code: '235050' }],
    ['lowercase SQLSTATE', { code: '22p02' }],
  ])('handles %s as a non-PostgreSQL error', (_case, error) => {
    expect(classifyPostgresError(error)).toEqual({
      kind: 'non_postgres_error',
    });
  });

  it('classifies an unknown SQLSTATE as an unknown PostgreSQL error', () => {
    expect(
      classifyPostgresError({
        code: 'P0001',
        message: 'BACKEND_AUTH_TRIGGER_IDENTIFIER',
      }),
    ).toEqual({
      kind: 'postgres_error',
      category: 'unknown_postgres_error',
      metadata: { code: 'P0001' },
    });
  });

  it('keeps SQLSTATE 22023 as an unknown PostgreSQL error', () => {
    expect(classifyPostgresError({ code: '22023' })).toEqual({
      kind: 'postgres_error',
      category: 'unknown_postgres_error',
      metadata: { code: '22023' },
    });
  });

  it('does not mutate the original error object', () => {
    const error = Object.freeze({
      code: '23514',
      constraint: 'accounts_status_check',
      detail: 'secret row value',
    });
    const snapshot = { ...error };

    classifyPostgresError(error);

    expect(error).toEqual(snapshot);
  });
});
