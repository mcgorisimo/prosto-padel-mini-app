import {
  buildYclientsControlledReschedulePayload,
  readYclientsControlledFullRecord,
  YclientsControlledFullRecordSnapshot,
  YclientsControlledRescheduleTarget,
} from './yclients-controlled-record';
import { YclientsConservativeRequestLimiter } from './yclients-request-limiter';

const MAX_CONTROLLED_RESPONSE_BYTES = 262_144;
const YCLIENTS_ACCEPT = 'application/vnd.yclients.v2+json';

export interface YclientsControlledAdminClientConfiguration {
  /** Explicit harness-only gate; no environment loader or runtime wiring exists. */
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly companyId: number;
  readonly partnerToken: string;
  readonly userToken: string;
  readonly requestTimeoutMilliseconds: number;
  readonly fetch: typeof globalThis.fetch;
  readonly limiter: YclientsConservativeRequestLimiter;
}

export type YclientsControlledFullRecordResult =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{ outcome: 'invalid_request' }>
  | Readonly<{
      outcome: 'found';
      snapshot: YclientsControlledFullRecordSnapshot;
    }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'not_found' }>
  | Readonly<{ outcome: 'rejected' }>
  | Readonly<{ outcome: 'rate_limited' }>
  | Readonly<{ outcome: 'unavailable' }>
  | Readonly<{ outcome: 'unknown' }>;

export type YclientsControlledWriteUnknownReason =
  | 'timeout_or_transport'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_or_ambiguous_response';

type YclientsControlledWriteFailure =
  | Readonly<{ outcome: 'disabled' }>
  | Readonly<{ outcome: 'invalid_request' }>
  | Readonly<{ outcome: 'unauthorized' }>
  | Readonly<{ outcome: 'rejected' }>
  | Readonly<{
      outcome: 'unknown';
      reason: YclientsControlledWriteUnknownReason;
    }>;

export type YclientsControlledRescheduleResult =
  | Readonly<{ outcome: 'accepted' }>
  | YclientsControlledWriteFailure;

export type YclientsControlledCancelResult =
  | Readonly<{ outcome: 'deleted' }>
  | YclientsControlledWriteFailure;

type ConfiguredValues = Readonly<{
  baseUrl: string;
  companyId: number;
  authorization: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function safeBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return undefined;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, '')}`;
  } catch {
    return undefined;
  }
}

function configuredValues(
  configuration: YclientsControlledAdminClientConfiguration,
): ConfiguredValues | undefined {
  const baseUrl = safeBaseUrl(configuration.baseUrl);
  if (
    baseUrl === undefined ||
    !positiveSafeInteger(configuration.companyId) ||
    configuration.partnerToken.length === 0 ||
    configuration.userToken.length === 0 ||
    !positiveSafeInteger(configuration.requestTimeoutMilliseconds)
  ) {
    return undefined;
  }
  return Object.freeze({
    baseUrl,
    companyId: configuration.companyId,
    authorization: `Bearer ${configuration.partnerToken}, User ${configuration.userToken}`,
  });
}

async function cancelBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (body === null) return;
  try {
    await body.cancel();
  } catch {
    // Cancellation failure never changes a fail-closed result.
  }
}

async function readBoundedJson(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) ||
      Number(contentLength) > MAX_CONTROLLED_RESPONSE_BYTES)
  ) {
    await cancelBody(response.body);
    return undefined;
  }
  if (response.body === null) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_CONTROLLED_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The response remains invalid.
        }
        return undefined;
      }
      chunks.push(chunk.value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The response remains invalid.
    }
    return undefined;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(decoded);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function controlledUrl(
  configured: ConfiguredValues,
  recordId: number,
): URL {
  return new URL(
    `api/v1/record/${configured.companyId}/${recordId}`,
    `${configured.baseUrl}/`,
  );
}

function readStatusFailure(
  status: number,
): Exclude<YclientsControlledFullRecordResult, { outcome: 'found' }> | undefined {
  if (status === 401 || status === 403) {
    return Object.freeze({ outcome: 'unauthorized' as const });
  }
  if (status === 404) {
    return Object.freeze({ outcome: 'not_found' as const });
  }
  if (status === 429) {
    return Object.freeze({ outcome: 'rate_limited' as const });
  }
  if (status === 408 || status === 425 || status >= 500) {
    return Object.freeze({ outcome: 'unavailable' as const });
  }
  if (status >= 400 && status < 500) {
    return Object.freeze({ outcome: 'rejected' as const });
  }
  return status === 200
    ? undefined
    : Object.freeze({ outcome: 'unknown' as const });
}

function writeStatusFailure(
  status: number,
  expectedStatus: number,
): YclientsControlledWriteFailure | undefined {
  if (status === 401 || status === 403) {
    return Object.freeze({ outcome: 'unauthorized' as const });
  }
  if (status === 408 || status === 425) {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'provider_unavailable' as const,
    });
  }
  if (status === 429) {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'rate_limited' as const,
    });
  }
  if (status >= 500) {
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'provider_unavailable' as const,
    });
  }
  if (status >= 400 && status < 500) {
    // The current operation pages do not document a no-effect 4xx contract.
    // Even 404 can mean an already-applied DELETE, so effect stays unknown.
    return Object.freeze({
      outcome: 'unknown' as const,
      reason: 'invalid_or_ambiguous_response' as const,
    });
  }
  return status === expectedStatus
    ? undefined
    : Object.freeze({
        outcome: 'unknown' as const,
        reason: 'invalid_or_ambiguous_response' as const,
      });
}

export class YclientsControlledFullRecordReader {
  constructor(
    private readonly configuration: YclientsControlledAdminClientConfiguration,
  ) {
    if (configuration.limiter === undefined) {
      throw new TypeError('Shared YCLIENTS request limiter is required');
    }
  }

  async getRecordSnapshot(
    recordId: number,
  ): Promise<YclientsControlledFullRecordResult> {
    if (!this.configuration.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const configured = configuredValues(this.configuration);
    if (configured === undefined || !positiveSafeInteger(recordId)) {
      return Object.freeze({ outcome: 'invalid_request' as const });
    }
    return this.configuration.limiter.run(async () => {
      try {
        const response = await this.configuration.fetch(
          controlledUrl(configured, recordId),
          {
            method: 'GET',
            headers: {
              accept: YCLIENTS_ACCEPT,
              authorization: configured.authorization,
            },
            signal: AbortSignal.timeout(
              this.configuration.requestTimeoutMilliseconds,
            ),
          },
        );
        const failure = readStatusFailure(response.status);
        if (failure !== undefined) {
          await cancelBody(response.body);
          return failure;
        }
        const body = await readBoundedJson(response);
        const snapshot =
          body?.success === true
            ? readYclientsControlledFullRecord(
                body.data,
                configured.companyId,
                recordId,
              )
            : undefined;
        return snapshot === undefined
          ? Object.freeze({ outcome: 'unknown' as const })
          : Object.freeze({ outcome: 'found' as const, snapshot });
      } catch {
        return Object.freeze({ outcome: 'unavailable' as const });
      }
    });
  }
}

export class YclientsAdminWriteClient {
  constructor(
    private readonly configuration: YclientsControlledAdminClientConfiguration,
  ) {
    if (configuration.limiter === undefined) {
      throw new TypeError('Shared YCLIENTS request limiter is required');
    }
  }

  async reschedule(
    snapshot: YclientsControlledFullRecordSnapshot,
    target: YclientsControlledRescheduleTarget,
  ): Promise<YclientsControlledRescheduleResult> {
    if (!this.configuration.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const configured = configuredValues(this.configuration);
    const payload = buildYclientsControlledReschedulePayload(snapshot, target);
    if (
      configured === undefined ||
      payload === undefined ||
      snapshot.companyId !== configured.companyId
    ) {
      return Object.freeze({ outcome: 'invalid_request' as const });
    }
    return this.configuration.limiter.run(async () => {
      try {
        const response = await this.configuration.fetch(
          controlledUrl(configured, snapshot.recordId),
          {
            method: 'PUT',
            headers: {
              accept: YCLIENTS_ACCEPT,
              authorization: configured.authorization,
              'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(
              this.configuration.requestTimeoutMilliseconds,
            ),
          },
        );
        const failure = writeStatusFailure(response.status, 201);
        if (failure !== undefined) {
          await cancelBody(response.body);
          return failure;
        }
        const body = await readBoundedJson(response);
        return body?.success === true &&
          isRecord(body.data) &&
          body.data.id === snapshot.recordId
          ? Object.freeze({ outcome: 'accepted' as const })
          : Object.freeze({
              outcome: 'unknown' as const,
              reason: 'invalid_or_ambiguous_response' as const,
            });
      } catch {
        return Object.freeze({
          outcome: 'unknown' as const,
          reason: 'timeout_or_transport' as const,
        });
      }
    });
  }

  async cancel(recordId: number): Promise<YclientsControlledCancelResult> {
    if (!this.configuration.enabled) {
      return Object.freeze({ outcome: 'disabled' as const });
    }
    const configured = configuredValues(this.configuration);
    if (configured === undefined || !positiveSafeInteger(recordId)) {
      return Object.freeze({ outcome: 'invalid_request' as const });
    }
    return this.configuration.limiter.run(async () => {
      try {
        const response = await this.configuration.fetch(
          controlledUrl(configured, recordId),
          {
            method: 'DELETE',
            headers: {
              accept: YCLIENTS_ACCEPT,
              authorization: configured.authorization,
              'content-type': 'application/json',
            },
            signal: AbortSignal.timeout(
              this.configuration.requestTimeoutMilliseconds,
            ),
          },
        );
        const failure = writeStatusFailure(response.status, 204);
        if (failure !== undefined) {
          await cancelBody(response.body);
          return failure;
        }
        if (response.body !== null) {
          await cancelBody(response.body);
          return Object.freeze({
            outcome: 'unknown' as const,
            reason: 'invalid_or_ambiguous_response' as const,
          });
        }
        return Object.freeze({ outcome: 'deleted' as const });
      } catch {
        return Object.freeze({
          outcome: 'unknown' as const,
          reason: 'timeout_or_transport' as const,
        });
      }
    });
  }
}
