import { AccountId } from '../accounts/account.types';
import { ContactCheckoutVerificationSnapshot } from '../contacts/contact-verification.contracts';
import { PostgresTransaction } from './postgres-transaction';

export interface ReadContactVerificationSnapshotInput {
  readonly accountId: AccountId;
}

export type ContactVerificationSnapshotPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class ContactVerificationSnapshotPersistenceError extends Error {
  readonly name = 'ContactVerificationSnapshotPersistenceError';

  constructor(
    readonly reason: ContactVerificationSnapshotPersistenceFailure,
  ) {
    super('Contact verification snapshot persistence failed');
  }
}

export interface ContactVerificationSnapshotRepository {
  readCheckoutSnapshot(
    transaction: PostgresTransaction,
    input: ReadContactVerificationSnapshotInput,
  ): Promise<ContactCheckoutVerificationSnapshot>;
}
