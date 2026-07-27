import { QueryResultRow } from 'pg';
import {
  AuthenticationOperationId,
  UnixEpochSeconds,
  isAuthenticationOperationId,
  isUnixEpochSeconds,
} from '../auth/auth.types';
import { aggregateCommandSequence } from '../auth/aggregate-command-sequence';
import {
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from '../auth/security-audit.types';
import {
  SessionTransitionResult,
  hydrateSessionStateFromCommandPersistenceRecords,
  isSessionCommandPersistenceRecord,
  transitionSession,
} from '../auth/session.state-machine';
import {
  ConsumedSessionCredential,
  SessionCommand,
  SessionCommandId,
  SessionCommandPersistenceRecord,
  SessionCredentialBinding,
  SessionCredentialDigest,
  SessionCredentialReference,
  SessionId,
  SessionRequestDigest,
  SessionRevokeReason,
  SessionState,
  isSessionAccountId,
  isSessionCommandId,
  isSessionCredentialDigest,
  isSessionCredentialGeneration,
  isSessionId,
  isSessionRequestDigest,
  isSessionRevokeReason,
} from '../auth/session.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  ApplyPresentedSessionCredentialInput,
  ApplyPresentedSessionCredentialResult,
  SessionCredentialLifecyclePersistenceError,
  SessionCredentialLifecyclePersistenceFailure,
  SessionCredentialLifecycleRepository,
} from './session-credential-lifecycle.repository';
import {
  SecurityAuditPersistenceError,
  SecurityAuditRepository,
} from './security-audit.repository';

const SELECT_PRESENTED_CREDENTIAL_FAMILY_FOR_UPDATE_SQL = `
  SELECT
    f.id AS family_id,
    f.account_id,
    f.authentication_operation_id,
    f.status,
    f.current_credential_generation,
    f.created_at,
    f.expires_at,
    f.terminal_command_id,
    f.terminal_reason,
    f.terminal_at,
    f.terminal_reuse_generation,
    f.terminal_reuse_digest,
    presented.generation AS presented_generation
  FROM backend_auth.auth_session_credentials presented
  JOIN backend_auth.auth_session_families f
    ON f.id = presented.family_id
  WHERE presented.digest = $1
  ORDER BY f.id
  FOR UPDATE OF f
`;

const SELECT_SESSION_CREDENTIALS_FOR_UPDATE_SQL = `
  SELECT
    family_id,
    generation,
    digest,
    issued_at,
    consumed_at,
    consumed_by_command_id
  FROM backend_auth.auth_session_credentials
  WHERE family_id = $1
  ORDER BY generation
  FOR UPDATE
`;

const SELECT_SESSION_COMMANDS_SQL = `
  SELECT
    family_id,
    command_id,
    command_sequence,
    request_digest,
    command_type,
    applied_at,
    presented_generation,
    presented_digest,
    next_generation,
    next_digest,
    reason,
    result_type
  FROM backend_auth.auth_session_commands
  WHERE family_id = $1
  ORDER BY command_sequence
`;

const CONSUME_SESSION_CREDENTIAL_SQL = `
  UPDATE backend_auth.auth_session_credentials
  SET
    consumed_at = $4,
    consumed_by_command_id = $5
  WHERE family_id = $1
    AND generation = $2
    AND digest = $3
    AND consumed_at IS NULL
    AND consumed_by_command_id IS NULL
  RETURNING
    family_id,
    generation,
    digest,
    issued_at,
    consumed_at,
    consumed_by_command_id
`;

const INSERT_SESSION_CREDENTIAL_SQL = `
  INSERT INTO backend_auth.auth_session_credentials (
    family_id,
    generation,
    digest,
    issued_at
  )
  VALUES ($1, $2, $3, $4)
  RETURNING
    family_id,
    generation,
    digest,
    issued_at,
    consumed_at,
    consumed_by_command_id
`;

const UPDATE_ACTIVE_SESSION_GENERATION_SQL = `
  UPDATE backend_auth.auth_session_families
  SET current_credential_generation = $2
  WHERE id = $1
    AND status = 'active'
    AND current_credential_generation = $3
  RETURNING id, status, current_credential_generation
`;

const INSERT_SESSION_COMMAND_SQL = `
  INSERT INTO backend_auth.auth_session_commands (
    family_id,
    command_id,
    command_sequence,
    request_digest,
    command_type,
    applied_at,
    presented_generation,
    presented_digest,
    next_generation,
    next_digest,
    reason,
    result_type
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING family_id, command_id, command_sequence
`;

const UPDATE_TERMINAL_SESSION_SQL = `
  UPDATE backend_auth.auth_session_families
  SET
    status = $2,
    terminal_command_id = $3,
    terminal_reason = $4,
    terminal_at = $5,
    terminal_reuse_generation = $6,
    terminal_reuse_digest = $7
  WHERE id = $1
    AND status = $8
    AND current_credential_generation = $9
  RETURNING id, status, current_credential_generation, terminal_command_id
`;

const SESSION_STATUSES = Object.freeze([
  'active',
  'revoked',
  'expired',
  'reuse_detected',
] as const);

interface LockedFamilyRow extends QueryResultRow {
  readonly family_id: unknown;
  readonly account_id: unknown;
  readonly authentication_operation_id: unknown;
  readonly status: unknown;
  readonly current_credential_generation: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly terminal_command_id: unknown;
  readonly terminal_reason: unknown;
  readonly terminal_at: unknown;
  readonly terminal_reuse_generation: unknown;
  readonly terminal_reuse_digest: unknown;
  readonly presented_generation: unknown;
}

interface SessionCredentialRow extends QueryResultRow {
  readonly family_id: unknown;
  readonly generation: unknown;
  readonly digest: unknown;
  readonly issued_at: unknown;
  readonly consumed_at: unknown;
  readonly consumed_by_command_id: unknown;
}

interface SessionCommandRow extends QueryResultRow {
  readonly family_id: unknown;
  readonly command_id: unknown;
  readonly command_sequence: unknown;
  readonly request_digest: unknown;
  readonly command_type: unknown;
  readonly applied_at: unknown;
  readonly presented_generation: unknown;
  readonly presented_digest: unknown;
  readonly next_generation: unknown;
  readonly next_digest: unknown;
  readonly reason: unknown;
  readonly result_type: unknown;
}

interface SessionCredentialRecord {
  readonly familyId: SessionId;
  readonly generation: number;
  readonly digest: SessionCredentialDigest;
  readonly issuedAt: UnixEpochSeconds;
  readonly consumedAt: UnixEpochSeconds | null;
  readonly consumedByCommandId: SessionCommandId | null;
}

interface HydratedAggregate {
  readonly state: SessionState;
  readonly presentedCredential: SessionCredentialReference;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function invalidInput(): SessionCredentialLifecyclePersistenceError {
  return new SessionCredentialLifecyclePersistenceError('invalid_input');
}

function invalidPersistedState(): SessionCredentialLifecyclePersistenceError {
  return new SessionCredentialLifecyclePersistenceError(
    'invalid_persisted_state',
  );
}

function assertValidInput(
  value: unknown,
): asserts value is ApplyPresentedSessionCredentialInput {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      'presentedCredentialDigest',
      'nextCredentialDigest',
      'commandId',
      'requestDigest',
      'now',
      'audit',
    ]) ||
    !isSessionCredentialDigest(value.presentedCredentialDigest) ||
    !isSessionCredentialDigest(value.nextCredentialDigest) ||
    !isSessionCommandId(value.commandId) ||
    !isSessionRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.now) ||
    !isRecord(value.audit) ||
    !hasExactlyKeys(value.audit, ['eventId']) ||
    !isInternalUuid(value.audit.eventId)
  ) {
    throw invalidInput();
  }
}

function isClosedValue(
  value: unknown,
  values: readonly string[],
): value is string {
  return typeof value === 'string' && values.includes(value);
}

function nullableNonNegativeBigint(value: unknown): number | null {
  return value === null ? null : decodePostgresNonNegativeBigint(value);
}

function nullableDigest(value: unknown): SessionCredentialDigest | null {
  if (value === null) {
    return null;
  }
  const digest = decodePostgresByteaDigest(value);
  if (!isSessionCredentialDigest(digest)) {
    throw invalidPersistedState();
  }
  return digest;
}

function nullableSessionCommandId(value: unknown): SessionCommandId | null {
  if (value === null) {
    return null;
  }
  if (!isSessionCommandId(value)) {
    throw invalidPersistedState();
  }
  return value;
}

function nonNegativeEpoch(value: unknown): UnixEpochSeconds {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (!isUnixEpochSeconds(decoded)) {
    throw invalidPersistedState();
  }
  return decoded;
}

function hydrateCredential(row: SessionCredentialRow): SessionCredentialRecord {
  if (!isSessionId(row.family_id)) {
    throw invalidPersistedState();
  }
  const generation = decodePostgresNonNegativeBigint(row.generation);
  const digest = decodePostgresByteaDigest(row.digest);
  const issuedAt = nonNegativeEpoch(row.issued_at);
  const consumedAt =
    row.consumed_at === null ? null : nonNegativeEpoch(row.consumed_at);
  const consumedByCommandId = nullableSessionCommandId(
    row.consumed_by_command_id,
  );
  if (
    !isSessionCredentialGeneration(generation) ||
    !isSessionCredentialDigest(digest) ||
    (consumedAt === null) !== (consumedByCommandId === null)
  ) {
    throw invalidPersistedState();
  }
  return Object.freeze({
    familyId: row.family_id,
    generation,
    digest,
    issuedAt,
    consumedAt,
    consumedByCommandId,
  });
}

function credentialReference(
  generation: number | null,
  digest: SessionCredentialDigest | null,
): SessionCredentialReference | null {
  if (generation === null && digest === null) {
    return null;
  }
  if (
    !isSessionCredentialGeneration(generation) ||
    !isSessionCredentialDigest(digest)
  ) {
    throw invalidPersistedState();
  }
  return Object.freeze({ generation, digest });
}

function hydrateCommand(row: SessionCommandRow): SessionCommandPersistenceRecord {
  if (
    !isSessionId(row.family_id) ||
    !isSessionCommandId(row.command_id) ||
    !isSessionRequestDigest(row.request_digest) ||
    typeof row.command_type !== 'string' ||
    typeof row.result_type !== 'string'
  ) {
    throw invalidPersistedState();
  }

  const commandSequence = aggregateCommandSequence(
    decodePostgresNonNegativeBigint(row.command_sequence),
  );
  const appliedAt = nonNegativeEpoch(row.applied_at);
  const presentedCredential = credentialReference(
    nullableNonNegativeBigint(row.presented_generation),
    nullableDigest(row.presented_digest),
  );
  const nextCredential = credentialReference(
    nullableNonNegativeBigint(row.next_generation),
    nullableDigest(row.next_digest),
  );

  let record: SessionCommandPersistenceRecord;
  switch (row.result_type) {
    case 'credential_rotated':
      if (
        row.command_type !== 'rotate_credential' ||
        presentedCredential === null ||
        nextCredential === null ||
        row.reason !== null
      ) {
        throw invalidPersistedState();
      }
      record = {
        sessionId: row.family_id,
        commandId: row.command_id,
        commandSequence,
        commandType: 'rotate_credential',
        requestDigest: row.request_digest,
        appliedAt,
        presentedCredential,
        nextCredential,
        result: {
          type: 'credential_rotated',
          credential: {
            ...nextCredential,
            issuedAt: appliedAt,
          },
        },
      };
      break;
    case 'reuse_detected':
      if (
        row.command_type !== 'rotate_credential' ||
        presentedCredential === null ||
        nextCredential === null ||
        row.reason !== null
      ) {
        throw invalidPersistedState();
      }
      record = {
        sessionId: row.family_id,
        commandId: row.command_id,
        commandSequence,
        commandType: 'rotate_credential',
        requestDigest: row.request_digest,
        appliedAt,
        presentedCredential,
        nextCredential,
        result: {
          type: 'reuse_detected',
          reuse: {
            detectedAt: appliedAt,
            generation: presentedCredential.generation,
            digest: presentedCredential.digest,
            commandId: row.command_id,
          },
        },
      };
      break;
    case 'session_revoked':
      if (
        row.command_type !== 'revoke_session' ||
        presentedCredential !== null ||
        nextCredential !== null ||
        !isSessionRevokeReason(row.reason)
      ) {
        throw invalidPersistedState();
      }
      record = {
        sessionId: row.family_id,
        commandId: row.command_id,
        commandSequence,
        commandType: 'revoke_session',
        requestDigest: row.request_digest,
        appliedAt,
        reason: row.reason,
        result: {
          type: 'session_revoked',
          revocation: {
            reason: row.reason,
            revokedAt: appliedAt,
            commandId: row.command_id,
          },
        },
      };
      break;
    case 'session_expired':
      if (
        row.command_type !== 'expire_session' ||
        presentedCredential !== null ||
        nextCredential !== null ||
        row.reason !== null
      ) {
        throw invalidPersistedState();
      }
      record = {
        sessionId: row.family_id,
        commandId: row.command_id,
        commandSequence,
        commandType: 'expire_session',
        requestDigest: row.request_digest,
        appliedAt,
        result: {
          type: 'session_expired',
          expiration: {
            expiredAt: appliedAt,
            commandId: row.command_id,
          },
        },
      };
      break;
    default:
      throw invalidPersistedState();
  }

  if (!isSessionCommandPersistenceRecord(record)) {
    throw invalidPersistedState();
  }
  return Object.freeze(record);
}

function hydrateAggregate(
  familyRow: LockedFamilyRow,
  credentialRows: readonly SessionCredentialRow[],
  commandRows: readonly SessionCommandRow[],
  presentedDigest: SessionCredentialDigest,
): HydratedAggregate {
  try {
    if (
      !isSessionId(familyRow.family_id) ||
      !isSessionAccountId(familyRow.account_id) ||
      !isAuthenticationOperationId(
        familyRow.authentication_operation_id,
      ) ||
      !isClosedValue(familyRow.status, SESSION_STATUSES)
    ) {
      throw invalidPersistedState();
    }
    const currentGeneration = decodePostgresNonNegativeBigint(
      familyRow.current_credential_generation,
    );
    const createdAt = nonNegativeEpoch(familyRow.created_at);
    const expiresAt = nonNegativeEpoch(familyRow.expires_at);
    const terminalCommandId = nullableSessionCommandId(
      familyRow.terminal_command_id,
    );
    const terminalAt =
      familyRow.terminal_at === null
        ? null
        : nonNegativeEpoch(familyRow.terminal_at);
    const terminalReuseGeneration = nullableNonNegativeBigint(
      familyRow.terminal_reuse_generation,
    );
    const terminalReuseDigest = nullableDigest(
      familyRow.terminal_reuse_digest,
    );
    const presentedGeneration = decodePostgresNonNegativeBigint(
      familyRow.presented_generation,
    );
    if (
      !isSessionCredentialGeneration(currentGeneration) ||
      !isSessionCredentialGeneration(presentedGeneration)
    ) {
      throw invalidPersistedState();
    }

    const credentials = credentialRows.map(hydrateCredential);
    if (
      credentials.length === 0 ||
      credentials.some(
        (credential) => credential.familyId !== familyRow.family_id,
      )
    ) {
      throw invalidPersistedState();
    }
    const current = credentials.find(
      (credential) => credential.generation === currentGeneration,
    );
    const presented = credentials.find(
      (credential) =>
        credential.generation === presentedGeneration &&
        credential.digest === presentedDigest,
    );
    if (
      current === undefined ||
      presented === undefined ||
      current.consumedAt !== null ||
      current.consumedByCommandId !== null
    ) {
      throw invalidPersistedState();
    }
    const currentCredential: SessionCredentialBinding = Object.freeze({
      digest: current.digest,
      generation: current.generation,
      issuedAt: current.issuedAt,
    });
    const consumedCredentials: ConsumedSessionCredential[] = credentials
      .filter((credential) => credential.generation !== currentGeneration)
      .map((credential) => {
        if (
          credential.consumedAt === null ||
          credential.consumedByCommandId === null
        ) {
          throw invalidPersistedState();
        }
        return Object.freeze({
          digest: credential.digest,
          generation: credential.generation,
          issuedAt: credential.issuedAt,
          consumedAt: credential.consumedAt,
          consumedByCommandId: credential.consumedByCommandId,
        });
      });
    const appliedCommands = commandRows.map(hydrateCommand);
    if (
      commandRows.some((row) => row.family_id !== familyRow.family_id)
    ) {
      throw invalidPersistedState();
    }

    const base = {
      sessionId: familyRow.family_id,
      authenticationOperationId:
        familyRow.authentication_operation_id as AuthenticationOperationId,
      accountId: familyRow.account_id,
      createdAt,
      expiresAt,
      currentCredential,
      consumedCredentials: Object.freeze(consumedCredentials),
      appliedCommands,
    };

    let persisted: unknown;
    switch (familyRow.status) {
      case 'active':
        if (
          terminalCommandId !== null ||
          familyRow.terminal_reason !== null ||
          terminalAt !== null ||
          terminalReuseGeneration !== null ||
          terminalReuseDigest !== null
        ) {
          throw invalidPersistedState();
        }
        persisted = { ...base, status: 'active' };
        break;
      case 'revoked':
        if (
          terminalCommandId === null ||
          !isSessionRevokeReason(familyRow.terminal_reason) ||
          terminalAt === null ||
          terminalReuseGeneration !== null ||
          terminalReuseDigest !== null
        ) {
          throw invalidPersistedState();
        }
        persisted = {
          ...base,
          status: 'revoked',
          revocation: {
            reason: familyRow.terminal_reason as SessionRevokeReason,
            revokedAt: terminalAt,
            commandId: terminalCommandId,
          },
        };
        break;
      case 'expired':
        if (
          terminalCommandId === null ||
          familyRow.terminal_reason !== null ||
          terminalAt === null ||
          terminalReuseGeneration !== null ||
          terminalReuseDigest !== null
        ) {
          throw invalidPersistedState();
        }
        persisted = {
          ...base,
          status: 'expired',
          expiration: {
            expiredAt: terminalAt,
            commandId: terminalCommandId,
          },
        };
        break;
      case 'reuse_detected':
        if (
          terminalCommandId === null ||
          familyRow.terminal_reason !== null ||
          terminalAt === null ||
          !isSessionCredentialGeneration(terminalReuseGeneration) ||
          !isSessionCredentialDigest(terminalReuseDigest)
        ) {
          throw invalidPersistedState();
        }
        persisted = {
          ...base,
          status: 'reuse_detected',
          reuse: {
            detectedAt: terminalAt,
            generation: terminalReuseGeneration,
            digest: terminalReuseDigest,
            commandId: terminalCommandId,
          },
        };
        break;
    }

    return Object.freeze({
      state: hydrateSessionStateFromCommandPersistenceRecords(persisted),
      presentedCredential: Object.freeze({
        digest: presented.digest,
        generation: presented.generation,
      }),
    });
  } catch (error) {
    if (error instanceof SessionCredentialLifecyclePersistenceError) {
      throw error;
    }
    throw invalidPersistedState();
  }
}

function commandFor(
  aggregate: HydratedAggregate,
  input: ApplyPresentedSessionCredentialInput,
): SessionCommand {
  const existing = aggregate.state.appliedCommands.find(
    (command) => command.commandId === input.commandId,
  );
  if (existing?.commandType === 'expire_session') {
    return Object.freeze({
      type: 'expire_session',
      sessionId: aggregate.state.sessionId,
      commandId: input.commandId,
      requestDigest: input.requestDigest,
      now: existing.appliedAt,
    });
  }

  const nextGeneration =
    existing?.commandType === 'rotate_credential'
      ? existing.nextCredential.generation
      : aggregate.state.currentCredential.generation + 1;
  if (existing?.commandType === 'rotate_credential') {
    return Object.freeze({
      type: 'rotate_credential',
      sessionId: aggregate.state.sessionId,
      commandId: input.commandId,
      requestDigest: input.requestDigest,
      now: existing.appliedAt,
      presentedCredential: aggregate.presentedCredential,
      nextCredential: Object.freeze({
        digest: input.nextCredentialDigest,
        generation: nextGeneration,
      }),
    });
  }
  const presentedIsCurrent =
    aggregate.presentedCredential.generation ===
      aggregate.state.currentCredential.generation &&
    aggregate.presentedCredential.digest ===
      aggregate.state.currentCredential.digest;
  if (presentedIsCurrent && input.now >= aggregate.state.expiresAt) {
    return Object.freeze({
      type: 'expire_session',
      sessionId: aggregate.state.sessionId,
      commandId: input.commandId,
      requestDigest: input.requestDigest,
      now: input.now,
    });
  }
  return Object.freeze({
    type: 'rotate_credential',
    sessionId: aggregate.state.sessionId,
    commandId: input.commandId,
    requestDigest: input.requestDigest,
    now: input.now,
    presentedCredential: aggregate.presentedCredential,
    nextCredential: Object.freeze({
      digest: input.nextCredentialDigest,
      generation: nextGeneration,
    }),
  });
}

function mapRejectedTransition(
  transition: Extract<SessionTransitionResult, { readonly outcome: 'rejected' }>,
): ApplyPresentedSessionCredentialResult {
  switch (transition.reason) {
    case 'command_reuse_conflict':
      return Object.freeze({
        outcome: 'rejected',
        reason: 'command_reuse_conflict',
      });
    case 'invalid_next_credential':
      return Object.freeze({
        outcome: 'rejected',
        reason: 'invalid_next_credential',
      });
    case 'forbidden_transition':
    case 'session_expired':
      return Object.freeze({
        outcome: 'rejected',
        reason: 'session_closed',
      });
    case 'invalid_session_state':
      throw invalidPersistedState();
    case 'invalid_session_command':
      throw invalidInput();
    case 'session_binding_conflict':
    case 'invalid_session_credential':
    case 'not_yet_expired':
      throw invalidPersistedState();
  }
}

function resultFor(
  transition: Exclude<
    SessionTransitionResult,
    { readonly outcome: 'rejected' }
  >,
  expiresAt: UnixEpochSeconds,
): ApplyPresentedSessionCredentialResult {
  const persistence =
    transition.outcome === 'transitioned' ? 'applied' : 'idempotent_retry';
  const result =
    transition.outcome === 'transitioned'
      ? transition.result
      : transition.originalResult;
  switch (result.type) {
    case 'credential_rotated':
      return Object.freeze({
        outcome: 'credential_rotated',
        persistence,
        generation: result.credential.generation,
        expiresAt,
      });
    case 'session_expired':
      return Object.freeze({
        outcome: 'session_expired',
        persistence,
        expiresAt,
      });
    case 'reuse_detected':
      return Object.freeze({
        outcome: 'credential_reuse_detected',
        persistence,
        expiresAt,
      });
    case 'session_revoked':
      return Object.freeze({
        outcome: 'rejected',
        reason: 'session_closed',
      });
  }
}

function persistenceRecord(
  previous: SessionState,
  transition: Extract<
    SessionTransitionResult,
    { readonly outcome: 'transitioned' }
  >,
): SessionCommandPersistenceRecord {
  const applied =
    transition.state.appliedCommands[
      transition.state.appliedCommands.length - 1
    ];
  const commandSequence = aggregateCommandSequence(
    previous.appliedCommands.length + 1,
  );
  const base = {
    sessionId: applied.sessionId,
    commandId: applied.commandId,
    commandSequence,
    requestDigest: applied.requestDigest,
    appliedAt: applied.appliedAt,
    result: applied.result,
  };
  let record: SessionCommandPersistenceRecord;
  switch (applied.commandType) {
    case 'rotate_credential':
      if (
        applied.result.type !== 'credential_rotated' &&
        applied.result.type !== 'reuse_detected'
      ) {
        throw invalidPersistedState();
      }
      record = {
        ...base,
        commandType: applied.commandType,
        presentedCredential: applied.presentedCredential,
        nextCredential: applied.nextCredential,
        result: applied.result,
      };
      break;
    case 'revoke_session':
      if (applied.result.type !== 'session_revoked') {
        throw invalidPersistedState();
      }
      record = {
        ...base,
        commandType: applied.commandType,
        reason: applied.reason,
        result: applied.result,
      };
      break;
    case 'expire_session':
      if (applied.result.type !== 'session_expired') {
        throw invalidPersistedState();
      }
      record = {
        ...base,
        commandType: applied.commandType,
        result: applied.result,
      };
      break;
  }
  if (!isSessionCommandPersistenceRecord(record)) {
    throw invalidPersistedState();
  }
  return Object.freeze(record);
}

function commandValues(
  record: SessionCommandPersistenceRecord,
): readonly unknown[] {
  const base = [
    record.sessionId,
    record.commandId,
    record.commandSequence.toString(10),
    record.requestDigest,
    record.commandType,
    record.appliedAt.toString(10),
  ] as const;
  switch (record.commandType) {
    case 'rotate_credential':
      return [
        ...base,
        record.presentedCredential.generation.toString(10),
        encodePostgresByteaDigest(record.presentedCredential.digest),
        record.nextCredential.generation.toString(10),
        encodePostgresByteaDigest(record.nextCredential.digest),
        null,
        record.result.type,
      ];
    case 'revoke_session':
      return [
        ...base,
        null,
        null,
        null,
        null,
        record.reason,
        record.result.type,
      ];
    case 'expire_session':
      return [
        ...base,
        null,
        null,
        null,
        null,
        null,
        record.result.type,
      ];
  }
  const exhaustive: never = record;
  return exhaustive;
}

function mapSecurityAuditFailure(
  reason: SecurityAuditPersistenceError['reason'],
): SessionCredentialLifecyclePersistenceFailure {
  switch (reason) {
    case 'referential_integrity':
      return 'referential_integrity';
    case 'permission_denied':
      return 'permission_denied';
    case 'transaction_conflict':
      return 'transaction_conflict';
    case 'database_unavailable':
      return 'database_unavailable';
    case 'invalid_audit_event':
    case 'storage_failure':
      return 'storage_failure';
  }
}

function mapPersistenceError(
  error: unknown,
): SessionCredentialLifecyclePersistenceError {
  if (error instanceof SessionCredentialLifecyclePersistenceError) {
    return error;
  }
  if (error instanceof SecurityAuditPersistenceError) {
    return new SessionCredentialLifecyclePersistenceError(
      mapSecurityAuditFailure(error.reason),
    );
  }
  const classified = classifyPostgresError(error);
  if (classified.kind !== 'postgres_error') {
    return new SessionCredentialLifecyclePersistenceError('storage_failure');
  }
  const { category, metadata } = classified;
  if (category === 'unique_violation') {
    switch (metadata.constraint) {
      case 'auth_session_credentials_pkey':
      case 'auth_session_credentials_family_digest_key':
      case 'auth_session_credentials_one_unconsumed_uidx':
        return new SessionCredentialLifecyclePersistenceError(
          'credential_conflict',
        );
      case 'auth_session_commands_pkey':
      case 'auth_session_commands_family_sequence_key':
        return new SessionCredentialLifecyclePersistenceError(
          'command_conflict',
        );
      default:
        return new SessionCredentialLifecyclePersistenceError(
          'storage_failure',
        );
    }
  }
  switch (category) {
    case 'foreign_key_violation':
      return new SessionCredentialLifecyclePersistenceError(
        'referential_integrity',
      );
    case 'insufficient_privilege':
      return new SessionCredentialLifecyclePersistenceError(
        'permission_denied',
      );
    case 'serialization_failure':
    case 'deadlock_detected':
      return new SessionCredentialLifecyclePersistenceError(
        'transaction_conflict',
      );
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return new SessionCredentialLifecyclePersistenceError(
        'database_unavailable',
      );
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
    case 'object_not_in_prerequisite_state':
      return invalidPersistedState();
    case 'unknown_postgres_error':
      return metadata.code === '22023'
        ? invalidPersistedState()
        : new SessionCredentialLifecyclePersistenceError('storage_failure');
  }
}

export class PostgresSessionCredentialLifecycleRepository
  implements SessionCredentialLifecycleRepository
{
  constructor(private readonly auditRepository: SecurityAuditRepository) {}

  async applyPresentedCredential(
    transaction: PostgresTransaction,
    input: ApplyPresentedSessionCredentialInput,
  ): Promise<ApplyPresentedSessionCredentialResult> {
    assertValidInput(input);

    try {
      const presentedDigest = encodePostgresByteaDigest(
        input.presentedCredentialDigest,
      );
      const locked = await transaction.query<LockedFamilyRow>(
        SELECT_PRESENTED_CREDENTIAL_FAMILY_FOR_UPDATE_SQL,
        [presentedDigest],
      );
      if (locked.rowCount !== locked.rows.length) {
        throw invalidPersistedState();
      }
      if (locked.rows.length === 0) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'credential_not_found',
        });
      }
      if (locked.rows.length !== 1) {
        throw invalidPersistedState();
      }
      const familyId = locked.rows[0].family_id;
      if (!isSessionId(familyId)) {
        throw invalidPersistedState();
      }

      const credentials = await transaction.query<SessionCredentialRow>(
        SELECT_SESSION_CREDENTIALS_FOR_UPDATE_SQL,
        [familyId],
      );
      const commands = await transaction.query<SessionCommandRow>(
        SELECT_SESSION_COMMANDS_SQL,
        [familyId],
      );
      if (
        credentials.rowCount !== credentials.rows.length ||
        commands.rowCount !== commands.rows.length
      ) {
        throw invalidPersistedState();
      }
      const aggregate = hydrateAggregate(
        locked.rows[0],
        credentials.rows,
        commands.rows,
        input.presentedCredentialDigest,
      );
      const transition = transitionSession(
        aggregate.state,
        commandFor(aggregate, input),
      );
      if (transition.outcome === 'rejected') {
        return mapRejectedTransition(transition);
      }
      if (transition.outcome === 'idempotent_retry') {
        return resultFor(transition, aggregate.state.expiresAt);
      }

      const record = persistenceRecord(aggregate.state, transition);
      await this.persistTransition(
        transaction,
        aggregate.state,
        transition,
        record,
      );
      await this.appendAudit(transaction, input, transition);
      return resultFor(transition, aggregate.state.expiresAt);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  private async persistTransition(
    transaction: PostgresTransaction,
    previous: SessionState,
    transition: Extract<
      SessionTransitionResult,
      { readonly outcome: 'transitioned' }
    >,
    record: SessionCommandPersistenceRecord,
  ): Promise<void> {
    switch (transition.transition) {
      case 'credential_rotated':
        await this.persistRotation(transaction, previous, transition, record);
        return;
      case 'session_expired':
      case 'reuse_detected':
        await this.persistTerminalTransition(
          transaction,
          previous,
          transition,
          record,
        );
        return;
      case 'session_revoked':
        throw invalidPersistedState();
    }
  }

  private async persistRotation(
    transaction: PostgresTransaction,
    previous: SessionState,
    transition: Extract<
      SessionTransitionResult,
      { readonly outcome: 'transitioned' }
    >,
    record: SessionCommandPersistenceRecord,
  ): Promise<void> {
    if (
      transition.transition !== 'credential_rotated' ||
      record.commandType !== 'rotate_credential' ||
      record.result.type !== 'credential_rotated' ||
      transition.state.status !== 'active'
    ) {
      throw invalidPersistedState();
    }
    // The consuming-command foreign key is NOT DEFERRABLE in migration 015,
    // so the command must exist before the old credential can reference it.
    await this.insertCommand(transaction, record);

    const consumed = await transaction.query<SessionCredentialRow>(
      CONSUME_SESSION_CREDENTIAL_SQL,
      [
        previous.sessionId,
        record.presentedCredential.generation.toString(10),
        encodePostgresByteaDigest(record.presentedCredential.digest),
        record.appliedAt.toString(10),
        record.commandId,
      ],
    );
    if (consumed.rowCount !== 1 || consumed.rows.length !== 1) {
      throw invalidPersistedState();
    }
    const authoritativeConsumed = hydrateCredential(consumed.rows[0]);
    if (
      authoritativeConsumed.familyId !== previous.sessionId ||
      authoritativeConsumed.generation !==
        record.presentedCredential.generation ||
      authoritativeConsumed.digest !== record.presentedCredential.digest ||
      authoritativeConsumed.consumedAt !== record.appliedAt ||
      authoritativeConsumed.consumedByCommandId !== record.commandId
    ) {
      throw invalidPersistedState();
    }

    const next = record.result.credential;
    const inserted = await transaction.query<SessionCredentialRow>(
      INSERT_SESSION_CREDENTIAL_SQL,
      [
        previous.sessionId,
        next.generation.toString(10),
        encodePostgresByteaDigest(next.digest),
        next.issuedAt.toString(10),
      ],
    );
    if (inserted.rowCount !== 1 || inserted.rows.length !== 1) {
      throw invalidPersistedState();
    }
    const authoritativeNext = hydrateCredential(inserted.rows[0]);
    if (
      authoritativeNext.familyId !== previous.sessionId ||
      authoritativeNext.generation !== next.generation ||
      authoritativeNext.digest !== next.digest ||
      authoritativeNext.issuedAt !== next.issuedAt ||
      authoritativeNext.consumedAt !== null ||
      authoritativeNext.consumedByCommandId !== null
    ) {
      throw invalidPersistedState();
    }

    const updated = await transaction.query(
      UPDATE_ACTIVE_SESSION_GENERATION_SQL,
      [
        previous.sessionId,
        next.generation.toString(10),
        previous.currentCredential.generation.toString(10),
      ],
    );
    if (
      updated.rowCount !== 1 ||
      updated.rows.length !== 1 ||
      updated.rows[0].id !== previous.sessionId ||
      updated.rows[0].status !== 'active' ||
      decodePostgresNonNegativeBigint(
        updated.rows[0].current_credential_generation,
      ) !== next.generation
    ) {
      throw invalidPersistedState();
    }
  }

  private async persistTerminalTransition(
    transaction: PostgresTransaction,
    previous: SessionState,
    transition: Extract<
      SessionTransitionResult,
      { readonly outcome: 'transitioned' }
    >,
    record: SessionCommandPersistenceRecord,
  ): Promise<void> {
    if (
      transition.transition === 'session_revoked' ||
      transition.transition === 'credential_rotated'
    ) {
      throw invalidPersistedState();
    }
    await this.insertCommand(transaction, record);

    const target =
      transition.transition === 'session_expired'
        ? {
            status: 'expired' as const,
            terminalAt: transition.result.type === 'session_expired'
              ? transition.result.expiration.expiredAt
              : undefined,
            reuseGeneration: null,
            reuseDigest: null,
          }
        : {
            status: 'reuse_detected' as const,
            terminalAt: transition.result.type === 'reuse_detected'
              ? transition.result.reuse.detectedAt
              : undefined,
            reuseGeneration:
              transition.result.type === 'reuse_detected'
                ? transition.result.reuse.generation
                : undefined,
            reuseDigest:
              transition.result.type === 'reuse_detected'
                ? transition.result.reuse.digest
                : undefined,
          };
    if (
      target.terminalAt === undefined ||
      target.reuseGeneration === undefined ||
      target.reuseDigest === undefined
    ) {
      throw invalidPersistedState();
    }
    const updated = await transaction.query(
      UPDATE_TERMINAL_SESSION_SQL,
      [
        previous.sessionId,
        target.status,
        record.commandId,
        null,
        target.terminalAt.toString(10),
        target.reuseGeneration === null
          ? null
          : target.reuseGeneration.toString(10),
        target.reuseDigest === null
          ? null
          : encodePostgresByteaDigest(target.reuseDigest),
        previous.status,
        previous.currentCredential.generation.toString(10),
      ],
    );
    if (
      updated.rowCount !== 1 ||
      updated.rows.length !== 1 ||
      updated.rows[0].id !== previous.sessionId ||
      updated.rows[0].status !== target.status ||
      decodePostgresNonNegativeBigint(
        updated.rows[0].current_credential_generation,
      ) !== previous.currentCredential.generation ||
      updated.rows[0].terminal_command_id !== record.commandId
    ) {
      throw invalidPersistedState();
    }
  }

  private async insertCommand(
    transaction: PostgresTransaction,
    record: SessionCommandPersistenceRecord,
  ): Promise<void> {
    const inserted = await transaction.query(
      INSERT_SESSION_COMMAND_SQL,
      commandValues(record),
    );
    if (
      inserted.rowCount !== 1 ||
      inserted.rows.length !== 1 ||
      inserted.rows[0].family_id !== record.sessionId ||
      inserted.rows[0].command_id !== record.commandId ||
      decodePostgresNonNegativeBigint(
        inserted.rows[0].command_sequence,
      ) !== record.commandSequence
    ) {
      throw invalidPersistedState();
    }
  }

  private async appendAudit(
    transaction: PostgresTransaction,
    input: ApplyPresentedSessionCredentialInput,
    transition: Extract<
      SessionTransitionResult,
      { readonly outcome: 'transitioned' }
    >,
  ): Promise<void> {
    const sessionId = transition.state.sessionId;
    const result = transition.result;
    const event =
      result.type === 'credential_rotated'
        ? createSecurityAuditEvent({
            eventId: input.audit.eventId,
            eventType: 'session_credential_rotation',
            outcome: 'success',
            occurredAt: result.credential.issuedAt,
            metadata: createSecurityAuditMetadata(
              'session_credential_rotation',
              {
                sessionId,
                generation: result.credential.generation,
              },
            ),
          })
        : createSecurityAuditEvent({
            eventId: input.audit.eventId,
            eventType: 'session_family_transition',
            outcome:
              result.type === 'reuse_detected'
                ? 'replay_detected'
                : 'expired',
            occurredAt:
              result.type === 'reuse_detected'
                ? result.reuse.detectedAt
                : result.type === 'session_expired'
                  ? result.expiration.expiredAt
                  : input.now,
            metadata: createSecurityAuditMetadata(
              'session_family_transition',
              {
                sessionId,
                status:
                  result.type === 'reuse_detected'
                    ? 'reuse_detected'
                    : 'expired',
              },
            ),
          });
    const appended = await this.auditRepository.append(transaction, event);
    if (appended.status !== 'appended') {
      throw new SessionCredentialLifecyclePersistenceError(
        'audit_conflict',
      );
    }
  }
}
