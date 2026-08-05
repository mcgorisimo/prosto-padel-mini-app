import type { YclientsApiConfiguration } from '../../config/yclients-api.config';

const MAX_RESPONSE_BYTES = 65_536;
const YCLIENTS_ACCEPT = 'application/vnd.yclients.v2+json';

export type YclientsCompanyProbeResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{ outcome: 'verified'; companyId: number; title?: string }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'company_not_found' }>
  | Readonly<{ outcome: 'invalid_response' }>
  | Readonly<{ outcome: 'unavailable' }>;

export interface YclientsApiClientConfiguration {
  readonly runtime: YclientsApiConfiguration;
  readonly requestTimeoutMilliseconds: number;
  readonly fetch: typeof globalThis.fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBody(text: string): Record<string, unknown> | undefined {
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export class YclientsApiClient {
  constructor(private readonly configuration: YclientsApiClientConfiguration) {}

  async probeConfiguredCompany(): Promise<YclientsCompanyProbeResult> {
    const runtime = this.configuration.runtime;
    if (!runtime.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const companyId = runtime.companyId;
    if (
      runtime.baseUrl.length === 0 ||
      typeof companyId !== 'number' ||
      !Number.isSafeInteger(companyId) ||
      companyId <= 0 ||
      runtime.partnerToken.length === 0 ||
      runtime.userToken.length === 0
    ) {
      return Object.freeze({ outcome: 'invalid_response' as const });
    }

    try {
      const url = new URL('api/v1/companies', `${runtime.baseUrl}/`);
      url.searchParams.set('my', '1');
      const response = await this.configuration.fetch(url, {
        method: 'GET',
        headers: {
          accept: YCLIENTS_ACCEPT,
          authorization: `Bearer ${runtime.partnerToken}, User ${runtime.userToken}`,
        },
        signal: AbortSignal.timeout(
          this.configuration.requestTimeoutMilliseconds,
        ),
      });

      if (response.status === 401 || response.status === 403) {
        return Object.freeze({ outcome: 'unauthorized' as const });
      }
      if (response.status === 429 || response.status >= 500) {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
      if (response.status < 200 || response.status >= 300) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }

      const body = readBody(await response.text());
      if (body?.success !== true || !Array.isArray(body.data)) {
        return Object.freeze({ outcome: 'invalid_response' as const });
      }
      const company = body.data.find(
        (value) =>
          isRecord(value) &&
          Number.isSafeInteger(value.id) &&
          Number(value.id) === companyId,
      );
      if (!isRecord(company)) {
        return Object.freeze({ outcome: 'company_not_found' as const });
      }
      const title =
        typeof company.title === 'string' && company.title.length > 0
          ? company.title.slice(0, 256)
          : undefined;
      return Object.freeze({
        outcome: 'verified' as const,
        companyId,
        ...(title === undefined ? {} : { title }),
      });
    } catch {
      return Object.freeze({ outcome: 'unavailable' as const });
    }
  }
}
