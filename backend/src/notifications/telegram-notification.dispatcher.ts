import {
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import { TelegramNotificationOutboxRepository } from '../database/telegram-notification-outbox.repository';
import { ClaimedTelegramNotification } from './telegram-notification.types';
import { TelegramBotClient } from './telegram-bot.client';

const MOSCOW_TIME_ZONE = 'Europe/Moscow';
const MAX_RETRY_DELAY_SECONDS = 900;

export interface TelegramNotificationDispatcherDependencies {
  readonly enabled: boolean;
  readonly pollIntervalMilliseconds: number;
  readonly visibilityLeaseSeconds: number;
  readonly transactions: Pick<PostgresTransactionRunner, 'runInTransaction'>;
  readonly outbox: TelegramNotificationOutboxRepository;
  readonly telegram: Pick<TelegramBotClient, 'sendMessage'>;
  readonly clock: { nowEpochSeconds(): UnixEpochSeconds };
}

function messageText(notification: ClaimedTelegramNotification): string {
  const startsAt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Number(notification.matchStartsAt) * 1_000));
  if (notification.sourceType === 'match_invitation') {
    return [
      'Вас пригласили в матч.',
      `${startsAt} · ${notification.courtName}`,
      'Откройте «Просто Падел», чтобы принять или отклонить приглашение.',
    ].join('\n');
  }
  return [
    'Вы добавлены в матч из листа ожидания.',
    `${startsAt} · ${notification.courtName}`,
    'Откройте «Просто Падел», чтобы посмотреть детали.',
  ].join('\n');
}

function retryDelaySeconds(
  attemptCount: number,
  requestedDelay: number | undefined,
): number {
  const exponential = Math.min(
    MAX_RETRY_DELAY_SECONDS,
    5 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 8),
  );
  return Math.max(exponential, requestedDelay ?? 0);
}

export class TelegramNotificationDispatcher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramNotificationDispatcher.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private running: Promise<void> | undefined;

  constructor(readonly dependencies: TelegramNotificationDispatcherDependencies) {}

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

  async dispatchOne(): Promise<boolean> {
    const claimedAt = this.dependencies.clock.nowEpochSeconds();
    if (!isUnixEpochSeconds(claimedAt)) {
      throw new TypeError('Telegram notification clock is invalid');
    }
    const leaseUntil = claimedAt + this.dependencies.visibilityLeaseSeconds;
    if (!isUnixEpochSeconds(leaseUntil)) {
      throw new TypeError('Telegram notification lease is invalid');
    }
    const claim = await this.dependencies.transactions.runInTransaction(
      (transaction) =>
        this.dependencies.outbox.claimNext(transaction, {
          now: claimedAt,
          leaseUntil,
        }),
    );
    if (claim.outcome === 'none_available') return false;
    if (claim.outcome === 'retry_exhausted') return true;

    const notification = claim.notification;
    if (notification.telegramChatId === undefined) {
      await this.dependencies.transactions.runInTransaction((transaction) =>
        this.dependencies.outbox.abandon(transaction, {
          outboxId: notification.outboxId,
          claimVersion: notification.claimVersion,
          now: this.readNow(),
          failure: 'destination_unavailable',
        }),
      );
      return true;
    }

    const delivery = await this.dependencies.telegram.sendMessage({
      telegramChatId: notification.telegramChatId,
      text: messageText(notification),
    });
    const completedAt = this.readNow();
    if (delivery.outcome === 'sent') {
      await this.dependencies.transactions.runInTransaction((transaction) =>
        this.dependencies.outbox.markSent(transaction, {
          outboxId: notification.outboxId,
          claimVersion: notification.claimVersion,
          now: completedAt,
          telegramMessageId: delivery.telegramMessageId,
        }),
      );
      return true;
    }
    if (delivery.outcome === 'retry') {
      const availableAt =
        completedAt +
        retryDelaySeconds(
          notification.attemptCount,
          delivery.retryAfterSeconds,
        );
      if (!isUnixEpochSeconds(availableAt)) {
        throw new TypeError('Telegram notification retry is invalid');
      }
      await this.dependencies.transactions.runInTransaction((transaction) =>
        this.dependencies.outbox.scheduleRetry(transaction, {
          outboxId: notification.outboxId,
          claimVersion: notification.claimVersion,
          now: completedAt,
          availableAt,
          failure: delivery.failure,
        }),
      );
      return true;
    }
    await this.dependencies.transactions.runInTransaction((transaction) =>
      this.dependencies.outbox.abandon(transaction, {
        outboxId: notification.outboxId,
        claimVersion: notification.claimVersion,
        now: completedAt,
        failure: delivery.failure,
        ...(delivery.disableDestination === undefined
          ? {}
          : {
              disableDestination: delivery.disableDestination,
              destinationVersion: notification.destinationVersion,
            }),
      }),
    );
    return true;
  }

  private readNow(): UnixEpochSeconds {
    const now = this.dependencies.clock.nowEpochSeconds();
    if (!isUnixEpochSeconds(now)) {
      throw new TypeError('Telegram notification clock is invalid');
    }
    return now;
  }

  private schedule(delayMilliseconds: number): void {
    if (!this.active) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
      });
    }, delayMilliseconds);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    let processed = false;
    try {
      processed = await this.dispatchOne();
    } catch {
      this.logger.error('Telegram notification dispatch failed safely');
    } finally {
      this.schedule(processed ? 0 : this.dependencies.pollIntervalMilliseconds);
    }
  }
}
