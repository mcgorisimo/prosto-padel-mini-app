import {
  AccountId,
  AccountStatus,
  UserRole,
} from '../accounts/account.types';
import { ExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import { ComputedExternalIdentityLookupDigest } from '../accounts/external-identity-lookup-digest.port';
import {
  AuthenticationCommandId,
  AuthenticationIdempotencyKey,
  AuthenticationOperationId,
  AuthenticationRequestDigest,
  TelegramProofVerificationOutcome,
  UnixEpochSeconds,
  VerifiedTelegramProof,
} from './auth.types';
import {
  SecurityAuditEventId,
} from './security-audit.types';
import {
  SessionCredentialDigest,
  SessionId,
} from './session.types';
import { PostgresTransaction } from '../database/postgres-transaction';

export interface TelegramProofVerifier {
  verifyProof(rawInitData: string): TelegramProofVerificationOutcome;
}

export interface TelegramLookupDigestCandidates {
  readonly primary: ComputedExternalIdentityLookupDigest;
  readonly all: readonly ComputedExternalIdentityLookupDigest[];
}

export interface TelegramLookupDigestCandidatesPort {
  computeCandidates(
    proof: VerifiedTelegramProof,
  ): Promise<TelegramLookupDigestCandidates>;
}

export interface TransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AccountStatusReader {
  findById(
    transaction: PostgresTransaction,
    accountId: AccountId,
  ): Promise<
    | { readonly outcome: 'not_found' }
    | {
        readonly outcome: 'found';
        readonly accountId: AccountId;
        readonly role: UserRole;
        readonly status: AccountStatus;
      }
  >;
}

export interface IssuedSessionCredential {
  readonly plaintext: string;
  readonly digest: SessionCredentialDigest;
}

export interface SessionCredentialIssuer {
  issue(): IssuedSessionCredential;
}

export interface TelegramLoginWorkflowAuditIds {
  readonly proofConsumption: SecurityAuditEventId;
  readonly accountCreated: SecurityAuditEventId;
  readonly externalIdentityLinked: SecurityAuditEventId;
  readonly operationTerminal: SecurityAuditEventId;
  readonly sessionCreated: SecurityAuditEventId;
}

export interface TelegramLoginWorkflowTimestamps {
  readonly operationCreatedAt: UnixEpochSeconds;
  readonly operationExpiresAt: UnixEpochSeconds;
  readonly proofConsumedAt: UnixEpochSeconds;
  readonly accountCreatedAt: UnixEpochSeconds;
  readonly terminalAppliedAt: UnixEpochSeconds;
  readonly sessionCreatedAt: UnixEpochSeconds;
  readonly sessionExpiresAt: UnixEpochSeconds;
  readonly credentialIssuedAt: UnixEpochSeconds;
  readonly auditOccurredAt: UnixEpochSeconds;
}

export interface TelegramLoginWorkflowBindings {
  readonly operationId: AuthenticationOperationId;
  readonly idempotencyKey: AuthenticationIdempotencyKey;
  readonly requestDigest: AuthenticationRequestDigest;
  readonly terminalCommandId: AuthenticationCommandId;
  readonly accountId: AccountId;
  readonly identityId: ExternalIdentityId;
  readonly sessionId: SessionId;
  readonly auditEventIds: TelegramLoginWorkflowAuditIds;
  readonly timestamps: TelegramLoginWorkflowTimestamps;
}

export interface TelegramLoginWorkflowBindingsPort {
  /**
   * The same requestKey and verified proof must always produce exactly the
   * same bindings. This port owns the retry-stability policy.
   */
  create(
    requestKey: string,
    proof: VerifiedTelegramProof,
    now: UnixEpochSeconds,
  ): TelegramLoginWorkflowBindings;
}
