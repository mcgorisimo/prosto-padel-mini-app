import { YclientsApiConfiguration } from '../config/yclients-api.config';
import { normalizeContactEmail } from '../common/contact-email';
import { YclientsConservativeRequestLimiter } from '../integrations/yclients/yclients-request-limiter';

export type ClientLookupResult = Readonly<{ outcome: 'unique'; companyId: number; clientId: number; clientVersion?: string }>
  | Readonly<{ outcome: 'no_match' | 'review_required' | 'unknown' }>;
export type EmailClientLookupResult = ClientLookupResult | Readonly<{ outcome: 'provider_forbidden' }>;
class ProviderAccessDenied extends Error {}
export interface ClientLookup {
  find(phone: string, companyId: number): Promise<ClientLookupResult>;
}

export const CLIENT_LOOKUP_BUDGET = Object.freeze({
  pages: 2, pageSize: 10, candidates: 20, requests: 24,
  totalMilliseconds: 15_000, requestMilliseconds: 3_000, responseBytes: 131_072,
});
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const positiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Conservative normalization: no suffix matching, guessing country codes or extensions. */
export function normalizeCrmPhone(value: unknown): string | undefined {
  if (typeof value === 'number' && positiveId(value)) value = String(value);
  if (typeof value !== 'string' || value.length > 40 || !/^\+?[0-9 ()-]+$/u.test(value)) return undefined;
  let digits = value.replace(/[ ()-]/gu, '');
  if (/^8[0-9]{10}$/u.test(digits)) digits = `+7${digits.slice(1)}`;
  else if (/^[1-9][0-9]{6,14}$/u.test(digits)) digits = `+${digits}`;
  return /^\+[1-9][0-9]{6,14}$/u.test(digits) ? digits : undefined;
}

/** Only semantic reads: POST search with phone in body, GET exact by ID. */
export class YclientsClientLookup implements ClientLookup {
  constructor(private readonly config: {
    runtime: YclientsApiConfiguration;
    fetch: typeof globalThis.fetch;
    limiter: Pick<YclientsConservativeRequestLimiter, 'run'>;
  }) {}

  async find(phone: string, companyId: number): Promise<ClientLookupResult> {
    if (!/^\+[1-9][0-9]{6,14}$/u.test(phone)) return { outcome: 'unknown' };
    const result = await this.findContact(phone, companyId, 'phone');
    return result.outcome === 'provider_forbidden' ? { outcome: 'unknown' } : result;
  }

  async findEmail(email: string, companyId: number): Promise<EmailClientLookupResult> {
    const normalized = normalizeContactEmail(email);
    if (!normalized) return { outcome: 'unknown' };
    return this.findContact(normalized, companyId, 'email');
  }

  private async findContact(contact: string, companyId: number, kind: 'phone' | 'email'): Promise<EmailClientLookupResult> {
    const runtime = this.config.runtime;
    if (!runtime.enabled || !positiveId(companyId) || companyId !== runtime.companyId ||
        runtime.baseUrl !== 'https://api.yclients.com' ||
        !runtime.partnerToken || !runtime.userToken) return { outcome: 'unknown' };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Lookup unavailable')); }, CLIENT_LOOKUP_BUDGET.totalMilliseconds);
    });
    try {
      return await Promise.race([this.search(contact, companyId, controller.signal, kind), expired]);
    } catch (error) {
      // No raw URL, body, contact, credential, provider error or cause escapes.
      return { outcome: error instanceof ProviderAccessDenied ? 'provider_forbidden' : 'unknown' };
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }

  private async search(contact: string, companyId: number, signal: AbortSignal, kind: 'phone' | 'email'): Promise<ClientLookupResult> {
    let requests = 0;
    const read = async (path: string, body?: object): Promise<Record<string, unknown>> => {
      if (signal.aborted || ++requests > CLIENT_LOOKUP_BUDGET.requests) throw new Error('Lookup unavailable');
      return this.config.limiter.run(async () => {
        // A queued operation must not dispatch after its enclosing lookup expired.
        if (signal.aborted) throw new Error('Lookup unavailable');
        const timeout = AbortSignal.timeout(CLIENT_LOOKUP_BUDGET.requestMilliseconds);
        const response = await this.config.fetch(`${this.config.runtime.baseUrl}${path}`, {
          method: body ? 'POST' : 'GET', redirect: 'error',
          headers: { Accept: 'application/vnd.yclients.v2+json', 'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.runtime.partnerToken}, User ${this.config.runtime.userToken}` },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.any([signal, timeout]),
        });
        if (response.status !== 200 || !response.body) {
          await response.body?.cancel();
          if (response.status === 401 || response.status === 403) throw new ProviderAccessDenied();
          throw new Error('Lookup unavailable');
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (signal.aborted || timeout.aborted || bytes > CLIENT_LOOKUP_BUDGET.responseBytes) throw new Error('Lookup unavailable');
            chunks.push(part.value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!object(value) || value.success !== true) throw new Error('Lookup unavailable');
        return value;
      });
    };
    const collect = async (): Promise<number[]> => {
      const ids: number[] = [];
      let total: number | undefined;
      for (let page = 1; page <= CLIENT_LOOKUP_BUDGET.pages; page++) {
        const result = await read(`/api/v1/company/${companyId}/clients/search`, {
          page, page_size: CLIENT_LOOKUP_BUDGET.pageSize, fields: ['id'], order_by: 'id', order_by_direction: 'ASC',
          operation: 'AND', filters: [{ type: 'quick_search', state: { value: kind === 'phone' ? contact.slice(1) : contact } }],
        });
        if (!object(result.meta) || !Number.isSafeInteger(result.meta.total_count) ||
            Number(result.meta.total_count) < 0 || Number(result.meta.total_count) > CLIENT_LOOKUP_BUDGET.candidates ||
            !Array.isArray(result.data)) throw new Error('Lookup unavailable');
        if (total !== undefined && total !== result.meta.total_count) throw new Error('Lookup unavailable');
        total = Number(result.meta.total_count);
        if (result.data.length !== Math.min(CLIENT_LOOKUP_BUDGET.pageSize, total - ids.length)) throw new Error('Lookup unavailable');
        for (const row of result.data) {
          if (!object(row) || !positiveId(row.id) || (row.company_id !== undefined && row.company_id !== companyId) ||
              (ids.length > 0 && row.id <= ids[ids.length - 1])) throw new Error('Lookup unavailable');
          ids.push(row.id);
        }
        if (ids.length === total) return ids;
      }
      throw new Error('Lookup unavailable');
    };
    const ids = await collect();
    const exact: number[] = [];
    let clientVersion: string | undefined;
    for (const id of ids) {
      const result = await read(`/api/v1/client/${companyId}/${id}`);
      if (!object(result.data) || result.data.id !== id ||
          (result.data.company_id !== undefined && result.data.company_id !== companyId)) throw new Error('Lookup unavailable');
      const candidate = kind === 'phone' ? normalizeCrmPhone(result.data.phone) : normalizeContactEmail(result.data.email);
      if (!candidate) throw new Error('Lookup unavailable');
      if (candidate === contact) {
        exact.push(id);
        if (kind === 'email') {
          const version = result.data.last_change_date;
          if (typeof version !== 'string' || !Number.isFinite(Date.parse(version))) throw new Error('Lookup unavailable');
          clientVersion = version;
        }
      }
    }
    // Detect ordinary pagination drift. YCLIENTS offers no consistent-snapshot token.
    if (JSON.stringify(await collect()) !== JSON.stringify(ids)) return { outcome: 'unknown' };
    if (exact.length === 1) return { outcome: 'unique', companyId, clientId: exact[0], ...(kind === 'email' ? { clientVersion } : {}) };
    return { outcome: ids.length === 0 ? 'no_match' : 'review_required' };
  }
}
