import { describe, expect, it, vi } from 'vitest';
import { createTrainingScheduleClient, readTrainingScheduleResponse } from './trainingScheduleClient';

const CREDENTIAL = 'A'.repeat(43);
const ID = '11111111-1111-5111-8111-111111111111';
const UPDATED = '2030-03-17T00:00:00.000Z';
const SESSION = Object.freeze({
  id: ID,
  title: 'Групповая тренировка Новички D/D+',
  startsAt: '2030-03-17T08:00:00.000Z',
  durationSeconds: 3_600,
  courtName: 'Корт №4',
  capacity: 4,
  occupied: 1,
  remaining: 3,
});
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

describe('Training schedule browser boundary', () => {
  it('sends one same-origin authenticated GET and accepts the bounded loaded projection', async () => {
    const body = { outcome: 'loaded', sessions: [SESSION], lastUpdatedAt: UPDATED };
    const fetchImpl = vi.fn().mockResolvedValue(response(body));
    const client = createTrainingScheduleClient({ fetchImpl });
    expect(await client.read(CREDENTIAL)).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('/api/v1/trainings/schedule', expect.objectContaining({
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${CREDENTIAL}` },
      credentials: 'omit', cache: 'no-store', redirect: 'error',
    }));
  });

  it.each([
    { outcome: 'not_configured', sessions: [] },
    { outcome: 'unavailable', sessions: [] },
    { outcome: 'error', sessions: [] },
    { outcome: 'empty', sessions: [], lastUpdatedAt: UPDATED },
    { outcome: 'stale', sessions: [], lastUpdatedAt: UPDATED },
  ])('accepts the exact fail-closed response %j', async (body) => {
    const client = createTrainingScheduleClient({ fetchImpl: vi.fn().mockResolvedValue(response(body)) });
    expect(await client.read(CREDENTIAL)).toEqual(body);
  });

  it.each([
    { outcome: 'loaded', sessions: [{ ...SESSION, providerEventId: 19 }], lastUpdatedAt: UPDATED },
    { outcome: 'loaded', sessions: [{ ...SESSION, phone: 'SYNTHETIC_PRIVATE_MARKER' }], lastUpdatedAt: UPDATED },
    { outcome: 'loaded', sessions: [{ ...SESSION, remaining: 4 }], lastUpdatedAt: UPDATED },
    { outcome: 'loaded', sessions: [{ ...SESSION, id: '19' }], lastUpdatedAt: UPDATED },
    { outcome: 'loaded', sessions: [SESSION, SESSION], lastUpdatedAt: UPDATED },
    { outcome: 'loaded', sessions: [], lastUpdatedAt: UPDATED },
    { outcome: 'stale', sessions: [SESSION], lastUpdatedAt: UPDATED },
    { outcome: 'not_configured', sessions: [], phone: 'SYNTHETIC_PRIVATE_MARKER' },
    { outcome: 'loaded', sessions: [SESSION], lastUpdatedAt: 'not-a-date' },
  ])('refuses unexpected, inconsistent or private data without echoing it', async (body) => {
    const client = createTrainingScheduleClient({ fetchImpl: vi.fn().mockResolvedValue(response(body)) });
    expect(await client.read(CREDENTIAL)).toEqual({ outcome: 'rejected', reason: 'invalid_response' });
  });

  it('requires sorted unique sessions at the browser boundary', () => {
    const later = { ...SESSION, id: '22222222-2222-5222-8222-222222222222', startsAt: '2030-03-18T08:00:00.000Z' };
    expect(readTrainingScheduleResponse({ outcome: 'loaded', sessions: [later, SESSION], lastUpdatedAt: UPDATED })).toBeNull();
  });

  it('stops before fetch for invalid credentials and signals 401 to the session lifecycle', async () => {
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
