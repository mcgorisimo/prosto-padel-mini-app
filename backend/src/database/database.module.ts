import { Module, Provider } from '@nestjs/common';
import { PostgresAccountStatusReader } from './postgres-account-status.reader';
import { PostgresAuthenticationOperationTerminalRepository } from './postgres-authentication-operation-terminal.repository';
import { PostgresExternalIdentityResolutionRepository } from './postgres-external-identity.repository';
import { PostgresInitialSessionRepository } from './postgres-initial-session.repository';
import { PostgresPlayerAccountProvisioningRepository } from './postgres-player-account-provisioning.repository';
import { PostgresSecurityAuditRepository } from './postgres-security-audit.repository';
import { PostgresService } from './postgres.service';
import { PostgresTelegramAuthenticationOperationRepository } from './postgres-telegram-authentication-operation.repository';
import { PostgresTransactionRunner } from './postgres-transaction';
import { PostgresTransactionExecutorAdapter } from './postgres-transaction-executor.adapter';

const DATABASE_WORKFLOW_PROVIDERS: Provider[] = [
  PostgresSecurityAuditRepository,
  PostgresExternalIdentityResolutionRepository,
  PostgresAccountStatusReader,
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
];

const DATABASE_WORKFLOW_EXPORTS = [
  PostgresTransactionRunner,
  PostgresTransactionExecutorAdapter,
  PostgresSecurityAuditRepository,
  PostgresTelegramAuthenticationOperationRepository,
  PostgresExternalIdentityResolutionRepository,
  PostgresAccountStatusReader,
  PostgresPlayerAccountProvisioningRepository,
  PostgresAuthenticationOperationTerminalRepository,
  PostgresInitialSessionRepository,
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
