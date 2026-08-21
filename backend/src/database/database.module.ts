import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readReservationSnapshotConfiguration } from '../config/reservation-snapshot.config';
import { YCLIENTS_API_CONFIG_KEYS } from '../config/yclients-api.config';
import { ReservationSnapshotCrypto } from '../reservations/reservation-snapshot.crypto';
import {
  PlayerProfilePhotoUrlResolver,
  readPlayerProfilePhotoStorageConfiguration,
} from '../config/player-profile-photo.config';
import {
  MATCH_COURT_CATALOG,
  MatchCourtCatalog,
  SystemMatchCourtCatalog,
} from '../matches/match-court-catalog';
import { PostgresAccountStatusReader } from './postgres-account-status.reader';
import { PostgresAdminPlayerRatingRepository } from './postgres-admin-player-rating.repository';
import { PostgresAuthenticationOperationTerminalRepository } from './postgres-authentication-operation-terminal.repository';
import { PostgresExternalIdentityResolutionRepository } from './postgres-external-identity.repository';
import { PostgresInitialSessionRepository } from './postgres-initial-session.repository';
import { PostgresMatchChatRepository } from './postgres-match-chat.repository';
import { PostgresMatchLineupRepository } from './postgres-match-lineup.repository';
import { PostgresMatchNotificationRepository } from './postgres-match-notification.repository';
import { PostgresMatchResultRepository } from './postgres-match-result.repository';
import { PostgresMatchRepository } from './postgres-match.repository';
import { PostgresMatchInvitationRepository } from './postgres-match-invitation.repository';
import { PostgresMatchWaitlistRepository } from './postgres-match-waitlist.repository';
import { PostgresPlayerAccountProvisioningRepository } from './postgres-player-account-provisioning.repository';
import { PostgresPlayerProfileDetailsRepository } from './postgres-player-profile-details.repository';
import { PostgresPlayerProfilePhotoRepository } from './postgres-player-profile-photo.repository';
import { PostgresPlayerOnboardingReader } from './postgres-player-onboarding-reader';
import { PostgresPlayerProfileReader } from './postgres-player-profile-reader';
import { PostgresPlayerProfileWriter } from './postgres-player-profile-writer';
import { PostgresPublicPlayerProfileSearchRepository } from './postgres-public-player-profile-search.repository';
import { PostgresSecurityAuditRepository } from './postgres-security-audit.repository';
import { PostgresSessionAuthenticationRepository } from './postgres-session-authentication.repository';
import { PostgresSessionCredentialLifecycleRepository } from './postgres-session-credential-lifecycle.repository';
import { PostgresService } from './postgres.service';
import { PostgresTelegramAuthenticationOperationRepository } from './postgres-telegram-authentication-operation.repository';
import { PostgresTelegramNotificationDestinationRepository } from './postgres-telegram-notification-destination.repository';
import { PostgresTelegramNotificationOutboxRepository } from './postgres-telegram-notification-outbox.repository';
import { PostgresYclientsWebhookSignalRepository } from './postgres-yclients-webhook-signal.repository';
import { PostgresTransactionRunner } from './postgres-transaction';
import { PostgresTransactionExecutorAdapter } from './postgres-transaction-executor.adapter';
import { PostgresCourtReservationRepository } from './postgres-court-reservation.repository';
import { PostgresMatchReservationRepository } from './postgres-match-reservation.repository';

const DATABASE_WORKFLOW_PROVIDERS: Provider[] = [
  {
    provide: ReservationSnapshotCrypto,
    inject: [ConfigService],
    useFactory: (config: ConfigService): ReservationSnapshotCrypto => {
      if (config.get<boolean>(YCLIENTS_API_CONFIG_KEYS.enabled) !== true) {
        return ReservationSnapshotCrypto.disabled();
      }
      const snapshot = readReservationSnapshotConfiguration(config);
      try {
        return new ReservationSnapshotCrypto(snapshot.masterKey, snapshot.keyVersion);
      } finally {
        snapshot.masterKey.fill(0);
      }
    },
  },
  {
    provide: PostgresCourtReservationRepository,
    inject: [ReservationSnapshotCrypto, ConfigService],
    useFactory: (
      crypto: ReservationSnapshotCrypto,
      config: ConfigService,
    ): PostgresCourtReservationRepository =>
      new PostgresCourtReservationRepository(
        crypto,
        config.get<number>(YCLIENTS_API_CONFIG_KEYS.companyId) ?? 0,
      ),
  },
  {
    provide: PostgresMatchReservationRepository,
    inject: [PostgresCourtReservationRepository],
    useFactory: (
      reservations: PostgresCourtReservationRepository,
    ): PostgresMatchReservationRepository =>
      new PostgresMatchReservationRepository(reservations),
  },
  PostgresAdminPlayerRatingRepository,
  PostgresSecurityAuditRepository,
  PostgresExternalIdentityResolutionRepository,
  PostgresAccountStatusReader,
  PostgresPlayerProfileDetailsRepository,
  PostgresPlayerProfilePhotoRepository,
  PostgresPlayerOnboardingReader,
  PostgresPlayerProfileWriter,
  PostgresSessionAuthenticationRepository,
  PostgresMatchChatRepository,
  PostgresMatchLineupRepository,
  PostgresMatchNotificationRepository,
  PostgresMatchResultRepository,
  PostgresTelegramNotificationDestinationRepository,
  PostgresTelegramNotificationOutboxRepository,
  PostgresYclientsWebhookSignalRepository,
  PostgresMatchWaitlistRepository,
  {
    provide: PlayerProfilePhotoUrlResolver,
    inject: [ConfigService],
    useFactory: (config: ConfigService): PlayerProfilePhotoUrlResolver =>
      new PlayerProfilePhotoUrlResolver(
        readPlayerProfilePhotoStorageConfiguration(config).publicBaseUrl,
      ),
  },
  {
    provide: PostgresPlayerProfileReader,
    inject: [PlayerProfilePhotoUrlResolver],
    useFactory: (
      urls: PlayerProfilePhotoUrlResolver,
    ): PostgresPlayerProfileReader =>
      new PostgresPlayerProfileReader(urls),
  },
  {
    provide: PostgresPublicPlayerProfileSearchRepository,
    inject: [PlayerProfilePhotoUrlResolver],
    useFactory: (
      urls: PlayerProfilePhotoUrlResolver,
    ): PostgresPublicPlayerProfileSearchRepository =>
      new PostgresPublicPlayerProfileSearchRepository(urls),
  },
  {
    provide: MATCH_COURT_CATALOG,
    useFactory: (): MatchCourtCatalog =>
      Object.freeze(new SystemMatchCourtCatalog()),
  },
  {
    provide: PostgresMatchRepository,
    inject: [PostgresPlayerProfileReader, MATCH_COURT_CATALOG],
    useFactory: (
      profiles: PostgresPlayerProfileReader,
      courts: MatchCourtCatalog,
    ): PostgresMatchRepository =>
      new PostgresMatchRepository(profiles, courts),
  },
  {
    provide: PostgresMatchInvitationRepository,
    inject: [PostgresMatchRepository],
    useFactory: (
      matches: PostgresMatchRepository,
    ): PostgresMatchInvitationRepository =>
      new PostgresMatchInvitationRepository(matches),
  },
  {
    provide: PostgresTransactionExecutorAdapter,
    inject: [PostgresTransactionRunner],
    useFactory: (
      runner: PostgresTransactionRunner,
    ): PostgresTransactionExecutorAdapter =>
      new PostgresTransactionExecutorAdapter(runner),
  },
  {
    provide: PostgresTelegramAuthenticationOperationRepository,
    inject: [PostgresSecurityAuditRepository],
    useFactory: (
      audit: PostgresSecurityAuditRepository,
    ): PostgresTelegramAuthenticationOperationRepository =>
      new PostgresTelegramAuthenticationOperationRepository(audit),
  },
  {
    provide: PostgresPlayerAccountProvisioningRepository,
    inject: [
      PostgresExternalIdentityResolutionRepository,
      PostgresSecurityAuditRepository,
    ],
    useFactory: (
      externalIdentities: PostgresExternalIdentityResolutionRepository,
      audit: PostgresSecurityAuditRepository,
    ): PostgresPlayerAccountProvisioningRepository =>
      new PostgresPlayerAccountProvisioningRepository(
        externalIdentities,
        audit,
      ),
  },
  {
    provide: PostgresAuthenticationOperationTerminalRepository,
    inject: [PostgresSecurityAuditRepository],
    useFactory: (
      audit: PostgresSecurityAuditRepository,
    ): PostgresAuthenticationOperationTerminalRepository =>
      new PostgresAuthenticationOperationTerminalRepository(audit),
  },
  {
    provide: PostgresInitialSessionRepository,
    inject: [PostgresSecurityAuditRepository],
    useFactory: (
      audit: PostgresSecurityAuditRepository,
    ): PostgresInitialSessionRepository =>
      new PostgresInitialSessionRepository(audit),
  },
  {
    provide: PostgresSessionCredentialLifecycleRepository,
    inject: [PostgresSecurityAuditRepository],
    useFactory: (
      audit: PostgresSecurityAuditRepository,
    ): PostgresSessionCredentialLifecycleRepository =>
      new PostgresSessionCredentialLifecycleRepository(audit),
  },
];

const DATABASE_WORKFLOW_EXPORTS = [
  PostgresCourtReservationRepository,
  PostgresMatchReservationRepository,
  PostgresTransactionRunner,
  PostgresTransactionExecutorAdapter,
  PostgresAdminPlayerRatingRepository,
  PostgresSecurityAuditRepository,
  PostgresTelegramAuthenticationOperationRepository,
  PostgresTelegramNotificationDestinationRepository,
  PostgresTelegramNotificationOutboxRepository,
  PostgresYclientsWebhookSignalRepository,
  PostgresExternalIdentityResolutionRepository,
  PostgresAccountStatusReader,
  PostgresSessionAuthenticationRepository,
  PostgresPlayerAccountProvisioningRepository,
  PostgresPlayerProfileDetailsRepository,
  PostgresPlayerProfilePhotoRepository,
  PostgresPlayerOnboardingReader,
  PostgresPlayerProfileReader,
  PlayerProfilePhotoUrlResolver,
  PostgresPlayerProfileWriter,
  PostgresPublicPlayerProfileSearchRepository,
  PostgresMatchChatRepository,
  PostgresMatchLineupRepository,
  PostgresMatchNotificationRepository,
  PostgresMatchResultRepository,
  PostgresMatchWaitlistRepository,
  PostgresMatchRepository,
  PostgresMatchInvitationRepository,
  MATCH_COURT_CATALOG,
  PostgresAuthenticationOperationTerminalRepository,
  PostgresInitialSessionRepository,
  PostgresSessionCredentialLifecycleRepository,
] as const;

@Module({
  providers: [
    PostgresService,
    PostgresTransactionRunner,
    ...DATABASE_WORKFLOW_PROVIDERS,
  ],
  exports: [...DATABASE_WORKFLOW_EXPORTS],
})
export class DatabaseModule {}
