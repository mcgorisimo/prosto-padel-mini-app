import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import {
  EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  ComputedExternalIdentityLookupDigest,
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
  isComputedExternalIdentityLookupDigest,
} from '../accounts/external-identity-lookup-digest.port';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  ExternalIdentityNamespace,
  ExternalIdentityProvider,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from '../accounts/external-identity.types';
import {
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  ExternalIdentityPersistenceError,
  ExternalIdentityPersistenceFailure,
  ExternalIdentityResolutionRepository,
  ExternalIdentityResolutionResult,
  LinkedExternalIdentityResolution,
  UnlinkedExternalIdentityResolution,
} from './external-identity.repository';

const RESOLVE_EXTERNAL_IDENTITY_SQL = `
  WITH input_aliases AS (
    SELECT *
    FROM pg_catalog.unnest(
      $1::text[],
      $2::text[],
      $3::text[],
      $4::bytea[],
      $5::bigint[],
      $6::bigint[]
    ) WITH ORDINALITY AS input(
      algorithm,
      provider,
      namespace,
      digest,
      digest_version,
      pepper_version,
      input_order
    )
  )
  SELECT
    input.input_order,
    identity.id,
    identity.account_id,
    identity.provider AS identity_provider,
    identity.namespace AS identity_namespace,
    identity.status,
    identity.is_primary,
    alias.identity_id AS alias_identity_id,
    alias.algorithm,
    alias.provider AS alias_provider,
    alias.namespace AS alias_namespace,
    alias.digest,
    alias.digest_version,
    alias.pepper_version,
    alias.created_at
  FROM input_aliases AS input
  JOIN backend_auth.external_identity_lookup_digests AS alias
    ON alias.algorithm = input.algorithm
   AND alias.provider = input.provider
   AND alias.namespace = input.namespace
   AND alias.digest = input.digest
   AND alias.digest_version = input.digest_version
   AND alias.pepper_version = input.pepper_version
  JOIN backend_auth.external_identities AS identity
    ON identity.id = alias.identity_id
  ORDER BY input.input_order, identity.id
`;

const NOT_FOUND_RESULT: ExternalIdentityResolutionResult = Object.freeze({
  outcome: 'not_found',
});
const SAME_ACCOUNT_CONFLICT_RESULT: ExternalIdentityResolutionResult =
  Object.freeze({
    outcome: 'conflict',
    reason: 'multiple_identities_same_account',
  });
const MULTIPLE_ACCOUNTS_CONFLICT_RESULT: ExternalIdentityResolutionResult =
  Object.freeze({
    outcome: 'conflict',
    reason: 'multiple_accounts',
  });

interface ExternalIdentityResolutionRow extends QueryResultRow {
  readonly input_order: unknown;
  readonly id: unknown;
  readonly account_id: unknown;
  readonly identity_provider: unknown;
  readonly identity_namespace: unknown;
  readonly status: unknown;
  readonly is_primary: unknown;
  readonly alias_identity_id: unknown;
  readonly algorithm: unknown;
  readonly alias_provider: unknown;
  readonly alias_namespace: unknown;
  readonly digest: unknown;
  readonly digest_version: unknown;
  readonly pepper_version: unknown;
  readonly created_at: unknown;
}

type ResolvedIdentity =
  | {
      readonly status: 'linked';
      readonly identity: LinkedExternalIdentityResolution;
    }
  | {
      readonly status: 'unlinked';
      readonly identity: UnlinkedExternalIdentityResolution;
    };

function invalidInput(): ExternalIdentityPersistenceError {
  return new ExternalIdentityPersistenceError('invalid_input');
}

function invalidPersistedState(): ExternalIdentityPersistenceError {
  return new ExternalIdentityPersistenceError('invalid_persisted_state');
}

function storageFailure(): ExternalIdentityPersistenceError {
  return new ExternalIdentityPersistenceError('storage_failure');
}

function isProvider(value: unknown): value is ExternalIdentityProvider {
  return (
    typeof value === 'string' &&
    (EXTERNAL_IDENTITY_PROVIDERS as readonly string[]).includes(value)
  );
}

function readNamespace(value: unknown): ExternalIdentityNamespace {
  if (typeof value !== 'string') {
    throw invalidPersistedState();
  }

  try {
    return externalIdentityNamespace(value);
  } catch {
    throw invalidPersistedState();
  }
}

function validateCandidates(
  candidates: readonly ComputedExternalIdentityLookupDigest[],
): readonly ComputedExternalIdentityLookupDigest[] {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw invalidInput();
  }

  const first = candidates[0];
  if (!isComputedExternalIdentityLookupDigest(first)) {
    throw invalidInput();
  }

  const candidatesByVersion = new Map<
    string,
    ComputedExternalIdentityLookupDigest
  >();
  for (const candidate of candidates) {
    if (
      !isComputedExternalIdentityLookupDigest(candidate) ||
      candidate.algorithm !== first.algorithm ||
      candidate.provider !== first.provider ||
      candidate.namespace !== first.namespace
    ) {
      throw invalidInput();
    }

    const versionKey = `${candidate.digestVersion}:${candidate.pepperVersion}`;
    const previous = candidatesByVersion.get(versionKey);
    if (previous !== undefined) {
      if (previous.digest !== candidate.digest) {
        throw invalidInput();
      }
      continue;
    }

    candidatesByVersion.set(versionKey, candidate);
  }

  return Object.freeze([...candidatesByVersion.values()]);
}

function queryValues(
  candidates: readonly ComputedExternalIdentityLookupDigest[],
): readonly unknown[] {
  return [
    candidates.map((candidate) => candidate.algorithm),
    candidates.map((candidate) => candidate.provider),
    candidates.map((candidate) => candidate.namespace),
    candidates.map((candidate) =>
      encodePostgresByteaDigest(candidate.digest),
    ),
    candidates.map((candidate) => candidate.digestVersion.toString(10)),
    candidates.map((candidate) => candidate.pepperVersion.toString(10)),
  ];
}

function identitiesEqual(
  left: ResolvedIdentity,
  right: ResolvedIdentity,
): boolean {
  return (
    left.status === right.status &&
    left.identity.identityId === right.identity.identityId &&
    left.identity.accountId === right.identity.accountId &&
    left.identity.provider === right.identity.provider &&
    left.identity.namespace === right.identity.namespace &&
    left.identity.isPrimary === right.identity.isPrimary
  );
}

function readPersistedMatch(
  row: ExternalIdentityResolutionRow,
  candidates: readonly ComputedExternalIdentityLookupDigest[],
): ResolvedIdentity {
  try {
    const inputOrder = decodePostgresNonNegativeBigint(row.input_order);
    if (inputOrder === 0) {
      throw invalidPersistedState();
    }
    const candidate = candidates[inputOrder - 1];
    if (candidate === undefined) {
      throw invalidPersistedState();
    }

    if (
      !isExternalIdentityId(row.id) ||
      !isAccountId(row.account_id) ||
      !isProvider(row.identity_provider) ||
      typeof row.is_primary !== 'boolean' ||
      !isExternalIdentityId(row.alias_identity_id) ||
      row.algorithm !== EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM ||
      !isProvider(row.alias_provider)
    ) {
      throw invalidPersistedState();
    }

    const identityNamespace = readNamespace(row.identity_namespace);
    const aliasNamespace = readNamespace(row.alias_namespace);
    const digest = externalIdentityLookupDigest(
      decodePostgresByteaDigest(row.digest),
    );
    const digestVersion = externalIdentityLookupDigestVersion(
      decodePostgresNonNegativeBigint(row.digest_version),
    );
    const pepperVersion = externalIdentityLookupDigestPepperVersion(
      decodePostgresNonNegativeBigint(row.pepper_version),
    );
    decodePostgresNonNegativeBigint(row.created_at);

    if (
      row.alias_identity_id !== row.id ||
      row.alias_provider !== row.identity_provider ||
      aliasNamespace !== identityNamespace ||
      candidate.algorithm !== row.algorithm ||
      candidate.provider !== row.alias_provider ||
      candidate.namespace !== aliasNamespace ||
      candidate.digest !== digest ||
      candidate.digestVersion !== digestVersion ||
      candidate.pepperVersion !== pepperVersion
    ) {
      throw invalidPersistedState();
    }

    const binding = {
      identityId: row.id,
      accountId: row.account_id,
      provider: row.identity_provider,
      namespace: identityNamespace,
    };

    if (row.status === 'linked') {
      return Object.freeze({
        status: 'linked',
        identity: Object.freeze({
          ...binding,
          isPrimary: row.is_primary,
        }),
      });
    }
    if (row.status === 'unlinked' && row.is_primary === false) {
      return Object.freeze({
        status: 'unlinked',
        identity: Object.freeze({
          ...binding,
          isPrimary: false,
        }),
      });
    }

    throw invalidPersistedState();
  } catch {
    throw invalidPersistedState();
  }
}

function resolveMatches(
  rows: readonly ExternalIdentityResolutionRow[],
  candidates: readonly ComputedExternalIdentityLookupDigest[],
): ExternalIdentityResolutionResult {
  if (rows.length === 0) {
    return NOT_FOUND_RESULT;
  }

  const identities = new Map<string, ResolvedIdentity>();
  for (const row of rows) {
    const resolved = readPersistedMatch(row, candidates);
    const existing = identities.get(resolved.identity.identityId);
    if (existing !== undefined && !identitiesEqual(existing, resolved)) {
      throw invalidPersistedState();
    }
    identities.set(resolved.identity.identityId, resolved);
  }

  if (identities.size === 1) {
    const resolved = identities.values().next().value;
    if (resolved === undefined) {
      throw storageFailure();
    }

    return resolved.status === 'linked'
      ? Object.freeze({
          outcome: 'linked',
          identity: resolved.identity,
        })
      : Object.freeze({
          outcome: 'historical_reservation',
          identity: resolved.identity,
        });
  }

  const accountIds = new Set(
    [...identities.values()].map((resolved) => resolved.identity.accountId),
  );
  return accountIds.size === 1
    ? SAME_ACCOUNT_CONFLICT_RESULT
    : MULTIPLE_ACCOUNTS_CONFLICT_RESULT;
}

function persistenceError(error: unknown): ExternalIdentityPersistenceError {
  if (error instanceof ExternalIdentityPersistenceError) {
    return error;
  }

  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return storageFailure();
  }

  let reason: ExternalIdentityPersistenceFailure;
  switch (classified.category) {
    case 'insufficient_privilege':
      reason = 'permission_denied';
      break;
    case 'serialization_failure':
    case 'deadlock_detected':
      reason = 'transaction_conflict';
      break;
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      reason = 'database_unavailable';
      break;
    default:
      reason = 'storage_failure';
      break;
  }

  return new ExternalIdentityPersistenceError(reason);
}

export class PostgresExternalIdentityResolutionRepository
  implements ExternalIdentityResolutionRepository
{
  async resolveByLookupDigests(
    transaction: PostgresTransaction,
    candidates: readonly ComputedExternalIdentityLookupDigest[],
  ): Promise<ExternalIdentityResolutionResult> {
    try {
      const validatedCandidates = validateCandidates(candidates);
      const selected = await transaction.query<ExternalIdentityResolutionRow>(
        RESOLVE_EXTERNAL_IDENTITY_SQL,
        queryValues(validatedCandidates),
      );
      return resolveMatches(selected.rows, validatedCandidates);
    } catch (error) {
      throw persistenceError(error);
    }
  }
}
