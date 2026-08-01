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
import { ContentModerationController } from '../common/content-moderation.controller';
import { PostgresAccountStatusReader } from '../database/postgres-account-status.reader';
import { PostgresAuthenticationOperationTerminalRepository } from '../database/postgres-authentication-operation-terminal.repository';
import { PostgresExternalIdentityResolutionRepository } from '../database/postgres-external-identity.repository';
import { PostgresInitialSessionRepository } from '../database/postgres-initial-session.repository';
import { PostgresMatchChatRepository } from '../database/postgres-match-chat.repository';
import { PostgresMatchLineupRepository } from '../database/postgres-match-lineup.repository';
import { PostgresMatchResultRepository } from '../database/postgres-match-result.repository';
import { PostgresMatchRepository } from '../database/postgres-match.repository';
import { PostgresMatchInvitationRepository } from '../database/postgres-match-invitation.repository';
import { PostgresMatchWaitlistRepository } from '../database/postgres-match-waitlist.repository';
import { PostgresPlayerAccountProvisioningRepository } from '../database/postgres-player-account-provisioning.repository';
import { PostgresPlayerProfileDetailsRepository } from '../database/postgres-player-profile-details.repository';
import { PostgresPlayerProfileReader } from '../database/postgres-player-profile-reader';
import { PostgresPlayerProfileWriter } from '../database/postgres-player-profile-writer';
import { PostgresPublicPlayerProfileSearchRepository } from '../database/postgres-public-player-profile-search.repository';
import { PostgresSessionAuthenticationRepository } from '../database/postgres-session-authentication.repository';
import { PostgresSessionCredentialLifecycleRepository } from '../database/postgres-session-credential-lifecycle.repository';
import { PostgresTelegramAuthenticationOperationRepository } from '../database/postgres-telegram-authentication-operation.repository';
import { PostgresTransactionExecutorAdapter } from '../database/postgres-transaction-executor.adapter';
import { MatchApiService } from '../matches/match-api.service';
import { MatchChatController } from '../matches/match-chat.controller';
import { MatchChatService } from '../matches/match-chat.service';
import { MatchController } from '../matches/match.controller';
import { MatchInvitationController } from '../matches/match-invitation.controller';
import { MatchInvitationService } from '../matches/match-invitation.service';
import { MatchLineupController } from '../matches/match-lineup.controller';
import { MatchLineupService } from '../matches/match-lineup.service';
import { MatchResultController } from '../matches/match-result.controller';
import { MatchResultService } from '../matches/match-result.service';
import { MatchWaitlistController } from '../matches/match-waitlist.controller';
import { MatchWaitlistService } from '../matches/match-waitlist.service';
import { NodeSessionCredentialIssuer } from './session-credential-issuer.adapter';
import { PlayerProfileController } from './player-profile.controller';
import { PlayerProfileService } from './player-profile.service';
import { PublicPlayerProfileController } from './public-player-profile.controller';
import { PublicPlayerProfileService } from './public-player-profile.service';
import { SessionAuthenticationController } from './session-authentication.controller';
import {
  SESSION_AUTHENTICATION_CLOCK_PROVIDER,
  SESSION_AUTHENTICATION_CLOCK,
  SessionAuthenticationClock,
  SessionBearerGuard,
} from './session-authentication.guard';
import { SessionAuthenticationService } from './session-authentication.service';
import {
  SESSION_LIFECYCLE_HTTP_CLOCK_PROVIDER,
  SessionLifecycleController,
} from './session-lifecycle.controller';
import { SessionLifecycleService } from './session-lifecycle.service';
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
  profileDetails: PostgresPlayerProfileDetailsRepository,
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
          profileDetails,
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

function createSessionLifecycleService(
  transactions: PostgresTransactionExecutorAdapter,
  sessions: PostgresSessionCredentialLifecycleRepository,
): SessionLifecycleService {
  return new SessionLifecycleService({
    transactions,
    sessions,
    credentialIssuer: new NodeSessionCredentialIssuer(),
  });
}

function createSessionAuthenticationService(
  transactions: PostgresTransactionExecutorAdapter,
  sessions: PostgresSessionAuthenticationRepository,
): SessionAuthenticationService {
  return new SessionAuthenticationService({
    transactions,
    sessions,
  });
}

function createPlayerProfileService(
  transactions: PostgresTransactionExecutorAdapter,
  profiles: PostgresPlayerProfileReader,
  profileWriter: PostgresPlayerProfileWriter,
  clock: SessionAuthenticationClock,
): PlayerProfileService {
  return new PlayerProfileService({
    transactions,
    profiles,
    profileWriter,
    clock,
  });
}

function createPublicPlayerProfileService(
  transactions: PostgresTransactionExecutorAdapter,
  profiles: PostgresPublicPlayerProfileSearchRepository,
): PublicPlayerProfileService {
  return new PublicPlayerProfileService({
    transactions,
    profiles,
  });
}

function createMatchApiService(
  transactions: PostgresTransactionExecutorAdapter,
  matches: PostgresMatchRepository,
  publicProfiles: PostgresPublicPlayerProfileSearchRepository,
  waitlist: MatchWaitlistService,
  lineups: MatchLineupService,
  clock: SessionAuthenticationClock,
): MatchApiService {
  return new MatchApiService({
    transactions,
    matches,
    publicProfiles,
    waitlist,
    lineups,
    clock,
  });
}

function createMatchInvitationService(
  transactions: PostgresTransactionExecutorAdapter,
  invitations: PostgresMatchInvitationRepository,
  publicProfiles: PostgresPublicPlayerProfileSearchRepository,
  waitlist: MatchWaitlistService,
  clock: SessionAuthenticationClock,
): MatchInvitationService {
  return new MatchInvitationService({
    transactions,
    invitations,
    publicProfiles,
    waitlist,
    clock,
  });
}

function createMatchWaitlistService(
  transactions: PostgresTransactionExecutorAdapter,
  waitlist: PostgresMatchWaitlistRepository,
  matches: PostgresMatchRepository,
  publicProfiles: PostgresPublicPlayerProfileSearchRepository,
  clock: SessionAuthenticationClock,
): MatchWaitlistService {
  return new MatchWaitlistService({
    transactions,
    waitlist,
    matches,
    publicProfiles,
    clock,
  });
}

function createMatchChatService(
  transactions: PostgresTransactionExecutorAdapter,
  chat: PostgresMatchChatRepository,
  clock: SessionAuthenticationClock,
): MatchChatService {
  return new MatchChatService({
    transactions,
    chat,
    clock,
  });
}

function createMatchLineupService(
  transactions: PostgresTransactionExecutorAdapter,
  lineups: PostgresMatchLineupRepository,
  publicProfiles: PostgresPublicPlayerProfileSearchRepository,
  clock: SessionAuthenticationClock,
): MatchLineupService {
  return new MatchLineupService({
    transactions,
    lineups,
    publicProfiles,
    clock,
  });
}

function createMatchResultService(
  transactions: PostgresTransactionExecutorAdapter,
  results: PostgresMatchResultRepository,
  clock: SessionAuthenticationClock,
): MatchResultService {
  return new MatchResultService({
    transactions,
    results,
    clock,
  });
}

@Module({
  imports: [DatabaseModule],
  controllers: [
    TelegramLoginController,
    SessionLifecycleController,
    SessionAuthenticationController,
    PlayerProfileController,
    PublicPlayerProfileController,
    MatchController,
    MatchInvitationController,
    MatchChatController,
    MatchWaitlistController,
    MatchLineupController,
    MatchResultController,
    ContentModerationController,
  ],
  providers: [
    TELEGRAM_LOGIN_HTTP_CLOCK_PROVIDER,
    SESSION_LIFECYCLE_HTTP_CLOCK_PROVIDER,
    SESSION_AUTHENTICATION_CLOCK_PROVIDER,
    SessionBearerGuard,
    {
      provide: MatchResultService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresMatchResultRepository,
        SESSION_AUTHENTICATION_CLOCK,
      ],
      useFactory: createMatchResultService,
    },
    {
      provide: MatchLineupService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresMatchLineupRepository,
        PostgresPublicPlayerProfileSearchRepository,
        SESSION_AUTHENTICATION_CLOCK,
      ],
      useFactory: createMatchLineupService,
    },
    {
      provide: MatchWaitlistService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresMatchWaitlistRepository,
        PostgresMatchRepository,
        PostgresPublicPlayerProfileSearchRepository,
        SESSION_AUTHENTICATION_CLOCK,
      ],
      useFactory: createMatchWaitlistService,
    },
    {
      provide: MatchChatService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresMatchChatRepository,
        SESSION_AUTHENTICATION_CLOCK,
      ],
      useFactory: createMatchChatService,
    },
    {
      provide: MatchInvitationService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresMatchInvitationRepository,
        PostgresPublicPlayerProfileSearchRepository,
        MatchWaitlistService,
        SESSION_AUTHENTICATION_CLOCK,
      ],
      useFactory: createMatchInvitationService,
    },
    {
      provide: MatchApiService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresMatchRepository,
        PostgresPublicPlayerProfileSearchRepository,
        MatchWaitlistService,
        MatchLineupService,
        SESSION_AUTHENTICATION_CLOCK,
      ],
      useFactory: createMatchApiService,
    },
    {
      provide: PublicPlayerProfileService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresPublicPlayerProfileSearchRepository,
      ],
      useFactory: createPublicPlayerProfileService,
    },
    {
      provide: PlayerProfileService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresPlayerProfileReader,
        PostgresPlayerProfileWriter,
        SESSION_AUTHENTICATION_CLOCK,
      ],
      useFactory: createPlayerProfileService,
    },
    {
      provide: SessionAuthenticationService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresSessionAuthenticationRepository,
      ],
      useFactory: createSessionAuthenticationService,
    },
    {
      provide: SessionLifecycleService,
      inject: [
        PostgresTransactionExecutorAdapter,
        PostgresSessionCredentialLifecycleRepository,
      ],
      useFactory: createSessionLifecycleService,
    },
    {
      provide: TELEGRAM_LOGIN_FEATURE,
      inject: [
        ConfigService,
        PostgresTransactionExecutorAdapter,
        PostgresTelegramAuthenticationOperationRepository,
        PostgresExternalIdentityResolutionRepository,
        PostgresAccountStatusReader,
        PostgresPlayerAccountProvisioningRepository,
        PostgresPlayerProfileDetailsRepository,
        PostgresAuthenticationOperationTerminalRepository,
        PostgresInitialSessionRepository,
      ],
      useFactory: createTelegramLoginFeature,
    },
  ],
  exports: [
    TELEGRAM_LOGIN_FEATURE,
    SessionAuthenticationService,
    SessionBearerGuard,
    PlayerProfileService,
    PublicPlayerProfileService,
    MatchApiService,
    MatchInvitationService,
    MatchChatService,
    MatchWaitlistService,
    MatchLineupService,
    MatchResultService,
  ],
})
export class AuthModule {}
