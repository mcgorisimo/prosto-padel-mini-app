import { AccountId } from '../accounts/account.types';
import { ExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import { ComputedExternalIdentityLookupDigest } from '../accounts/external-identity-lookup-digest.port';
import { ExternalIdentityNamespace } from '../accounts/external-identity.types';
import { CreatePlayerAccountWithProfileBinding } from '../accounts/player-profile.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { SecurityAuditEvent } from '../auth/security-audit.types';
import { PostgresTransaction } from './postgres-transaction';

export interface ProvisionPlayerAccountInput {
  readonly binding: CreatePlayerAccountWithProfileBinding;
  readonly createdAt: UnixEpochSeconds;
  readonly identity: {
    readonly identityId: ExternalIdentityId;
    readonly provider: 'telegram';
    readonly namespace: ExternalIdentityNamespace;
    readonly isPrimary: true;
  };
  readonly lookupDigests: readonly ComputedExternalIdentityLookupDigest[];
  readonly auditEvents: {
    readonly accountCreated: SecurityAuditEvent<'account_created'>;
    readonly externalIdentityLinked:
      SecurityAuditEvent<'external_identity_linked'>;
  };
}

export interface PlayerAccountProvisioningResult {
  readonly outcome: 'created';
  readonly accountId: AccountId;
}

export type PlayerAccountProvisioningPersistenceFailure =
  | 'invalid_input'
  | 'identity_reserved'
  | 'identity_resolution_conflict'
  | 'account_binding_conflict'
  | 'identity_binding_conflict'
  | 'referential_integrity'
  | 'invalid_persisted_state'
  | 'audit_conflict'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerAccountProvisioningPersistenceError extends Error {
  readonly name = 'PlayerAccountProvisioningPersistenceError';

  constructor(
    readonly reason: PlayerAccountProvisioningPersistenceFailure,
  ) {
    super('Player account provisioning persistence failed');
  }
}

export interface PlayerAccountProvisioningRepository {
  provision(
    transaction: PostgresTransaction,
    input: ProvisionPlayerAccountInput,
  ): Promise<PlayerAccountProvisioningResult>;
}
