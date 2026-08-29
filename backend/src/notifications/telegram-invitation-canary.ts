import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import { TelegramNotificationIntentRepository } from '../database/telegram-notification-intent.repository';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import {
  TelegramBotClient,
  TelegramBotSendResult,
} from './telegram-bot.client';
import { ClaimedTelegramNotificationIntent } from './telegram-notification-intent.types';
import { renderTelegramNotificationMessage } from './telegram-notification-message';

export type TelegramInvitationCanaryTarget = Readonly<{
  eventKey: string;
  recipientAccountId: AccountId;
}>;

type TelegramInvitationCanaryResult = Readonly<{
  outcome:
    | 'sent'
    | 'not_sendable'
    | 'target_rejected'
    | 'provider_rejected'
    | 'delivery_unknown'
    | 'finalization_conflict'
    | 'already_run';
}>;

type TelegramInvitationCanaryDependencies = Readonly<{
  visibilityLeaseSeconds: number;
  transactions: Pick<PostgresTransactionRunner, 'runInTransaction'>;
  intents: TelegramNotificationIntentRepository;
  telegram: Pick<TelegramBotClient, 'sendMessage'>;
  clock: { nowEpochSeconds(): UnixEpochSeconds };
}>;

export class TelegramInvitationCanary {
  private used = false;

  constructor(
    private readonly dependencies: TelegramInvitationCanaryDependencies,
  ) {}

  async run(
    target: TelegramInvitationCanaryTarget,
  ): Promise<TelegramInvitationCanaryResult> {
    if (this.used) return Object.freeze({ outcome: 'already_run' });
    this.used = true;

    const claimedAt = this.readNow();
    const leaseUntil = claimedAt + this.dependencies.visibilityLeaseSeconds;
    if (!isUnixEpochSeconds(leaseUntil)) {
      throw new TypeError('Telegram invitation canary lease is invalid');
    }
    const claim = await this.dependencies.transactions.runInTransaction(
      (transaction) =>
        this.dependencies.intents.claimExactInvitationCanary(transaction, {
          ...target,
          now: claimedAt,
          leaseUntil,
        }),
    );
    if (claim.outcome !== 'claimed') {
      return Object.freeze({ outcome: 'not_sendable' });
    }

    const intent = claim.intent;
    if (!this.isExactTarget(intent, target)) {
      await this.abandon(intent, 'delivery_unknown');
      return Object.freeze({ outcome: 'target_rejected' });
    }

    let delivery: TelegramBotSendResult;
    try {
      delivery = await this.dependencies.telegram.sendMessage({
        telegramChatId: intent.telegramChatId,
        text: renderTelegramNotificationMessage(intent),
        deepLink: intent.deepLink,
      });
    } catch {
      const applied = await this.abandon(intent, 'delivery_unknown');
      return Object.freeze({
        outcome: applied ? 'delivery_unknown' : 'finalization_conflict',
      });
    }

    if (delivery.outcome === 'sent') {
      const finalized = await this.dependencies.transactions.runInTransaction(
        (transaction) =>
          this.dependencies.intents.markSent(transaction, {
            eventKey: intent.eventKey,
            recipientAccountId: intent.recipientAccountId,
            claimVersion: intent.claimVersion,
            now: this.readNow(),
            telegramMessageId: delivery.telegramMessageId,
          }),
      );
      return Object.freeze({
        outcome:
          finalized.outcome === 'applied' ? 'sent' : 'finalization_conflict',
      });
    }

    const applied = await this.abandon(
      intent,
      delivery.outcome === 'retry' ? 'retry_exhausted' : delivery.failure,
      delivery.outcome === 'abandoned'
        ? delivery.disableDestination
        : undefined,
    );
    if (!applied) return Object.freeze({ outcome: 'finalization_conflict' });
    return Object.freeze({
      outcome:
        delivery.outcome === 'abandoned' &&
        delivery.failure === 'delivery_unknown'
          ? 'delivery_unknown'
          : 'provider_rejected',
    });
  }

  private isExactTarget(
    intent: ClaimedTelegramNotificationIntent,
    target: TelegramInvitationCanaryTarget,
  ): intent is ClaimedTelegramNotificationIntent & {
    readonly telegramChatId: string;
  } {
    return (
      intent.eventType === 'match_invited' &&
      intent.eventKey === target.eventKey &&
      intent.recipientAccountId === target.recipientAccountId &&
      intent.attemptCount === 1 &&
      intent.telegramChatId !== undefined &&
      intent.destinationVersion !== undefined &&
      intent.terminalReason === undefined
    );
  }

  private async abandon(
    intent: ClaimedTelegramNotificationIntent,
    failure: Parameters<
      TelegramNotificationIntentRepository['abandon']
    >[1]['failure'],
    disableDestination?: Parameters<
      TelegramNotificationIntentRepository['abandon']
    >[1]['disableDestination'],
  ): Promise<boolean> {
    const finalized = await this.dependencies.transactions.runInTransaction(
      (transaction) =>
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
    return finalized.outcome === 'applied';
  }

  private readNow(): UnixEpochSeconds {
    const now = this.dependencies.clock.nowEpochSeconds();
    if (!isUnixEpochSeconds(now)) {
      throw new TypeError('Telegram invitation canary clock is invalid');
    }
    return now;
  }
}
