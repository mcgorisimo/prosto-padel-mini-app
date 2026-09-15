import { AccountId, isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import { CrmBindingResponse } from './crm-binding.types';
import {
  ManualBindingRepository,
  ManualClientReader,
  ManualResult,
} from './manual-binding.types';
import { positiveId } from './yclients-client-lookup';
import { YclientsClientLookup } from './yclients-client-lookup';
import { normalizeContactEmail } from '../common/contact-email';

export class ManualBindingService {
  private readonly active = new Set<AccountId>();
  constructor(
    private readonly config: {
      enabled: boolean;
      companyId?: number;
      repository: ManualBindingRepository;
      clients: ManualClientReader;
      emailLookup?: Pick<YclientsClientLookup, 'findEmail'>;
    },
  ) {}

  async ownStatus(owner: AccountId): Promise<CrmBindingResponse> {
    if (!this.config.enabled || !positiveId(this.config.companyId))
      return { outcome: 'not_configured' };
    try {
      return await this.config.repository.ownStatus(
        owner,
        this.config.companyId,
      );
    } catch {
      return { outcome: 'unknown' };
    }
  }

  async preview(
    actor: AccountId,
    target: AccountId,
    selector: number | string,
  ): Promise<ManualResult> {
    return this.run(actor, target, async (companyId) => {
      const email = typeof selector === 'string' ? normalizeContactEmail(selector) : undefined;
      if (!positiveId(selector) && !email) return { outcome: 'unknown' };
      const context = await this.config.repository.context(actor, target);
      if (context.outcome !== 'ready') return context;
      let clientId = typeof selector === 'number' ? selector : 0;
      let expectedVersion: string | undefined;
      if (email) {
        if (!this.config.emailLookup) return { outcome: 'not_configured' };
        const match = await this.config.emailLookup.findEmail(email, companyId);
        if (match.outcome !== 'unique') return { outcome: match.outcome === 'no_match' ? 'not_found' : match.outcome };
        if (match.companyId !== companyId || !positiveId(match.clientId) || !match.clientVersion) return { outcome: 'unknown' };
        clientId = match.clientId;
        expectedVersion = match.clientVersion;
      }
      const client = await this.config.clients.readExact(companyId, clientId);
      if (client.outcome !== 'loaded') return client;
      if (client.companyId !== companyId || client.clientId !== clientId)
        return { outcome: 'unknown' };
      if (expectedVersion && client.version !== expectedVersion) return { outcome: 'review_required' };
      const draft = await this.config.repository.prepare(
        actor,
        target,
        companyId,
        clientId,
        context.revision,
        client.version,
      );
      if (
        !draft ||
        draft.actorId !== actor ||
        draft.targetId !== target ||
        draft.companyId !== companyId ||
        draft.clientId !== clientId ||
        draft.profileRevision !== context.revision
      )
        return { outcome: 'review_required' };
      return {
        outcome: 'preview',
        draftId: draft.draftId,
        name: client.name,
        phoneHint: client.phoneHint,
        expiresAt: draft.expiresAt,
      };
    });
  }

  async confirm(
    actor: AccountId,
    target: AccountId,
    draftId: string,
    identityChecked: boolean,
  ): Promise<ManualResult> {
    return this.run(actor, target, async (companyId) => {
      if (!isInternalUuid(draftId) || identityChecked !== true)
        return { outcome: 'unknown' };
      const draft = await this.config.repository.readDraft(
        actor,
        target,
        companyId,
        draftId,
      );
      if (
        !draft ||
        draft.actorId !== actor ||
        draft.targetId !== target ||
        draft.companyId !== companyId ||
        draft.draftId !== draftId
      )
        return { outcome: 'review_required' };
      if (draft.state === 'committed')
        return this.config.repository.commit(draft);
      const client = await this.config.clients.readExact(
        companyId,
        draft.clientId,
      );
      if (client.outcome !== 'loaded') return client;
      if (
        client.companyId !== companyId ||
        client.clientId !== draft.clientId ||
        client.version !== draft.clientVersion
      ) {
        return { outcome: 'review_required' };
      }
      return this.config.repository.commit(draft);
    });
  }

  private async run(
    actor: AccountId,
    target: AccountId,
    operation: (company: number) => Promise<ManualResult>,
  ): Promise<ManualResult> {
    if (!isAccountId(actor) || !isAccountId(target))
      return { outcome: 'forbidden' };
    if (!this.config.enabled || !positiveId(this.config.companyId))
      return { outcome: 'not_configured' };
    if (this.active.has(actor) || this.active.size >= 8)
      return { outcome: 'unknown' };
    this.active.add(actor);
    try {
      return await operation(this.config.companyId);
    } catch {
      return { outcome: 'unknown' };
    } finally {
      this.active.delete(actor);
    }
  }
}
