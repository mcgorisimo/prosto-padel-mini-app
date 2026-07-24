import { AccountId } from '../accounts/account.types';
import { ExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import { ComputedExternalIdentityLookupDigest } from '../accounts/external-identity-lookup-digest.port';
import {
  ExternalIdentityNamespace,
  ExternalIdentityProvider,
} from '../accounts/external-identity.types';
import { PostgresTransaction } from './postgres-transaction';

interface ExternalIdentityResolutionBinding {
  readonly identityId: ExternalIdentityId;
  readonly accountId: AccountId;
  readonly provider: ExternalIdentityProvider;
  readonly namespace: ExternalIdentityNamespace;
}

export interface LinkedExternalIdentityResolution
  extends ExternalIdentityResolutionBinding {
  readonly isPrimary: boolean;
}

export interface UnlinkedExternalIdentityResolution
  extends ExternalIdentityResolutionBinding {
  readonly isPrimary: false;
}

export type ExternalIdentityResolutionResult =
  | { readonly outcome: 'not_found' }
  | {
      readonly outcome: 'linked';
      readonly identity: LinkedExternalIdentityResolution;
    }
  | {
      readonly outcome: 'historical_reservation';
      readonly identity: UnlinkedExternalIdentityResolution;
    }
  | {
      readonly outcome: 'conflict';
      readonly reason:
        | 'multiple_identities_same_account'
        | 'multiple_accounts';
    };

export type ExternalIdentityPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class ExternalIdentityPersistenceError extends Error {
  readonly name = 'ExternalIdentityPersistenceError';

  constructor(readonly reason: ExternalIdentityPersistenceFailure) {
    super('External identity persistence failed');
  }
}

export interface ExternalIdentityResolutionRepository {
  resolveByLookupDigests(
    transaction: PostgresTransaction,
    candidates: readonly ComputedExternalIdentityLookupDigest[],
  ): Promise<ExternalIdentityResolutionResult>;
}
