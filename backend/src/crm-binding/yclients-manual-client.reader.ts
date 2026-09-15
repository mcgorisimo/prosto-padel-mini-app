import { YclientsApiConfiguration } from '../config/yclients-api.config';
import { YclientsConservativeRequestLimiter } from '../integrations/yclients/yclients-request-limiter';
import { ExactClient, ManualClientReader } from './manual-binding.types';
import { normalizeCrmPhone, positiveId } from './yclients-client-lookup';

export class YclientsManualClientReader implements ManualClientReader {
  constructor(
    private readonly config: {
      runtime: YclientsApiConfiguration;
      fetch: typeof globalThis.fetch;
      limiter: Pick<YclientsConservativeRequestLimiter, 'run'>;
    },
  ) {}
  async readExact(companyId: number, clientId: number): Promise<ExactClient> {
    const runtime = this.config.runtime;
    if (
      !runtime.enabled ||
      runtime.companyId !== companyId ||
      !positiveId(companyId) ||
      !positiveId(clientId) ||
      runtime.baseUrl !== 'https://api.yclients.com' ||
      !runtime.partnerToken ||
      !runtime.userToken
    )
      return { outcome: 'unknown' };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<ExactClient>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ outcome: 'unknown' });
      }, 8_000);
    });
    try {
      return await Promise.race([
        expired,
        this.config.limiter.run(async (): Promise<ExactClient> => {
          if (controller.signal.aborted) return { outcome: 'unknown' };
          const response = await this.config.fetch(
            `https://api.yclients.com/api/v1/client/${companyId}/${clientId}`,
            {
              method: 'GET',
              redirect: 'error',
              signal: controller.signal,
              headers: {
                Accept: 'application/vnd.yclients.v2+json',
                Authorization: `Bearer ${runtime.partnerToken}, User ${runtime.userToken}`,
              },
            },
          );
          if (response.status !== 200 || !response.body) {
            await response.body?.cancel();
            return {
              outcome: response.status === 404 ? 'not_found' : 'unknown',
            };
          }
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > 131_072 || controller.signal.aborted)
                return { outcome: 'unknown' };
              chunks.push(chunk.value);
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const data = body?.data;
          if (
            body?.success !== true ||
            data?.id !== clientId ||
            (data.company_id !== undefined && data.company_id !== companyId)
          )
            return { outcome: 'unknown' };
          const phone = normalizeCrmPhone(data.phone);
          const names = [data.name, data.surname].filter(
            (v) => v !== undefined && v !== '',
          );
          if (
            !phone ||
            typeof data.name !== 'string' ||
            !data.name.trim() ||
            !names.length ||
            names.some(
              (v) =>
                typeof v !== 'string' ||
                !v.trim() ||
                v.length > 120 ||
                /[\u0000-\u001f\u007f-\u009f]/u.test(v),
            ) ||
            typeof data.last_change_date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/u.test(
              data.last_change_date,
            ) ||
            !Number.isFinite(Date.parse(data.last_change_date))
          )
            return { outcome: 'unknown' };
          return {
            outcome: 'loaded',
            companyId,
            clientId,
            name: names.join(' '),
            phoneHint: `•••• ${phone.slice(-4)}`,
            version: data.last_change_date,
          };
        }),
      ]);
    } catch {
      return { outcome: 'unknown' };
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
}
