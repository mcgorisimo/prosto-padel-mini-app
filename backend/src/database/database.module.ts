import { Module, Provider } from '@nestjs/common';
import {
  MATCH_COURT_CATALOG,
  MatchCourtCatalog,
  SystemMatchCourtCatalog,
} from '../matches/match-court-catalog';
import { PostgresAccountStatusReader } from './postgres-account-status.reader';
import { PostgresAuthenticationOperationTerminalRepository } from './postgres-authentication-operation-terminal.repository';
import { PostgresExternalIdentityResolutionRepository } from './postgres-external-identity.repository';
import { PostgresInitialSessionRepository } from './postgres-initial-session.repository';
import { PostgresMatchChatRepository } from './postgres-match-chat.repository';
import { PostgresMatchRepository } from './postgres-match.repository';
import { PostgresMatchInvitationRepository } from './postgres-match-invitation.repository';
import { PostgresMatchWaitlistRepository } from './postgres-match-waitlist.repository';
import { PostgresPlayerAccountProvisioningRepository } from './postgres-player-account-provisioning.repository';
import { PostgresPlayerProfileDetailsRepository } from './postgres-player-profile-details.repository';
import { PostgresPlayerProfileReader } from './postgres-player-profile-reader';
import { PostgresPlayerProfileWriter } from './postgres-player-profile-writer';
import { PostgresPublicPlayerProfileSearchRepository } from './postgres-public-player-profile-search.repository';
import { PostgresSecurityAuditRepository } from './postgres-security-audit.repository';
import { PostgresSessionAuthenticationRepository } from './postgres-session-authentication.repository';
import { PostgresSessionCredentialLifecycleRepository } from './postgres-session-credential-lifecycle.repository';
import { PostgresService } from './postgres.service';
import { PostgresTelegramAuthenticationOperationRepository } from './postgres-telegram-authentication-operation.repository';
import { PostgresTransactionRunner } from './postgres-transaction';
import { PostgresTransactionExecutorAdapter } from './postgres-transaction-executor.adapter';

const DATABASE_WORKFLOW_PROVIDERS: Provider[] = [
  PostgresSecurityAuditRepository,
  PostgresExternalIdentityResolutionRepository,
  PostgresAccountStatusReader,
  PostgresPlayerProfileDetailsRepository,
  PostgresPlayerProfileReader,
  PostgresPlayerProfileWriter,
  PostgresPublicPlayerProfileSearchRepository,
  PostgresSessionAuthenticationRepository,
  PostgresMatchChatRepository,
  PostgresMatchWaitlistRepository,
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
  PostgresTransactionRunner,
  PostgresTransactionExecutorAdapter,
  PostgresSecurityAuditRepository,
  PostgresTelegramAuthenticationOperationRepository,
  PostgresExternalIdentityResolutionRepository,
  PostgresAccountStatusReader,
  PostgresSessionAuthenticationRepository,
  PostgresPlayerAccountProvisioningRepository,
  PostgresPlayerProfileDetailsRepository,
  PostgresPlayerProfileReader,
  PostgresPlayerProfileWriter,
  PostgresPublicPlayerProfileSearchRepository,
  PostgresMatchChatRepository,
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
