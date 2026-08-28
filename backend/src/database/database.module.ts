import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readReservationSnapshotConfiguration } from '../config/reservation-snapshot.config';
import { YCLIENTS_API_CONFIG_KEYS } from '../config/yclients-api.config';
import { readPlayerOnboardingPolicyConfiguration } from '../config/player-onboarding-policy.config';
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
import { PostgresAccountNotificationPreferencesRepository } from './postgres-account-notification-preferences.repository';
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
import { PostgresPlayerOnboardingDraftWriter } from './postgres-player-onboarding-draft-writer';
import { PostgresPlayerOnboardingCompletionWriter } from './postgres-player-onboarding-completion-writer';
import { PostgresPlayerOnboardingProgressWriter } from './postgres-player-onboarding-progress-writer';
import { PostgresPlayerOnboardingLegalAcceptanceWriter } from './postgres-player-onboarding-legal-acceptance-writer';
import { PostgresPlayerOnboardingReader } from './postgres-player-onboarding-reader';
import { PostgresPlayerInitialLevelReassessmentRepository } from './postgres-player-initial-level-reassessment-repository';
import { PostgresPlayerProfileReader } from './postgres-player-profile-reader';
import { PostgresPlayerProfileWriter } from './postgres-player-profile-writer';
import { PostgresPublicPlayerProfileSearchRepository } from './postgres-public-player-profile-search.repository';
import { PublicPlayerVisibilityPolicy } from './public-player-profile-search.repository';
import { PostgresSecurityAuditRepository } from './postgres-security-audit.repository';
import { PostgresSessionAuthenticationRepository } from './postgres-session-authentication.repository';
import { PostgresSessionCredentialLifecycleRepository } from './postgres-session-credential-lifecycle.repository';
import { PostgresService } from './postgres.service';
import { PostgresTelegramAuthenticationOperationRepository } from './postgres-telegram-authentication-operation.repository';
import { PostgresTelegramNotificationDestinationRepository } from './postgres-telegram-notification-destination.repository';
import { PostgresTelegramNotificationOutboxRepository } from './postgres-telegram-notification-outbox.repository';
import { PostgresTelegramNotificationIntentRepository } from './postgres-telegram-notification-intent.repository';
import { PostgresYclientsWebhookSignalRepository } from './postgres-yclients-webhook-signal.repository';
import { PostgresYclientsNotificationReconciliationRepository } from './postgres-yclients-notification-reconciliation.repository';
import { PostgresTransactionRunner } from './postgres-transaction';
import { PostgresTransactionExecutorAdapter } from './postgres-transaction-executor.adapter';
import { PostgresCourtReservationRepository } from './postgres-court-reservation.repository';
import { PostgresMatchReservationRepository } from './postgres-match-reservation.repository';

function readPublicPlayerVisibilityPolicy(
  config: ConfigService,
): PublicPlayerVisibilityPolicy {
  const policy = readPlayerOnboardingPolicyConfiguration(config);
  return Object.freeze({
    enabled: policy.enabled,
    requiredConsents: policy.enabled
      ? Object.freeze([
          Object.freeze({
            kind: 'cancellation' as const,
            documentVersion: policy.documentVersions.cancellation,
          }),
          Object.freeze({
            kind: 'personal_data_processing' as const,
            documentVersion:
              policy.documentVersions.personalDataProcessing,
          }),
          Object.freeze({
            kind: 'terms' as const,
            documentVersion: policy.documentVersions.terms,
          }),
        ])
      : Object.freeze([]),
  });
}

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
        return new ReservationSnapshotCrypto(
          snapshot.masterKey,
          snapshot.keyVersion,
        );
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
  PostgresAccountNotificationPreferencesRepository,
  PostgresSecurityAuditRepository,
  PostgresExternalIdentityResolutionRepository,
  PostgresAccountStatusReader,
  PostgresPlayerProfileDetailsRepository,
  PostgresPlayerProfilePhotoRepository,
  PostgresPlayerOnboardingCompletionWriter,
  PostgresPlayerOnboardingDraftWriter,
  PostgresPlayerOnboardingProgressWriter,
  PostgresPlayerOnboardingLegalAcceptanceWriter,
  PostgresPlayerOnboardingReader,
  PostgresPlayerInitialLevelReassessmentRepository,
  PostgresPlayerProfileWriter,
  PostgresSessionAuthenticationRepository,
  PostgresMatchLineupRepository,
  PostgresMatchNotificationRepository,
  PostgresMatchResultRepository,
  PostgresTelegramNotificationDestinationRepository,
  PostgresTelegramNotificationOutboxRepository,
  PostgresTelegramNotificationIntentRepository,
  PostgresYclientsWebhookSignalRepository,
  PostgresYclientsNotificationReconciliationRepository,
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
    ): PostgresPlayerProfileReader => new PostgresPlayerProfileReader(urls),
  },
  {
    provide: PostgresPublicPlayerProfileSearchRepository,
    inject: [PlayerProfilePhotoUrlResolver, ConfigService],
    useFactory: (
      urls: PlayerProfilePhotoUrlResolver,
      config: ConfigService,
    ): PostgresPublicPlayerProfileSearchRepository =>
      new PostgresPublicPlayerProfileSearchRepository(
        urls,
        readPublicPlayerVisibilityPolicy(config),
      ),
  },
  {
    provide: PostgresMatchChatRepository,
    inject: [ConfigService],
    useFactory: (config: ConfigService): PostgresMatchChatRepository =>
      new PostgresMatchChatRepository(
        readPublicPlayerVisibilityPolicy(config),
      ),
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
    ): PostgresMatchRepository => new PostgresMatchRepository(profiles, courts),
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
  PostgresAccountNotificationPreferencesRepository,
  PostgresSecurityAuditRepository,
  PostgresTelegramAuthenticationOperationRepository,
  PostgresTelegramNotificationDestinationRepository,
  PostgresTelegramNotificationOutboxRepository,
  PostgresTelegramNotificationIntentRepository,
  PostgresYclientsWebhookSignalRepository,
  PostgresYclientsNotificationReconciliationRepository,
  PostgresExternalIdentityResolutionRepository,
  PostgresAccountStatusReader,
  PostgresSessionAuthenticationRepository,
  PostgresPlayerAccountProvisioningRepository,
  PostgresPlayerProfileDetailsRepository,
  PostgresPlayerProfilePhotoRepository,
  PostgresPlayerOnboardingCompletionWriter,
  PostgresPlayerOnboardingDraftWriter,
  PostgresPlayerOnboardingProgressWriter,
  PostgresPlayerOnboardingLegalAcceptanceWriter,
  PostgresPlayerOnboardingReader,
  PostgresPlayerInitialLevelReassessmentRepository,
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
