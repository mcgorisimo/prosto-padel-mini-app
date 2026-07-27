import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../accounts/external-identity-lookup-digest.port';
import {
  TELEGRAM_LOGIN_CONFIG_KEYS,
  decodeTelegramCryptoSecret,
} from '../config/telegram-login.config';
import { DatabaseModule } from '../database/database.module';
import { PostgresAccountStatusReader } from '../database/postgres-account-status.reader';
import { PostgresAuthenticationOperationTerminalRepository } from '../database/postgres-authentication-operation-terminal.repository';
import { PostgresExternalIdentityResolutionRepository } from '../database/postgres-external-identity.repository';
import { PostgresInitialSessionRepository } from '../database/postgres-initial-session.repository';
import { PostgresPlayerAccountProvisioningRepository } from '../database/postgres-player-account-provisioning.repository';
import { PostgresTelegramAuthenticationOperationRepository } from '../database/postgres-telegram-authentication-operation.repository';
import { PostgresTransactionExecutorAdapter } from '../database/postgres-transaction-executor.adapter';
import { NodeSessionCredentialIssuer } from './session-credential-issuer.adapter';
import {
  TelegramInitDataDiagnosticEvent,
  TelegramInitDataVerifier,
} from './telegram-init-data.verifier';
import {
  TELEGRAM_LOGIN_HTTP_CLOCK_PROVIDER,
  TelegramLoginController,
} from './telegram-login.controller';
import {
  TELEGRAM_LOGIN_FEATURE,
  TelegramLoginFeature,
} from './telegram-login.feature';
import {
  TelegramLoginDiagnosticEvent,
  TelegramLoginService,
} from './telegram-login.service';
import { DeterministicTelegramLoginWorkflowBindingsAdapter } from './telegram-login-workflow-bindings.adapter';
import { TelegramLookupDigestCandidatesAdapter } from './telegram-lookup-digest.adapter';

function telegramWorkflowEnabled(config: ConfigService): boolean {
  return config.getOrThrow<boolean>('TELEGRAM_AUTH_ENABLED');
}

const DISABLED_TELEGRAM_LOGIN_FEATURE: TelegramLoginFeature = Object.freeze({
  enabled: false,
});

function logTelegramInitDataDiagnostic(
  logger: Logger,
  event: TelegramInitDataDiagnosticEvent,
): void {
  if (event.reason === 'auth_date_expired') {
    logger.warn(
      `Telegram initData verification rejected reason=auth_date_expired bucket=${event.ageBucket}`,
    );
    return;
  }
  if (event.reason === 'optional_field_invalid') {
    logger.warn(
      `Telegram initData verification rejected reason=optional_field_invalid field=${event.field}`,
    );
    return;
  }

  logger.warn(
    `Telegram initData verification rejected reason=${event.reason}`,
  );
}

function logTelegramLoginDiagnostic(
  logger: Logger,
  event: TelegramLoginDiagnosticEvent,
): void {
  if ('proofBindingCheck' in event) {
    const check = event.proofBindingCheck;
    logger.warn(
      'Telegram proof binding check: ' +
        `operation_exists=${check.operationExists} ` +
        `consumption_exists=${check.consumptionExists} ` +
        `operation_id_match=${check.operationIdMatch} ` +
        `intent_match=${check.intentMatch} ` +
        `idempotency_key_match=${check.idempotencyKeyMatch} ` +
        `request_digest_match=${check.requestDigestMatch}`,
    );
    return;
  }
  if ('checkpoint' in event) {
    logger.warn(`Telegram login failed checkpoint=${event.checkpoint}`);
    return;
  }
  logger.warn(`Telegram login failed stage=${event.stage}`);
}

function createTelegramLoginFeature(
  config: ConfigService,
  transactions: PostgresTransactionExecutorAdapter,
  pendingOperations: PostgresTelegramAuthenticationOperationRepository,
  externalIdentities: PostgresExternalIdentityResolutionRepository,
  accounts: PostgresAccountStatusReader,
  playerAccounts: PostgresPlayerAccountProvisioningRepository,
  terminalOperations: PostgresAuthenticationOperationTerminalRepository,
  initialSessions: PostgresInitialSessionRepository,
): TelegramLoginFeature {
  if (!telegramWorkflowEnabled(config)) {
    return DISABLED_TELEGRAM_LOGIN_FEATURE;
  }

  const telegramInitDataLogger = new Logger(
    TelegramInitDataVerifier.name,
  );
  const telegramLoginLogger = new Logger(TelegramLoginService.name);
  const pepper = decodeTelegramCryptoSecret(
    config.getOrThrow<string>(
      TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64,
    ),
  );
  try {
    const hmacSecret = decodeTelegramCryptoSecret(
      config.getOrThrow<string>(
        TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64,
      ),
    );
    try {
      const verifier = new TelegramInitDataVerifier(
        {
          enabled: true,
          botToken: config.getOrThrow<string>('TELEGRAM_BOT_TOKEN'),
          maxAgeSeconds: config.getOrThrow<number>(
            'TELEGRAM_INIT_DATA_MAX_AGE_SECONDS',
          ),
        },
        undefined,
        (event) => {
          logTelegramInitDataDiagnostic(telegramInitDataLogger, event);
        },
      );
      const lookupDigests = new TelegramLookupDigestCandidatesAdapter({
        digestVersion: externalIdentityLookupDigestVersion(
          config.getOrThrow<number>(
            TELEGRAM_LOGIN_CONFIG_KEYS.digestVersion,
          ),
        ),
        pepperVersion: externalIdentityLookupDigestPepperVersion(
          config.getOrThrow<number>(
            TELEGRAM_LOGIN_CONFIG_KEYS.pepperVersion,
          ),
        ),
        pepper,
      });
      const workflowBindings =
        new DeterministicTelegramLoginWorkflowBindingsAdapter({
          uuidNamespace: config.getOrThrow<string>(
            TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace,
          ),
          hmacSecret,
          operationTtlSeconds: config.getOrThrow<number>(
            TELEGRAM_LOGIN_CONFIG_KEYS.operationTtlSeconds,
          ),
          sessionTtlSeconds: config.getOrThrow<number>(
            TELEGRAM_LOGIN_CONFIG_KEYS.sessionTtlSeconds,
          ),
        });
      const service = new TelegramLoginService(
        {
          verifier,
          lookupDigests,
          transactions,
          pendingOperations,
          externalIdentities,
          accounts,
          playerAccounts,
          terminalOperations,
          credentialIssuer: new NodeSessionCredentialIssuer(),
          initialSessions,
          workflowBindings,
        },
        (event) => {
          logTelegramLoginDiagnostic(telegramLoginLogger, event);
        },
      );

      return Object.freeze({
        enabled: true,
        service,
      });
    } finally {
      hmacSecret.fill(0);
    }
  } finally {
    pepper.fill(0);
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [TelegramLoginController],
  providers: [
    TELEGRAM_LOGIN_HTTP_CLOCK_PROVIDER,
    {
      provide: TELEGRAM_LOGIN_FEATURE,
      inject: [
        ConfigService,
        PostgresTransactionExecutorAdapter,
        PostgresTelegramAuthenticationOperationRepository,
        PostgresExternalIdentityResolutionRepository,
        PostgresAccountStatusReader,
        PostgresPlayerAccountProvisioningRepository,
        PostgresAuthenticationOperationTerminalRepository,
        PostgresInitialSessionRepository,
      ],
      useFactory: createTelegramLoginFeature,
    },
  ],
  exports: [TELEGRAM_LOGIN_FEATURE],
})
export class AuthModule {}
