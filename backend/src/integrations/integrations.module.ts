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
import { PostgresTelegramNotificationIntentRepository } from '../database/postgres-telegram-notification-intent.repository';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import { PostgresCourtReservationRepository } from '../database/postgres-court-reservation.repository';
import { PostgresMatchReservationRepository } from '../database/postgres-match-reservation.repository';
import { PostgresYclientsNotificationReconciliationRepository } from '../database/postgres-yclients-notification-reconciliation.repository';
import { TelegramBotClient } from '../notifications/telegram-bot.client';
import { TelegramNotificationDispatcher } from '../notifications/telegram-notification.dispatcher';
import { TelegramNotificationIntentDispatcher } from '../notifications/telegram-notification-intent.dispatcher';
import { TelegramReminderScheduler } from '../notifications/telegram-reminder.scheduler';
import { CRM_ADAPTER } from './crm/crm.tokens';
import { DisabledCrmAdapter } from './crm/disabled-crm.adapter';
import { YclientsWebhookController } from './yclients/yclients-webhook.controller';
import { YclientsWebhookService } from './yclients/yclients-webhook.service';
import {
  YCLIENTS_API_REQUEST_TIMEOUT_MILLISECONDS,
  readYclientsApiConfiguration,
} from '../config/yclients-api.config';
import { YclientsApiClient } from './yclients/yclients-api.client';
import { YclientsAvailabilityService } from './yclients/yclients-availability.service';
import { YclientsBookingService } from './yclients/yclients-booking.service';
import { YclientsAdminReadClient } from './yclients/yclients-admin-read.client';
import { YclientsConservativeRequestLimiter } from './yclients/yclients-request-limiter';
import { YclientsNotificationReconciliationScheduler } from './yclients/yclients-notification-reconciliation.scheduler';

@Module({
  imports: [DatabaseModule],
  controllers: [YclientsWebhookController],
  providers: [
    DisabledCrmAdapter,
    YclientsAvailabilityService,
    YclientsBookingService,
    YclientsWebhookService,
    YclientsConservativeRequestLimiter,
    {
      provide: YclientsApiClient,
      inject: [ConfigService, YclientsConservativeRequestLimiter],
      useFactory: (
        config: ConfigService,
        limiter: YclientsConservativeRequestLimiter,
      ): YclientsApiClient =>
        new YclientsApiClient({
          runtime: readYclientsApiConfiguration(config),
          requestTimeoutMilliseconds:
            YCLIENTS_API_REQUEST_TIMEOUT_MILLISECONDS,
          fetch: globalThis.fetch,
          limiter,
        }),
    },
    {
      provide: YclientsAdminReadClient,
      inject: [ConfigService, YclientsConservativeRequestLimiter],
      useFactory: (
        config: ConfigService,
        limiter: YclientsConservativeRequestLimiter,
      ): YclientsAdminReadClient =>
        new YclientsAdminReadClient({
          runtime: readYclientsApiConfiguration(config),
          requestTimeoutMilliseconds:
            YCLIENTS_API_REQUEST_TIMEOUT_MILLISECONDS,
          fetch: globalThis.fetch,
          limiter,
        }),
    },
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
    {
      provide: TelegramNotificationIntentDispatcher,
      inject: [
        ConfigService,
        PostgresTransactionRunner,
        PostgresTelegramNotificationIntentRepository,
      ],
      useFactory: (
        config: ConfigService,
        transactions: PostgresTransactionRunner,
        intents: PostgresTelegramNotificationIntentRepository,
      ): TelegramNotificationIntentDispatcher => {
        const enabled =
          config.get<boolean>(TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled) ===
          true;
        return new TelegramNotificationIntentDispatcher({
          enabled,
          pollIntervalMilliseconds:
            TELEGRAM_NOTIFICATION_POLL_INTERVAL_MILLISECONDS,
          visibilityLeaseSeconds:
            TELEGRAM_NOTIFICATION_VISIBILITY_LEASE_SECONDS,
          transactions,
          intents,
          telegram: new TelegramBotClient({
            botToken: config.get<string>('TELEGRAM_BOT_TOKEN') ?? '',
            miniAppUrl:
              config.get<string>(
                TELEGRAM_NOTIFICATION_CONFIG_KEYS.miniAppUrl,
              ) ?? '',
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
    {
      provide: TelegramReminderScheduler,
      inject: [
        ConfigService,
        PostgresTransactionRunner,
        PostgresTelegramNotificationIntentRepository,
      ],
      useFactory: (
        config: ConfigService,
        transactions: PostgresTransactionRunner,
        intents: PostgresTelegramNotificationIntentRepository,
      ): TelegramReminderScheduler =>
        new TelegramReminderScheduler({
          enabled:
            config.get<boolean>(TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled) ===
            true,
          transactions,
          intents,
          clock: {
            nowEpochSeconds: () =>
              Math.floor(Date.now() / 1_000) as import('../auth/auth.types').UnixEpochSeconds,
          },
        }),
    },
    {
      provide: YclientsNotificationReconciliationScheduler,
      inject: [
        ConfigService,
        PostgresTransactionRunner,
        PostgresYclientsNotificationReconciliationRepository,
        PostgresCourtReservationRepository,
        PostgresMatchReservationRepository,
        PostgresTelegramNotificationIntentRepository,
        YclientsAdminReadClient,
      ],
      useFactory: (
        config: ConfigService,
        transactions: PostgresTransactionRunner,
        leases: PostgresYclientsNotificationReconciliationRepository,
        reservations: PostgresCourtReservationRepository,
        matchReservations: PostgresMatchReservationRepository,
        intents: PostgresTelegramNotificationIntentRepository,
        adminRead: YclientsAdminReadClient,
      ): YclientsNotificationReconciliationScheduler =>
        new YclientsNotificationReconciliationScheduler({
          enabled:
            config.get<boolean>(
              TELEGRAM_NOTIFICATION_CONFIG_KEYS
                .yclientsReadReconciliationEnabled,
            ) === true,
          transactions,
          leases,
          reservations,
          matchReservations,
          intents,
          adminRead,
          clock: {
            nowEpochSeconds: () =>
              Math.floor(Date.now() / 1_000) as import('../auth/auth.types').UnixEpochSeconds,
          },
        }),
    },
  ],
  exports: [
    CRM_ADAPTER,
    YclientsApiClient,
    YclientsAvailabilityService,
    YclientsBookingService,
    YclientsAdminReadClient,
  ],
})
export class IntegrationsModule {}
