import { describe, expect, it, vi } from 'vitest';
import { createTrainingScheduleClient } from './trainingScheduleClient';

const CREDENTIAL = 'A'.repeat(43);
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

describe('Training schedule browser boundary', () => {
  it('sends one same-origin authenticated GET without owner/PII query and returns only the closed contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ outcome: 'not_configured', sessions: [] }));
    const client = createTrainingScheduleClient({ fetchImpl });
    expect(await client.read(CREDENTIAL)).toEqual({ outcome: 'not_configured', sessions: [] });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('/api/v1/trainings/schedule', expect.objectContaining({
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${CREDENTIAL}` },
      credentials: 'omit', cache: 'no-store', redirect: 'error',
    }));
  });

  it.each([
    { outcome: 'not_configured', sessions: [{ title: 'SYNTHETIC_PRIVATE_MARKER' }] },
    { outcome: 'loaded', sessions: [] },
    { outcome: 'not_configured', sessions: [], phone: 'SYNTHETIC_PRIVATE_MARKER' },
    { outcome: 'not_configured', sessions: [], comment: 'x'.repeat(2000) },
  ])('refuses unexpected/unapproved data without echoing it', async (body) => {
    const client = createTrainingScheduleClient({ fetchImpl: vi.fn().mockResolvedValue(response(body)) });
    expect(await client.read(CREDENTIAL)).toEqual({ outcome: 'rejected', reason: 'invalid_response' });
  });

  it('stops before fetch for invalid credentials and signals 401 to the existing session lifecycle', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 401));
    const client = createTrainingScheduleClient({ fetchImpl });
    expect(await client.read('foreign-phone')).toEqual({ outcome: 'rejected', reason: 'invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await client.read(CREDENTIAL)).toEqual({ outcome: 'rejected', reason: 'invalid' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation and bounds a stalled fetch by timeout', async () => {
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = createTrainingScheduleClient({ fetchImpl, requestTimeoutMs: 10 });
    const controller = new AbortController();
    controller.abort();
    expect(await client.read(CREDENTIAL, { signal: controller.signal })).toEqual({ outcome: 'cancelled' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await client.read(CREDENTIAL)).toEqual({ outcome: 'rejected', reason: 'unavailable' });
  });
});
