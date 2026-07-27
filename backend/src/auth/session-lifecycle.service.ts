import { createHash } from 'node:crypto';
import { SecurityAuditEventId } from './security-audit.types';
import {
  SessionCredentialIssuer,
  digestSessionCredential,
  isCanonicalSessionCredential,
} from './session-credential';
import {
  SessionCommandId,
  SessionCredentialDigest,
  SessionRequestDigest,
  isSessionRequestDigest,
} from './session.types';
import {
  SessionLifecycleRequestInput,
  SessionLogoutResult,
  SessionRefreshResult,
} from './session-lifecycle.types';
import {
  encodeLengthPrefixedUtf8,
  uuidV5FromParts,
} from './crypto-encoding';
import {
  isUnixEpochSeconds,
} from './auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  ApplyPresentedSessionCredentialResult,
  RevokePresentedSessionResult,
  SessionCredentialLifecyclePersistenceError,
  SessionCredentialLifecycleRepository,
} from '../database/session-credential-lifecycle.repository';

const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

const BINDING_DOMAINS = Object.freeze({
  refresh: Object.freeze({
    command: 'prosto-padel.auth.session.refresh.command.v1',
    audit: 'prosto-padel.auth.session.refresh.audit.v1',
    request: 'prosto-padel.auth.session.refresh.request.v1',
  }),
  logout: Object.freeze({
    command: 'prosto-padel.auth.session.logout.command.v1',
    audit: 'prosto-padel.auth.session.logout.audit.v1',
    request: 'prosto-padel.auth.session.logout.request.v1',
  }),
} as const);

type SessionLifecycleOperation = keyof typeof BINDING_DOMAINS;

interface SessionLifecycleBindings {
  readonly commandId: SessionCommandId;
  readonly requestDigest: SessionRequestDigest;
  readonly auditEventId: SecurityAuditEventId;
}

export interface SessionLifecycleTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface SessionLifecycleServiceDependencies {
  readonly transactions: SessionLifecycleTransactionExecutor;
  readonly sessions: SessionCredentialLifecycleRepository;
  readonly credentialIssuer: SessionCredentialIssuer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function validInput(value: unknown): value is SessionLifecycleRequestInput {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['credential', 'requestKey', 'now']) &&
    isCanonicalSessionCredential(value.credential) &&
    isInternalUuid(value.requestKey) &&
    isUnixEpochSeconds(value.now)
  );
}

function deriveBindings(
  operation: SessionLifecycleOperation,
  requestKey: string,
  presentedCredentialDigest: SessionCredentialDigest,
): SessionLifecycleBindings {
  const domains = BINDING_DOMAINS[operation];
  const commandId = uuidV5FromParts(UUID_URL_NAMESPACE, [
    domains.command,
    requestKey,
  ]) as SessionCommandId;
  const auditEventId = uuidV5FromParts(UUID_URL_NAMESPACE, [
    domains.audit,
    requestKey,
  ]) as SecurityAuditEventId;
  const requestDigest = createHash('sha256')
    .update(
      encodeLengthPrefixedUtf8([
        domains.request,
        requestKey,
        presentedCredentialDigest,
      ]),
    )
    .digest('hex');
  if (!isSessionRequestDigest(requestDigest)) {
    throw new TypeError('Session lifecycle request binding is invalid');
  }
  return Object.freeze({
    commandId,
    requestDigest,
    auditEventId,
  });
}

function refreshRejected(
  reason: Extract<
    SessionRefreshResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): SessionRefreshResult {
  return Object.freeze({ outcome: 'rejected', reason });
}

function logoutRejected(
  reason: Extract<
    SessionLogoutResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): SessionLogoutResult {
  return Object.freeze({ outcome: 'rejected', reason });
}

function temporaryStorageFailure(error: unknown): boolean {
  return (
    error instanceof SessionCredentialLifecyclePersistenceError &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

function mapRefreshResult(
  result: ApplyPresentedSessionCredentialResult,
  nextCredential: string,
): SessionRefreshResult {
  switch (result.outcome) {
    case 'credential_rotated':
      if (result.persistence === 'idempotent_retry') {
        return refreshRejected('session_refresh_reopen_required');
      }
      return Object.freeze({
        outcome: 'refreshed',
        credential: nextCredential,
        expiresAt: result.expiresAt,
      });
    case 'session_expired':
      return refreshRejected('session_expired');
    case 'credential_reuse_detected':
      return refreshRejected('session_invalid');
    case 'rejected':
      switch (result.reason) {
        case 'credential_not_found':
        case 'session_closed':
          return refreshRejected('session_invalid');
        case 'command_reuse_conflict':
          return refreshRejected('session_request_conflict');
        case 'invalid_next_credential':
          return refreshRejected('internal_failure');
      }
  }
}

function mapLogoutResult(
  result: RevokePresentedSessionResult,
): SessionLogoutResult {
  if (result.outcome === 'session_revoked') {
    return Object.freeze({ outcome: 'logged_out' });
  }
  switch (result.reason) {
    case 'credential_not_found':
    case 'session_closed':
      return logoutRejected('session_invalid');
    case 'command_reuse_conflict':
      return logoutRejected('session_request_conflict');
  }
}

export class SessionLifecycleService {
  constructor(
    readonly dependencies: SessionLifecycleServiceDependencies,
  ) {}

  async refresh(input: SessionLifecycleRequestInput): Promise<SessionRefreshResult> {
    if (!validInput(input)) {
      return refreshRejected('invalid_request');
    }

    let presentedCredentialDigest: SessionCredentialDigest;
    let nextCredential: ReturnType<SessionCredentialIssuer['issue']>;
    let bindings: SessionLifecycleBindings;
    try {
      presentedCredentialDigest = digestSessionCredential(input.credential);
      nextCredential = this.dependencies.credentialIssuer.issue();
      if (
        !isRecord(nextCredential) ||
        !hasExactlyKeys(nextCredential, ['plaintext', 'digest']) ||
        !isCanonicalSessionCredential(nextCredential.plaintext) ||
        digestSessionCredential(nextCredential.plaintext) !==
          nextCredential.digest ||
        nextCredential.digest === presentedCredentialDigest
      ) {
        return refreshRejected('internal_failure');
      }
      bindings = deriveBindings(
        'refresh',
        input.requestKey,
        presentedCredentialDigest,
      );
    } catch {
      return refreshRejected('internal_failure');
    }

    try {
      const result = await this.dependencies.transactions.run(
        (transaction) =>
          this.dependencies.sessions.applyPresentedCredential(transaction, {
            presentedCredentialDigest,
            nextCredentialDigest: nextCredential.digest,
            commandId: bindings.commandId,
            requestDigest: bindings.requestDigest,
            now: input.now,
            audit: { eventId: bindings.auditEventId },
          }),
      );
      return mapRefreshResult(result, nextCredential.plaintext);
    } catch (error) {
      return refreshRejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }

  async logout(input: SessionLifecycleRequestInput): Promise<SessionLogoutResult> {
    if (!validInput(input)) {
      return logoutRejected('invalid_request');
    }

    let presentedCredentialDigest: SessionCredentialDigest;
    let bindings: SessionLifecycleBindings;
    try {
      presentedCredentialDigest = digestSessionCredential(input.credential);
      bindings = deriveBindings(
        'logout',
        input.requestKey,
        presentedCredentialDigest,
      );
    } catch {
      return logoutRejected('internal_failure');
    }

    try {
      const result = await this.dependencies.transactions.run(
        (transaction) =>
          this.dependencies.sessions.revokePresentedSession(transaction, {
            presentedCredentialDigest,
            commandId: bindings.commandId,
            requestDigest: bindings.requestDigest,
            now: input.now,
            audit: { eventId: bindings.auditEventId },
          }),
      );
      return mapLogoutResult(result);
    } catch (error) {
      return logoutRejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }
}
