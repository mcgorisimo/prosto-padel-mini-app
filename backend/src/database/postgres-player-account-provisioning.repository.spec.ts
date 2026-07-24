import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { ExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import {
  EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  ComputedExternalIdentityLookupDigest,
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../accounts/external-identity-lookup-digest.port';
import {
  ExternalIdentityNamespace,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from '../accounts/external-identity.types';
import { CreatePlayerAccountWithProfileBinding } from '../accounts/player-profile.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SecurityAuditEvent,
  SecurityAuditEventId,
  SecurityAuditEventType,
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from '../auth/security-audit.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  ExternalIdentityPersistenceError,
  ExternalIdentityResolutionRepository,
  ExternalIdentityResolutionResult,
} from './external-identity.repository';
import {
  PlayerAccountProvisioningPersistenceError,
  PlayerAccountProvisioningPersistenceFailure,
  ProvisionPlayerAccountInput,
} from './player-account-provisioning.repository';
import { PostgresPlayerAccountProvisioningRepository } from './postgres-player-account-provisioning.repository';
import { PostgresTransaction } from './postgres-transaction';
import {
  SecurityAuditAppendResult,
  SecurityAuditPersistenceError,
  SecurityAuditRepository,
} from './security-audit.repository';

const ACCOUNT_ID = deterministicUuid(
  'player-account-provisioning-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-account-provisioning-other-account',
) as AccountId;
const IDENTITY_ID = deterministicUuid(
  'player-account-provisioning-identity',
) as ExternalIdentityId;
const OTHER_IDENTITY_ID = deterministicUuid(
  'player-account-provisioning-other-identity',
) as ExternalIdentityId;
const ACCOUNT_AUDIT_EVENT_ID = deterministicUuid(
  'player-account-provisioning-account-audit',
) as SecurityAuditEventId;
const IDENTITY_AUDIT_EVENT_ID = deterministicUuid(
  'player-account-provisioning-identity-audit',
) as SecurityAuditEventId;
const NAMESPACE = externalIdentityNamespace('telegram:bot:123');
const OTHER_NAMESPACE = externalIdentityNamespace('telegram:bot:456');
const CREATED_AT = unixEpochSeconds(Number.MAX_SAFE_INTEGER);

interface CandidateOptions {
  readonly digestCharacter?: string;
  readonly digestVersion?: number;
  readonly pepperVersion?: number;
  readonly namespace?: ExternalIdentityNamespace;
  readonly provider?: ComputedExternalIdentityLookupDigest['provider'];
}

function candidate(
  options: CandidateOptions = {},
): ComputedExternalIdentityLookupDigest {
  const {
    digestCharacter = 'a',
    digestVersion = 1,
    pepperVersion = 1,
    namespace = NAMESPACE,
    provider = 'telegram',
  } = options;
  return {
    algorithm: EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
    provider,
    namespace,
    digest: externalIdentityLookupDigest(digestCharacter.repeat(64)),
    digestVersion: externalIdentityLookupDigestVersion(digestVersion),
    pepperVersion:
      externalIdentityLookupDigestPepperVersion(pepperVersion),
  };
}

function accountCreatedAudit(
  accountId = ACCOUNT_ID,
  eventId = ACCOUNT_AUDIT_EVENT_ID,
): SecurityAuditEvent<'account_created'> {
  return createSecurityAuditEvent({
    eventId,
    eventType: 'account_created',
    outcome: 'success',
    occurredAt: CREATED_AT,
    metadata: createSecurityAuditMetadata('account_created', {
      accountId,
      role: 'player',
    }),
  });
}

function identityLinkedAudit(
  identityId = IDENTITY_ID,
  accountId = ACCOUNT_ID,
  eventId = IDENTITY_AUDIT_EVENT_ID,
  provider: ComputedExternalIdentityLookupDigest['provider'] = 'telegram',
): SecurityAuditEvent<'external_identity_linked'> {
  return createSecurityAuditEvent({
    eventId,
    eventType: 'external_identity_linked',
    outcome: 'success',
    occurredAt: CREATED_AT,
    metadata: createSecurityAuditMetadata('external_identity_linked', {
      identityId,
      accountId,
      provider,
    }),
  });
}

function binding(
  accountId = ACCOUNT_ID,
): CreatePlayerAccountWithProfileBinding {
  return {
    account: {
      accountId,
      role: 'player',
      status: 'active',
    },
    playerProfile: { accountId },
  };
}

function validInput(
  lookupDigests: readonly ComputedExternalIdentityLookupDigest[] = [
    candidate(),
  ],
): ProvisionPlayerAccountInput {
  return {
    binding: binding(),
    createdAt: CREATED_AT,
    identity: {
      identityId: IDENTITY_ID,
      provider: 'telegram',
      namespace: NAMESPACE,
      isPrimary: true,
    },
    lookupDigests,
    auditEvents: {
      accountCreated: accountCreatedAudit(),
      externalIdentityLinked: identityLinkedAudit(),
    },
  };
}

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function queryResult<Row extends QueryResultRow>(
  rows: readonly Row[] = [],
): QueryResult<Row> {
  return {
    command: 'INSERT',
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: [],
  };
}

function queryLabel(text: string): string {
  if (/INSERT INTO backend_auth\.accounts/u.test(text)) {
    return 'insert:account';
  }
  if (/INSERT INTO backend_auth\.player_profiles/u.test(text)) {
    return 'insert:profile';
  }
  if (/INSERT INTO backend_auth\.external_identities/u.test(text)) {
    return 'insert:identity';
  }
  if (
    /INSERT INTO backend_auth\.external_identity_lookup_digests/u.test(
      text,
    )
  ) {
    return 'insert:aliases';
  }
  return 'query:unknown';
}

class FakePostgresTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly events: string[] = [],
    private readonly failureAtCall?: {
      readonly index: number;
      readonly error: unknown;
    },
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    const index = this.calls.length;
    this.calls.push({ text, values: [...values] });
    this.events.push(queryLabel(text));
    if (this.failureAtCall?.index === index) {
      throw this.failureAtCall.error;
    }
    return queryResult<Row>();
  }
}

type ResolutionResponse =
  | ExternalIdentityResolutionResult
  | ExternalIdentityPersistenceError;

class FakeExternalIdentityResolutionRepository
  implements ExternalIdentityResolutionRepository
{
  readonly calls: Array<{
    readonly transaction: PostgresTransaction;
    readonly candidates: readonly ComputedExternalIdentityLookupDigest[];
  }> = [];

  constructor(
    private readonly response: ResolutionResponse = {
      outcome: 'not_found',
    },
    private readonly events: string[] = [],
  ) {}

  async resolveByLookupDigests(
    transaction: PostgresTransaction,
    candidates: readonly ComputedExternalIdentityLookupDigest[],
  ): Promise<ExternalIdentityResolutionResult> {
    this.events.push('resolve');
    this.calls.push({ transaction, candidates });
    if (this.response instanceof ExternalIdentityPersistenceError) {
      throw this.response;
    }
    return this.response;
  }
}

type AuditResponse =
  | SecurityAuditAppendResult
  | SecurityAuditPersistenceError;

class FakeSecurityAuditRepository implements SecurityAuditRepository {
  readonly calls: Array<{
    readonly transaction: PostgresTransaction;
    readonly event: SecurityAuditEvent<SecurityAuditEventType>;
  }> = [];
  private responseIndex = 0;

  constructor(
    private readonly responses: readonly AuditResponse[] = [],
    private readonly events: string[] = [],
  ) {}

  async append<EventType extends SecurityAuditEventType>(
    transaction: PostgresTransaction,
    event: SecurityAuditEvent<EventType>,
  ): Promise<SecurityAuditAppendResult> {
    this.events.push(`audit:${event.eventType}`);
    this.calls.push({ transaction, event });
    const response = this.responses[this.responseIndex] ?? {
      status: 'appended',
    };
    this.responseIndex += 1;
    if (response instanceof SecurityAuditPersistenceError) {
      throw response;
    }
    return response;
  }
}

function repositoryWith(
  resolver: FakeExternalIdentityResolutionRepository,
  audit: FakeSecurityAuditRepository,
): PostgresPlayerAccountProvisioningRepository {
  return new PostgresPlayerAccountProvisioningRepository(resolver, audit);
}

async function capturePersistenceError(
  promise: Promise<unknown>,
): Promise<PlayerAccountProvisioningPersistenceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PlayerAccountProvisioningPersistenceError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected PlayerAccountProvisioningPersistenceError');
}

function unsafeInput(
  value: unknown,
): ProvisionPlayerAccountInput {
  return value as ProvisionPlayerAccountInput;
}

function insertColumns(text: string, table: string): readonly string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const pattern = new RegExp(
    `INSERT INTO backend_auth\\.${table} \\(([^)]+)\\)`,
    'u',
  );
  const match = pattern.exec(normalized);
  if (match === null) {
    throw new Error(`Expected INSERT for ${table}`);
  }
  return match[1].split(',').map((column) => column.trim());
}

interface ParsedAliasInsertSql {
  readonly columns: readonly string[];
  readonly selectExpressions: readonly string[];
}

function parseAliasInsertSql(text: string): ParsedAliasInsertSql {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const match =
    /INSERT INTO backend_auth\.external_identity_lookup_digests \(([^)]+)\) SELECT (.+?) FROM pg_catalog\.unnest\(/u.exec(
      normalized,
    );
  if (match === null) {
    throw new Error('Expected the fixed lookup alias INSERT SELECT shape');
  }

  return {
    columns: match[1].split(',').map((column) => column.trim()),
    selectExpressions: match[2]
      .split(',')
      .map((expression) => expression.trim()),
  };
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected array parameter');
  }
  return value;
}

function requireBuffers(value: unknown): readonly Buffer[] {
  return requireArray(value).map((item) => {
    if (!Buffer.isBuffer(item)) {
      throw new Error('Expected digest Buffer');
    }
    return item;
  });
}

function postgresError(
  code: string,
  constraint?: string,
): Readonly<Record<string, unknown>> {
  return {
    code,
    ...(constraint === undefined ? {} : { constraint }),
  };
}

describe('PostgresPlayerAccountProvisioningRepository', () => {
  it.each([
    [
      'invalid account binding',
      () => ({
        ...validInput(),
        binding: {
          account: {
            accountId: ACCOUNT_ID,
            role: 'club_admin',
            status: 'active',
          },
          playerProfile: { accountId: ACCOUNT_ID },
        },
      }),
    ],
    [
      'profile belonging to another account',
      () => ({
        ...validInput(),
        binding: {
          ...binding(),
          playerProfile: { accountId: OTHER_ACCOUNT_ID },
        },
      }),
    ],
    [
      'invalid creation time',
      () => ({ ...validInput(), createdAt: -1 }),
    ],
    [
      'non-Telegram identity',
      () => ({
        ...validInput(),
        identity: { ...validInput().identity, provider: 'google' },
      }),
    ],
    [
      'non-primary first identity',
      () => ({
        ...validInput(),
        identity: { ...validInput().identity, isPrimary: false },
      }),
    ],
    [
      'invalid identity UUID string',
      () => ({
        ...validInput(),
        identity: {
          ...validInput().identity,
          identityId: 'not-an-identity-uuid',
        },
      }),
    ],
    [
      'non-string identity ID',
      () => ({
        ...validInput(),
        identity: {
          ...validInput().identity,
          identityId: 123,
        },
      }),
    ],
    [
      'empty identity namespace',
      () => ({
        ...validInput(),
        identity: {
          ...validInput().identity,
          namespace: '',
        },
      }),
    ],
    [
      'identity namespace with a control character',
      () => ({
        ...validInput(),
        identity: {
          ...validInput().identity,
          namespace: 'telegram:bot:\n123',
        },
      }),
    ],
    [
      'empty lookup aliases',
      () => ({ ...validInput(), lookupDigests: [] }),
    ],
    [
      'audit event bound to another account',
      () => ({
        ...validInput(),
        auditEvents: {
          ...validInput().auditEvents,
          accountCreated: accountCreatedAudit(OTHER_ACCOUNT_ID),
        },
      }),
    ],
    [
      'duplicate audit event IDs',
      () => ({
        ...validInput(),
        auditEvents: {
          accountCreated: accountCreatedAudit(),
          externalIdentityLinked: identityLinkedAudit(
            IDENTITY_ID,
            ACCOUNT_ID,
            ACCOUNT_AUDIT_EVENT_ID,
          ),
        },
      }),
    ],
    [
      'external identity audit bound to another identity',
      () => ({
        ...validInput(),
        auditEvents: {
          ...validInput().auditEvents,
          externalIdentityLinked: identityLinkedAudit(OTHER_IDENTITY_ID),
        },
      }),
    ],
    [
      'external identity audit bound to another account',
      () => ({
        ...validInput(),
        auditEvents: {
          ...validInput().auditEvents,
          externalIdentityLinked: identityLinkedAudit(
            IDENTITY_ID,
            OTHER_ACCOUNT_ID,
          ),
        },
      }),
    ],
    [
      'external identity audit bound to another provider',
      () => ({
        ...validInput(),
        auditEvents: {
          ...validInput().auditEvents,
          externalIdentityLinked: identityLinkedAudit(
            IDENTITY_ID,
            ACCOUNT_ID,
            IDENTITY_AUDIT_EVENT_ID,
            'google',
          ),
        },
      }),
    ],
    [
      'unexpected audit data',
      () => ({
        ...validInput(),
        auditEvents: {
          ...validInput().auditEvents,
          accountCreated: {
            ...accountCreatedAudit(),
            rawInitData: 'must-not-cross-persistence-boundary',
          },
        },
      }),
    ],
  ])('rejects %s before resolution or SQL', async (_name, makeInput) => {
    const resolver = new FakeExternalIdentityResolutionRepository();
    const audit = new FakeSecurityAuditRepository();
    const transaction = new FakePostgresTransaction();

    const error = await capturePersistenceError(
      repositoryWith(resolver, audit).provision(
        transaction,
        unsafeInput(makeInput()),
      ),
    );

    expect(error.reason).toBe('invalid_input');
    expect(resolver.calls).toHaveLength(0);
    expect(transaction.calls).toHaveLength(0);
    expect(audit.calls).toHaveLength(0);
  });

  it.each([
    [
      'linked identity',
      {
        outcome: 'linked',
        identity: {
          identityId: IDENTITY_ID,
          accountId: ACCOUNT_ID,
          provider: 'telegram',
          namespace: NAMESPACE,
          isPrimary: true,
        },
      } satisfies ExternalIdentityResolutionResult,
      'identity_reserved',
    ],
    [
      'historical reservation',
      {
        outcome: 'historical_reservation',
        identity: {
          identityId: IDENTITY_ID,
          accountId: ACCOUNT_ID,
          provider: 'telegram',
          namespace: NAMESPACE,
          isPrimary: false,
        },
      } satisfies ExternalIdentityResolutionResult,
      'identity_reserved',
    ],
    [
      'ambiguous resolution',
      {
        outcome: 'conflict',
        reason: 'multiple_accounts',
      } satisfies ExternalIdentityResolutionResult,
      'identity_resolution_conflict',
    ],
  ] as const)(
    'stops after resolution for %s',
    async (_name, resolution, expectedReason) => {
      const events: string[] = [];
      const resolver = new FakeExternalIdentityResolutionRepository(
        resolution,
        events,
      );
      const audit = new FakeSecurityAuditRepository([], events);
      const transaction = new FakePostgresTransaction(events);

      const error = await capturePersistenceError(
        repositoryWith(resolver, audit).provision(
          transaction,
          validInput(),
        ),
      );

      expect(error.reason).toBe(expectedReason);
      expect(events).toEqual(['resolve']);
      expect(transaction.calls).toHaveLength(0);
      expect(audit.calls).toHaveLength(0);
    },
  );

  it('uses one transaction in the strict write and audit order', async () => {
    const events: string[] = [];
    const resolver = new FakeExternalIdentityResolutionRepository(
      { outcome: 'not_found' },
      events,
    );
    const audit = new FakeSecurityAuditRepository([], events);
    const transaction = new FakePostgresTransaction(events);

    await expect(
      repositoryWith(resolver, audit).provision(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({
      outcome: 'created',
      accountId: ACCOUNT_ID,
    });

    expect(events).toEqual([
      'resolve',
      'insert:account',
      'insert:profile',
      'insert:identity',
      'insert:aliases',
      'audit:account_created',
      'audit:external_identity_linked',
    ]);
    expect(resolver.calls[0].transaction).toBe(transaction);
    expect(audit.calls).toHaveLength(2);
    expect(audit.calls.every((call) => call.transaction === transaction)).toBe(
      true,
    );
    expect(transaction.calls).toHaveLength(4);

    const sql = transaction.calls.map((call) => call.text).join(' ');
    expect(sql).not.toMatch(
      /\b(?:BEGIN|COMMIT|ROLLBACK|UPDATE|DELETE|FOR\s+UPDATE)\b/iu,
    );
  });

  it('maps account, profile, identity, and aliases exactly', async () => {
    const resolver = new FakeExternalIdentityResolutionRepository();
    const audit = new FakeSecurityAuditRepository();
    const transaction = new FakePostgresTransaction();
    const lookups = [
      candidate({
        digestCharacter: 'b',
        digestVersion: 2,
        pepperVersion: 2,
      }),
      candidate({
        digestCharacter: 'a',
        digestVersion: 1,
        pepperVersion: 3,
      }),
    ];

    await repositoryWith(resolver, audit).provision(
      transaction,
      validInput(lookups),
    );

    expect(
      insertColumns(transaction.calls[0].text, 'accounts'),
    ).toEqual(['id', 'created_at', 'updated_at']);
    expect(transaction.calls[0].values).toEqual([
      ACCOUNT_ID,
      Number.MAX_SAFE_INTEGER.toString(10),
      Number.MAX_SAFE_INTEGER.toString(10),
    ]);
    expect(transaction.calls[0].text).not.toMatch(/\brole\b|\bstatus\b/u);

    expect(
      insertColumns(transaction.calls[1].text, 'player_profiles'),
    ).toEqual(['account_id']);
    expect(transaction.calls[1].values).toEqual([ACCOUNT_ID]);

    expect(
      insertColumns(transaction.calls[2].text, 'external_identities'),
    ).toEqual([
      'id',
      'account_id',
      'provider',
      'namespace',
      'status',
      'is_primary',
    ]);
    expect(transaction.calls[2].values).toEqual([
      IDENTITY_ID,
      ACCOUNT_ID,
      'telegram',
      NAMESPACE,
      'linked',
      true,
    ]);

    const aliasCall = transaction.calls[3];
    expect(parseAliasInsertSql(aliasCall.text)).toEqual({
      columns: [
        'identity_id',
        'algorithm',
        'provider',
        'namespace',
        'digest',
        'digest_version',
        'pepper_version',
        'created_at',
      ],
      selectExpressions: [
        '$1::uuid',
        '$2::text',
        '$3::text',
        '$4::text',
        'input.digest',
        'input.digest_version',
        'input.pepper_version',
        '$8::bigint',
      ],
    });
    expect(aliasCall.text).toMatch(/pg_catalog\.unnest/u);
    expect(aliasCall.text).toMatch(/\$5::bytea\[\]/u);
    expect(aliasCall.text).toMatch(/\$6::bigint\[\]/u);
    expect(aliasCall.text).toMatch(/\$7::bigint\[\]/u);
    expect(aliasCall.text).not.toMatch(/ON\s+CONFLICT/iu);
    expect(aliasCall.values.slice(0, 4)).toEqual([
      IDENTITY_ID,
      'hmac-sha-256',
      'telegram',
      NAMESPACE,
    ]);
    expect(
      requireBuffers(aliasCall.values[4]).map((buffer) =>
        buffer.toString('hex'),
      ),
    ).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(aliasCall.values[5]).toEqual(['1', '2']);
    expect(aliasCall.values[6]).toEqual(['3', '2']);
    expect(aliasCall.values[7]).toBe(
      Number.MAX_SAFE_INTEGER.toString(10),
    );
  });

  it('deduplicates exact aliases before resolution and INSERT', async () => {
    const lookup = candidate();
    const resolver = new FakeExternalIdentityResolutionRepository();
    const audit = new FakeSecurityAuditRepository();
    const transaction = new FakePostgresTransaction();

    await repositoryWith(resolver, audit).provision(
      transaction,
      validInput([lookup, { ...lookup }]),
    );

    expect(resolver.calls[0].candidates).toHaveLength(1);
    expect(requireArray(transaction.calls[3].values[4])).toHaveLength(1);
    expect(requireArray(transaction.calls[3].values[5])).toHaveLength(1);
    expect(requireArray(transaction.calls[3].values[6])).toHaveLength(1);
  });

  it('rejects one version pair with different digests before resolution', async () => {
    const resolver = new FakeExternalIdentityResolutionRepository();
    const audit = new FakeSecurityAuditRepository();
    const transaction = new FakePostgresTransaction();

    const error = await capturePersistenceError(
      repositoryWith(resolver, audit).provision(
        transaction,
        validInput([
          candidate({ digestCharacter: 'a' }),
          candidate({ digestCharacter: 'b' }),
        ]),
      ),
    );

    expect(error.reason).toBe('invalid_input');
    expect(resolver.calls).toHaveLength(0);
    expect(transaction.calls).toHaveLength(0);
  });

  it('rejects one digest under different version pairs before resolution', async () => {
    const resolver = new FakeExternalIdentityResolutionRepository();
    const audit = new FakeSecurityAuditRepository();
    const transaction = new FakePostgresTransaction();

    const error = await capturePersistenceError(
      repositoryWith(resolver, audit).provision(
        transaction,
        validInput([
          candidate(),
          candidate({ digestVersion: 2, pepperVersion: 2 }),
        ]),
      ),
    );

    expect(error.reason).toBe('invalid_input');
    expect(resolver.calls).toHaveLength(0);
    expect(transaction.calls).toHaveLength(0);
  });

  it('rejects alias bindings for another namespace or provider', async () => {
    const resolver = new FakeExternalIdentityResolutionRepository();
    const audit = new FakeSecurityAuditRepository();
    const transaction = new FakePostgresTransaction();

    for (const lookup of [
      candidate({ namespace: OTHER_NAMESPACE }),
      candidate({ provider: 'google' }),
    ]) {
      const error = await capturePersistenceError(
        repositoryWith(resolver, audit).provision(
          transaction,
          validInput([lookup]),
        ),
      );
      expect(error.reason).toBe('invalid_input');
    }

    expect(resolver.calls).toHaveLength(0);
    expect(transaction.calls).toHaveLength(0);
  });

  it('creates independent digest Buffers for separate calls', async () => {
    const lookup = candidate();
    const firstTransaction = new FakePostgresTransaction();
    const secondTransaction = new FakePostgresTransaction();
    const firstRepository = repositoryWith(
      new FakeExternalIdentityResolutionRepository(),
      new FakeSecurityAuditRepository(),
    );
    const secondRepository = repositoryWith(
      new FakeExternalIdentityResolutionRepository(),
      new FakeSecurityAuditRepository(),
    );

    await firstRepository.provision(
      firstTransaction,
      validInput([lookup]),
    );
    await secondRepository.provision(
      secondTransaction,
      validInput([lookup]),
    );

    const firstBuffer = requireBuffers(
      firstTransaction.calls[3].values[4],
    )[0];
    const secondBuffer = requireBuffers(
      secondTransaction.calls[3].values[4],
    )[0];
    expect(firstBuffer).not.toBe(secondBuffer);
    firstBuffer[0] = 0;
    expect(secondBuffer.toString('hex')).toBe(lookup.digest);
    expect(lookup.digest).toBe('a'.repeat(64));
  });

  it('creates independent digest Buffers inside one batch', async () => {
    const firstLookup = candidate({
      digestCharacter: 'a',
      digestVersion: 1,
      pepperVersion: 1,
    });
    const secondLookup = candidate({
      digestCharacter: 'b',
      digestVersion: 2,
      pepperVersion: 2,
    });
    const transaction = new FakePostgresTransaction();

    await repositoryWith(
      new FakeExternalIdentityResolutionRepository(),
      new FakeSecurityAuditRepository(),
    ).provision(
      transaction,
      validInput([secondLookup, firstLookup]),
    );

    const [firstBuffer, secondBuffer] = requireBuffers(
      transaction.calls[3].values[4],
    );
    expect(firstBuffer).not.toBe(secondBuffer);
    expect(firstBuffer).toHaveLength(32);
    expect(secondBuffer).toHaveLength(32);
    expect(firstBuffer.toString('hex')).toBe(firstLookup.digest);
    expect(secondBuffer.toString('hex')).toBe(secondLookup.digest);

    firstBuffer[0] = 0;
    expect(secondBuffer.toString('hex')).toBe(secondLookup.digest);
    expect(firstLookup.digest).toBe('a'.repeat(64));
    expect(secondLookup.digest).toBe('b'.repeat(64));
  });

  it.each([
    { status: 'idempotent_retry' },
    { status: 'event_id_conflict' },
  ] as const)(
    'rejects non-appended account audit result $status',
    async (auditResult) => {
      const events: string[] = [];
      const resolver = new FakeExternalIdentityResolutionRepository(
        { outcome: 'not_found' },
        events,
      );
      const audit = new FakeSecurityAuditRepository(
        [auditResult],
        events,
      );
      const transaction = new FakePostgresTransaction(events);

      const error = await capturePersistenceError(
        repositoryWith(resolver, audit).provision(
          transaction,
          validInput(),
        ),
      );

      expect(error.reason).toBe('audit_conflict');
      expect(audit.calls).toHaveLength(1);
      expect(events.at(-1)).toBe('audit:account_created');
    },
  );

  it.each([
    { status: 'idempotent_retry' },
    { status: 'event_id_conflict' },
  ] as const)(
    'rejects non-appended identity audit result $status',
    async (auditResult) => {
      const resolver = new FakeExternalIdentityResolutionRepository();
      const audit = new FakeSecurityAuditRepository([
        { status: 'appended' },
        auditResult,
      ]);
      const transaction = new FakePostgresTransaction();

      const error = await capturePersistenceError(
        repositoryWith(resolver, audit).provision(
          transaction,
          validInput(),
        ),
      );

      expect(error.reason).toBe('audit_conflict');
      expect(audit.calls.map((call) => call.event.eventType)).toEqual([
        'account_created',
        'external_identity_linked',
      ]);
    },
  );

  it('returns only the safe created projection', async () => {
    const repository = repositoryWith(
      new FakeExternalIdentityResolutionRepository(),
      new FakeSecurityAuditRepository(),
    );

    const result = await repository.provision(
      new FakePostgresTransaction(),
      validInput(),
    );

    expect(result).toEqual({
      outcome: 'created',
      accountId: ACCOUNT_ID,
    });
    expect(Object.keys(result).sort()).toEqual(['accountId', 'outcome']);
    expect(JSON.stringify(result)).not.toContain(candidate().digest);
  });

  it.each([
    ['accounts_pkey', 'account_binding_conflict'],
    ['player_profiles_pkey', 'account_binding_conflict'],
    [
      'external_identities_one_linked_primary_uidx',
      'identity_binding_conflict',
    ],
    ['external_identities_pkey', 'identity_binding_conflict'],
    ['external_identities_binding_key', 'identity_binding_conflict'],
    [
      'external_identity_lookup_digests_pkey',
      'identity_binding_conflict',
    ],
    [
      'external_identity_lookup_digests_global_key',
      'identity_reserved',
    ],
    ['unexpected_unique_constraint', 'storage_failure'],
  ] as const)(
    'maps unique constraint %s to %s',
    async (constraint, expectedReason) => {
      const repository = repositoryWith(
        new FakeExternalIdentityResolutionRepository(),
        new FakeSecurityAuditRepository(),
      );
      const transaction = new FakePostgresTransaction([], {
        index: 0,
        error: postgresError('23505', constraint),
      });

      const error = await capturePersistenceError(
        repository.provision(transaction, validInput()),
      );

      expect(error.reason).toBe(expectedReason);
    },
  );

  it.each([
    ['23503', 'referential_integrity'],
    ['23514', 'invalid_input'],
    ['23502', 'invalid_input'],
    ['22P02', 'invalid_input'],
    ['42501', 'permission_denied'],
    ['40001', 'transaction_conflict'],
    ['40P01', 'transaction_conflict'],
    ['08006', 'database_unavailable'],
    ['57P01', 'database_unavailable'],
    ['57014', 'database_unavailable'],
    ['22023', 'storage_failure'],
  ] as const)(
    'maps SQLSTATE %s to %s',
    async (code, expectedReason) => {
      const repository = repositoryWith(
        new FakeExternalIdentityResolutionRepository(),
        new FakeSecurityAuditRepository(),
      );
      const transaction = new FakePostgresTransaction([], {
        index: 0,
        error: postgresError(code),
      });

      const error = await capturePersistenceError(
        repository.provision(transaction, validInput()),
      );

      expect(error.reason).toBe(expectedReason);
    },
  );

  it('maps resolver persisted-state failure safely', async () => {
    const resolver = new FakeExternalIdentityResolutionRepository(
      new ExternalIdentityPersistenceError('invalid_persisted_state'),
    );

    const error = await capturePersistenceError(
      repositoryWith(
        resolver,
        new FakeSecurityAuditRepository(),
      ).provision(new FakePostgresTransaction(), validInput()),
    );

    expect(error.reason).toBe('invalid_persisted_state');
  });

  it('stops after a safe first-audit persistence failure', async () => {
    const events: string[] = [];
    const audit = new FakeSecurityAuditRepository([
      new SecurityAuditPersistenceError('referential_integrity'),
    ], events);
    const transaction = new FakePostgresTransaction(events);

    const error = await capturePersistenceError(
      repositoryWith(
        new FakeExternalIdentityResolutionRepository(
          { outcome: 'not_found' },
          events,
        ),
        audit,
      ).provision(transaction, validInput()),
    );

    expect(error).toBeInstanceOf(
      PlayerAccountProvisioningPersistenceError,
    );
    expect(error.reason).toBe('referential_integrity');
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].event.eventType).toBe('account_created');
    expect(events.at(-1)).toBe('audit:account_created');
    expect(events).not.toContain('audit:external_identity_linked');
    expect(
      transaction.calls.map((call) => call.text).join(' '),
    ).not.toMatch(/\bROLLBACK\b/iu);
  });

  it('maps ordinary errors to storage failure', async () => {
    const repository = repositoryWith(
      new FakeExternalIdentityResolutionRepository(),
      new FakeSecurityAuditRepository(),
    );
    const transaction = new FakePostgresTransaction([], {
      index: 0,
      error: new Error('raw ordinary failure'),
    });

    const error = await capturePersistenceError(
      repository.provision(transaction, validInput()),
    );

    expect(error.reason).toBe('storage_failure');
  });

  it('does not retain or disclose raw PostgreSQL data', async () => {
    const secretMarkers = [
      'RAW_MESSAGE_SECRET',
      'RAW_DETAIL_SECRET',
      'RAW_HINT_SECRET',
      'RAW_WHERE_SECRET',
      'RAW_QUERY_SECRET',
      'RAW_PARAMETER_SECRET',
      'RAW_CONSTRAINT_SECRET',
      'RAW_SCHEMA_SECRET',
      'RAW_TABLE_SECRET',
      'RAW_COLUMN_SECRET',
      'RAW_CAUSE_SECRET',
      'TELEGRAM_SUBJECT_SECRET',
      'TELEGRAM_FIRST_NAME_SECRET',
      'TELEGRAM_LAST_NAME_SECRET',
      'TELEGRAM_USERNAME_SECRET',
      'https://example.test/TELEGRAM_PHOTO_SECRET',
      'AUDIT_METADATA_SECRET',
      ACCOUNT_AUDIT_EVENT_ID,
      ACCOUNT_ID,
      IDENTITY_ID,
      candidate().digest,
    ] as const;
    const markers = {
      message: secretMarkers[0],
      detail: secretMarkers[1],
      hint: secretMarkers[2],
      where: secretMarkers[3],
      query: secretMarkers[4],
      parameters: [secretMarkers[5]],
      constraint: secretMarkers[6],
      schema: secretMarkers[7],
      table: secretMarkers[8],
      column: secretMarkers[9],
      cause: new Error(secretMarkers[10]),
      telegramSubject: secretMarkers[11],
      firstName: secretMarkers[12],
      lastName: secretMarkers[13],
      username: secretMarkers[14],
      photoUrl: secretMarkers[15],
      auditMetadata: { marker: secretMarkers[16] },
      eventId: secretMarkers[17],
      accountId: secretMarkers[18],
      identityId: secretMarkers[19],
      lookupDigest: secretMarkers[20],
    };
    const rawError = {
      code: '23505',
      ...markers,
    };
    const repository = repositoryWith(
      new FakeExternalIdentityResolutionRepository(),
      new FakeSecurityAuditRepository(),
    );
    const transaction = new FakePostgresTransaction([], {
      index: 0,
      error: rawError,
    });

    const error = await capturePersistenceError(
      repository.provision(transaction, validInput()),
    );

    expect(error).not.toBe(rawError);
    expect(error.reason).toBe('storage_failure');
    expect(Object.getOwnPropertyNames(error).sort()).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
    for (const property of Object.getOwnPropertyNames(error)) {
      expect(
        (error as unknown as Record<string, unknown>)[property],
      ).not.toBe(rawError);
    }
    expect(error).not.toHaveProperty('cause');
    expect(error).not.toHaveProperty('constraint');
    expect(error).not.toHaveProperty('schema');
    expect(error).not.toHaveProperty('table');
    expect(error).not.toHaveProperty('column');
    expect(error).not.toHaveProperty('query');
    expect(error).not.toHaveProperty('parameters');

    const serialized = JSON.stringify(error);
    const exposed = `${error.message}\n${error.stack ?? ''}\n${serialized}`;
    for (const marker of secretMarkers) {
      expect(exposed).not.toContain(marker);
    }
  });
});
