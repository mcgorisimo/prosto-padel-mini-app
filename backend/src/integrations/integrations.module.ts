import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TELEGRAM_NOTIFICATION_CONFIG_KEYS,
  TELEGRAM_NOTIFICATION_POLL_INTERVAL_MILLISECONDS,
  TELEGRAM_NOTIFICATION_REQUEST_TIMEOUT_MILLISECONDS,
  TELEGRAM_NOTIFICATION_VISIBILITY_LEASE_SECONDS,
} from '../config/telegram-notification.config';
import { DatabaseModule } from '../database/database.module';
import { PostgresTelegramNotificationOutboxRepository } from '../database/postgres-telegram-notification-outbox.repository';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import { TelegramBotClient } from '../notifications/telegram-bot.client';
import { TelegramNotificationDispatcher } from '../notifications/telegram-notification.dispatcher';
import { CRM_ADAPTER } from './crm/crm.tokens';
import { DisabledCrmAdapter } from './crm/disabled-crm.adapter';
import { YclientsWebhookController } from './yclients/yclients-webhook.controller';
import { YclientsWebhookService } from './yclients/yclients-webhook.service';

@Module({
  imports: [DatabaseModule],
  controllers: [YclientsWebhookController],
  providers: [
    DisabledCrmAdapter,
    YclientsWebhookService,
    {
      provide: CRM_ADAPTER,
      useExisting: DisabledCrmAdapter,
    },
    {
      provide: TelegramNotificationDispatcher,
      inject: [
        ConfigService,
        PostgresTransactionRunner,
        PostgresTelegramNotificationOutboxRepository,
      ],
      useFactory: (
        config: ConfigService,
        transactions: PostgresTransactionRunner,
        outbox: PostgresTelegramNotificationOutboxRepository,
      ): TelegramNotificationDispatcher => {
        const enabled =
          config.get<boolean>(TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled) ===
          true;
        const botToken = config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
        const miniAppUrl =
          config.get<string>(TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl) ??
          '';
        return new TelegramNotificationDispatcher({
          enabled,
          pollIntervalMilliseconds:
            TELEGRAM_NOTIFICATION_POLL_INTERVAL_MILLISECONDS,
          visibilityLeaseSeconds:
            TELEGRAM_NOTIFICATION_VISIBILITY_LEASE_SECONDS,
          transactions,
          outbox,
          telegram: new TelegramBotClient({
            botToken,
            miniAppUrl,
            requestTimeoutMilliseconds:
              TELEGRAM_NOTIFICATION_REQUEST_TIMEOUT_MILLISECONDS,
            fetch: globalThis.fetch,
          }),
          clock: {
            nowEpochSeconds: () =>
              Math.floor(Date.now() / 1_000) as import('../auth/auth.types').UnixEpochSeconds,
          },
        });
      },
    },
  ],
  exports: [CRM_ADAPTER],
})
export class IntegrationsModule {}
