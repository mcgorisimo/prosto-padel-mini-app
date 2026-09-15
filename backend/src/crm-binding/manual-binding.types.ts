import { AccountId } from '../accounts/account.types';

export type ManualOutcome =
  | 'not_configured'
  | 'forbidden'
  | 'provider_forbidden'
  | 'not_found'
  | 'review_required'
  | 'unknown'
  | 'linked';
export type ManualResult =
  | Readonly<{ outcome: ManualOutcome }>
  | Readonly<{
      outcome: 'preview';
      draftId: string;
      name: string;
      phoneHint: string;
      expiresAt: number;
    }>;
export interface ManualDraft {
  readonly draftId: string;
  readonly actorId: AccountId;
  readonly targetId: AccountId;
  readonly companyId: number;
  readonly clientId: number;
  readonly profileRevision: number;
  readonly clientVersion: string;
  readonly expiresAt: number;
  readonly state: 'prepared' | 'committed';
}
export type ExactClient =
  | Readonly<{
      outcome: 'loaded';
      companyId: number;
      clientId: number;
      name: string;
      phoneHint: string;
      version: string;
    }>
  | Readonly<{ outcome: 'unknown' | 'not_found' | 'provider_forbidden' }>;
export interface ManualClientReader {
  readExact(companyId: number, clientId: number): Promise<ExactClient>;
}
export interface ManualBindingRepository {
  context(
    actorId: AccountId,
    targetId: AccountId,
  ): Promise<
    | { outcome: 'ready'; revision: number }
    | { outcome: 'forbidden' | 'not_found' }
  >;
  prepare(
    actorId: AccountId,
    targetId: AccountId,
    companyId: number,
    clientId: number,
    revision: number,
    version: string,
  ): Promise<ManualDraft | undefined>;
  readDraft(
    actorId: AccountId,
    targetId: AccountId,
    companyId: number,
    draftId: string,
  ): Promise<ManualDraft | undefined>;
  commit(draft: ManualDraft): Promise<ManualResult>;
  ownStatus(
    accountId: AccountId,
    companyId: number,
  ): Promise<{ outcome: 'linked' | 'not_linked' | 'review_required' }>;
}
