import {
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import { TelegramNotificationIntentRepository } from '../database/telegram-notification-intent.repository';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import { TelegramBotClient } from './telegram-bot.client';
import { ClaimedTelegramNotificationIntent } from './telegram-notification-intent.types';
import { renderTelegramNotificationMessage } from './telegram-notification-message';

const MAX_RETRY_DELAY_SECONDS = 900;

export interface TelegramNotificationIntentDispatcherDependencies {
  readonly enabled: boolean;
  readonly pollIntervalMilliseconds: number;
  readonly visibilityLeaseSeconds: number;
  readonly transactions: Pick<PostgresTransactionRunner, 'runInTransaction'>;
  readonly intents: TelegramNotificationIntentRepository;
  readonly telegram: Pick<TelegramBotClient, 'sendMessage'>;
  readonly clock: { nowEpochSeconds(): UnixEpochSeconds };
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

export class TelegramNotificationIntentDispatcher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    TelegramNotificationIntentDispatcher.name,
  );
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private authenticationFailed = false;
  private running: Promise<void> | undefined;

  constructor(
    readonly dependencies: TelegramNotificationIntentDispatcherDependencies,
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

  async dispatchOne(): Promise<boolean> {
    if (this.authenticationFailed) return false;
    const claimedAt = this.readNow();
    const leaseUntil = claimedAt + this.dependencies.visibilityLeaseSeconds;
    if (!isUnixEpochSeconds(leaseUntil)) {
      throw new TypeError('Telegram notification lease is invalid');
    }
    const claim = await this.dependencies.transactions.runInTransaction(
      (transaction) =>
        this.dependencies.intents.claimNext(transaction, {
          now: claimedAt,
          leaseUntil,
        }),
    );
    if (claim.outcome === 'none_available') return false;
    if (claim.outcome === 'retry_exhausted') return true;

    const intent = claim.intent;
    if (intent.terminalReason !== undefined) {
      await this.abandon(intent, intent.terminalReason);
      return true;
    }
    if (intent.telegramChatId === undefined) {
      await this.abandon(intent, 'destination_unavailable');
      return true;
    }
    const delivery = await this.dependencies.telegram.sendMessage({
      telegramChatId: intent.telegramChatId,
      text: renderTelegramNotificationMessage(intent),
      deepLink: intent.deepLink,
    });
    const completedAt = this.readNow();
    if (delivery.outcome === 'sent') {
      await this.dependencies.transactions.runInTransaction((transaction) =>
        this.dependencies.intents.markSent(transaction, {
          eventKey: intent.eventKey,
          recipientAccountId: intent.recipientAccountId,
          claimVersion: intent.claimVersion,
          now: completedAt,
          telegramMessageId: delivery.telegramMessageId,
        }),
      );
      return true;
    }
    if (delivery.outcome === 'retry') {
      const availableAt =
        completedAt +
        retryDelaySeconds(intent.attemptCount, delivery.retryAfterSeconds);
      if (!isUnixEpochSeconds(availableAt)) {
        throw new TypeError('Telegram notification retry is invalid');
      }
      await this.dependencies.transactions.runInTransaction((transaction) =>
        this.dependencies.intents.scheduleRetry(transaction, {
          eventKey: intent.eventKey,
          recipientAccountId: intent.recipientAccountId,
          claimVersion: intent.claimVersion,
          now: completedAt,
          availableAt,
          failure: delivery.failure,
        }),
      );
      return true;
    }
    await this.abandon(intent, delivery.failure, delivery.disableDestination);
    if (delivery.failure === 'telegram_unauthorized') {
      this.authenticationFailed = true;
      this.logger.error(
        'Telegram notification dispatch disabled after authentication failure',
      );
    }
    return true;
  }

  private async abandon(
    intent: ClaimedTelegramNotificationIntent,
    failure: Parameters<
      TelegramNotificationIntentRepository['abandon']
    >[1]['failure'],
    disableDestination?: Parameters<
      TelegramNotificationIntentRepository['abandon']
    >[1]['disableDestination'],
  ): Promise<void> {
    await this.dependencies.transactions.runInTransaction((transaction) =>
      this.dependencies.intents.abandon(transaction, {
        eventKey: intent.eventKey,
        recipientAccountId: intent.recipientAccountId,
        claimVersion: intent.claimVersion,
        now: this.readNow(),
        failure,
        ...(disableDestination === undefined
          ? {}
          : {
              disableDestination,
              destinationVersion: intent.destinationVersion,
            }),
      }),
    );
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
      this.logger.error('Telegram notification intent dispatch failed safely');
    } finally {
      this.schedule(processed ? 0 : this.dependencies.pollIntervalMilliseconds);
    }
  }
}
