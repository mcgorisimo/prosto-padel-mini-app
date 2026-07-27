import {
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import {
  SessionAuthenticationPersistenceError,
  SessionAuthenticationRepository,
} from '../database/session-authentication.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  digestSessionCredential,
  isCanonicalSessionCredential,
} from './session-credential';
import {
  AuthenticatedSessionPrincipal,
  SessionAuthenticationInput,
  SessionAuthenticationResult,
} from './session-authentication.types';
import { isUnixEpochSeconds } from './auth.types';

export interface SessionAuthenticationTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface SessionAuthenticationServiceDependencies {
  readonly transactions: SessionAuthenticationTransactionExecutor;
  readonly sessions: SessionAuthenticationRepository;
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

function validInput(value: unknown): value is SessionAuthenticationInput {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['credential', 'now']) &&
    isCanonicalSessionCredential(value.credential) &&
    isUnixEpochSeconds(value.now)
  );
}

function rejected(
  reason: Extract<
    SessionAuthenticationResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): SessionAuthenticationResult {
  return Object.freeze({ outcome: 'rejected', reason });
}

function isAllowedValue(
  value: unknown,
  allowed: readonly string[],
): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

function readPrincipal(
  value: unknown,
  now: SessionAuthenticationInput['now'],
): AuthenticatedSessionPrincipal | undefined {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      'outcome',
      'accountId',
      'role',
      'expiresAt',
    ]) ||
    value.outcome !== 'authenticated' ||
    !isAccountId(value.accountId) ||
    !isAllowedValue(value.role, USER_ROLES) ||
    !isUnixEpochSeconds(value.expiresAt) ||
    value.expiresAt <= now
  ) {
    return undefined;
  }
  return Object.freeze({
    accountId: value.accountId,
    role: value.role,
    expiresAt: value.expiresAt,
  }) as AuthenticatedSessionPrincipal;
}

function isRejectedRepositoryResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['outcome']) &&
    value.outcome === 'rejected'
  );
}

function temporaryStorageFailure(error: unknown): boolean {
  return (
    error instanceof SessionAuthenticationPersistenceError &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

export class SessionAuthenticationService {
  constructor(
    readonly dependencies: SessionAuthenticationServiceDependencies,
  ) {}

  async authenticate(
    input: SessionAuthenticationInput,
  ): Promise<SessionAuthenticationResult> {
    if (!validInput(input)) {
      return rejected('invalid_request');
    }

    let digest;
    try {
      digest = digestSessionCredential(input.credential);
    } catch {
      return rejected('internal_failure');
    }

    try {
      const result = await this.dependencies.transactions.run(
        (transaction) =>
          this.dependencies.sessions.authenticatePresentedCredential(
            transaction,
            {
              presentedCredentialDigest: digest,
              now: input.now,
            },
          ),
      );
      const principal = readPrincipal(result, input.now);
      if (principal !== undefined) {
        return Object.freeze({
          outcome: 'authenticated',
          principal,
        });
      }
      if (isRejectedRepositoryResult(result)) {
        return rejected('session_invalid');
      }
      return rejected('internal_failure');
    } catch (error) {
      return rejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }
}
