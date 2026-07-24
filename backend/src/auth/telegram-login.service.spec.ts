import { QueryResult, QueryResultRow } from 'pg';
import {
  AccountId,
  AccountStatus,
  UserRole,
} from '../accounts/account.types';
import {
  ExternalIdentityId,
} from '../accounts/external-identity-lifecycle.types';
import {
  EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  ComputedExternalIdentityLookupDigest,
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../accounts/external-identity-lookup-digest.port';
import {
  externalIdentityLookupDigest,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  AuthenticationCommandId,
  AuthenticationIdempotencyKey,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationRequestDigest,
  TelegramProofVerificationOutcome,
  UnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';
import { SecurityAuditEventId } from './security-audit.types';
import {
  SessionCredentialDigest,
  SessionId,
} from './session.types';
import {
  ExternalIdentityResolutionRepository,
  ExternalIdentityResolutionResult,
} from '../database/external-identity.repository';
import {
  CreateInitialSessionInput,
  CreateInitialSessionResult,
  InitialSessionRepository,
} from '../database/initial-session.repository';
import {
  PlayerAccountProvisioningPersistenceError,
  PlayerAccountProvisioningRepository,
  PlayerAccountProvisioningResult,
  ProvisionPlayerAccountInput,
} from '../database/player-account-provisioning.repository';
import {
  ApplyAuthenticationOperationTerminalInput,
  AuthenticationOperationTerminalRepository,
  AuthenticationOperationTerminalResult,
} from '../database/authentication-operation-terminal.repository';
import {
  PersistPendingTelegramAuthenticationInput,
  TelegramAuthenticationOperationRepository,
  TelegramAuthenticationOperationResult,
} from '../database/telegram-authentication-operation.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  AccountStatusReader,
  SessionCredentialIssuer,
  TelegramLoginWorkflowBindings,
  TelegramLoginWorkflowBindingsPort,
  TelegramLookupDigestCandidatesPort,
  TelegramProofVerifier,
  TransactionExecutor,
} from './telegram-login.ports';
import {
  TelegramLoginService,
  TelegramLoginServiceDependencies,
} from './telegram-login.service';
import { TelegramLoginInput } from './telegram-login.types';

const RAW_INIT_DATA = 'query_id=safe-signed-payload';
const PLAINTEXT = 'session-plaintext-only-in-application';
const OTHER_PLAINTEXT = 'different-session-plaintext';
const REQUEST_KEY = 'request-key-1';
const NAMESPACE = externalIdentityNamespace('telegram:bot:123456');
const LOOKUP_DIGEST = externalIdentityLookupDigest('11'.repeat(32));
const PROOF_FINGERPRINT = '22'.repeat(32) as AuthenticationProofFingerprint;
const CREDENTIAL_DIGEST = '33'.repeat(32) as SessionCredentialDigest;
const OTHER_CREDENTIAL_DIGEST = '44'.repeat(32) as SessionCredentialDigest;

const OPERATION_ID =
  '11111111-1111-4111-8111-111111111111' as AuthenticationOperationId;
const COMMAND_ID =
  '22222222-2222-4222-8222-222222222222' as AuthenticationCommandId;
const ACCOUNT_ID =
  '33333333-3333-4333-8333-333333333333' as AccountId;
const IDENTITY_ID =
  '44444444-4444-4444-8444-444444444444' as ExternalIdentityId;
const SESSION_ID =
  '55555555-5555-4555-8555-555555555555' as SessionId;

const NOW = unixEpochSeconds(1_800_000_100);
const OPERATION_CREATED_AT = unixEpochSeconds(1_800_000_000);
const OPERATION_EXPIRES_AT = unixEpochSeconds(1_800_000_600);
const SESSION_EXPIRES_AT = unixEpochSeconds(1_802_592_000);

function auditId(value: string): SecurityAuditEventId {
  return value as SecurityAuditEventId;
}

const BINDINGS: TelegramLoginWorkflowBindings = Object.freeze({
  operationId: OPERATION_ID,
  idempotencyKey: 'telegram-login-request-1' as AuthenticationIdempotencyKey,
  requestDigest: 'authentication-request-digest-1' as AuthenticationRequestDigest,
  terminalCommandId: COMMAND_ID,
  accountId: ACCOUNT_ID,
  identityId: IDENTITY_ID,
  sessionId: SESSION_ID,
  auditEventIds: Object.freeze({
    proofConsumption: auditId('60000000-0000-4000-8000-000000000001'),
    accountCreated: auditId('60000000-0000-4000-8000-000000000002'),
    externalIdentityLinked: auditId(
      '60000000-0000-4000-8000-000000000003',
    ),
    operationTerminal: auditId('60000000-0000-4000-8000-000000000004'),
    sessionCreated: auditId('60000000-0000-4000-8000-000000000005'),
  }),
  timestamps: Object.freeze({
    operationCreatedAt: OPERATION_CREATED_AT,
    operationExpiresAt: OPERATION_EXPIRES_AT,
    proofConsumedAt: NOW,
    accountCreatedAt: NOW,
    terminalAppliedAt: NOW,
    sessionCreatedAt: NOW,
    sessionExpiresAt: SESSION_EXPIRES_AT,
    credentialIssuedAt: NOW,
    auditOccurredAt: NOW,
  }),
});

const DIGEST_CANDIDATE: ComputedExternalIdentityLookupDigest = Object.freeze({
  algorithm: EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  provider: 'telegram',
  namespace: NAMESPACE,
  digest: LOOKUP_DIGEST,
  digestVersion: externalIdentityLookupDigestVersion(1),
  pepperVersion: externalIdentityLookupDigestPepperVersion(2),
});

function verifiedProof(): Extract<
  TelegramProofVerificationOutcome,
  { readonly status: 'verified' }
> {
  return {
    status: 'verified',
    proof: {
      provider: 'telegram',
      namespace: NAMESPACE,
      identityKey: {
        provider: 'telegram',
        namespace: NAMESPACE,
        lookup: {
          kind: 'canonical_subject',
          subject: trustProviderCanonicalizedExternalIdentitySubject(
            '123456789',
          ),
        },
      },
      authDate: unixEpochSeconds(1_800_000_000),
      verifiedAt: NOW,
      expiresAt: OPERATION_EXPIRES_AT,
      proofFingerprint: PROOF_FINGERPRINT,
    },
  };
}

function input(): TelegramLoginInput {
  return {
    rawInitData: RAW_INIT_DATA,
    now: NOW,
    requestKey: REQUEST_KEY,
  };
}

class FakeTransaction implements PostgresTransaction {
  constructor(readonly id: number) {}

  query<Row extends QueryResultRow = QueryResultRow>(): Promise<
    QueryResult<Row>
  > {
    throw new Error('Application service must not execute SQL directly');
  }
}

class FakeTransactionExecutor implements TransactionExecutor {
  readonly transactions: FakeTransaction[] = [];
  readonly beforeFailures = new Map<number, unknown>();
  readonly commitFailures = new Map<number, unknown>();

  constructor(private readonly timeline: string[]) {}

  async run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    const number = this.transactions.length + 1;
    const transaction = new FakeTransaction(number);
    this.transactions.push(transaction);
    this.timeline.push(`tx${number}:begin`);
    if (this.beforeFailures.has(number)) {
      this.timeline.push(`tx${number}:rollback`);
      throw this.beforeFailures.get(number);
    }

    try {
      const result = await operation(transaction);
      if (this.commitFailures.has(number)) {
        this.timeline.push(`tx${number}:commit-failed`);
        throw this.commitFailures.get(number);
      }
      this.timeline.push(`tx${number}:commit`);
      return result;
    } catch (error) {
      if (!this.commitFailures.has(number)) {
        this.timeline.push(`tx${number}:rollback`);
      }
      throw error;
    }
  }
}

class FakeVerifier implements TelegramProofVerifier {
  readonly calls: string[] = [];

  constructor(
    public outcome: TelegramProofVerificationOutcome = verifiedProof(),
  ) {}

  verifyProof(rawInitData: string): TelegramProofVerificationOutcome {
    this.calls.push(rawInitData);
    return this.outcome;
  }
}

class FakeLookupDigests implements TelegramLookupDigestCandidatesPort {
  readonly calls: unknown[] = [];

  async computeCandidates(proof: unknown) {
    this.calls.push(proof);
    return { primary: DIGEST_CANDIDATE, all: [DIGEST_CANDIDATE] };
  }
}

class FakeWorkflowBindings implements TelegramLoginWorkflowBindingsPort {
  readonly calls: unknown[][] = [];

  create(
    requestKey: string,
    proof: Parameters<TelegramLoginWorkflowBindingsPort['create']>[1],
    now: UnixEpochSeconds,
  ): TelegramLoginWorkflowBindings {
    this.calls.push([requestKey, proof, now]);
    return BINDINGS;
  }
}

class FakePendingOperations
  implements TelegramAuthenticationOperationRepository
{
  readonly calls: Array<{
    transaction: PostgresTransaction;
    input: PersistPendingTelegramAuthenticationInput;
  }> = [];
  result: TelegramAuthenticationOperationResult = {
    outcome: 'created',
    operationId: OPERATION_ID,
  };

  constructor(private readonly timeline: string[]) {}

  async persistPending(
    transaction: PostgresTransaction,
    inputValue: PersistPendingTelegramAuthenticationInput,
  ): Promise<TelegramAuthenticationOperationResult> {
    this.timeline.push('pending');
    this.calls.push({ transaction, input: inputValue });
    return this.result;
  }
}

class FakeExternalIdentities implements ExternalIdentityResolutionRepository {
  readonly calls: Array<{
    transaction: PostgresTransaction;
    candidates: readonly ComputedExternalIdentityLookupDigest[];
  }> = [];
  result: ExternalIdentityResolutionResult = {
    outcome: 'linked',
    identity: {
      identityId: IDENTITY_ID,
      accountId: ACCOUNT_ID,
      provider: 'telegram',
      namespace: NAMESPACE,
      isPrimary: true,
    },
  };

  constructor(private readonly timeline: string[]) {}

  async resolveByLookupDigests(
    transaction: PostgresTransaction,
    candidates: readonly ComputedExternalIdentityLookupDigest[],
  ): Promise<ExternalIdentityResolutionResult> {
    this.timeline.push('resolve');
    this.calls.push({ transaction, candidates });
    return this.result;
  }
}

class FakeAccounts implements AccountStatusReader {
  readonly calls: Array<{
    transaction: PostgresTransaction;
    accountId: AccountId;
  }> = [];
  result:
    | { readonly outcome: 'not_found' }
    | {
        readonly outcome: 'found';
        readonly accountId: AccountId;
        readonly role: UserRole;
        readonly status: AccountStatus;
      } = {
    outcome: 'found',
    accountId: ACCOUNT_ID,
    role: 'player',
    status: 'active',
  };

  constructor(private readonly timeline: string[]) {}

  async findById(transaction: PostgresTransaction, accountId: AccountId) {
    this.timeline.push('account');
    this.calls.push({ transaction, accountId });
    return this.result;
  }
}

class FakePlayerAccounts implements PlayerAccountProvisioningRepository {
  readonly calls: Array<{
    transaction: PostgresTransaction;
    input: ProvisionPlayerAccountInput;
  }> = [];
  result: PlayerAccountProvisioningResult = {
    outcome: 'created',
    accountId: ACCOUNT_ID,
  };
  error: unknown;

  constructor(private readonly timeline: string[]) {}

  async provision(
    transaction: PostgresTransaction,
    inputValue: ProvisionPlayerAccountInput,
  ): Promise<PlayerAccountProvisioningResult> {
    this.timeline.push('provision');
    this.calls.push({ transaction, input: inputValue });
    if (this.error !== undefined) {
      throw this.error;
    }
    return this.result;
  }
}

class FakeTerminalOperations
  implements AuthenticationOperationTerminalRepository
{
  readonly calls: Array<{
    transaction: PostgresTransaction;
    input: ApplyAuthenticationOperationTerminalInput;
  }> = [];
  result: AuthenticationOperationTerminalResult = {
    outcome: 'transitioned',
    operationId: OPERATION_ID,
    status: 'completed',
  };

  constructor(private readonly timeline: string[]) {}

  async applyTerminalCommand(
    transaction: PostgresTransaction,
    inputValue: ApplyAuthenticationOperationTerminalInput,
  ): Promise<AuthenticationOperationTerminalResult> {
    this.timeline.push('terminal');
    this.calls.push({ transaction, input: inputValue });
    return this.result;
  }
}

class FakeCredentialIssuer implements SessionCredentialIssuer {
  readonly issued: Array<{
    readonly plaintext: string;
    readonly digest: SessionCredentialDigest;
  }> = [];
  values = [
    { plaintext: PLAINTEXT, digest: CREDENTIAL_DIGEST },
    { plaintext: OTHER_PLAINTEXT, digest: OTHER_CREDENTIAL_DIGEST },
  ];

  constructor(private readonly timeline: string[]) {}

  issue() {
    this.timeline.push('credential');
    const value = this.values[this.issued.length] ?? this.values[0];
    this.issued.push(value);
    return value;
  }
}

class FakeInitialSessions implements InitialSessionRepository {
  readonly calls: Array<{
    transaction: PostgresTransaction;
    input: CreateInitialSessionInput;
  }> = [];
  result: CreateInitialSessionResult = {
    outcome: 'created',
    sessionId: SESSION_ID,
    generation: 1,
    expiresAt: SESSION_EXPIRES_AT,
  };

  constructor(private readonly timeline: string[]) {}

  async createInitialSession(
    transaction: PostgresTransaction,
    inputValue: CreateInitialSessionInput,
  ): Promise<CreateInitialSessionResult> {
    this.timeline.push('session');
    this.calls.push({ transaction, input: inputValue });
    return this.result;
  }
}

interface Harness {
  readonly service: TelegramLoginService;
  readonly timeline: string[];
  readonly transactions: FakeTransactionExecutor;
  readonly verifier: FakeVerifier;
  readonly lookupDigests: FakeLookupDigests;
  readonly workflowBindings: FakeWorkflowBindings;
  readonly pending: FakePendingOperations;
  readonly identities: FakeExternalIdentities;
  readonly accounts: FakeAccounts;
  readonly playerAccounts: FakePlayerAccounts;
  readonly terminal: FakeTerminalOperations;
  readonly issuer: FakeCredentialIssuer;
  readonly sessions: FakeInitialSessions;
}

function harness(): Harness {
  const timeline: string[] = [];
  const subject = {
    timeline,
    transactions: new FakeTransactionExecutor(timeline),
    verifier: new FakeVerifier(),
    lookupDigests: new FakeLookupDigests(),
    workflowBindings: new FakeWorkflowBindings(),
    pending: new FakePendingOperations(timeline),
    identities: new FakeExternalIdentities(timeline),
    accounts: new FakeAccounts(timeline),
    playerAccounts: new FakePlayerAccounts(timeline),
    terminal: new FakeTerminalOperations(timeline),
    issuer: new FakeCredentialIssuer(timeline),
    sessions: new FakeInitialSessions(timeline),
  };
  const dependencies: TelegramLoginServiceDependencies = {
    verifier: subject.verifier,
    lookupDigests: subject.lookupDigests,
    transactions: subject.transactions,
    pendingOperations: subject.pending,
    externalIdentities: subject.identities,
    accounts: subject.accounts,
    playerAccounts: subject.playerAccounts,
    terminalOperations: subject.terminal,
    credentialIssuer: subject.issuer,
    initialSessions: subject.sessions,
    workflowBindings: subject.workflowBindings,
  };
  return {
    ...subject,
    service: new TelegramLoginService(dependencies),
  };
}

function postgresError(code: string): object {
  return {
    code,
    message: 'raw postgres secret message',
    detail: 'raw postgres detail',
    constraint: 'secret_constraint',
  };
}

function persistedPayloads(subject: Harness): string {
  return JSON.stringify({
    pending: subject.pending.calls,
    identities: subject.identities.calls,
    accounts: subject.accounts.calls,
    provisioning: subject.playerAccounts.calls,
    terminal: subject.terminal.calls,
    sessions: subject.sessions.calls,
  });
}

describe('TelegramLoginService', () => {
  it('authenticates a new Telegram user', async () => {
    const subject = harness();
    subject.identities.result = { outcome: 'not_found' };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'authenticated',
      credential: PLAINTEXT,
      expiresAt: SESSION_EXPIRES_AT,
      accountKind: 'new',
    });
  });

  it('authenticates an existing active account', async () => {
    const subject = harness();

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'authenticated',
      credential: PLAINTEXT,
      expiresAt: SESSION_EXPIRES_AT,
      accountKind: 'existing',
    });
  });

  it.each(['blocked', 'pending_deletion'] as const)(
    'rejects a %s account without issuing a session',
    async (status) => {
      const subject = harness();
      subject.accounts.result = {
        outcome: 'found',
        accountId: ACCOUNT_ID,
        role: 'player',
        status,
      };

      await expect(
        subject.service.authenticateWithTelegram(input()),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: 'account_unavailable',
      });
      expect(subject.terminal.calls).toHaveLength(1);
      expect(subject.issuer.issued).toHaveLength(0);
      expect(subject.sessions.calls).toHaveLength(0);
    },
  );

  it('rejects invalid Telegram data before any transaction', async () => {
    const subject = harness();
    subject.verifier.outcome = { status: 'invalid', reason: 'invalid_proof' };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_telegram_data',
    });
    expect(subject.transactions.transactions).toHaveLength(0);
  });

  it('rejects an expired Telegram proof before any transaction', async () => {
    const subject = harness();
    subject.verifier.outcome = {
      status: 'expired',
      reason: 'expired_proof',
      proofFingerprint: PROOF_FINGERPRINT,
      expiresAt: OPERATION_EXPIRES_AT,
    };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'telegram_proof_expired',
    });
    expect(subject.transactions.transactions).toHaveLength(0);
  });

  it('continues after a pending-operation exact retry', async () => {
    const subject = harness();
    subject.pending.result = {
      outcome: 'idempotent_retry',
      operationId: OPERATION_ID,
    };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toMatchObject({
      outcome: 'authenticated',
    });
    expect(subject.identities.calls).toHaveLength(1);
  });

  it.each([
    'idempotency_key_conflict',
    'operation_binding_conflict',
  ] as const)('maps pending %s to request_conflict', async (reason) => {
    const subject = harness();
    subject.pending.result = { outcome: 'conflict', reason };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'request_conflict',
    });
    expect(subject.identities.calls).toHaveLength(0);
  });

  it('maps proof replay and stops the workflow', async () => {
    const subject = harness();
    subject.pending.result = {
      outcome: 'replay',
      reason: 'proof_already_consumed',
    };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'proof_replayed',
    });
    expect(subject.identities.calls).toHaveLength(0);
  });

  it('maps a historical identity reservation to request_conflict', async () => {
    const subject = harness();
    subject.identities.result = {
      outcome: 'historical_reservation',
      identity: {
        identityId: IDENTITY_ID,
        accountId: ACCOUNT_ID,
        provider: 'telegram',
        namespace: NAMESPACE,
        isPrimary: false,
      },
    };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'request_conflict',
    });
  });

  it.each([
    'multiple_identities_same_account',
    'multiple_accounts',
  ] as const)('maps identity conflict %s to request_conflict', async (reason) => {
    const subject = harness();
    subject.identities.result = { outcome: 'conflict', reason };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'request_conflict',
    });
  });

  it('maps a provisioning reservation conflict safely', async () => {
    const subject = harness();
    subject.identities.result = { outcome: 'not_found' };
    subject.playerAccounts.error =
      new PlayerAccountProvisioningPersistenceError('identity_reserved');

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'request_conflict',
    });
    expect(subject.terminal.calls).toHaveLength(0);
  });

  it('rolls back the new-account transaction when terminal completion rejects', async () => {
    const subject = harness();
    subject.identities.result = { outcome: 'not_found' };
    subject.terminal.result = {
      outcome: 'rejected',
      reason: 'forbidden_transition',
    };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'request_conflict',
    });
    expect(subject.timeline).toContain('tx2:rollback');
    expect(subject.issuer.issued).toHaveLength(0);
  });

  it('continues after terminal exact retry', async () => {
    const subject = harness();
    subject.terminal.result = {
      outcome: 'idempotent_retry',
      operationId: OPERATION_ID,
      status: 'completed',
    };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toMatchObject({
      outcome: 'authenticated',
      accountKind: 'existing',
    });
  });

  it('accepts an initial-session exact retry while retaining the plaintext', async () => {
    const subject = harness();
    subject.sessions.result = {
      outcome: 'idempotent_retry',
      sessionId: SESSION_ID,
      generation: 1,
      expiresAt: SESSION_EXPIRES_AT,
    };

    await expect(subject.service.authenticateWithTelegram(input())).resolves.toEqual({
      outcome: 'authenticated',
      credential: PLAINTEXT,
      expiresAt: SESSION_EXPIRES_AT,
      accountKind: 'existing',
    });
  });

  it.each(['40001', '40P01'])(
    'sanitizes transaction conflict %s',
    async (code) => {
      const subject = harness();
      subject.transactions.commitFailures.set(1, postgresError(code));

      await expect(
        subject.service.authenticateWithTelegram(input()),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: 'temporary_conflict',
      });
    },
  );

  it.each(['08006', '57P01', '57014'])(
    'sanitizes unavailable database error %s',
    async (code) => {
      const subject = harness();
      subject.transactions.commitFailures.set(1, postgresError(code));

      await expect(
        subject.service.authenticateWithTelegram(input()),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: 'dependency_unavailable',
      });
    },
  );

  it('sanitizes unknown commit failure', async () => {
    const subject = harness();
    subject.transactions.commitFailures.set(
      1,
      new Error('commit leaked secret'),
    );

    const result = await subject.service.authenticateWithTelegram(input());
    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    expect(JSON.stringify(result)).not.toContain('commit leaked secret');
  });

  it('uses stable workflow bindings across all phases', async () => {
    const subject = harness();
    await subject.service.authenticateWithTelegram(input());

    expect(subject.workflowBindings.calls).toEqual([
      [REQUEST_KEY, verifiedProof().proof, NOW],
    ]);
    expect(subject.pending.calls[0].input.operation.operationId).toBe(
      OPERATION_ID,
    );
    expect(subject.terminal.calls[0].input.command.commandId).toBe(COMMAND_ID);
    expect(subject.sessions.calls[0].input.binding.sessionId).toBe(SESSION_ID);
    expect(subject.pending.calls[0].input.audit.eventId).toBe(
      BINDINGS.auditEventIds.proofConsumption,
    );
    expect(subject.terminal.calls[0].input.audit.eventId).toBe(
      BINDINGS.auditEventIds.operationTerminal,
    );
    expect(subject.sessions.calls[0].input.audit.eventId).toBe(
      BINDINGS.auditEventIds.sessionCreated,
    );
  });

  it('provisions and completes a new account in one transaction', async () => {
    const subject = harness();
    subject.identities.result = { outcome: 'not_found' };
    await subject.service.authenticateWithTelegram(input());

    expect(subject.playerAccounts.calls[0].transaction).toBe(
      subject.terminal.calls[0].transaction,
    );
    expect(subject.playerAccounts.calls[0].transaction).toBe(
      subject.transactions.transactions[1],
    );
    expect(subject.timeline.indexOf('provision')).toBeLessThan(
      subject.timeline.indexOf('terminal'),
    );
  });

  it('reads and completes an existing account in one transaction', async () => {
    const subject = harness();
    await subject.service.authenticateWithTelegram(input());

    expect(subject.accounts.calls[0].transaction).toBe(
      subject.terminal.calls[0].transaction,
    );
    expect(subject.accounts.calls[0].transaction).toBe(
      subject.transactions.transactions[1],
    );
  });

  it('uses three transactions in strict successful order', async () => {
    const subject = harness();
    await subject.service.authenticateWithTelegram(input());

    expect(subject.timeline).toEqual([
      'tx1:begin',
      'pending',
      'tx1:commit',
      'tx2:begin',
      'resolve',
      'account',
      'terminal',
      'tx2:commit',
      'credential',
      'tx3:begin',
      'session',
      'tx3:commit',
    ]);
  });

  it('never passes plaintext credential to persistence or audit inputs', async () => {
    const subject = harness();
    await subject.service.authenticateWithTelegram(input());

    const payloads = persistedPayloads(subject);
    expect(payloads).not.toContain(PLAINTEXT);
    expect(payloads).toContain(CREDENTIAL_DIGEST);
  });

  it('never passes raw initData to persistence repositories', async () => {
    const subject = harness();
    await subject.service.authenticateWithTelegram(input());

    expect(subject.verifier.calls).toEqual([RAW_INIT_DATA]);
    expect(persistedPayloads(subject)).not.toContain(RAW_INIT_DATA);
  });

  it('returns no account, session, operation IDs or digests', async () => {
    const subject = harness();
    const result = await subject.service.authenticateWithTelegram(input());
    const serialized = JSON.stringify(result);

    expect(Object.keys(result)).toEqual([
      'outcome',
      'credential',
      'expiresAt',
      'accountKind',
    ]);
    for (const forbidden of [
      ACCOUNT_ID,
      SESSION_ID,
      OPERATION_ID,
      LOOKUP_DIGEST,
      CREDENTIAL_DIGEST,
      PROOF_FINGERPRINT,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('does not claim transparent credential recovery after a lost response', async () => {
    const subject = harness();
    const first = await subject.service.authenticateWithTelegram(input());
    subject.pending.result = {
      outcome: 'idempotent_retry',
      operationId: OPERATION_ID,
    };
    subject.terminal.result = {
      outcome: 'idempotent_retry',
      operationId: OPERATION_ID,
      status: 'completed',
    };
    subject.sessions.result = {
      outcome: 'conflict',
      reason: 'credential_conflict',
    };

    const second = await subject.service.authenticateWithTelegram(input());
    expect(first).toMatchObject({
      outcome: 'authenticated',
      credential: PLAINTEXT,
    });
    expect(second).toEqual({
      outcome: 'rejected',
      reason: 'request_conflict',
    });
    expect(second).not.toMatchObject({ credential: PLAINTEXT });
  });
});
