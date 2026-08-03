import { createHash, createHmac, randomUUID } from 'node:crypto';
import { QueryResult, QueryResultRow } from 'pg';
import {
  CreatePlayerAccountWithProfileBinding,
  validatePlayerAccountWithProfileCreation,
} from '../../src/accounts/player-profile.types';
import {
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../../src/accounts/external-identity-lookup-digest.port';
import {
  AuthenticationOperationCommandBinding,
  PendingAuthenticationOperation,
  createAuthenticationOperation,
} from '../../src/auth/authentication-operation.state-machine';
import {
  VerifiedTelegramProof,
  telegramAuthenticationProofReference,
  unixEpochSeconds,
} from '../../src/auth/auth.types';
import { newAccountRequired } from '../../src/auth/account-resolution.types';
import { NodeSessionCredentialIssuer } from '../../src/auth/session-credential-issuer.adapter';
import {
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from '../../src/auth/security-audit.types';
import { CreateActiveSessionBinding } from '../../src/auth/session.types';
import {
  EMPTY_TELEGRAM_PROOF_CONSUMPTION_STATE,
  TelegramProofConsumptionRecord,
  consumeTelegramProof,
} from '../../src/auth/telegram-proof-consumption.state-machine';
import { TelegramInitDataVerifier } from '../../src/auth/telegram-init-data.verifier';
import { TelegramLoginService } from '../../src/auth/telegram-login.service';
import {
  TelegramLoginWorkflowBindings,
  TelegramLookupDigestCandidates,
} from '../../src/auth/telegram-login.ports';
import { DeterministicTelegramLoginWorkflowBindingsAdapter } from '../../src/auth/telegram-login-workflow-bindings.adapter';
import { TelegramLookupDigestCandidatesAdapter } from '../../src/auth/telegram-lookup-digest.adapter';
import { PostgresAccountStatusReader } from '../../src/database/postgres-account-status.reader';
import { PostgresAuthenticationOperationTerminalRepository } from '../../src/database/postgres-authentication-operation-terminal.repository';
import { PostgresExternalIdentityResolutionRepository } from '../../src/database/postgres-external-identity.repository';
import { PostgresInitialSessionRepository } from '../../src/database/postgres-initial-session.repository';
import { PostgresPlayerAccountProvisioningRepository } from '../../src/database/postgres-player-account-provisioning.repository';
import { PostgresPlayerProfileDetailsRepository } from '../../src/database/postgres-player-profile-details.repository';
import { PostgresSecurityAuditRepository } from '../../src/database/postgres-security-audit.repository';
import { PostgresTelegramAuthenticationOperationRepository } from '../../src/database/postgres-telegram-authentication-operation.repository';
import { PostgresTelegramNotificationDestinationRepository } from '../../src/database/postgres-telegram-notification-destination.repository';
import { TelegramNotificationDestinationRepository } from '../../src/database/telegram-notification-destination.repository';
import { PostgresTransactionExecutorAdapter } from '../../src/database/postgres-transaction-executor.adapter';
import {
  PostgresTransaction,
  PostgresTransactionRunner,
} from '../../src/database/postgres-transaction';
import {
  GuardedAuthIntegrationDatabase,
  openGuardedAuthIntegrationDatabase,
} from './auth-integration.guard';

const TEST_BOT_TOKEN =
  '900000001:AUTH_INTEGRATION_TEST_ONLY_TOKEN';
const TEST_UUID_NAMESPACE = '4a9372c5-f0b4-4c89-bb14-c96edb27d1dd';
const TEST_MAX_AGE_SECONDS = 300;
const OPERATION_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 2_592_000;
const LOOKUP_PEPPER = Buffer.alloc(32, 0x41);
const WORKFLOW_SECRET = Buffer.alloc(32, 0x57);
const INTENT = 'sign_up' as const;
export const AUTH_INTEGRATION_BARRIER_TIMEOUT_MILLIS = 5_000;

export interface PreparedTelegramLogin {
  readonly rawInitData: string;
  readonly requestKey: string;
  readonly now: ReturnType<typeof unixEpochSeconds>;
  readonly subject: string;
  readonly proof: VerifiedTelegramProof;
  readonly digests: TelegramLookupDigestCandidates;
  readonly bindings: TelegramLoginWorkflowBindings;
  readonly operation: PendingAuthenticationOperation & {
    readonly identityKey: {
      readonly provider: 'telegram';
      readonly namespace: VerifiedTelegramProof['namespace'];
      readonly lookup: {
        readonly kind: 'lookup_digest';
        readonly digest:
          TelegramLookupDigestCandidates['primary']['digest'];
      };
    };
    readonly proofReference: ReturnType<
      typeof telegramAuthenticationProofReference
    >;
  };
  readonly consumption: TelegramProofConsumptionRecord;
}

export interface AuthIntegrationGraph {
  readonly verifier: TelegramInitDataVerifier;
  readonly lookupDigests: TelegramLookupDigestCandidatesAdapter;
  readonly workflowBindings:
    DeterministicTelegramLoginWorkflowBindingsAdapter;
  readonly credentialIssuer: NodeSessionCredentialIssuer;
  readonly transactionRunner: PostgresTransactionRunner;
  readonly transactions: PostgresTransactionExecutorAdapter;
  readonly audit: PostgresSecurityAuditRepository;
  readonly externalIdentities:
    PostgresExternalIdentityResolutionRepository;
  readonly pendingOperations:
    PostgresTelegramAuthenticationOperationRepository;
  readonly accountStatus: PostgresAccountStatusReader;
  readonly playerAccounts:
    PostgresPlayerAccountProvisioningRepository;
  readonly profileDetails: PostgresPlayerProfileDetailsRepository;
  readonly notificationDestinations: TelegramNotificationDestinationRepository;
  readonly terminalOperations:
    PostgresAuthenticationOperationTerminalRepository;
  readonly initialSessions: PostgresInitialSessionRepository;
  readonly service: TelegramLoginService;
}

export interface AuthIntegrationHarness {
  readonly testRunId: string;
  readonly database: GuardedAuthIntegrationDatabase;
  readonly graph: AuthIntegrationGraph;
  readonly now: ReturnType<typeof unixEpochSeconds>;
  prepareLogin(options?: {
    readonly subjectLabel?: string;
    readonly proofLabel?: string;
    readonly requestKey?: string;
    readonly rawInitData?: string;
    readonly firstName?: string;
    readonly authDate?: number;
    readonly allowsWriteToPm?: boolean;
  }): Promise<PreparedTelegramLogin>;
  persistPending(
    prepared: PreparedTelegramLogin,
  ): ReturnType<
    PostgresTelegramAuthenticationOperationRepository['persistPending']
  >;
  provisionAndComplete(
    prepared: PreparedTelegramLogin,
  ): Promise<void>;
  provisionAccount(
    transaction: PostgresTransaction,
    prepared: PreparedTelegramLogin,
  ): ReturnType<
    PostgresPlayerAccountProvisioningRepository['provision']
  >;
  createInitialSession(
    prepared: PreparedTelegramLogin,
    binding: CreateActiveSessionBinding,
  ): ReturnType<PostgresInitialSessionRepository['createInitialSession']>;
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  close(): Promise<void>;
}

function createGraph(
  database: GuardedAuthIntegrationDatabase,
  now: ReturnType<typeof unixEpochSeconds>,
): AuthIntegrationGraph {
  const audit = new PostgresSecurityAuditRepository();
  const externalIdentities =
    new PostgresExternalIdentityResolutionRepository();
  const pendingOperations =
    new PostgresTelegramAuthenticationOperationRepository(audit);
  const accountStatus = new PostgresAccountStatusReader();
  const playerAccounts =
    new PostgresPlayerAccountProvisioningRepository(
      externalIdentities,
      audit,
    );
  const profileDetails = new PostgresPlayerProfileDetailsRepository();
  const notificationDestinations =
    new PostgresTelegramNotificationDestinationRepository();
  const terminalOperations =
    new PostgresAuthenticationOperationTerminalRepository(audit);
  const initialSessions =
    new PostgresInitialSessionRepository(audit);
  const transactionRunner = new PostgresTransactionRunner(
    database.postgres,
  );
  const transactions = new PostgresTransactionExecutorAdapter(
    transactionRunner,
  );
  const lookupPepper = Buffer.from(LOOKUP_PEPPER);
  const workflowSecret = Buffer.from(WORKFLOW_SECRET);
  const lookupDigests = new TelegramLookupDigestCandidatesAdapter({
    digestVersion: externalIdentityLookupDigestVersion(1),
    pepperVersion: externalIdentityLookupDigestPepperVersion(1),
    pepper: lookupPepper,
  });
  const workflowBindings =
    new DeterministicTelegramLoginWorkflowBindingsAdapter({
      uuidNamespace: TEST_UUID_NAMESPACE,
      hmacSecret: workflowSecret,
      operationTtlSeconds: OPERATION_TTL_SECONDS,
      sessionTtlSeconds: SESSION_TTL_SECONDS,
    });
  lookupPepper.fill(0);
  workflowSecret.fill(0);
  const verifier = new TelegramInitDataVerifier(
    {
      enabled: true,
      botToken: TEST_BOT_TOKEN,
      maxAgeSeconds: TEST_MAX_AGE_SECONDS,
    },
    () => new Date(now * 1000),
  );
  const credentialIssuer = new NodeSessionCredentialIssuer();
  const service = new TelegramLoginService({
    verifier,
    lookupDigests,
    transactions,
    pendingOperations,
    externalIdentities,
    accounts: accountStatus,
    playerAccounts,
    profileDetails,
    notificationDestinations,
    terminalOperations,
    credentialIssuer,
    initialSessions,
    workflowBindings,
  });

  return Object.freeze({
    verifier,
    lookupDigests,
    workflowBindings,
    credentialIssuer,
    transactionRunner,
    transactions,
    audit,
    externalIdentities,
    pendingOperations,
    accountStatus,
    playerAccounts,
    profileDetails,
    notificationDestinations,
    terminalOperations,
    initialSessions,
    service,
  });
}

function subjectFor(testRunId: string, label: string): string {
  const hash = createHash('sha256')
    .update(`${testRunId}:${label}`, 'utf8')
    .digest();
  const value =
    (hash.readUInt32BE(0) * 0x100000 + hash.readUInt32BE(4)) %
      (2 ** 52 - 1) +
    1;
  return Math.floor(value).toString(10);
}

function signedInitData(
  subject: string,
  now: number,
  proofLabel: string,
  firstName: string,
  allowsWriteToPm: boolean | undefined,
): string {
  const user = {
    id: Number(subject),
    first_name: firstName,
    ...(allowsWriteToPm === undefined
      ? {}
      : { allows_write_to_pm: allowsWriteToPm }),
  };
  const parameters = new Map<string, string>([
    ['auth_date', now.toString(10)],
    ['query_id', `${proofLabel}:${randomUUID()}`],
    [
      'user',
      JSON.stringify(user),
    ],
  ]);
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(TEST_BOT_TOKEN, 'utf8')
    .digest();
  const hash = createHmac('sha256', secretKey)
    .update(dataCheckString, 'utf8')
    .digest('hex');
  secretKey.fill(0);
  parameters.set('hash', hash);

  return [...parameters.entries()]
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

function operationBinding(
  prepared: PreparedTelegramLogin,
): AuthenticationOperationCommandBinding {
  return {
    operationId: prepared.operation.operationId,
    intent: prepared.operation.intent,
    identityKey: prepared.operation.identityKey,
    proofReference: prepared.operation.proofReference,
    idempotencyKey: prepared.operation.idempotencyKey,
    requestDigest: prepared.operation.requestDigest,
  };
}

function playerBinding(
  prepared: PreparedTelegramLogin,
): CreatePlayerAccountWithProfileBinding {
  const validated = validatePlayerAccountWithProfileCreation({
    account: {
      accountId: prepared.bindings.accountId,
      role: 'player',
      status: 'active',
    },
    playerProfile: {
      accountId: prepared.bindings.accountId,
    },
  });
  if (validated.outcome !== 'validated') {
    throw new Error('Auth integration fixture is invalid');
  }
  return validated.binding;
}

async function provisionAndCompleteInTransaction(
  graph: AuthIntegrationGraph,
  transaction: PostgresTransaction,
  prepared: PreparedTelegramLogin,
): Promise<void> {
  const provisioned = await provisionAccount(
    graph,
    transaction,
    prepared,
  );
  if (
    provisioned.outcome !== 'created' ||
    provisioned.accountId !== prepared.bindings.accountId
  ) {
    throw new Error('Auth integration provisioning assertion failed');
  }

  const terminal =
    await graph.terminalOperations.applyTerminalCommand(transaction, {
      command: {
        type: 'complete',
        commandId: prepared.bindings.terminalCommandId,
        binding: operationBinding(prepared),
        now: prepared.bindings.timestamps.terminalAppliedAt,
        resolution: newAccountRequired(prepared.operation.identityKey),
      },
      audit: {
        eventId: prepared.bindings.auditEventIds.operationTerminal,
      },
    });
  if (
    terminal.outcome !== 'transitioned' ||
    terminal.status !== 'completed'
  ) {
    throw new Error('Auth integration terminal assertion failed');
  }
}

function provisionAccount(
  graph: AuthIntegrationGraph,
  transaction: PostgresTransaction,
  prepared: PreparedTelegramLogin,
): ReturnType<PostgresPlayerAccountProvisioningRepository['provision']> {
  return graph.playerAccounts.provision(transaction, {
    binding: playerBinding(prepared),
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
  });
}

export async function openAuthIntegrationHarness(): Promise<AuthIntegrationHarness> {
  const database = await openGuardedAuthIntegrationDatabase();
  try {
    const testRunId = randomUUID();
    const now = unixEpochSeconds(Math.floor(Date.now() / 1000));
    const graph = createGraph(database, now);

    return {
    testRunId,
    database,
    graph,
    now,
    async prepareLogin(options = {}) {
      const subject = subjectFor(
        testRunId,
        options.subjectLabel ?? randomUUID(),
      );
      const requestKey = options.requestKey ?? randomUUID();
      const rawInitData =
        options.rawInitData ??
        signedInitData(
          subject,
          options.authDate ?? now,
          options.proofLabel ?? randomUUID(),
          options.firstName ?? 'Auth Integration',
          options.allowsWriteToPm,
        );
      const proofOutcome = verifierResult(graph.verifier, rawInitData);
      const proof = proofOutcome.proof;
      const digests = await graph.lookupDigests.computeCandidates(proof);
      const bindings = graph.workflowBindings.create(
        requestKey,
        proof,
        now,
      );
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
        throw new Error('Auth integration operation fixture is invalid');
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
      if (consumed.outcome !== 'first_use') {
        throw new Error('Auth integration proof fixture is invalid');
      }

      return Object.freeze({
        rawInitData,
        requestKey,
        now,
        subject,
        proof,
        digests,
        bindings,
        operation: created.state as PreparedTelegramLogin['operation'],
        consumption: consumed.consumption,
      });
    },
    persistPending(prepared) {
      return graph.transactions.run((transaction) =>
        graph.pendingOperations.persistPending(transaction, {
          operation: prepared.operation,
          consumption: prepared.consumption,
          audit: {
            eventId:
              prepared.bindings.auditEventIds.proofConsumption,
          },
        }),
      );
    },
    provisionAndComplete(prepared) {
      return graph.transactions.run((transaction) =>
        provisionAndCompleteInTransaction(
          graph,
          transaction,
          prepared,
        ),
      );
    },
    provisionAccount(transaction, prepared) {
      return provisionAccount(graph, transaction, prepared);
    },
    createInitialSession(prepared, binding) {
      return graph.transactions.run((transaction) =>
        graph.initialSessions.createInitialSession(transaction, {
          binding,
          audit: {
            eventId: prepared.bindings.auditEventIds.sessionCreated,
          },
        }),
      );
    },
    query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      return database.pool.query<Row, unknown[]>(text, [...values]);
    },
      close: () => database.close(),
    };
  } catch (error) {
    try {
      await database.close();
    } catch {
      // Preserve the original fixture construction failure.
    }
    throw error;
  }
}

function verifierResult(
  verifier: TelegramInitDataVerifier,
  rawInitData: string,
): Extract<
  ReturnType<TelegramInitDataVerifier['verifyProof']>,
  { readonly status: 'verified' }
> {
  const result = verifier.verifyProof(rawInitData);
  if (result.status !== 'verified') {
    throw new Error('Auth integration verifier fixture is invalid');
  }
  return result;
}

export function createSessionBinding(
  prepared: PreparedTelegramLogin,
  digest: ReturnType<NodeSessionCredentialIssuer['issue']>['digest'],
): CreateActiveSessionBinding {
  return Object.freeze({
    sessionId: prepared.bindings.sessionId,
    authenticationOperationId: prepared.bindings.operationId,
    accountId: prepared.bindings.accountId,
    createdAt: prepared.bindings.timestamps.sessionCreatedAt,
    expiresAt: prepared.bindings.timestamps.sessionExpiresAt,
    currentCredential: Object.freeze({
      digest,
      generation: 1,
      issuedAt: prepared.bindings.timestamps.credentialIssuedAt,
    }),
  });
}

export function twoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const opened = new Promise<void>((resolve, rejectOpened) => {
    release = resolve;
    reject = rejectOpened;
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return async () => {
    if (arrivals === 0) {
      timeout = setTimeout(() => {
        reject?.(
          new Error(
            'Auth integration concurrency barrier timed out',
          ),
        );
      }, AUTH_INTEGRATION_BARRIER_TIMEOUT_MILLIS);
    }
    arrivals += 1;
    if (arrivals === 2) {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      release?.();
    } else if (arrivals > 2) {
      throw new Error('Auth integration concurrency barrier is invalid');
    }
    await opened;
  };
}
