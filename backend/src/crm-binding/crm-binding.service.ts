import { AccountId, isAccountId } from '../accounts/account.types';
import { CrmBindingResponse, CrmBindingStore, freshProof, sameBinding, sameProof } from './crm-binding.types';
import { ClientLookup, positiveId } from './yclients-client-lookup';

export class CrmBindingService {
  private readonly pending = new Set<AccountId>();
  constructor(private readonly config: { store: CrmBindingStore; lookup: ClientLookup; companyId?: number }) {}

  async status(accountId: AccountId): Promise<CrmBindingResponse> {
    try {
      if (!isAccountId(accountId)) return { outcome: 'unknown' };
      if (!positiveId(this.config.companyId)) return { outcome: 'not_configured' };
      const snapshot = await this.config.store.snapshot(accountId, this.config.companyId);
      if (snapshot.outcome !== 'ready') return { outcome: snapshot.outcome };
      if (snapshot.proof.accountId !== accountId) return { outcome: 'unknown' };
      return { outcome: !snapshot.binding ? 'not_linked'
        : sameBinding(snapshot.binding, snapshot.proof, this.config.companyId) ? 'linked' : 'review_required' };
    } catch { return { outcome: 'unknown' }; }
  }

  async bind(accountId: AccountId): Promise<CrmBindingResponse> {
    // Bound process memory/work. Do not share a completed response across proofs.
    if (!isAccountId(accountId) || this.pending.has(accountId) || this.pending.size >= 8) return { outcome: 'unknown' };
    this.pending.add(accountId);
    try {
      const companyId = this.config.companyId;
      if (!positiveId(companyId)) return { outcome: 'not_configured' };
      const snapshot = await this.config.store.snapshot(accountId, companyId);
      if (snapshot.outcome !== 'ready') return { outcome: snapshot.outcome };
      if (snapshot.proof.accountId !== accountId) return { outcome: 'unknown' };
      if (snapshot.binding) return { outcome: sameBinding(snapshot.binding, snapshot.proof, companyId) ? 'linked' : 'review_required' };
      if (!freshProof(snapshot.proof)) return { outcome: 'phone_verification_required' };
      const found = await this.config.lookup.find(snapshot.proof.phone, companyId);
      // Even negative outcomes must not outlive a changed proof.
      if (found.outcome !== 'unique') {
        const current = await this.config.store.snapshot(accountId, companyId);
        if (current.outcome !== 'ready') return { outcome: current.outcome };
        if (!sameProof(snapshot.proof, current.proof) || !freshProof(current.proof)) return { outcome: 'phone_verification_required' };
        return { outcome: found.outcome };
      }
      if (found.companyId !== companyId || !positiveId(found.clientId)) return { outcome: 'unknown' };
      return await this.config.store.save(snapshot.proof, companyId, found.clientId);
    } catch { return { outcome: 'unknown' }; }
    finally { this.pending.delete(accountId); }
  }
}
