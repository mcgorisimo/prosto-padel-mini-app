import { isExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import {
  ComputedExternalIdentityLookupDigest,
  isComputedExternalIdentityLookupDigest,
} from '../accounts/external-identity-lookup-digest.port';
import {
  ExternalIdentityNamespace,
  externalIdentityNamespace,
} from '../accounts/external-identity.types';
import {
  CreatePlayerAccountWithProfileBinding,
  validatePlayerAccountWithProfileCreation,
} from '../accounts/player-profile.types';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import {
  SecurityAuditEvent,
  createSecurityAuditEvent,
} from '../auth/security-audit.types';
import {
  ExternalIdentityPersistenceError,
  ExternalIdentityResolutionRepository,
} from './external-identity.repository';
import {
  PlayerAccountProvisioningPersistenceError,
  PlayerAccountProvisioningPersistenceFailure,
  PlayerAccountProvisioningRepository,
  PlayerAccountProvisioningResult,
  ProvisionPlayerAccountInput,
} from './player-account-provisioning.repository';
import {
  PostgresCodecError,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  SecurityAuditPersistenceError,
  SecurityAuditRepository,
} from './security-audit.repository';

const INSERT_ACCOUNT_SQL = `
  INSERT INTO backend_auth.accounts (
    id, created_at, updated_at
  )
  VALUES ($1, $2, $3)
`;

const INSERT_PLAYER_PROFILE_SQL = `
  INSERT INTO backend_auth.player_profiles (account_id)
  VALUES ($1)
`;

const INSERT_EXTERNAL_IDENTITY_SQL = `
  INSERT INTO backend_auth.external_identities (
    id, account_id, provider, namespace, status, is_primary
  )
  VALUES ($1, $2, $3, $4, $5, $6)
`;

const INSERT_LOOKUP_DIGEST_ALIASES_SQL = `
  INSERT INTO backend_auth.external_identity_lookup_digests (
    identity_id,
    algorithm,
    provider,
    namespace,
    digest,
    digest_version,
    pepper_version,
    created_at
  )
  SELECT
    $1::uuid,
    $2::text,
    $3::text,
    $4::text,
    input.digest,
    input.digest_version,
    input.pepper_version,
    $8::bigint
  FROM pg_catalog.unnest(
    $5::bytea[],
    $6::bigint[],
    $7::bigint[]
  ) WITH ORDINALITY AS input(
    digest,
    digest_version,
    pepper_version,
    input_order
  )
  ORDER BY
    input.digest,
    input.digest_version,
    input.pepper_version,
    input.input_order
`;

const CREATED_RESULT = (
  accountId: CreatePlayerAccountWithProfileBinding['account']['accountId'],
): PlayerAccountProvisioningResult =>
  Object.freeze({
    outcome: 'created',
    accountId,
  });

interface ValidatedProvisioningInput {
  readonly binding: CreatePlayerAccountWithProfileBinding;
  readonly createdAt: UnixEpochSeconds;
  readonly identity: {
    readonly identityId:
      ProvisionPlayerAccountInput['identity']['identityId'];
    readonly provider: 'telegram';
    readonly namespace: ExternalIdentityNamespace;
    readonly isPrimary: true;
  };
  readonly lookupDigests: readonly ComputedExternalIdentityLookupDigest[];
  readonly auditEvents: {
    readonly accountCreated: SecurityAuditEvent<'account_created'>;
    readonly externalIdentityLinked:
      SecurityAuditEvent<'external_identity_linked'>;
  };
}

function persistenceFailure(
  reason: PlayerAccountProvisioningPersistenceFailure,
): PlayerAccountProvisioningPersistenceError {
  return new PlayerAccountProvisioningPersistenceError(reason);
}

function invalidInput(): PlayerAccountProvisioningPersistenceError {
  return persistenceFailure('invalid_input');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function readNamespace(value: unknown): ExternalIdentityNamespace {
  if (typeof value !== 'string') {
    throw invalidInput();
  }

  try {
    return externalIdentityNamespace(value);
  } catch {
    throw invalidInput();
  }
}

function readAuditEvent<EventType extends
  | 'account_created'
  | 'external_identity_linked'>(
  value: unknown,
  eventType: EventType,
): SecurityAuditEvent<EventType> {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      'eventId',
      'eventType',
      'outcome',
      'occurredAt',
      'metadata',
    ])
  ) {
    throw invalidInput();
  }

  try {
    const event = createSecurityAuditEvent(
      value as unknown as SecurityAuditEvent<EventType>,
    );
    if (event.eventType !== eventType || event.outcome !== 'success') {
      throw invalidInput();
    }
    return event;
  } catch {
    throw invalidInput();
  }
}

function validateLookupDigests(
  value: unknown,
  namespace: ExternalIdentityNamespace,
): readonly ComputedExternalIdentityLookupDigest[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidInput();
  }

  const byVersion = new Map<
    string,
    ComputedExternalIdentityLookupDigest
  >();
  const versionByDigest = new Map<string, string>();

  for (const candidate of value) {
    if (
      !isComputedExternalIdentityLookupDigest(candidate) ||
      candidate.provider !== 'telegram' ||
      candidate.namespace !== namespace
    ) {
      throw invalidInput();
    }

    const versionKey = `${candidate.digestVersion}:${candidate.pepperVersion}`;
    const previousForVersion = byVersion.get(versionKey);
    if (previousForVersion !== undefined) {
      if (previousForVersion.digest !== candidate.digest) {
        throw invalidInput();
      }
      continue;
    }

    const previousVersion = versionByDigest.get(candidate.digest);
    if (previousVersion !== undefined && previousVersion !== versionKey) {
      throw invalidInput();
    }

    const immutableCandidate = Object.freeze({ ...candidate });
    byVersion.set(versionKey, immutableCandidate);
    versionByDigest.set(candidate.digest, versionKey);
  }

  return Object.freeze(
    [...byVersion.values()].sort(
      (left, right) =>
        left.digest.localeCompare(right.digest) ||
        left.digestVersion - right.digestVersion ||
        left.pepperVersion - right.pepperVersion,
    ),
  );
}

function validateInput(value: unknown): ValidatedProvisioningInput {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      'binding',
      'createdAt',
      'identity',
      'lookupDigests',
      'auditEvents',
    ])
  ) {
    throw invalidInput();
  }

  const bindingResult = validatePlayerAccountWithProfileCreation(
    value.binding,
  );
  if (
    bindingResult.outcome !== 'validated' ||
    !isUnixEpochSeconds(value.createdAt) ||
    !isRecord(value.identity) ||
    !hasExactlyKeys(value.identity, [
      'identityId',
      'provider',
      'namespace',
      'isPrimary',
    ]) ||
    !isExternalIdentityId(value.identity.identityId) ||
    value.identity.provider !== 'telegram' ||
    value.identity.isPrimary !== true ||
    !isRecord(value.auditEvents) ||
    !hasExactlyKeys(value.auditEvents, [
      'accountCreated',
      'externalIdentityLinked',
    ])
  ) {
    throw invalidInput();
  }

  const namespace = readNamespace(value.identity.namespace);
  const lookupDigests = validateLookupDigests(
    value.lookupDigests,
    namespace,
  );
  const accountCreated = readAuditEvent(
    value.auditEvents.accountCreated,
    'account_created',
  );
  const externalIdentityLinked = readAuditEvent(
    value.auditEvents.externalIdentityLinked,
    'external_identity_linked',
  );

  if (
    accountCreated.eventId === externalIdentityLinked.eventId ||
    accountCreated.metadata.accountId !==
      bindingResult.binding.account.accountId ||
    accountCreated.metadata.role !== 'player' ||
    externalIdentityLinked.metadata.identityId !==
      value.identity.identityId ||
    externalIdentityLinked.metadata.accountId !==
      bindingResult.binding.account.accountId ||
    externalIdentityLinked.metadata.provider !== 'telegram'
  ) {
    throw invalidInput();
  }

  return Object.freeze({
    binding: bindingResult.binding,
    createdAt: value.createdAt,
    identity: Object.freeze({
      identityId: value.identity.identityId,
      provider: 'telegram' as const,
      namespace,
      isPrimary: true as const,
    }),
    lookupDigests,
    auditEvents: Object.freeze({
      accountCreated,
      externalIdentityLinked,
    }),
  });
}

function aliasQueryValues(
  input: ValidatedProvisioningInput,
): readonly unknown[] {
  const digests = input.lookupDigests.map((candidate) =>
    encodePostgresByteaDigest(candidate.digest),
  );
  const digestVersions = input.lookupDigests.map((candidate) =>
    candidate.digestVersion.toString(10),
  );
  const pepperVersions = input.lookupDigests.map((candidate) =>
    candidate.pepperVersion.toString(10),
  );
  const first = input.lookupDigests[0];
  if (first === undefined) {
    throw invalidInput();
  }

  return [
    input.identity.identityId,
    first.algorithm,
    input.identity.provider,
    input.identity.namespace,
    digests,
    digestVersions,
    pepperVersions,
    input.createdAt.toString(10),
  ];
}

function constraintFailure(
  constraint: string | undefined,
): PlayerAccountProvisioningPersistenceFailure {
  switch (constraint) {
    case 'accounts_pkey':
    case 'player_profiles_pkey':
      return 'account_binding_conflict';
    case 'external_identities_one_linked_primary_uidx':
      return 'identity_binding_conflict';
    case 'external_identities_pkey':
    case 'external_identities_binding_key':
    case 'external_identity_lookup_digests_pkey':
      return 'identity_binding_conflict';
    case 'external_identity_lookup_digests_global_key':
      return 'identity_reserved';
    default:
      return 'storage_failure';
  }
}

function mapExternalIdentityError(
  error: ExternalIdentityPersistenceError,
): PlayerAccountProvisioningPersistenceError {
  switch (error.reason) {
    case 'invalid_input':
      return persistenceFailure('invalid_input');
    case 'invalid_persisted_state':
      return persistenceFailure('invalid_persisted_state');
    case 'permission_denied':
      return persistenceFailure('permission_denied');
    case 'transaction_conflict':
      return persistenceFailure('transaction_conflict');
    case 'database_unavailable':
      return persistenceFailure('database_unavailable');
    case 'storage_failure':
      return persistenceFailure('storage_failure');
  }
}

function mapSecurityAuditError(
  error: SecurityAuditPersistenceError,
): PlayerAccountProvisioningPersistenceError {
  switch (error.reason) {
    case 'referential_integrity':
      return persistenceFailure('referential_integrity');
    case 'invalid_audit_event':
      return persistenceFailure('invalid_input');
    case 'permission_denied':
      return persistenceFailure('permission_denied');
    case 'transaction_conflict':
      return persistenceFailure('transaction_conflict');
    case 'database_unavailable':
      return persistenceFailure('database_unavailable');
    case 'storage_failure':
      return persistenceFailure('storage_failure');
  }
}

function mapPersistenceError(
  error: unknown,
): PlayerAccountProvisioningPersistenceError {
  if (error instanceof PlayerAccountProvisioningPersistenceError) {
    return error;
  }
  if (error instanceof ExternalIdentityPersistenceError) {
    return mapExternalIdentityError(error);
  }
  if (error instanceof SecurityAuditPersistenceError) {
    return mapSecurityAuditError(error);
  }
  if (error instanceof PostgresCodecError) {
    return invalidInput();
  }

  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return persistenceFailure('storage_failure');
  }

  switch (classified.category) {
    case 'unique_violation':
      return persistenceFailure(
        constraintFailure(classified.metadata.constraint),
      );
    case 'foreign_key_violation':
      return persistenceFailure('referential_integrity');
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
      return persistenceFailure('invalid_input');
    case 'insufficient_privilege':
      return persistenceFailure('permission_denied');
    case 'serialization_failure':
    case 'deadlock_detected':
      return persistenceFailure('transaction_conflict');
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return persistenceFailure('database_unavailable');
    default:
      return persistenceFailure('storage_failure');
  }
}

export class PostgresPlayerAccountProvisioningRepository
  implements PlayerAccountProvisioningRepository
{
  constructor(
    private readonly externalIdentities:
      ExternalIdentityResolutionRepository,
    private readonly securityAudit: SecurityAuditRepository,
  ) {}

  async provision(
    transaction: PostgresTransaction,
    input: ProvisionPlayerAccountInput,
  ): Promise<PlayerAccountProvisioningResult> {
    try {
      const validated = validateInput(input);
      const aliasValues = aliasQueryValues(validated);
      const resolution =
        await this.externalIdentities.resolveByLookupDigests(
          transaction,
          validated.lookupDigests,
        );

      switch (resolution.outcome) {
        case 'not_found':
          break;
        case 'linked':
        case 'historical_reservation':
          throw persistenceFailure('identity_reserved');
        case 'conflict':
          throw persistenceFailure('identity_resolution_conflict');
      }

      const accountId = validated.binding.account.accountId;
      const createdAt = validated.createdAt.toString(10);
      await transaction.query(INSERT_ACCOUNT_SQL, [
        accountId,
        createdAt,
        createdAt,
      ]);
      await transaction.query(INSERT_PLAYER_PROFILE_SQL, [accountId]);
      await transaction.query(INSERT_EXTERNAL_IDENTITY_SQL, [
        validated.identity.identityId,
        accountId,
        validated.identity.provider,
        validated.identity.namespace,
        'linked',
        validated.identity.isPrimary,
      ]);
      await transaction.query(
        INSERT_LOOKUP_DIGEST_ALIASES_SQL,
        aliasValues,
      );

      const accountAudit = await this.securityAudit.append(
        transaction,
        validated.auditEvents.accountCreated,
      );
      if (accountAudit.status !== 'appended') {
        throw persistenceFailure('audit_conflict');
      }

      const identityAudit = await this.securityAudit.append(
        transaction,
        validated.auditEvents.externalIdentityLinked,
      );
      if (identityAudit.status !== 'appended') {
        throw persistenceFailure('audit_conflict');
      }

      return CREATED_RESULT(accountId);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
