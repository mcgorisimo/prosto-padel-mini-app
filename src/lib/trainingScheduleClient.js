import { isCanonicalSessionCredential } from './sessionCredential';

const PATH = '/api/v1/trainings/schedule';
const rejected = (reason) => Object.freeze({ outcome: 'rejected', reason });

export function isUnconfiguredTrainingSchedule(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === 2 && body.outcome === 'not_configured' &&
    Array.isArray(body.sessions) && body.sessions.length === 0;
}

export function createTrainingScheduleClient({ fetchImpl = globalThis.fetch?.bind(globalThis), requestTimeoutMs = 8_000 } = {}) {
  return Object.freeze({
    async read(credential, { signal } = {}) {
      if (!isCanonicalSessionCredential(credential)) return rejected('invalid');
      if (signal?.aborted) return Object.freeze({ outcome: 'cancelled' });
      if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) return rejected('internal_error');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, requestTimeoutMs);
      let reader;
      try {
        const response = await fetchImpl(PATH, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` },
          cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
        });
        if (response.status === 401) return rejected('invalid');
        if (response.status !== 200) return rejected('unavailable');
        if (!/^application\/json(?:;|$)/iu.test(response.headers.get('content-type') ?? '') ||
            response.headers.get('cache-control') !== 'no-store') return rejected('invalid_response');
        reader = response.body?.getReader();
        if (!reader) return rejected('invalid_response');
        // The only current response is small. Bound actual bytes, not merely
        // Content-Length, so unexpected provider payloads cannot reach the UI.
        const bytes = [];
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (bytes.length + chunk.value.byteLength > 1_024) return rejected('invalid_response');
          bytes.push(...chunk.value);
        }
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)));
        if (!isUnconfiguredTrainingSchedule(body)) return rejected('invalid_response');
        return Object.freeze({ outcome: 'not_configured', sessions: Object.freeze([]) });
      } catch {
        return signal?.aborted ? Object.freeze({ outcome: 'cancelled' }) : rejected('unavailable');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (reader) await reader.cancel().catch(() => {});
      }
    },
  });
}

export const trainingScheduleClient = createTrainingScheduleClient();
