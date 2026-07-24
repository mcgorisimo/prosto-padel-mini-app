import { QueryResult, QueryResultRow } from 'pg';
import {
  ExternalIdentityLookupDigest,
  ExternalIdentityNamespace,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  AuthenticationIdempotencyKey,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationRequestDigest,
  UnixEpochSeconds,
  unixEpochSeconds,
} from '../auth/auth.types';
import {
  SecurityAuditEvent,
  SecurityAuditEventId,
  SecurityAuditEventType,
} from '../auth/security-audit.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { PostgresTelegramAuthenticationOperationRepository } from './postgres-telegram-authentication-operation.repository';
import { PostgresTransaction } from './postgres-transaction';
import {
  SecurityAuditAppendResult,
  SecurityAuditPersistenceError,
  SecurityAuditRepository,
} from './security-audit.repository';
import {
  PendingTelegramAuthenticationOperation,
  PersistPendingTelegramAuthenticationInput,
  TelegramAuthenticationOperationPersistenceError,
  TelegramAuthenticationOperationPersistenceFailure,
} from './telegram-authentication-operation.repository';

const OPERATION_ID = deterministicUuid(
  'telegram-auth-operation',
) as AuthenticationOperationId;
const OTHER_OPERATION_ID = deterministicUuid(
  'telegram-auth-operation-other',
) as AuthenticationOperationId;
const THIRD_OPERATION_ID = deterministicUuid(
  'telegram-auth-operation-third',
) as AuthenticationOperationId;
const OTP_CHALLENGE_ID = deterministicUuid(
  'telegram-auth-operation-otp-challenge',
);
const AUDIT_EVENT_ID = deterministicUuid(
  'telegram-auth-operation-audit',
) as SecurityAuditEventId;
const LEAK_AUDIT_EVENT_ID = deterministicUuid(
  'telegram-auth-operation-leak-audit',
) as SecurityAuditEventId;
const NAMESPACE = externalIdentityNamespace('telegram:bot:123456');
const LOOKUP_DIGEST = externalIdentityLookupDigest('a'.repeat(64));
const OTHER_LOOKUP_DIGEST = externalIdentityLookupDigest('b'.repeat(64));
const PROOF_FINGERPRINT =
  'c'.repeat(64) as AuthenticationProofFingerprint;
const OTHER_PROOF_FINGERPRINT =
  'd'.repeat(64) as AuthenticationProofFingerprint;
const THIRD_PROOF_FINGERPRINT =
  'e'.repeat(64) as AuthenticationProofFingerprint;
const IDEMPOTENCY_KEY =
  'telegram-auth-idempotency-key' as AuthenticationIdempotencyKey;
const OTHER_IDEMPOTENCY_KEY =
  'telegram-auth-idempotency-key-other' as AuthenticationIdempotencyKey;
const THIRD_IDEMPOTENCY_KEY =
  'telegram-auth-idempotency-key-third' as AuthenticationIdempotencyKey;
const REQUEST_DIGEST =
  'telegram-auth-request-digest' as AuthenticationRequestDigest;
const OTHER_REQUEST_DIGEST =
  'telegram-auth-request-digest-other' as AuthenticationRequestDigest;
const CREATED_AT = unixEpochSeconds(1_000);
const EXPIRES_AT = unixEpochSeconds(1_300);
const CONSUMED_AT = unixEpochSeconds(1_010);
const PROOF_EXPIRES_AT = unixEpochSeconds(1_120);
const AUDIT_OCCURRED_AT = unixEpochSeconds(1_011);

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function queryResult<Row extends QueryResultRow>(
  rows: readonly Row[] = [],
): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: [],
  };
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly responses: readonly (
      | QueryResult<QueryResultRow>
      | unknown
    )[],
    private readonly order: string[] = [],
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    this.order.push(`query:${this.calls.length}`);
    const response = this.responses[this.calls.length - 1];
    if (response instanceof Error || !isQueryResult(response)) {
      throw response;
    }
    return response as QueryResult<Row>;
  }
}

function isQueryResult(
  value: unknown,
): value is QueryResult<QueryResultRow> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rows' in value &&
    Array.isArray(value.rows)
  );
}

interface AuditCall {
  readonly transaction: PostgresTransaction;
  readonly event: SecurityAuditEvent<SecurityAuditEventType>;
}

class FakeSecurityAuditRepository implements SecurityAuditRepository {
  readonly calls: AuditCall[] = [];

  constructor(
    private readonly response:
      | SecurityAuditAppendResult
      | SecurityAuditPersistenceError = { status: 'appended' },
    private readonly order: string[] = [],
  ) {}

  async append<EventType extends SecurityAuditEventType>(
    transaction: PostgresTransaction,
    event: SecurityAuditEvent<EventType>,
  ): Promise<SecurityAuditAppendResult> {
    this.calls.push({
      transaction,
      event: event as SecurityAuditEvent<SecurityAuditEventType>,
    });
    this.order.push('audit');
    if (this.response instanceof SecurityAuditPersistenceError) {
      throw this.response;
    }
    return this.response;
  }
}

function validOperation(): PendingTelegramAuthenticationOperation {
  return {
    operationId: OPERATION_ID,
    intent: 'sign_in',
    identityKey: {
      provider: 'telegram',
      namespace: NAMESPACE,
      lookup: {
        kind: 'lookup_digest',
        digest: LOOKUP_DIGEST,
      },
    },
    proofReference: {
      type: 'telegram_proof',
      proofFingerprint: PROOF_FINGERPRINT,
    },
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestDigest: REQUEST_DIGEST,
    status: 'pending',
  };
}

function validInput(): PersistPendingTelegramAuthenticationInput {
  return {
    operation: validOperation(),
    consumption: {
      outcome: 'first_use',
      proofFingerprint: PROOF_FINGERPRINT,
      proofExpiresAt: PROOF_EXPIRES_AT,
      intent: 'sign_in',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestDigest: REQUEST_DIGEST,
      operationId: OPERATION_ID,
      consumedAt: CONSUMED_AT,
    },
    audit: {
      eventId: AUDIT_EVENT_ID,
      occurredAt: AUDIT_OCCURRED_AT,
    },
  };
}

function operationRow(
  overrides: Readonly<Record<string, unknown>> = {},
): QueryResultRow {
  return {
    id: OPERATION_ID,
    intent: 'sign_in',
    identity_provider: 'telegram',
    identity_namespace: NAMESPACE,
    identity_lookup_digest: Buffer.from(LOOKUP_DIGEST, 'hex'),
    proof_type: 'telegram_proof',
    telegram_proof_fingerprint: Buffer.from(
      PROOF_FINGERPRINT,
      'hex',
    ),
    otp_challenge_id: null,
    created_at: CREATED_AT.toString(10),
    expires_at: EXPIRES_AT.toString(10),
    idempotency_key: IDEMPOTENCY_KEY,
    request_digest: REQUEST_DIGEST,
    status: 'pending',
    resolution_type: null,
    resolution_account_id: null,
    resolution_account_status: null,
    resolution_initial_role: null,
    resolution_reason: null,
    failure_reason: null,
    terminal_command_id: null,
    terminal_command_type: null,
    terminal_applied_at: null,
    ...overrides,
  };
}

function consumptionRow(
  overrides: Readonly<Record<string, unknown>> = {},
): QueryResultRow {
  return {
    proof_fingerprint: Buffer.from(PROOF_FINGERPRINT, 'hex'),
    proof_expires_at: PROOF_EXPIRES_AT.toString(10),
    intent: 'sign_in',
    idempotency_key: IDEMPOTENCY_KEY,
    request_digest: REQUEST_DIGEST,
    operation_id: OPERATION_ID,
    consumed_at: CONSUMED_AT.toString(10),
    ...overrides,
  };
}

function createdTransaction(
  order: string[] = [],
): FakeTransaction {
  return new FakeTransaction(
    [
      queryResult([{ id: OPERATION_ID }]),
      queryResult(),
    ],
    order,
  );
}

function conflictTransaction(
  operations: readonly QueryResultRow[] = [operationRow()],
  consumptions: readonly QueryResultRow[] = [consumptionRow()],
  order: string[] = [],
): FakeTransaction {
  return new FakeTransaction(
    [
      queryResult(),
      queryResult(operations),
      queryResult(consumptions),
    ],
    order,
  );
}

function repository(
  transaction: FakeTransaction,
  audit = new FakeSecurityAuditRepository(),
): {
  readonly transaction: FakeTransaction;
  readonly audit: FakeSecurityAuditRepository;
  readonly repository: PostgresTelegramAuthenticationOperationRepository;
} {
  return {
    transaction,
    audit,
    repository: new PostgresTelegramAuthenticationOperationRepository(
      audit,
    ),
  };
}

function unsafeInput(
  mutate: (value: Record<string, unknown>) => void,
): PersistPendingTelegramAuthenticationInput {
  const input = validInput();
  const value = {
    operation: {
      ...input.operation,
      identityKey: {
        ...input.operation.identityKey,
        lookup: { ...input.operation.identityKey.lookup },
      },
      proofReference: { ...input.operation.proofReference },
    },
    consumption: { ...input.consumption },
    audit: { ...input.audit },
  } as unknown as Record<string, unknown>;
  mutate(value);
  return value as unknown as PersistPendingTelegramAuthenticationInput;
}

function operationOf(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return value.operation as Record<string, unknown>;
}

function consumptionOf(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return value.consumption as Record<string, unknown>;
}

function expectPersistenceReason(
  action: Promise<unknown>,
  reason: TelegramAuthenticationOperationPersistenceFailure,
): Promise<void> {
  return expect(action).rejects.toMatchObject({
    name: 'TelegramAuthenticationOperationPersistenceError',
    message: 'Telegram authentication operation persistence failed',
    reason,
  });
}

function normalizedSql(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

interface ParsedInsert {
  readonly columns: readonly string[];
  readonly values: readonly string[];
}

function parseInsert(text: string, table: string): ParsedInsert {
  const match = normalizedSql(text).match(
    new RegExp(
      `INSERT INTO ${table} \\((.*?)\\) VALUES \\((.*?)\\)(?: |$)`,
      'u',
    ),
  );
  if (match === null) {
    throw new Error('Expected static INSERT statement');
  }
  return {
    columns: match[1].split(',').map((column) => column.trim()),
    values: match[2].split(',').map((value) => value.trim()),
  };
}

describe('PostgresTelegramAuthenticationOperationRepository', () => {
  describe('input boundary', () => {
    it('forbids canonical subjects in the persistence subtype', () => {
      const canonicalSubject =
        trustProviderCanonicalizedExternalIdentitySubject('123456');
      const identityKey: PendingTelegramAuthenticationOperation['identityKey'] =
        {
          provider: 'telegram',
          namespace: NAMESPACE,
          lookup: {
            // @ts-expect-error Persistence accepts only lookup_digest.
            kind: 'canonical_subject',
            subject: canonicalSubject,
          },
        };
      expect(identityKey.lookup.kind).toBe('canonical_subject');
    });

    it('accepts a digest-only Telegram identity and rejects canonical subjects at runtime', async () => {
      const valid = repository(createdTransaction());
      await expect(
        valid.repository.persistPending(valid.transaction, validInput()),
      ).resolves.toEqual({
        outcome: 'created',
        operationId: OPERATION_ID,
      });

      const invalidTransaction = createdTransaction();
      const invalid = repository(invalidTransaction);
      const canonical = unsafeInput((value) => {
        const operation = operationOf(value);
        const identityKey = operation.identityKey as Record<
          string,
          unknown
        >;
        identityKey.lookup = {
          kind: 'canonical_subject',
          subject:
            trustProviderCanonicalizedExternalIdentitySubject('123456'),
        };
      });
      await expectPersistenceReason(
        invalid.repository.persistPending(
          invalid.transaction,
          canonical,
        ),
        'invalid_input',
      );
      expect(invalidTransaction.calls).toHaveLength(0);
      expect(invalid.audit.calls).toHaveLength(0);
    });

    it.each([
      [
        'operation ID',
        (value: Record<string, unknown>) => {
          consumptionOf(value).operationId = OTHER_OPERATION_ID;
        },
      ],
      [
        'intent',
        (value: Record<string, unknown>) => {
          consumptionOf(value).intent = 'sign_up';
        },
      ],
      [
        'proof fingerprint',
        (value: Record<string, unknown>) => {
          consumptionOf(value).proofFingerprint =
            OTHER_PROOF_FINGERPRINT;
        },
      ],
      [
        'idempotency key',
        (value: Record<string, unknown>) => {
          consumptionOf(value).idempotencyKey =
            OTHER_IDEMPOTENCY_KEY;
        },
      ],
      [
        'request digest',
        (value: Record<string, unknown>) => {
          consumptionOf(value).requestDigest = OTHER_REQUEST_DIGEST;
        },
      ],
    ])(
      'rejects a mismatched %s before SQL or audit',
      async (_label, mutate) => {
        const transaction = createdTransaction();
        const subject = repository(transaction);
        await expectPersistenceReason(
          subject.repository.persistPending(
            transaction,
            unsafeInput(mutate),
          ),
          'invalid_input',
        );
        expect(transaction.calls).toHaveLength(0);
        expect(subject.audit.calls).toHaveLength(0);
      },
    );

    it.each([
      [
        'operation UUID',
        (value: Record<string, unknown>) => {
          operationOf(value).operationId = 'not-a-uuid';
        },
      ],
      [
        'lookup digest',
        (value: Record<string, unknown>) => {
          const operation = operationOf(value);
          const identityKey = operation.identityKey as Record<
            string,
            unknown
          >;
          const lookup = identityKey.lookup as Record<string, unknown>;
          lookup.digest = 'not-a-digest';
        },
      ],
      [
        'proof fingerprint',
        (value: Record<string, unknown>) => {
          operationOf(value).proofReference = {
            type: 'telegram_proof',
            proofFingerprint: 'not-a-fingerprint',
          };
        },
      ],
      [
        'timestamp',
        (value: Record<string, unknown>) => {
          operationOf(value).createdAt = -1;
        },
      ],
      [
        'operation window',
        (value: Record<string, unknown>) => {
          operationOf(value).expiresAt = CREATED_AT;
        },
      ],
      [
        'intent',
        (value: Record<string, unknown>) => {
          operationOf(value).intent = 'unknown';
        },
      ],
      [
        'provider',
        (value: Record<string, unknown>) => {
          const operation = operationOf(value);
          const identityKey = operation.identityKey as Record<
            string,
            unknown
          >;
          identityKey.provider = 'apple';
        },
      ],
      [
        'namespace',
        (value: Record<string, unknown>) => {
          const operation = operationOf(value);
          const identityKey = operation.identityKey as Record<
            string,
            unknown
          >;
          identityKey.namespace = 'bad\u0000namespace';
        },
      ],
      [
        'consumption window',
        (value: Record<string, unknown>) => {
          consumptionOf(value).proofExpiresAt = CONSUMED_AT;
        },
      ],
      [
        'terminal field',
        (value: Record<string, unknown>) => {
          operationOf(value).resolution = { type: 'existing_account' };
        },
      ],
    ])(
      'rejects malformed %s before every side effect',
      async (_label, mutate) => {
        const transaction = createdTransaction();
        const subject = repository(transaction);
        await expectPersistenceReason(
          subject.repository.persistPending(
            transaction,
            unsafeInput(mutate),
          ),
          'invalid_input',
        );
        expect(transaction.calls).toHaveLength(0);
        expect(subject.audit.calls).toHaveLength(0);
      },
    );
  });

  describe('created path', () => {
    it('uses the passed transaction in operation, consumption, audit order', async () => {
      const order: string[] = [];
      const transaction = createdTransaction(order);
      const audit = new FakeSecurityAuditRepository(
        { status: 'appended' },
        order,
      );
      const subject = repository(transaction, audit);

      await subject.repository.persistPending(transaction, validInput());

      expect(order).toEqual(['query:1', 'query:2', 'audit']);
      expect(transaction.calls).toHaveLength(2);
      expect(audit.calls[0].transaction).toBe(transaction);
      for (const call of transaction.calls) {
        expect(normalizedSql(call.text)).not.toMatch(
          /\b(?:BEGIN|COMMIT|ROLLBACK)\b/iu,
        );
      }
    });

    it('inserts only the twelve initial operation columns in exact order', async () => {
      const transaction = createdTransaction();
      const subject = repository(transaction);
      await subject.repository.persistPending(transaction, validInput());

      const call = transaction.calls[0];
      expect(
        parseInsert(
          call.text,
          'backend_auth.authentication_operations',
        ),
      ).toEqual({
        columns: [
          'id',
          'intent',
          'identity_provider',
          'identity_namespace',
          'identity_lookup_digest',
          'proof_type',
          'telegram_proof_fingerprint',
          'otp_challenge_id',
          'created_at',
          'expires_at',
          'idempotency_key',
          'request_digest',
        ],
        values: [
          '$1',
          '$2',
          '$3',
          '$4',
          '$5',
          '$6',
          '$7',
          '$8',
          '$9',
          '$10',
          '$11',
          '$12',
        ],
      });
      expect(normalizedSql(call.text)).toContain(
        'ON CONFLICT DO NOTHING RETURNING id',
      );
      expect(normalizedSql(call.text)).not.toMatch(
        /\b(status|resolution_type|failure_reason|terminal_command_id)\b/u,
      );
      expect(call.values).toHaveLength(12);
      expect(call.values).toEqual([
        OPERATION_ID,
        'sign_in',
        'telegram',
        NAMESPACE,
        expect.any(Buffer),
        'telegram_proof',
        expect.any(Buffer),
        null,
        '1000',
        '1300',
        IDEMPOTENCY_KEY,
        REQUEST_DIGEST,
      ]);
      for (const value of [
        OPERATION_ID,
        LOOKUP_DIGEST,
        PROOF_FINGERPRINT,
        IDEMPOTENCY_KEY,
        REQUEST_DIGEST,
      ]) {
        expect(call.text).not.toContain(value);
      }
    });

    it('passes lookup digest and proof fingerprint as independent exact buffers', async () => {
      const transaction = createdTransaction();
      const subject = repository(transaction);
      await subject.repository.persistPending(transaction, validInput());

      const lookupBuffer = transaction.calls[0].values[4] as Buffer;
      const fingerprintBuffer = transaction.calls[0].values[6] as Buffer;
      const consumptionFingerprint =
        transaction.calls[1].values[0] as Buffer;
      expect(lookupBuffer).not.toBe(fingerprintBuffer);
      expect(fingerprintBuffer).not.toBe(consumptionFingerprint);
      expect(lookupBuffer.toString('hex')).toBe(LOOKUP_DIGEST);
      expect(fingerprintBuffer.toString('hex')).toBe(
        PROOF_FINGERPRINT,
      );
      expect(consumptionFingerprint.toString('hex')).toBe(
        PROOF_FINGERPRINT,
      );
      lookupBuffer[0] = 0xff;
      fingerprintBuffer[0] = 0xff;
      expect(consumptionFingerprint.toString('hex')).toBe(
        PROOF_FINGERPRINT,
      );
      expect(fingerprintBuffer.toString('hex')).toBe(
        `ff${PROOF_FINGERPRINT.slice(2)}`,
      );
      expect(LOOKUP_DIGEST).toBe('a'.repeat(64));
      expect(PROOF_FINGERPRINT).toBe('c'.repeat(64));
    });

    it('creates independent digest buffers across repeated calls', async () => {
      const firstTransaction = createdTransaction();
      const secondTransaction = createdTransaction();
      const audit = new FakeSecurityAuditRepository();
      const subject =
        new PostgresTelegramAuthenticationOperationRepository(audit);

      await subject.persistPending(firstTransaction, validInput());
      await subject.persistPending(secondTransaction, validInput());

      const firstBuffers = [
        firstTransaction.calls[0].values[4],
        firstTransaction.calls[0].values[6],
        firstTransaction.calls[1].values[0],
      ] as readonly Buffer[];
      const secondBuffers = [
        secondTransaction.calls[0].values[4],
        secondTransaction.calls[0].values[6],
        secondTransaction.calls[1].values[0],
      ] as readonly Buffer[];
      const expectedHex = [
        LOOKUP_DIGEST,
        PROOF_FINGERPRINT,
        PROOF_FINGERPRINT,
      ];

      for (let index = 0; index < firstBuffers.length; index += 1) {
        expect(firstBuffers[index]).not.toBe(secondBuffers[index]);
        expect(firstBuffers[index].toString('hex')).toBe(
          expectedHex[index],
        );
        expect(secondBuffers[index].toString('hex')).toBe(
          expectedHex[index],
        );
      }

      firstBuffers[0][0] = 0xff;
      firstBuffers[1][0] = 0xff;
      expect(firstBuffers[2].toString('hex')).toBe(PROOF_FINGERPRINT);
      for (let index = 0; index < secondBuffers.length; index += 1) {
        expect(secondBuffers[index].toString('hex')).toBe(
          expectedHex[index],
        );
      }
      expect(LOOKUP_DIGEST).toBe('a'.repeat(64));
      expect(PROOF_FINGERPRINT).toBe('c'.repeat(64));
    });

    it('inserts all seven immutable consumption columns without conflict suppression', async () => {
      const transaction = createdTransaction();
      const subject = repository(transaction);
      await subject.repository.persistPending(transaction, validInput());

      const call = transaction.calls[1];
      expect(
        parseInsert(
          call.text,
          'backend_auth.telegram_proof_consumptions',
        ),
      ).toEqual({
        columns: [
          'proof_fingerprint',
          'proof_expires_at',
          'intent',
          'idempotency_key',
          'request_digest',
          'operation_id',
          'consumed_at',
        ],
        values: ['$1', '$2', '$3', '$4', '$5', '$6', '$7'],
      });
      expect(normalizedSql(call.text)).not.toMatch(
        /\b(?:ON CONFLICT|UPDATE|DELETE)\b/iu,
      );
      expect(call.values).toEqual([
        expect.any(Buffer),
        '1120',
        'sign_in',
        IDEMPOTENCY_KEY,
        REQUEST_DIGEST,
        OPERATION_ID,
        '1010',
      ]);
      expect((call.values[0] as Buffer).toString('hex')).toBe(
        PROOF_FINGERPRINT,
      );
    });

    it('returns only created and operationId', async () => {
      const transaction = createdTransaction();
      const subject = repository(transaction);
      const result = await subject.repository.persistPending(
        transaction,
        validInput(),
      );
      expect(result).toEqual({
        outcome: 'created',
        operationId: OPERATION_ID,
      });
      expect(Object.keys(result).sort()).toEqual([
        'operationId',
        'outcome',
      ]);
    });
  });

  describe('conflict reread and classification', () => {
    it('rereads both tables sequentially without LIMIT or FOR UPDATE', async () => {
      const transaction = conflictTransaction();
      const subject = repository(transaction);
      await subject.repository.persistPending(transaction, validInput());

      expect(transaction.calls).toHaveLength(3);
      expect(normalizedSql(transaction.calls[1].text)).toContain(
        'FROM backend_auth.authentication_operations',
      );
      expect(normalizedSql(transaction.calls[2].text)).toContain(
        'FROM backend_auth.telegram_proof_consumptions',
      );
      for (const call of transaction.calls.slice(1)) {
        expect(normalizedSql(call.text)).not.toMatch(
          /\bLIMIT\s+1\b|\bFOR\s+UPDATE\b/iu,
        );
        expect(call.values).toHaveLength(3);
        expect(call.values[0]).toBe(OPERATION_ID);
        expect(call.values[1]).toBe(IDEMPOTENCY_KEY);
        expect((call.values[2] as Buffer).toString('hex')).toBe(
          PROOF_FINGERPRINT,
        );
      }
    });

    it('classifies a full match as an idempotent retry', async () => {
      const transaction = conflictTransaction();
      const subject = repository(transaction);
      await expect(
        subject.repository.persistPending(transaction, validInput()),
      ).resolves.toEqual({
        outcome: 'idempotent_retry',
        operationId: OPERATION_ID,
      });
      expect(transaction.calls).toHaveLength(3);
    });

    it('keeps exact retry priority after current proof TTL and does not compare persisted proof times', async () => {
      const transaction = conflictTransaction(
        [operationRow()],
        [
          consumptionRow({
            proof_expires_at: '1119',
            consumed_at: '1009',
          }),
        ],
      );
      const subject = repository(transaction);
      const input = validInput();
      const afterProofExpiry: PersistPendingTelegramAuthenticationInput = {
        ...input,
        audit: {
          ...input.audit,
          occurredAt: unixEpochSeconds(2_000),
        },
      };
      await expect(
        subject.repository.persistPending(
          transaction,
          afterProofExpiry,
        ),
      ).resolves.toEqual({
        outcome: 'idempotent_retry',
        operationId: OPERATION_ID,
      });
    });

    it('returns idempotency conflict when consumption is exact but lookup digest differs', async () => {
      const transaction = conflictTransaction(
        [
          operationRow({
            identity_lookup_digest: Buffer.from(
              OTHER_LOOKUP_DIGEST,
              'hex',
            ),
          }),
        ],
      );
      const subject = repository(transaction);
      await expect(
        subject.repository.persistPending(transaction, validInput()),
      ).resolves.toEqual({
        outcome: 'conflict',
        reason: 'idempotency_key_conflict',
      });
    });

    it.each([
      ['request digest', { request_digest: OTHER_REQUEST_DIGEST }],
      [
        'proof fingerprint',
        {
          telegram_proof_fingerprint: Buffer.from(
            OTHER_PROOF_FINGERPRINT,
            'hex',
          ),
        },
      ],
      ['intent', { intent: 'sign_up' }],
      ['operation ID', { id: OTHER_OPERATION_ID }],
      ['operation timestamp', { created_at: '999' }],
    ])(
      'returns idempotency conflict when a reused key changes %s',
      async (_label, operationOverrides) => {
        const operation = operationRow(operationOverrides);
        const operationId = operation.id as AuthenticationOperationId;
        const proof = operation.telegram_proof_fingerprint as Buffer;
        const intent = operation.intent;
        const requestDigest = operation.request_digest;
        const transaction = conflictTransaction(
          [operation],
          [
            consumptionRow({
              operation_id: operationId,
              proof_fingerprint: Buffer.from(proof),
              intent,
              request_digest: requestDigest,
            }),
          ],
        );
        const subject = repository(transaction);
        await expect(
          subject.repository.persistPending(transaction, validInput()),
        ).resolves.toEqual({
          outcome: 'conflict',
          reason: 'idempotency_key_conflict',
        });
      },
    );

    it('returns idempotency conflict when the key belongs to an OTP operation', async () => {
      const transaction = conflictTransaction(
        [
          operationRow({
            id: OTHER_OPERATION_ID,
            proof_type: 'otp_challenge',
            telegram_proof_fingerprint: null,
            otp_challenge_id: OTP_CHALLENGE_ID,
          }),
        ],
        [],
      );
      const subject = repository(transaction);
      await expect(
        subject.repository.persistPending(transaction, validInput()),
      ).resolves.toEqual({
        outcome: 'conflict',
        reason: 'idempotency_key_conflict',
      });
    });

    it('classifies proof reuse with another operation and key as replay', async () => {
      const transaction = conflictTransaction(
        [
          operationRow({
            id: OTHER_OPERATION_ID,
            idempotency_key: OTHER_IDEMPOTENCY_KEY,
            request_digest: OTHER_REQUEST_DIGEST,
          }),
        ],
        [
          consumptionRow({
            operation_id: OTHER_OPERATION_ID,
            idempotency_key: OTHER_IDEMPOTENCY_KEY,
            request_digest: OTHER_REQUEST_DIGEST,
          }),
        ],
      );
      const subject = repository(transaction);
      await expect(
        subject.repository.persistPending(transaction, validInput()),
      ).resolves.toEqual({
        outcome: 'replay',
        reason: 'proof_already_consumed',
      });
    });

    it('classifies reuse of the operation ID with other bindings as operation conflict', async () => {
      const transaction = conflictTransaction(
        [
          operationRow({
            idempotency_key: OTHER_IDEMPOTENCY_KEY,
            request_digest: OTHER_REQUEST_DIGEST,
            telegram_proof_fingerprint: Buffer.from(
              OTHER_PROOF_FINGERPRINT,
              'hex',
            ),
          }),
        ],
        [
          consumptionRow({
            idempotency_key: OTHER_IDEMPOTENCY_KEY,
            request_digest: OTHER_REQUEST_DIGEST,
            proof_fingerprint: Buffer.from(
              OTHER_PROOF_FINGERPRINT,
              'hex',
            ),
          }),
        ],
      );
      const subject = repository(transaction);
      await expect(
        subject.repository.persistPending(transaction, validInput()),
      ).resolves.toEqual({
        outcome: 'conflict',
        reason: 'operation_binding_conflict',
      });
    });

    it('gives idempotency conflict priority when key and proof point to different records', async () => {
      const keyOperation = operationRow({
        id: OTHER_OPERATION_ID,
        telegram_proof_fingerprint: Buffer.from(
          OTHER_PROOF_FINGERPRINT,
          'hex',
        ),
        request_digest: OTHER_REQUEST_DIGEST,
      });
      const proofOperation = operationRow({
        id: THIRD_OPERATION_ID,
        idempotency_key: THIRD_IDEMPOTENCY_KEY,
        request_digest: OTHER_REQUEST_DIGEST,
      });
      const keyConsumption = consumptionRow({
        operation_id: OTHER_OPERATION_ID,
        proof_fingerprint: Buffer.from(
          OTHER_PROOF_FINGERPRINT,
          'hex',
        ),
        request_digest: OTHER_REQUEST_DIGEST,
      });
      const proofConsumption = consumptionRow({
        operation_id: THIRD_OPERATION_ID,
        idempotency_key: THIRD_IDEMPOTENCY_KEY,
        request_digest: OTHER_REQUEST_DIGEST,
      });

      for (const transaction of [
        conflictTransaction(
          [keyOperation, proofOperation],
          [keyConsumption, proofConsumption],
        ),
        conflictTransaction(
          [proofOperation, keyOperation],
          [proofConsumption, keyConsumption],
        ),
      ]) {
        const subject = repository(transaction);
        await expect(
          subject.repository.persistPending(transaction, validInput()),
        ).resolves.toEqual({
          outcome: 'conflict',
          reason: 'idempotency_key_conflict',
        });
      }
    });

    it.each([
      ['operation UUID', [operationRow({ id: 'bad-uuid' })], [consumptionRow()]],
      [
        'lookup digest',
        [operationRow({ identity_lookup_digest: Buffer.alloc(31) })],
        [consumptionRow()],
      ],
      [
        'operation timestamp',
        [operationRow({ created_at: '1.5' })],
        [consumptionRow()],
      ],
      [
        'operation status',
        [operationRow({ status: 'unknown' })],
        [consumptionRow()],
      ],
      [
        'terminal shape',
        [operationRow({ terminal_command_type: 'complete' })],
        [consumptionRow()],
      ],
      [
        'consumption fingerprint',
        [operationRow()],
        [consumptionRow({ proof_fingerprint: Buffer.alloc(31) })],
      ],
      [
        'consumption expiry',
        [operationRow()],
        [consumptionRow({ proof_expires_at: '-1' })],
      ],
      [
        'cross-table binding',
        [operationRow()],
        [
          consumptionRow({
            operation_id: OTHER_OPERATION_ID,
          }),
        ],
      ],
      ['missing reread', [], []],
    ])(
      'rejects malformed persisted %s',
      async (_label, operations, consumptions) => {
        const transaction = conflictTransaction(
          operations as readonly QueryResultRow[],
          consumptions as readonly QueryResultRow[],
        );
        const subject = repository(transaction);
        await expectPersistenceReason(
          subject.repository.persistPending(
            transaction,
            validInput(),
          ),
          'invalid_persisted_state',
        );
        expect(subject.audit.calls).toHaveLength(0);
      },
    );

    it('rejects duplicate persisted unique bindings instead of choosing the first row', async () => {
      const duplicate = operationRow({
        id: OTHER_OPERATION_ID,
      });
      const transaction = conflictTransaction(
        [operationRow(), duplicate],
        [
          consumptionRow(),
          consumptionRow({
            operation_id: OTHER_OPERATION_ID,
          }),
        ],
      );
      const subject = repository(transaction);
      await expectPersistenceReason(
        subject.repository.persistPending(transaction, validInput()),
        'invalid_persisted_state',
      );
    });
  });

  describe('audit phase', () => {
    it.each([
      [
        'created',
        createdTransaction(),
        'success',
        'operationId',
      ],
      [
        'retry',
        conflictTransaction(),
        'idempotent_retry',
        'operationId',
      ],
      [
        'conflict',
        conflictTransaction(
          [
            operationRow({
              request_digest: OTHER_REQUEST_DIGEST,
            }),
          ],
          [
            consumptionRow({
              request_digest: OTHER_REQUEST_DIGEST,
            }),
          ],
        ),
        'conflict',
        'attemptedOperationId',
      ],
      [
        'replay',
        conflictTransaction(
          [
            operationRow({
              id: OTHER_OPERATION_ID,
              idempotency_key: OTHER_IDEMPOTENCY_KEY,
              request_digest: OTHER_REQUEST_DIGEST,
            }),
          ],
          [
            consumptionRow({
              operation_id: OTHER_OPERATION_ID,
              idempotency_key: OTHER_IDEMPOTENCY_KEY,
              request_digest: OTHER_REQUEST_DIGEST,
            }),
          ],
        ),
        'replay_detected',
        'attemptedOperationId',
      ],
    ])(
      'builds the %s audit event from the actual result',
      async (_label, transaction, outcome, metadataKey) => {
        const subject = repository(transaction);
        await subject.repository.persistPending(transaction, validInput());
        expect(subject.audit.calls).toHaveLength(1);
        const event = subject.audit.calls[0].event;
        expect(event).toMatchObject({
          eventId: AUDIT_EVENT_ID,
          eventType: 'telegram_proof_consumption',
          outcome,
          occurredAt: AUDIT_OCCURRED_AT,
          metadata: { [metadataKey]: OPERATION_ID },
        });
        expect(Object.keys(event.metadata)).toEqual([metadataKey]);
      },
    );

    it('accepts an exact retry from the audit repository', async () => {
      const transaction = createdTransaction();
      const audit = new FakeSecurityAuditRepository({
        status: 'idempotent_retry',
      });
      const subject = repository(transaction, audit);
      await expect(
        subject.repository.persistPending(transaction, validInput()),
      ).resolves.toEqual({
        outcome: 'created',
        operationId: OPERATION_ID,
      });
    });

    it('maps an audit event ID conflict to a safe audit conflict', async () => {
      const transaction = createdTransaction();
      const audit = new FakeSecurityAuditRepository({
        status: 'event_id_conflict',
      });
      const subject = repository(transaction, audit);
      await expectPersistenceReason(
        subject.repository.persistPending(transaction, validInput()),
        'audit_conflict',
      );
      expect(transaction.calls).toHaveLength(2);
      expect(audit.calls).toHaveLength(1);
    });

    it('maps a thrown audit persistence error without another side effect', async () => {
      const transaction = createdTransaction();
      const audit = new FakeSecurityAuditRepository(
        new SecurityAuditPersistenceError('permission_denied'),
      );
      const subject = repository(transaction, audit);
      await expectPersistenceReason(
        subject.repository.persistPending(transaction, validInput()),
        'permission_denied',
      );
      expect(transaction.calls).toHaveLength(2);
      expect(audit.calls).toHaveLength(1);
    });
  });

  describe('PostgreSQL failures and safety', () => {
    it.each([
      ['23503', 'referential_integrity'],
      ['23514', 'invalid_persisted_state'],
      ['23502', 'invalid_persisted_state'],
      ['22P02', 'invalid_persisted_state'],
      ['22023', 'invalid_persisted_state'],
      ['55000', 'invalid_persisted_state'],
      ['42501', 'permission_denied'],
      ['40001', 'transaction_conflict'],
      ['40P01', 'transaction_conflict'],
      ['08006', 'database_unavailable'],
      ['57P01', 'database_unavailable'],
      ['57014', 'database_unavailable'],
      ['23505', 'storage_failure'],
      ['99999', 'storage_failure'],
    ] as const)(
      'maps SQLSTATE %s to %s without audit',
      async (code, reason) => {
        const transaction = new FakeTransaction([{ code }]);
        const subject = repository(transaction);
        await expectPersistenceReason(
          subject.repository.persistPending(
            transaction,
            validInput(),
          ),
          reason,
        );
        expect(transaction.calls).toHaveLength(1);
        expect(subject.audit.calls).toHaveLength(0);
      },
    );

    it('maps an ordinary error to storage failure', async () => {
      const transaction = new FakeTransaction([
        new Error('raw driver message'),
      ]);
      const subject = repository(transaction);
      await expectPersistenceReason(
        subject.repository.persistPending(transaction, validInput()),
        'storage_failure',
      );
      expect(subject.audit.calls).toHaveLength(0);
    });

    it('treats an unexpected consumption unique conflict as storage failure without reread or audit', async () => {
      const transaction = new FakeTransaction([
        queryResult([{ id: OPERATION_ID }]),
        { code: '23505', constraint: 'secret-constraint' },
      ]);
      const subject = repository(transaction);
      await expectPersistenceReason(
        subject.repository.persistPending(transaction, validInput()),
        'storage_failure',
      );
      expect(transaction.calls).toHaveLength(2);
      expect(subject.audit.calls).toHaveLength(0);
    });

    it('does not retain or serialize raw PostgreSQL or authentication data', async () => {
      const telegramSubject = 'telegram-subject-secret';
      const initData = 'raw-init-data-secret';
      const sql = 'secret SQL text';
      const parameters = [
        OPERATION_ID,
        PROOF_FINGERPRINT,
        LOOKUP_DIGEST,
        IDEMPOTENCY_KEY,
        REQUEST_DIGEST,
      ];
      const raw = {
        code: '23503',
        message: 'postgres-message-secret',
        detail: 'postgres-detail-secret',
        hint: 'postgres-hint-secret',
        where: 'postgres-where-secret',
        query: sql,
        parameters,
        constraint: 'postgres-constraint-secret',
        schema: 'postgres-schema-secret',
        table: 'postgres-table-secret',
        column: 'postgres-column-secret',
        cause: {
          telegramSubject,
          initData,
          auditEventId: LEAK_AUDIT_EVENT_ID,
        },
      };
      const transaction = new FakeTransaction([raw]);
      const subject = repository(transaction);
      const input = validInput();
      const leakInput: PersistPendingTelegramAuthenticationInput = {
        ...input,
        audit: {
          ...input.audit,
          eventId: LEAK_AUDIT_EVENT_ID,
        },
      };

      let caught: unknown;
      try {
        await subject.repository.persistPending(
          transaction,
          leakInput,
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(
        TelegramAuthenticationOperationPersistenceError,
      );
      expect(caught).not.toBe(raw);
      const safe = caught as TelegramAuthenticationOperationPersistenceError;
      expect(Object.getOwnPropertyNames(safe).sort()).toEqual([
        'message',
        'name',
        'reason',
        'stack',
      ]);
      expect(
        Object.getOwnPropertyNames(safe).some(
          (key) =>
            (safe as unknown as Record<string, unknown>)[key] === raw,
        ),
      ).toBe(false);
      expect(
        (safe as unknown as Record<string, unknown>).cause,
      ).toBeUndefined();

      const visible = [
        safe.message,
        safe.stack ?? '',
        JSON.stringify(safe),
      ].join('\n');
      for (const marker of [
        telegramSubject,
        initData,
        LEAK_AUDIT_EVENT_ID,
        sql,
        ...parameters.map(String),
        raw.message,
        raw.detail,
        raw.hint,
        raw.where,
        raw.constraint,
        raw.schema,
        raw.table,
        raw.column,
      ]) {
        expect(visible).not.toContain(marker);
      }
      expect(subject.audit.calls).toHaveLength(0);
    });
  });
});
