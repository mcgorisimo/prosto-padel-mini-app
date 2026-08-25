import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { PlayerOnboardingConsentRecord } from './player-onboarding-reader';
import { PostgresTransaction } from './postgres-transaction';

export interface AcceptPlayerOnboardingLegalPolicyInput {
  readonly accountId: AccountId;
  readonly consents: readonly PlayerOnboardingConsentRecord[];
  readonly flowVersion: string;
  readonly acceptedAt: UnixEpochSeconds;
}

export type AcceptPlayerOnboardingLegalPolicyResult =
  | { readonly outcome: 'accepted' }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'incomplete' }
  | { readonly outcome: 'conflict' };

export type PlayerOnboardingLegalAcceptancePersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerOnboardingLegalAcceptancePersistenceError extends Error {
  readonly name = 'PlayerOnboardingLegalAcceptancePersistenceError';

  constructor(
    readonly reason: PlayerOnboardingLegalAcceptancePersistenceFailure,
  ) {
    super('Player onboarding legal acceptance persistence failed');
  }
}

export interface PlayerOnboardingLegalAcceptanceWriter {
  accept(
    transaction: PostgresTransaction,
    input: AcceptPlayerOnboardingLegalPolicyInput,
  ): Promise<AcceptPlayerOnboardingLegalPolicyResult>;
}
