import { unixEpochSeconds } from '../auth/auth.types';
import { PostgresTransaction } from '../database/postgres-transaction';
import { TelegramReminderScheduler } from './telegram-reminder.scheduler';

describe('TelegramReminderScheduler', () => {
  it('uses a fake clock and a bounded durable 24h/2h eligibility scan', async () => {
    const now = unixEpochSeconds(1_800_000_000);
    const enqueueDueReminders = jest.fn().mockResolvedValue(3);
    const transaction = {} as PostgresTransaction;
    const scheduler = new TelegramReminderScheduler({
      enabled: false,
      transactions: { runInTransaction: (operation) => operation(transaction) },
      intents: { enqueueDueReminders },
      clock: { nowEpochSeconds: () => now },
    });
    await expect(scheduler.enqueueDue()).resolves.toBe(3);
    expect(enqueueDueReminders).toHaveBeenCalledWith(transaction, {
      now,
      matchLimit: 50,
    });
  });
});
