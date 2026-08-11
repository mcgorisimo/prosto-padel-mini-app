import { describe, expect, it } from 'vitest';
import {
  createDeterministicCrypto,
  createJsonFetchHarness,
} from './browserTestHarness.js';

describe('browser test harness', () => {
  it('provides deterministic UUID and random bytes', () => {
    const cryptoImpl = createDeterministicCrypto({ randomByte: 0x2a });
    const bytes = new Uint8Array(4);

    expect(cryptoImpl.randomUUID()).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(cryptoImpl.getRandomValues(bytes)).toBe(bytes);
    expect(Array.from(bytes)).toEqual([42, 42, 42, 42]);
    expect(() => cryptoImpl.getRandomValues(new DataView(new ArrayBuffer(1))))
      .toThrow('target must be a typed array');
  });

  it('records exact fetch calls and rejects unexpected routes', async () => {
    const harness = createJsonFetchHarness(new Map([
      ['/test', { body: { ok: true } }],
    ]));

    const response = await harness.fetchImpl('/test', { method: 'POST' });

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(harness.calls).toEqual([
      { url: '/test', init: { method: 'POST' } },
    ]);
    await expect(harness.fetchImpl('/missing')).rejects.toThrow(
      'Unexpected test request: /missing',
    );
  });
});
