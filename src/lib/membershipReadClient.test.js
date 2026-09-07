import { describe, expect, it, vi } from 'vitest';
import { createMembershipReadClient } from './membershipReadClient';

const CREDENTIAL = 'A'.repeat(43);
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
describe('Membership browser read boundary', () => {
  it('uses same-origin bearer GETs without owner or PII input', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ outcome: 'not_configured', memberships: [] }))
      .mockResolvedValueOnce(response({ outcome: 'not_configured', products: [] }));
    const client = createMembershipReadClient({ fetchImpl });

    expect(await client.readMine(CREDENTIAL)).toEqual({ outcome: 'not_configured', memberships: [] });
    expect(await client.readCatalog(CREDENTIAL)).toEqual({ outcome: 'not_configured', products: [] });
    expect(fetchImpl.mock.calls.map(([path, options]) => ({ path, options }))).toEqual([
      expect.objectContaining({
        path: '/api/v1/memberships/mine',
        options: expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error' }),
      }),
      expect.objectContaining({
        path: '/api/v1/memberships/catalog',
        options: expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error' }),
      }),
    ]);
    expect(fetchImpl.mock.calls.every(([, options]) => options.headers.Authorization === `Bearer ${CREDENTIAL}`)).toBe(true);
  });

  it('accepts only bounded canonical own and published-catalog projections', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ outcome: 'loaded', memberships: [{
        id: '11111111-1111-4111-8111-111111111111', title: 'Клубный', status: 'active', remainingVisits: 4, expiresOn: '2035-10-05',
      }] }))
      .mockResolvedValueOnce(response({ outcome: 'loaded', products: [{
        id: '22222222-2222-4222-8222-222222222222', title: 'Восемь тренировок', description: 'Опубликованный вариант клуба', visitCount: 8, validityDays: 60,
      }] }));
    const client = createMembershipReadClient({ fetchImpl });
    expect(await client.readMine(CREDENTIAL)).toEqual({ outcome: 'loaded', memberships: [expect.objectContaining({ status: 'active', remainingVisits: 4 })] });
    expect(await client.readCatalog(CREDENTIAL)).toEqual({ outcome: 'loaded', products: [expect.objectContaining({ visitCount: 8, validityDays: 60 })] });
  });

  it.each([
    { path: 'mine', body: { outcome: 'loaded', memberships: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Закрытый', status: 'active', remainingVisits: 4, expiresOn: '2035-10-05', phone: 'SYNTHETIC_PRIVATE_MARKER' }] } },
    { path: 'mine', body: { outcome: 'not_configured', memberships: [{ title: 'SYNTHETIC_PRIVATE_MARKER' }] } },
    { path: 'catalog', body: { outcome: 'loaded', products: [{ id: 'bad-id', title: 'Ошибка', description: null, visitCount: 8, validityDays: 60 }] } },
    { path: 'catalog', body: { outcome: 'loaded', products: [], clientId: 123 } },
  ])('rejects unexpected, identifying or malformed $path data', async ({ path, body }) => {
    const client = createMembershipReadClient({ fetchImpl: vi.fn().mockResolvedValue(response(body)) });
    const result = path === 'mine' ? await client.readMine(CREDENTIAL) : await client.readCatalog(CREDENTIAL);
    expect(result).toEqual({ outcome: 'rejected', reason: 'invalid_response' });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_MARKER');
  });

  it('maps empty, unavailable and session-invalid responses without fabricated rows', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ outcome: 'loaded', memberships: [] }))
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}, 401));
    const client = createMembershipReadClient({ fetchImpl });
    expect(await client.readMine(CREDENTIAL)).toEqual({ outcome: 'loaded', memberships: [] });
    expect(await client.readCatalog(CREDENTIAL)).toEqual({ outcome: 'rejected', reason: 'unavailable' });
    expect(await client.readMine(CREDENTIAL)).toEqual({ outcome: 'rejected', reason: 'invalid' });
  });

  it('stops before fetch for invalid credentials and honors cancellation/timeout', async () => {
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = createMembershipReadClient({ fetchImpl, requestTimeoutMs: 10 });
    expect(await client.readMine('editable-phone')).toEqual({ outcome: 'rejected', reason: 'invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    expect(await client.readMine(CREDENTIAL, { signal: controller.signal })).toEqual({ outcome: 'cancelled' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await client.readCatalog(CREDENTIAL)).toEqual({ outcome: 'rejected', reason: 'unavailable' });
  });
});
