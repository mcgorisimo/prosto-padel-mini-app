import {
  ACCOUNT_STATUSES,
  USER_ROLES,
  AccountId,
  isAccountId,
} from '../accounts/account.types';
import {
  isExternalIdentityId,
} from '../accounts/external-identity-lifecycle.types';
import {
  isComputedExternalIdentityLookupDigest,
} from '../accounts/external-identity-lookup-digest.port';
import {
  CreatePlayerAccountWithProfileBinding,
  validatePlayerAccountWithProfileCreation,
} from '../accounts/player-profile.types';
import {
  TelegramProofVerificationOutcome,
  VerifiedTelegramProof,
  isAuthenticationCommandId,
  isAuthenticationIdempotencyKey,
  isAuthenticationOperationId,
  isAuthenticationRequestDigest,
  isUnixEpochSeconds,
  telegramAuthenticationProofReference,
} from './auth.types';
import {
  AuthenticationOperationBinding,
  PendingAuthenticationOperation,
  createAuthenticationOperation,
} from './authentication-operation.state-machine';
import {
  AccountResolutionOutcome,
  accountResolutionConflict,
  newAccountRequired,
  resolveExistingAccountStatus,
} from './account-resolution.types';
import {
  EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
  TelegramProofConsumptionRecord,
  consumeTelegramProof,
} from './telegram-proof-consumption.state-machine';
import {
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from './security-audit.types';
import {
  CreateActiveSessionBinding,
  isSessionCredentialDigest,
  isSessionId,
} from './session.types';
import { createActiveSession } from './session.state-machine';
import { isInternalUuid } from '../common/internal-uuid';
import {
  ExternalIdentityPersistenceError,
  ExternalIdentityResolutionRepository,
} from '../database/external-identity.repository';
import {
  InitialSessionPersistenceError,
  InitialSessionRepository,
} from '../database/initial-session.repository';
import {
  PlayerAccountProvisioningPersistenceError,
  PlayerAccountProvisioningRepository,
} from '../database/player-account-provisioning.repository';
import {
  AuthenticationOperationTerminalPersistenceError,
  AuthenticationOperationTerminalRepository,
} from '../database/authentication-operation-terminal.repository';
import {
  TelegramAuthenticationOperationPersistenceError,
  TelegramAuthenticationOperationRepository,
} from '../database/telegram-authentication-operation.repository';
import { classifyPostgresError } from '../database/postgres-error-classifier';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  AccountStatusReader,
  SessionCredentialIssuer,
  TelegramLoginWorkflowBindings,
  TelegramLoginWorkflowBindingsPort,
  TelegramLookupDigestCandidates,
  TelegramLookupDigestCandidatesPort,
  TelegramProofVerifier,
  TransactionExecutor,
} from './telegram-login.ports';
import {
  TelegramLoginInput,
  TelegramLoginRejectionReason,
  TelegramLoginResult,
} from './telegram-login.types';

const REQUEST_KEY_MAX_LENGTH = 256;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const INTENT = 'sign_up' as const;

export interface TelegramLoginServiceDependencies {
  readonly verifier: TelegramProofVerifier;
  readonly lookupDigests: TelegramLookupDigestCandidatesPort;
  readonly transactions: TransactionExecutor;
  readonly pendingOperations: TelegramAuthenticationOperationRepository;
  readonly externalIdentities: ExternalIdentityResolutionRepository;
  readonly accounts: AccountStatusReader;
  readonly playerAccounts: PlayerAccountProvisioningRepository;
  readonly terminalOperations: AuthenticationOperationTerminalRepository;
  readonly credentialIssuer: SessionCredentialIssuer;
  readonly initialSessions: InitialSessionRepository;
  readonly workflowBindings: TelegramLoginWorkflowBindingsPort;
}

interface PreparedWorkflow {
  readonly proof: VerifiedTelegramProof;
  readonly digests: TelegramLookupDigestCandidates;
  readonly bindings: TelegramLoginWorkflowBindings;
  readonly operation: PendingAuthenticationOperation & {
    readonly identityKey: {
      readonly provider: 'telegram';
      readonly namespace: VerifiedTelegramProof['namespace'];
      readonly lookup: {
        readonly kind: 'lookup_digest';
        readonly digest: TelegramLookupDigestCandidates['primary']['digest'];
      };
    };
    readonly proofReference: ReturnType<
      typeof telegramAuthenticationProofReference
    >;
  };
  readonly consumption: TelegramProofConsumptionRecord;
}

interface ResolvedAccount {
  readonly accountKind: 'existing' | 'new';
  readonly accountId: AccountId;
}

type RejectedTelegramLoginResult = Extract<
  TelegramLoginResult,
  { readonly outcome: 'rejected' }
>;

type TransactionAttempt<T> =
  | { readonly succeeded: true; readonly value: T }
  | {
      readonly succeeded: false;
      readonly rejection: RejectedTelegramLoginResult;
    };

class TelegramLoginTransactionAbort extends Error {
  readonly name = 'TelegramLoginTransactionAbort';

  constructor(readonly reason: TelegramLoginRejectionReason) {
    super('Telegram login transaction aborted');
  }
}

function rejected(
  reason: TelegramLoginRejectionReason,
): RejectedTelegramLoginResult {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function isApplicationRejection(
  value: unknown,
): value is RejectedTelegramLoginResult {
  return isRecord(value) && value.outcome === 'rejected';
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

function validRequestKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= REQUEST_KEY_MAX_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function validInput(value: unknown): value is TelegramLoginInput {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, ['rawInitData', 'now', 'requestKey']) &&
    typeof value.rawInitData === 'string' &&
    value.rawInitData.length > 0 &&
    isUnixEpochSeconds(value.now) &&
    validRequestKey(value.requestKey)
  );
}

function validAuditIds(
  value: TelegramLoginWorkflowBindings['auditEventIds'],
): boolean {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, [
      'proofConsumption',
      'accountCreated',
      'externalIdentityLinked',
      'operationTerminal',
      'sessionCreated',
    ]) &&
    Object.values(value).every(isInternalUuid)
  );
}

function validTimestamps(
  value: TelegramLoginWorkflowBindings['timestamps'],
  proof: VerifiedTelegramProof,
): boolean {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      'operationCreatedAt',
      'operationExpiresAt',
      'proofConsumedAt',
      'accountCreatedAt',
      'terminalAppliedAt',
      'sessionCreatedAt',
      'sessionExpiresAt',
      'credentialIssuedAt',
      'auditOccurredAt',
    ]) ||
    !Object.values(value).every(isUnixEpochSeconds)
  ) {
    return false;
  }

  return (
    value.operationCreatedAt < value.operationExpiresAt &&
    value.operationExpiresAt <= proof.expiresAt &&
    value.proofConsumedAt < proof.expiresAt &&
    value.terminalAppliedAt >= value.operationCreatedAt &&
    value.sessionCreatedAt < value.sessionExpiresAt &&
    value.credentialIssuedAt >= value.sessionCreatedAt &&
    value.credentialIssuedAt < value.sessionExpiresAt
  );
}

function validWorkflowBindings(
  value: unknown,
  proof: VerifiedTelegramProof,
): value is TelegramLoginWorkflowBindings {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      'operationId',
      'idempotencyKey',
      'requestDigest',
      'terminalCommandId',
      'accountId',
      'identityId',
      'sessionId',
      'auditEventIds',
      'timestamps',
    ])
  ) {
    return false;
  }

  return (
    isAuthenticationOperationId(value.operationId) &&
    isAuthenticationIdempotencyKey(value.idempotencyKey) &&
    isAuthenticationRequestDigest(value.requestDigest) &&
    isAuthenticationCommandId(value.terminalCommandId) &&
    isAccountId(value.accountId) &&
    isExternalIdentityId(value.identityId) &&
    isSessionId(value.sessionId) &&
    validAuditIds(
      value.auditEventIds as TelegramLoginWorkflowBindings['auditEventIds'],
    ) &&
    validTimestamps(
      value.timestamps as TelegramLoginWorkflowBindings['timestamps'],
      proof,
    )
  );
}

function computedDigestsAreValid(
  value: unknown,
  proof: VerifiedTelegramProof,
): value is TelegramLookupDigestCandidates {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['primary', 'all']) ||
    !isComputedExternalIdentityLookupDigest(value.primary) ||
    !Array.isArray(value.all) ||
    value.all.length === 0
  ) {
    return false;
  }

  let primaryFound = false;
  for (const candidate of value.all) {
    if (
      !isComputedExternalIdentityLookupDigest(candidate) ||
      candidate.provider !== 'telegram' ||
      candidate.namespace !== proof.namespace
    ) {
      return false;
    }
    if (
      candidate.algorithm === value.primary.algorithm &&
      candidate.provider === value.primary.provider &&
      candidate.namespace === value.primary.namespace &&
      candidate.digest === value.primary.digest &&
      candidate.digestVersion === value.primary.digestVersion &&
      candidate.pepperVersion === value.primary.pepperVersion
    ) {
      primaryFound = true;
    }
  }

  return (
    value.primary.provider === 'telegram' &&
    value.primary.namespace === proof.namespace &&
    primaryFound
  );
}

function mapPersistenceReason(reason: string): TelegramLoginRejectionReason {
  switch (reason) {
    case 'transaction_conflict':
      return 'temporary_conflict';
    case 'database_unavailable':
    case 'permission_denied':
      return 'dependency_unavailable';
    case 'identity_reserved':
    case 'identity_resolution_conflict':
    case 'account_binding_conflict':
    case 'identity_binding_conflict':
    case 'session_binding_conflict':
    case 'credential_conflict':
      return 'request_conflict';
    default:
      return 'internal_failure';
  }
}

function mapFailure(error: unknown): TelegramLoginRejectionReason {
  if (error instanceof TelegramLoginTransactionAbort) {
    return error.reason;
  }
  if (
    error instanceof TelegramAuthenticationOperationPersistenceError ||
    error instanceof ExternalIdentityPersistenceError ||
    error instanceof PlayerAccountProvisioningPersistenceError ||
    error instanceof AuthenticationOperationTerminalPersistenceError ||
    error instanceof InitialSessionPersistenceError
  ) {
    return mapPersistenceReason(error.reason);
  }

  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return 'internal_failure';
  }
  switch (classified.category) {
    case 'serialization_failure':
    case 'deadlock_detected':
      return 'temporary_conflict';
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return 'dependency_unavailable';
    default:
      return 'internal_failure';
  }
}

function operationBinding(
  prepared: PreparedWorkflow,
): AuthenticationOperationBinding {
  return {
    operationId: prepared.operation.operationId,
    intent: prepared.operation.intent,
    identityKey: prepared.operation.identityKey,
    proofReference: prepared.operation.proofReference,
    createdAt: prepared.operation.createdAt,
    expiresAt: prepared.operation.expiresAt,
    idempotencyKey: prepared.operation.idempotencyKey,
    requestDigest: prepared.operation.requestDigest,
  };
}

function createPlayerBinding(
  accountId: AccountId,
): CreatePlayerAccountWithProfileBinding | undefined {
  const validated = validatePlayerAccountWithProfileCreation({
    account: {
      accountId,
      role: 'player',
      status: 'active',
    },
    playerProfile: { accountId },
  });
  return validated.outcome === 'validated' ? validated.binding : undefined;
}

function initialSessionRejection(
  reason: string,
): TelegramLoginRejectionReason {
  switch (reason) {
    case 'account_not_found':
    case 'account_not_active':
      return 'account_unavailable';
    default:
      return 'request_conflict';
  }
}

export class TelegramLoginService {
  constructor(private readonly dependencies: TelegramLoginServiceDependencies) {}

  async authenticateWithTelegram(
    input: TelegramLoginInput,
  ): Promise<TelegramLoginResult> {
    if (!validInput(input)) {
      return rejected('invalid_telegram_data');
    }

    const prepared = await this.prepare(input);
    if (isApplicationRejection(prepared)) {
      return prepared;
    }

    const pendingAttempt = await this.runTransaction((transaction) =>
      this.dependencies.pendingOperations.persistPending(transaction, {
        operation: prepared.operation,
        consumption: prepared.consumption,
        audit: {
          eventId: prepared.bindings.auditEventIds.proofConsumption,
          occurredAt: prepared.bindings.timestamps.auditOccurredAt,
        },
      }),
    );
    if (!pendingAttempt.succeeded) {
      return pendingAttempt.rejection;
    }
    const pending = pendingAttempt.value;
    if (pending.outcome === 'conflict') {
      return rejected('request_conflict');
    }
    if (pending.outcome === 'replay') {
      return rejected('proof_replayed');
    }
    if (pending.operationId !== prepared.bindings.operationId) {
      return rejected('internal_failure');
    }

    const accountAttempt = await this.runTransaction((transaction) =>
      this.resolveAndComplete(transaction, prepared),
    );
    if (!accountAttempt.succeeded) {
      return accountAttempt.rejection;
    }
    const account = accountAttempt.value;
    if (isApplicationRejection(account)) {
      return account;
    }

    let issued;
    try {
      issued = this.dependencies.credentialIssuer.issue();
    } catch {
      return rejected('internal_failure');
    }
    if (
      !isRecord(issued) ||
      !hasExactlyKeys(issued, ['plaintext', 'digest']) ||
      typeof issued.plaintext !== 'string' ||
      issued.plaintext.length === 0 ||
      !isSessionCredentialDigest(issued.digest)
    ) {
      return rejected('internal_failure');
    }

    const sessionBinding: CreateActiveSessionBinding = {
      sessionId: prepared.bindings.sessionId,
      authenticationOperationId: prepared.bindings.operationId,
      accountId: account.accountId,
      createdAt: prepared.bindings.timestamps.sessionCreatedAt,
      expiresAt: prepared.bindings.timestamps.sessionExpiresAt,
      currentCredential: {
        digest: issued.digest,
        generation: 1,
        issuedAt: prepared.bindings.timestamps.credentialIssuedAt,
      },
    };
    const sessionState = createActiveSession(sessionBinding);
    if (sessionState.outcome !== 'created') {
      return rejected('internal_failure');
    }

    const sessionAttempt = await this.runTransaction((transaction) =>
      this.dependencies.initialSessions.createInitialSession(transaction, {
        binding: sessionBinding,
        audit: {
          eventId: prepared.bindings.auditEventIds.sessionCreated,
          occurredAt: prepared.bindings.timestamps.auditOccurredAt,
        },
      }),
    );
    if (!sessionAttempt.succeeded) {
      return sessionAttempt.rejection;
    }
    const session = sessionAttempt.value;
    if (session.outcome === 'rejected') {
      return rejected(initialSessionRejection(session.reason));
    }
    if (session.outcome === 'conflict') {
      return rejected('request_conflict');
    }
    if (
      session.sessionId !== prepared.bindings.sessionId ||
      session.generation !== 1 ||
      session.expiresAt !== prepared.bindings.timestamps.sessionExpiresAt
    ) {
      return rejected('internal_failure');
    }

    return Object.freeze({
      outcome: 'authenticated',
      credential: issued.plaintext,
      expiresAt: session.expiresAt,
      accountKind: account.accountKind,
    });
  }

  private async prepare(
    input: TelegramLoginInput,
  ): Promise<PreparedWorkflow | RejectedTelegramLoginResult> {
    let proofOutcome: TelegramProofVerificationOutcome;
    try {
      proofOutcome = this.dependencies.verifier.verifyProof(input.rawInitData);
    } catch {
      return rejected('invalid_telegram_data');
    }
    if (proofOutcome.status === 'invalid') {
      return rejected('invalid_telegram_data');
    }
    if (proofOutcome.status === 'expired') {
      return rejected('telegram_proof_expired');
    }

    const proof = proofOutcome.proof;
    if (
      proof.provider !== 'telegram' ||
      proof.identityKey.provider !== 'telegram' ||
      proof.identityKey.namespace !== proof.namespace ||
      proof.identityKey.lookup.kind !== 'canonical_subject'
    ) {
      return rejected('invalid_telegram_data');
    }
    let digests: TelegramLookupDigestCandidates;
    let bindings: TelegramLoginWorkflowBindings;
    try {
      digests = await this.dependencies.lookupDigests.computeCandidates(proof);
      bindings = this.dependencies.workflowBindings.create(
        input.requestKey,
        proof,
        input.now,
      );
    } catch {
      return rejected('internal_failure');
    }
    if (
      !computedDigestsAreValid(digests, proof) ||
      !validWorkflowBindings(bindings, proof)
    ) {
      return rejected('internal_failure');
    }

    const identityKey = Object.freeze({
      provider: 'telegram' as const,
      namespace: proof.namespace,
      lookup: Object.freeze({
        kind: 'lookup_digest' as const,
        digest: digests.primary.digest,
      }),
    });
    const created = createAuthenticationOperation({
      operationId: bindings.operationId,
      intent: INTENT,
      identityKey,
      proofReference: telegramAuthenticationProofReference(
        proof.proofFingerprint,
      ),
      createdAt: bindings.timestamps.operationCreatedAt,
      expiresAt: bindings.timestamps.operationExpiresAt,
      idempotencyKey: bindings.idempotencyKey,
      requestDigest: bindings.requestDigest,
    });
    if (created.outcome !== 'created') {
      return rejected('internal_failure');
    }

    const consumed = consumeTelegramProof(
      EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
      {
        proof: proofOutcome,
        intent: INTENT,
        idempotencyKey: bindings.idempotencyKey,
        requestDigest: bindings.requestDigest,
        operationId: bindings.operationId,
        now: bindings.timestamps.proofConsumedAt,
      },
    );
    if (consumed.outcome === 'expired') {
      return rejected('telegram_proof_expired');
    }
    if (consumed.outcome !== 'first_use') {
      return rejected('internal_failure');
    }

    return {
      proof,
      digests,
      bindings,
      operation: created.state as PreparedWorkflow['operation'],
      consumption: consumed.consumption,
    };
  }

  private async resolveAndComplete(
    transaction: PostgresTransaction,
    prepared: PreparedWorkflow,
  ): Promise<ResolvedAccount | RejectedTelegramLoginResult> {
    const resolution =
      await this.dependencies.externalIdentities.resolveByLookupDigests(
        transaction,
        prepared.digests.all,
      );

    switch (resolution.outcome) {
      case 'historical_reservation':
      case 'conflict':
        return rejected('request_conflict');
      case 'not_found':
        return this.provisionAndComplete(transaction, prepared);
      case 'linked':
        break;
    }

    if (
      resolution.identity.provider !== 'telegram' ||
      resolution.identity.namespace !== prepared.proof.namespace
    ) {
      return rejected('request_conflict');
    }

    const account = await this.dependencies.accounts.findById(
      transaction,
      resolution.identity.accountId,
    );
    if (account.outcome === 'not_found') {
      return rejected('account_unavailable');
    }
    if (
      account.accountId !== resolution.identity.accountId ||
      !(USER_ROLES as readonly string[]).includes(account.role) ||
      !(ACCOUNT_STATUSES as readonly string[]).includes(account.status)
    ) {
      return rejected('internal_failure');
    }

    const accountResolution =
      account.status === 'anonymized'
        ? accountResolutionConflict(
            prepared.operation.identityKey,
            'account_anonymized',
          )
        : resolveExistingAccountStatus(
            prepared.operation.identityKey,
            account.accountId,
            account.status,
          );
    const terminal = await this.completeOperation(
      transaction,
      prepared,
      accountResolution,
    );
    if (terminal !== undefined) {
      return rejected(terminal);
    }
    if (account.status !== 'active') {
      return rejected('account_unavailable');
    }

    return {
      accountKind: 'existing',
      accountId: account.accountId,
    };
  }

  private async provisionAndComplete(
    transaction: PostgresTransaction,
    prepared: PreparedWorkflow,
  ): Promise<ResolvedAccount> {
    const playerBinding = createPlayerBinding(prepared.bindings.accountId);
    if (playerBinding === undefined) {
      throw new TelegramLoginTransactionAbort('internal_failure');
    }

    const provisioned = await this.dependencies.playerAccounts.provision(
      transaction,
      {
        binding: playerBinding,
        createdAt: prepared.bindings.timestamps.accountCreatedAt,
        identity: {
          identityId: prepared.bindings.identityId,
          provider: 'telegram',
          namespace: prepared.proof.namespace,
          isPrimary: true,
        },
        lookupDigests: prepared.digests.all,
        auditEvents: {
          accountCreated: createSecurityAuditEvent({
            eventId: prepared.bindings.auditEventIds.accountCreated,
            eventType: 'account_created',
            outcome: 'success',
            occurredAt: prepared.bindings.timestamps.auditOccurredAt,
            metadata: createSecurityAuditMetadata('account_created', {
              accountId: prepared.bindings.accountId,
              role: 'player',
            }),
          }),
          externalIdentityLinked: createSecurityAuditEvent({
            eventId:
              prepared.bindings.auditEventIds.externalIdentityLinked,
            eventType: 'external_identity_linked',
            outcome: 'success',
            occurredAt: prepared.bindings.timestamps.auditOccurredAt,
            metadata: createSecurityAuditMetadata(
              'external_identity_linked',
              {
                identityId: prepared.bindings.identityId,
                accountId: prepared.bindings.accountId,
                provider: 'telegram',
              },
            ),
          }),
        },
      },
    );
    if (
      provisioned.outcome !== 'created' ||
      provisioned.accountId !== prepared.bindings.accountId
    ) {
      throw new TelegramLoginTransactionAbort('internal_failure');
    }

    const terminalFailure = await this.completeOperation(
      transaction,
      prepared,
      newAccountRequired(prepared.operation.identityKey),
    );
    if (terminalFailure !== undefined) {
      throw new TelegramLoginTransactionAbort(terminalFailure);
    }

    return {
      accountKind: 'new',
      accountId: prepared.bindings.accountId,
    };
  }

  private async completeOperation(
    transaction: PostgresTransaction,
    prepared: PreparedWorkflow,
    resolution: AccountResolutionOutcome,
  ): Promise<TelegramLoginRejectionReason | undefined> {
    const terminal =
      await this.dependencies.terminalOperations.applyTerminalCommand(
        transaction,
        {
          command: {
            type: 'complete',
            commandId: prepared.bindings.terminalCommandId,
            binding: operationBinding(prepared),
            now: prepared.bindings.timestamps.terminalAppliedAt,
            resolution,
          },
          audit: {
            eventId: prepared.bindings.auditEventIds.operationTerminal,
            occurredAt: prepared.bindings.timestamps.auditOccurredAt,
          },
        },
      );

    if (terminal.outcome === 'rejected') {
      return terminal.reason === 'operation_expired'
        ? 'telegram_proof_expired'
        : 'request_conflict';
    }
    if (
      terminal.operationId !== prepared.bindings.operationId ||
      terminal.status !== 'completed'
    ) {
      return 'internal_failure';
    }
    return undefined;
  }

  private async runTransaction<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<TransactionAttempt<T>> {
    try {
      return {
        succeeded: true,
        value: await this.dependencies.transactions.run(operation),
      };
    } catch (error) {
      return {
        succeeded: false,
        rejection: rejected(mapFailure(error)),
      };
    }
  }
}
