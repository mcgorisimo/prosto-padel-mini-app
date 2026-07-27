import { createHash } from 'node:crypto';
import { AccountId } from '../accounts/account.types';
import {
  AuthenticateSessionCredentialInput,
  AuthenticateSessionCredentialResult,
  SessionAuthenticationPersistenceError,
  SessionAuthenticationRepository,
} from '../database/session-authentication.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import {
  SessionAuthenticationService,
  SessionAuthenticationTransactionExecutor,
} from './session-authentication.service';
import { SessionAuthenticationInput } from './session-authentication.types';

const CREDENTIAL = Buffer.alloc(32, 0x41).toString('base64url');
const DIGEST = createHash('sha256')
  .update(CREDENTIAL, 'utf8')
  .digest('hex');
const ACCOUNT_ID = deterministicUuid(
  'session-authentication-service-account',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_AUTHENTICATION_MARKER';
const TRANSACTION = Object.freeze({
  query: jest.fn(),
}) as unknown as PostgresTransaction;

class FakeTransactions implements SessionAuthenticationTransactionExecutor {
  readonly operations: Array<
    (transaction: PostgresTransaction) => Promise<unknown>
  > = [];

  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    this.operations.push(operation);
    return operation(TRANSACTION);
  }
}

function createSubject(
  result: AuthenticateSessionCredentialResult = {
    outcome: 'authenticated',
    accountId: ACCOUNT_ID,
    role: 'player',
    expiresAt: EXPIRES_AT,
  },
) {
  const transactions = new FakeTransactions();
  const authenticatePresentedCredential = jest.fn<
    Promise<AuthenticateSessionCredentialResult>,
    [PostgresTransaction, AuthenticateSessionCredentialInput]
  >().mockResolvedValue(result);
  const sessions: SessionAuthenticationRepository = {
    authenticatePresentedCredential,
  };
  return {
    subject: new SessionAuthenticationService({
      transactions,
      sessions,
    }),
    transactions,
    authenticatePresentedCredential,
  };
}

function input(): SessionAuthenticationInput {
  return { credential: CREDENTIAL, now: NOW };
}

describe('SessionAuthenticationService', () => {
  it('digests the credential and returns only a safe principal', async () => {
    const harness = createSubject();
    const result = await harness.subject.authenticate(input());
    expect(result).toEqual({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT_ID,
        role: 'player',
        expiresAt: EXPIRES_AT,
      },
    });

    expect(harness.transactions.operations).toHaveLength(1);
    expect(harness.authenticatePresentedCredential).toHaveBeenCalledTimes(1);
    expect(harness.authenticatePresentedCredential).toHaveBeenCalledWith(
      TRANSACTION,
      {
        presentedCredentialDigest: DIGEST,
        now: NOW,
      },
    );
    const repositoryInput =
      harness.authenticatePresentedCredential.mock.calls[0][1];
    expect(Object.keys(repositoryInput)).toEqual([
      'presentedCredentialDigest',
      'now',
    ]);
    expect(JSON.stringify(repositoryInput)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain(DIGEST);
  });

  it('maps any repository rejection to the same invalid-session result', async () => {
    const harness = createSubject({ outcome: 'rejected' });
    await expect(harness.subject.authenticate(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'session_invalid',
    });
  });

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
    ['storage_failure', 'internal_failure'],
  ] as const)('maps %s to %s', async (failure, expected) => {
    const harness = createSubject();
    harness.authenticatePresentedCredential.mockRejectedValue(
      new SessionAuthenticationPersistenceError(failure),
    );
    await expect(harness.subject.authenticate(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: expected,
    });
  });

  it('maps unexpected repository output and exceptions to internal failure', async () => {
    const malformed = createSubject();
    malformed.authenticatePresentedCredential.mockResolvedValue({
      outcome: 'authenticated',
      accountId: ACCOUNT_ID,
      role: 'player',
      expiresAt: NOW,
      [PRIVATE_MARKER]: PRIVATE_MARKER,
    } as unknown as AuthenticateSessionCredentialResult);
    await expect(malformed.subject.authenticate(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });

    const thrown = createSubject();
    thrown.authenticatePresentedCredential.mockRejectedValue(
      new Error(PRIVATE_MARKER),
    );
    await expect(thrown.subject.authenticate(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it.each([
    { credential: 'invalid', now: NOW },
    { credential: CREDENTIAL, now: -1 },
    { credential: CREDENTIAL, now: NOW, accountId: ACCOUNT_ID },
  ])('rejects invalid input before opening a transaction', async (value) => {
    const harness = createSubject();
    await expect(
      harness.subject.authenticate(
        value as unknown as SessionAuthenticationInput,
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(harness.transactions.operations).toHaveLength(0);
    expect(harness.authenticatePresentedCredential).not.toHaveBeenCalled();
  });

  it('does not expose credential or persistence details in results and errors', async () => {
    const harness = createSubject();
    harness.authenticatePresentedCredential.mockRejectedValue({
      code: '42501',
      credential: CREDENTIAL,
      digest: DIGEST,
      message: PRIVATE_MARKER,
    });
    const result = await harness.subject.authenticate(input());
    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    const serialized = JSON.stringify(result);
    for (const marker of [CREDENTIAL, DIGEST, PRIVATE_MARKER]) {
      expect(serialized).not.toContain(marker);
    }
  });
});
