import { AccountId } from '../accounts/account.types';

export type CrmBindingOutcome =
  | 'not_configured' | 'phone_verification_required' | 'not_linked'
  | 'linked' | 'no_match' | 'review_required' | 'unknown';
export type CrmBindingResponse = Readonly<{ outcome: CrmBindingOutcome }>;

/** Internal only: never serialize this object into HTTP, logs or metrics. */
export interface VerifiedPhoneProof {
  readonly accountId: AccountId;
  readonly phone: string;
  readonly contactVersion: number;
  readonly profileRevision: number;
  readonly challengeId: string;
  readonly subjectDigest: string;
  readonly digestKeyVersion: number;
  readonly verifiedAt: number;
  readonly observedAt: number;
}

export interface CrmBinding {
  readonly accountId: AccountId;
  readonly companyId: number;
  readonly clientId: number;
  readonly contactVersion: number;
  readonly profileRevision: number;
  readonly subjectDigest: string;
  readonly digestKeyVersion: number;
}

export type BindingSnapshot = Readonly<{
  outcome: 'ready'; proof: VerifiedPhoneProof; binding?: CrmBinding;
}> | Readonly<{ outcome: 'not_configured' | 'phone_verification_required' }>;

export interface CrmBindingStore {
  snapshot(accountId: AccountId, companyId: number): Promise<BindingSnapshot>;
  /** Re-read proof under short local locks; no provider work inside transaction. */
  save(proof: VerifiedPhoneProof, companyId: number, clientId: number): Promise<CrmBindingResponse>;
}

/** No SMS delivery/verification runtime exists yet. No DB or provider fallback. */
export class ClosedCrmBindingStore implements CrmBindingStore {
  async snapshot(): Promise<BindingSnapshot> { return { outcome: 'not_configured' }; }
  async save(): Promise<CrmBindingResponse> { return { outcome: 'not_configured' }; }
}

export function sameBinding(binding: CrmBinding, proof: VerifiedPhoneProof, companyId: number): boolean {
  return binding.accountId === proof.accountId && binding.companyId === companyId &&
    binding.contactVersion === proof.contactVersion && binding.profileRevision === proof.profileRevision &&
    binding.subjectDigest === proof.subjectDigest && binding.digestKeyVersion === proof.digestKeyVersion;
}

export function sameProof(left: VerifiedPhoneProof, right: VerifiedPhoneProof): boolean {
  return left.accountId === right.accountId && left.phone === right.phone &&
    left.contactVersion === right.contactVersion && left.profileRevision === right.profileRevision &&
    left.challengeId === right.challengeId && left.subjectDigest === right.subjectDigest &&
    left.digestKeyVersion === right.digestKeyVersion && left.verifiedAt === right.verifiedAt;
}

export function freshProof(proof: VerifiedPhoneProof): boolean {
  return proof.verifiedAt <= proof.observedAt && proof.observedAt - proof.verifiedAt < 600;
}
