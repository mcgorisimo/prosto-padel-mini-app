import { createHash } from 'node:crypto';
import { QueryResult, QueryResultRow } from 'pg';
import { unixEpochSeconds } from './auth.types';
import { encodeLengthPrefixedUtf8 } from './crypto-encoding';
import {
  IssuedSessionCredential,
  SessionCredentialIssuer,
  digestSessionCredential,
} from './session-credential';
import {
  SessionLifecycleService,
  SessionLifecycleTransactionExecutor,
} from './session-lifecycle.service';
import { isInternalUuid } from '../common/internal-uuid';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  ApplyPresentedSessionCredentialInput,
  ApplyPresentedSessionCredentialResult,
  RevokePresentedSessionInput,
  RevokePresentedSessionResult,
  SessionCredentialLifecyclePersistenceError,
  SessionCredentialLifecycleRepository,
} from '../database/session-credential-lifecycle.repository';

const REQUEST_KEY = '12345678-1234-4678-9234-567812345678';
const OTHER_REQUEST_KEY = '12345678-1234-4678-9234-567812345679';
const CURRENT_CREDENTIAL = Buffer.alloc(32, 0x11).toString('base64url');
const NEXT_CREDENTIAL = Buffer.alloc(32, 0x22).toString('base64url');
const OTHER_NEXT_CREDENTIAL = Buffer.alloc(32, 0x33).toString('base64url');
const CURRENT_DIGEST = digestSessionCredential(CURRENT_CREDENTIAL);
const NEXT_DIGEST = digestSessionCredential(NEXT_CREDENTIAL);
const OTHER_NEXT_DIGEST = digestSessionCredential(OTHER_NEXT_CREDENTIAL);
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const DATABASE_DETAIL = 'SYNTHETIC_DATABASE_DETAIL_MUST_NOT_ESCAPE';

class EmptyTransaction implements PostgresTransaction {
  async query<Row extends QueryResultRow = QueryResultRow>(
    _text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    throw new Error('Service must not execute SQL directly');
  }
}

class FakeTransactions implements SessionLifecycleTransactionExecutor {
  readonly transaction = new EmptyTransaction();
  readonly operations: Array<
    (transaction: PostgresTransaction) => Promise<unknown>
  > = [];

  async run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    this.operations.push(operation);
    return operation(this.transaction);
  }
}

class FakeSessions implements SessionCredentialLifecycleRepository {
  readonly apply = jest.fn<
    Promise<ApplyPresentedSessionCredentialResult>,
    [PostgresTransaction, ApplyPresentedSessionCredentialInput]
  >();
  readonly revoke = jest.fn<
    Promise<RevokePresentedSessionResult>,
    [PostgresTransaction, RevokePresentedSessionInput]
  >();

  constructor() {
    this.apply.mockResolvedValue({
      outcome: 'credential_rotated',
      persistence: 'applied',
      generation: 2,
      expiresAt: EXPIRES_AT,
    });
    this.revoke.mockResolvedValue({
      outcome: 'session_revoked',
      persistence: 'applied',
      revokedAt: NOW,
    });
  }

  applyPresentedCredential(
    transaction: PostgresTransaction,
    input: ApplyPresentedSessionCredentialInput,
  ): Promise<ApplyPresentedSessionCredentialResult> {
    return this.apply(transaction, input);
  }

  revokePresentedSession(
    transaction: PostgresTransaction,
    input: RevokePresentedSessionInput,
  ): Promise<RevokePresentedSessionResult> {
    return this.revoke(transaction, input);
  }
}

class FakeCredentialIssuer implements SessionCredentialIssuer {
  readonly issued: IssuedSessionCredential[] = [];

  constructor(
    private readonly plaintexts: readonly string[] = [NEXT_CREDENTIAL],
  ) {}

  issue(): IssuedSessionCredential {
    const plaintext =
      this.plaintexts[this.issued.length] ?? this.plaintexts[0];
    const issued = Object.freeze({
      plaintext,
      digest: digestSessionCredential(plaintext),
    });
    this.issued.push(issued);
    return issued;
  }
}

function harness(
  plaintexts: readonly string[] = [NEXT_CREDENTIAL],
) {
  const transactions = new FakeTransactions();
  const sessions = new FakeSessions();
  const credentialIssuer = new FakeCredentialIssuer(plaintexts);
  return {
    subject: new SessionLifecycleService({
      transactions,
      sessions,
      credentialIssuer,
    }),
    transactions,
    sessions,
    credentialIssuer,
  };
}

function input(requestKey = REQUEST_KEY) {
  return {
    credential: CURRENT_CREDENTIAL,
    requestKey,
    now: NOW,
  };
}

describe('SessionLifecycleService', () => {
  it('rotates through one transaction and passes only old/new digests to the repository', async () => {
    const subject = harness();

    await expect(subject.subject.refresh(input())).resolves.toEqual({
      outcome: 'refreshed',
      credential: NEXT_CREDENTIAL,
      expiresAt: EXPIRES_AT,
    });

    expect(subject.credentialIssuer.issued).toHaveLength(1);
    expect(subject.transactions.operations).toHaveLength(1);
    expect(subject.sessions.apply).toHaveBeenCalledTimes(1);
    const [transaction, repositoryInput] =
      subject.sessions.apply.mock.calls[0];
    expect(transaction).toBe(subject.transactions.transaction);
    expect(repositoryInput.presentedCredentialDigest).toBe(CURRENT_DIGEST);
    expect(repositoryInput.nextCredentialDigest).toBe(NEXT_DIGEST);
    expect(repositoryInput.nextCredentialDigest).not.toBe(
      repositoryInput.presentedCredentialDigest,
    );
    expect(Object.keys(repositoryInput).sort()).toEqual([
      'audit',
      'commandId',
      'nextCredentialDigest',
      'now',
      'presentedCredentialDigest',
      'requestDigest',
    ]);
    expect(JSON.stringify(repositoryInput)).not.toContain(CURRENT_CREDENTIAL);
    expect(JSON.stringify(repositoryInput)).not.toContain(NEXT_CREDENTIAL);
    expect(isInternalUuid(repositoryInput.commandId)).toBe(true);
    expect(isInternalUuid(repositoryInput.audit.eventId)).toBe(true);
    expect(repositoryInput.commandId).not.toBe(
      repositoryInput.audit.eventId,
    );
    const expectedRequestDigest = createHash('sha256')
      .update(
        encodeLengthPrefixedUtf8([
          'prosto-padel.auth.session.refresh.request.v1',
          REQUEST_KEY,
          CURRENT_DIGEST,
        ]),
      )
      .digest('hex');
    expect(repositoryInput.requestDigest).toBe(expectedRequestDigest);
  });

  it('keeps command, request and audit bindings stable when a retry issues a different random candidate', async () => {
    const subject = harness([NEXT_CREDENTIAL, OTHER_NEXT_CREDENTIAL]);

    await subject.subject.refresh(input());
    await subject.subject.refresh(input());

    const first = subject.sessions.apply.mock.calls[0][1];
    const second = subject.sessions.apply.mock.calls[1][1];
    expect(first.nextCredentialDigest).toBe(NEXT_DIGEST);
    expect(second.nextCredentialDigest).toBe(OTHER_NEXT_DIGEST);
    expect({
      commandId: second.commandId,
      requestDigest: second.requestDigest,
      auditEventId: second.audit.eventId,
    }).toEqual({
      commandId: first.commandId,
      requestDigest: first.requestDigest,
      auditEventId: first.audit.eventId,
    });
  });

  it('never returns the newly issued plaintext for an idempotent refresh retry', async () => {
    const subject = harness();
    subject.sessions.apply.mockResolvedValue({
      outcome: 'credential_rotated',
      persistence: 'idempotent_retry',
      generation: 2,
      expiresAt: EXPIRES_AT,
    });

    const result = await subject.subject.refresh(input());

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'session_refresh_reopen_required',
    });
    expect(JSON.stringify(result)).not.toContain(NEXT_CREDENTIAL);
  });

  it.each([
    [
      {
        outcome: 'session_expired',
        persistence: 'applied',
        expiresAt: EXPIRES_AT,
      },
      'session_expired',
    ],
    [
      {
        outcome: 'credential_reuse_detected',
        persistence: 'applied',
        expiresAt: EXPIRES_AT,
      },
      'session_invalid',
    ],
    [
      { outcome: 'rejected', reason: 'credential_not_found' },
      'session_invalid',
    ],
    [
      { outcome: 'rejected', reason: 'session_closed' },
      'session_invalid',
    ],
    [
      { outcome: 'rejected', reason: 'command_reuse_conflict' },
      'session_request_conflict',
    ],
    [
      { outcome: 'rejected', reason: 'invalid_next_credential' },
      'internal_failure',
    ],
  ] as const)(
    'maps refresh repository result %# without exposing credential material',
    async (repositoryResult, reason) => {
      const subject = harness();
      subject.sessions.apply.mockResolvedValue(
        repositoryResult as ApplyPresentedSessionCredentialResult,
      );

      const result = await subject.subject.refresh(input());

      expect(result).toEqual({ outcome: 'rejected', reason });
      expect(JSON.stringify(result)).not.toContain(CURRENT_CREDENTIAL);
      expect(JSON.stringify(result)).not.toContain(NEXT_CREDENTIAL);
    },
  );

  it.each(['applied', 'idempotent_retry'] as const)(
    'treats logout %s as a successful idempotent outcome',
    async (persistence) => {
      const subject = harness();
      subject.sessions.revoke.mockResolvedValue({
        outcome: 'session_revoked',
        persistence,
        revokedAt: NOW,
      });

      await expect(subject.subject.logout(input())).resolves.toEqual({
        outcome: 'logged_out',
      });
      expect(subject.transactions.operations).toHaveLength(1);
      expect(subject.sessions.revoke).toHaveBeenCalledTimes(1);
      const [transaction, repositoryInput] =
        subject.sessions.revoke.mock.calls[0];
      expect(transaction).toBe(subject.transactions.transaction);
      expect(repositoryInput.presentedCredentialDigest).toBe(CURRENT_DIGEST);
      expect(JSON.stringify(repositoryInput)).not.toContain(
        CURRENT_CREDENTIAL,
      );
    },
  );

  it.each([
    ['credential_not_found', 'session_invalid'],
    ['session_closed', 'session_invalid'],
    ['command_reuse_conflict', 'session_request_conflict'],
  ] as const)(
    'maps logout %s to %s',
    async (repositoryReason, serviceReason) => {
      const subject = harness();
      subject.sessions.revoke.mockResolvedValue({
        outcome: 'rejected',
        reason: repositoryReason,
      });

      await expect(subject.subject.logout(input())).resolves.toEqual({
        outcome: 'rejected',
        reason: serviceReason,
      });
    },
  );

  it('uses distinct deterministic domains for refresh and logout bindings', async () => {
    const subject = harness();

    await subject.subject.refresh(input());
    await subject.subject.logout(input());

    const refresh = subject.sessions.apply.mock.calls[0][1];
    const logout = subject.sessions.revoke.mock.calls[0][1];
    expect(logout.presentedCredentialDigest).toBe(CURRENT_DIGEST);
    expect(logout.commandId).not.toBe(refresh.commandId);
    expect(logout.requestDigest).not.toBe(refresh.requestDigest);
    expect(logout.audit.eventId).not.toBe(refresh.audit.eventId);
  });

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
  ] as const)(
    'hides refresh persistence %s as %s',
    async (persistenceReason, serviceReason) => {
      const subject = harness();
      subject.sessions.apply.mockRejectedValue(
        new SessionCredentialLifecyclePersistenceError(persistenceReason),
      );

      await expect(subject.subject.refresh(input())).resolves.toEqual({
        outcome: 'rejected',
        reason: serviceReason,
      });
    },
  );

  it('hides logout storage details and never places them in result errors or logs', async () => {
    const subject = harness();
    subject.sessions.revoke.mockRejectedValue(
      Object.assign(new Error(DATABASE_DETAIL), {
        code: '42501',
        schema: 'backend_auth',
      }),
    );

    const result = await subject.subject.logout(input(OTHER_REQUEST_KEY));

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    expect(JSON.stringify(result)).not.toContain(DATABASE_DETAIL);
    expect(JSON.stringify(result)).not.toContain(CURRENT_CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain(CURRENT_DIGEST);
  });

  it('rejects malformed direct service input before issuer, transaction and repository access', async () => {
    const subject = harness();
    const unsafe = {
      ...input(),
      sessionId: REQUEST_KEY,
    } as unknown as Parameters<SessionLifecycleService['refresh']>[0];

    await expect(subject.subject.refresh(unsafe)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(subject.credentialIssuer.issued).toHaveLength(0);
    expect(subject.transactions.operations).toHaveLength(0);
    expect(subject.sessions.apply).not.toHaveBeenCalled();
  });
});
