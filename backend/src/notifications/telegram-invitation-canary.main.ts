import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import {
  TELEGRAM_NOTIFICATION_CONFIG_KEYS,
  TELEGRAM_NOTIFICATION_REQUEST_TIMEOUT_MILLISECONDS,
  TELEGRAM_NOTIFICATION_VISIBILITY_LEASE_SECONDS,
} from '../config/telegram-notification.config';
import { DatabaseModule } from '../database/database.module';
import { PostgresTelegramNotificationIntentRepository } from '../database/postgres-telegram-notification-intent.repository';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import {
  TelegramBotClient,
  buildTelegramMiniAppUrl,
} from './telegram-bot.client';
import { TelegramInvitationCanary } from './telegram-invitation-canary';
import {
  TELEGRAM_INVITATION_CANARY_MINI_APP_URL,
  TelegramInvitationCanaryLauncherDependencies,
  runTelegramInvitationCanaryLauncher,
} from './telegram-invitation-canary-launcher';

@Module({ imports: [AppConfigModule, DatabaseModule] })
class TelegramInvitationCanaryModule {}

function miniAppUrlReady(value: string): boolean {
  try {
    buildTelegramMiniAppUrl(value);
    return true;
  } catch {
    return false;
  }
}

function dependencies(): TelegramInvitationCanaryLauncherDependencies {
  return Object.freeze({
    load: async () => {
      const application = await NestFactory.createApplicationContext(
        TelegramInvitationCanaryModule,
        { logger: false },
      );
      const config = application.get(ConfigService);
      const transactions = application.get(PostgresTransactionRunner);
      const intents = application.get(
        PostgresTelegramNotificationIntentRepository,
      );
      const botToken = config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
      const miniAppUrl = TELEGRAM_INVITATION_CANARY_MINI_APP_URL;
      return Object.freeze({
        runtime: Object.freeze({
          nodeEnvironment: config.get<string>('NODE_ENV') ?? '',
          release: config.get<string>('APP_RELEASE') ?? '',
          releaseShaRequired:
            config.get<boolean>('APP_RELEASE_SHA_REQUIRED') === true,
          databaseEnabled: config.get<boolean>('DATABASE_ENABLED') === true,
          telegramAuthEnabled:
            config.get<boolean>('TELEGRAM_AUTH_ENABLED') === true,
          outboundNotificationsEnabled:
            config.get<boolean>(TELEGRAM_NOTIFICATION_CONFIG_KEYS.enabled) ===
            true,
          yclientsNotificationReconciliationEnabled:
            config.get<boolean>(
              TELEGRAM_NOTIFICATION_CONFIG_KEYS.yclientsReadReconciliationEnabled,
            ) === true,
          botTokenReady: botToken.length > 0,
          miniAppUrlReady: miniAppUrlReady(miniAppUrl),
        }),
        canary: new TelegramInvitationCanary({
          visibilityLeaseSeconds:
            TELEGRAM_NOTIFICATION_VISIBILITY_LEASE_SECONDS,
          transactions,
          intents,
          telegram: new TelegramBotClient({
            botToken,
            miniAppUrl,
            requestTimeoutMilliseconds:
              TELEGRAM_NOTIFICATION_REQUEST_TIMEOUT_MILLISECONDS,
            fetch: globalThis.fetch,
          }),
          clock: {
            nowEpochSeconds: () =>
              Math.floor(
                Date.now() / 1_000,
              ) as import('../auth/auth.types').UnixEpochSeconds,
          },
        }),
        close: () => application.close(),
      });
    },
    writeOutput: (line: string) => {
      process.stdout.write(line);
    },
  });
}

if (require.main === module) {
  void runTelegramInvitationCanaryLauncher(
    process.argv.slice(2),
    dependencies(),
  ).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.exitCode = 2;
    },
  );
}
