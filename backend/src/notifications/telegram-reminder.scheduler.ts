import {
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import { TelegramNotificationIntentRepository } from '../database/telegram-notification-intent.repository';
import { PostgresTransactionRunner } from '../database/postgres-transaction';

export const TELEGRAM_REMINDER_INTERVAL_MILLISECONDS = 300_000;
export const TELEGRAM_REMINDER_MATCH_LIMIT = 50;

export class TelegramReminderScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramReminderScheduler.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private running: Promise<void> | undefined;

  constructor(
    private readonly dependencies: Readonly<{
      enabled: boolean;
      transactions: Pick<PostgresTransactionRunner, 'runInTransaction'>;
      intents: Pick<
        TelegramNotificationIntentRepository,
        'enqueueDueReminders'
      >;
      clock: { nowEpochSeconds(): UnixEpochSeconds };
    }>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.dependencies.enabled) return;
    this.active = true;
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.active = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    await this.running;
  }

  async enqueueDue(): Promise<number> {
    const now = this.dependencies.clock.nowEpochSeconds();
    if (!isUnixEpochSeconds(now))
      throw new TypeError('Reminder clock is invalid');
    return this.dependencies.transactions.runInTransaction((transaction) =>
      this.dependencies.intents.enqueueDueReminders(transaction, {
        now,
        matchLimit: TELEGRAM_REMINDER_MATCH_LIMIT,
      }),
    );
  }

  private schedule(delay: number): void {
    if (!this.active) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
      });
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.enqueueDue();
    } catch {
      this.logger.error('Telegram reminder scheduling failed safely');
    } finally {
      this.schedule(TELEGRAM_REMINDER_INTERVAL_MILLISECONDS);
    }
  }
}
