import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import {
  AccountNotificationPreferencesPersistenceError,
  AccountNotificationPreferencesRepository,
  ReadAccountNotificationPreferenceResult,
  SaveAccountNotificationPreferenceResult,
} from '../database/account-notification-preferences.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { PostgresTransactionExecutorAdapter } from '../database/postgres-transaction-executor.adapter';
import { AccountNotificationPreferencesService } from './account-notification-preferences.service';

const ACCOUNT_ID = deterministicUuid(
  'account-notification-preferences-service',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'account-notification-preferences-service-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const TRANSACTION = Object.freeze({
  query: jest.fn(),
}) as unknown as PostgresTransaction;

class FakeTransactions {
  calls = 0;

  async run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    this.calls += 1;
    return operation(TRANSACTION);
  }
}

interface Harness {
  readonly transactions: FakeTransactions;
  readonly findByAccountId: jest.Mock<
    Promise<ReadAccountNotificationPreferenceResult>,
    Parameters<AccountNotificationPreferencesRepository['findByAccountId']>
  >;
  readonly save: jest.Mock<
    Promise<SaveAccountNotificationPreferenceResult>,
    Parameters<AccountNotificationPreferencesRepository['save']>
  >;
  readonly service: AccountNotificationPreferencesService;
}

function preference(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    telegramMatchNotificationsEnabled: false,
    createdAt: unixEpochSeconds(NOW - 10),
    updatedAt: NOW,
    version: 3,
    ...overrides,
  };
}

function createHarness(): Harness {
  const transactions = new FakeTransactions();
  const findByAccountId = jest
    .fn<
      Promise<ReadAccountNotificationPreferenceResult>,
      Parameters<AccountNotificationPreferencesRepository['findByAccountId']>
    >()
    .mockResolvedValue({ outcome: 'missing' });
  const save = jest
    .fn<
      Promise<SaveAccountNotificationPreferenceResult>,
      Parameters<AccountNotificationPreferencesRepository['save']>
    >()
    .mockResolvedValue({
      outcome: 'saved',
      preference: preference(),
    });
  return {
    transactions,
    findByAccountId,
    save,
    service: new AccountNotificationPreferencesService({
      transactions:
        transactions as unknown as PostgresTransactionExecutorAdapter,
      preferences: { findByAccountId, save },
      clock: { nowEpochSeconds: () => NOW },
    }),
  };
}

describe('AccountNotificationPreferencesService', () => {
  it('maps an absent row to the enabled compatibility default and null version', async () => {
    const harness = createHarness();

    await expect(
      harness.service.readOwnPreferences({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toEqual({
      outcome: 'found',
      preferences: {
        telegramMatchNotificationsEnabled: true,
        version: null,
      },
    });
    expect(harness.findByAccountId).toHaveBeenCalledWith(TRANSACTION, {
      accountId: ACCOUNT_ID,
    });
    expect(harness.transactions.calls).toBe(1);
  });

  it.each(['player', 'club_admin'] as const)(
    'reads an explicit stored value for authenticated %s own-account',
    async (role) => {
      const harness = createHarness();
      harness.findByAccountId.mockResolvedValue({
        outcome: 'found',
        preference: preference(),
      });

      await expect(
        harness.service.readOwnPreferences({ accountId: ACCOUNT_ID, role }),
      ).resolves.toEqual({
        outcome: 'found',
        preferences: {
          telegramMatchNotificationsEnabled: false,
          version: 3,
        },
      });
    },
  );

  it('saves the explicit value with the observed version and current time', async () => {
    const harness = createHarness();

    await expect(
      harness.service.updateOwnPreferences({
        accountId: ACCOUNT_ID,
        role: 'player',
        patch: {
          telegramMatchNotificationsEnabled: false,
          expectedVersion: null,
        },
      }),
    ).resolves.toEqual({
      outcome: 'updated',
      preferences: {
        telegramMatchNotificationsEnabled: false,
        version: 3,
      },
    });
    expect(harness.save).toHaveBeenCalledWith(TRANSACTION, {
      accountId: ACCOUNT_ID,
      telegramMatchNotificationsEnabled: false,
      expectedVersion: null,
      updatedAt: NOW,
    });
    expect(harness.findByAccountId).not.toHaveBeenCalled();
  });

  it('returns a stable optimistic conflict without a second read or write', async () => {
    const harness = createHarness();
    harness.save.mockResolvedValue({ outcome: 'conflict' });

    await expect(
      harness.service.updateOwnPreferences({
        accountId: ACCOUNT_ID,
        role: 'club_admin',
        patch: {
          telegramMatchNotificationsEnabled: true,
          expectedVersion: 5,
        },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'version_conflict',
    });
    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.findByAccountId).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { accountId: 'invalid', role: 'player' },
    { accountId: ACCOUNT_ID, role: 'unknown' },
    { accountId: ACCOUNT_ID, role: 'player', extra: true },
  ])('rejects invalid read input without storage: %p', async (input) => {
    const harness = createHarness();
    await expect(
      harness.service.readOwnPreferences(input as never),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(harness.transactions.calls).toBe(0);
  });

  it.each([
    {},
    {
      telegramMatchNotificationsEnabled: false,
      expectedVersion: 0,
    },
    {
      telegramMatchNotificationsEnabled: false,
      expectedVersion: null,
      accountId: OTHER_ACCOUNT_ID,
    },
  ])('rejects invalid patch input without storage: %p', async (patch) => {
    const harness = createHarness();
    await expect(
      harness.service.updateOwnPreferences({
        accountId: ACCOUNT_ID,
        role: 'player',
        patch,
      } as never),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(harness.transactions.calls).toBe(0);
  });

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
    ['storage_failure', 'internal_failure'],
  ] as const)('maps persistence %s to %s', async (failure, reason) => {
    const harness = createHarness();
    harness.findByAccountId.mockRejectedValue(
      new AccountNotificationPreferencesPersistenceError(failure),
    );
    await expect(
      harness.service.readOwnPreferences({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toEqual({ outcome: 'rejected', reason });
  });

  it.each([
    ['wrong account', { accountId: OTHER_ACCOUNT_ID }],
    ['invalid boolean', { telegramMatchNotificationsEnabled: 'false' }],
    ['invalid timestamps', { updatedAt: unixEpochSeconds(NOW - 20) }],
    ['invalid version', { version: 0 }],
    ['extra field', { privateValue: 'PRIVATE' }],
  ])(
    'fails closed for malformed repository state: %s',
    async (_label, patch) => {
      const harness = createHarness();
      harness.findByAccountId.mockResolvedValue({
        outcome: 'found',
        preference: preference(patch),
      } as never);
      await expect(
        harness.service.readOwnPreferences({
          accountId: ACCOUNT_ID,
          role: 'player',
        }),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: 'internal_failure',
      });
    },
  );
});
