import { CLIENT_LOOKUP_BUDGET, normalizeCrmPhone, YclientsClientLookup } from './yclients-client-lookup';

const PHONE = '+79991112233';
const OTHER = '+79992223344';
const config = { enabled: true, bookingWriteEnabled: false, baseUrl: 'https://api.yclients.com',
  companyId: 17, partnerToken: 'partner-private', userToken: 'user-private' };
const page = (ids: number[], total = ids.length) => ({ success: true, data: ids.map(id => ({ id })), meta: { total_count: total } });
const exact = (id = 5, phone: unknown = PHONE) => ({ success: true, data: { id, phone } });
function setup(bodies: unknown[] = []) {
  const fetch = jest.fn();
  for (const body of bodies) fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  const limiter = { run: async <T>(work: () => Promise<T>) => work() };
  return { fetch, limiter, lookup: new YclientsClientLookup({ runtime: config, fetch, limiter }) };
}

describe('company-scoped YCLIENTS client reads', () => {
  it.each([PHONE, '79991112233', 79991112233, '8 (999) 111-22-33', '+7 (999) 111-22-33'])('normalizes primary phone %s', phone => {
    expect(normalizeCrmPhone(phone)).toBe(PHONE);
  });
  it.each(['9991112233 ext 4', '79991112233/79992223344', 'name', '', null, 1.5, '+7\n9991112233'])('rejects ambiguous phone %s', phone => {
    expect(normalizeCrmPhone(phone)).toBeUndefined();
  });
  it('requires exact primary phone and stable full search; never puts phone in URL', async () => {
    const { lookup, fetch } = setup([page([5, 6]), exact(), exact(6, OTHER), page([5, 6])]);
    expect(await lookup.find(PHONE, 17)).toEqual({ outcome: 'unique', companyId: 17, clientId: 5 });
    expect(fetch.mock.calls.map(c => c[1].method)).toEqual(['POST', 'GET', 'GET', 'POST']);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).not.toMatch(/7999|phone|token|\?/);
      expect(init.redirect).toBe('error');
    }
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      fields: ['id'], filters: [{ type: 'quick_search', state: { value: PHONE.slice(1) } }],
    });
  });
  it('returns no_match only for a complete, stable empty search', async () => {
    expect(await setup([page([]), page([])]).lookup.find(PHONE, 17)).toEqual({ outcome: 'no_match' });
  });
  it('treats name/additional-phone-only candidates as manual review', async () => {
    expect(await setup([page([5]), exact(5, OTHER), page([5])]).lookup.find(PHONE, 17)).toEqual({ outcome: 'review_required' });
  });
  it('detects two clients sharing the primary phone', async () => {
    expect(await setup([page([5, 6]), exact(), exact(6), page([5, 6])]).lookup.find(PHONE, 17)).toEqual({ outcome: 'review_required' });
  });
  it.each([
    [page([5], 2)], [page([], 1)], [page([5], 21)], [{ success: true, data: [] }],
    [page([5, 5])], [page([5]), exact(6)], [page([5]), exact(5, null)],
    [page([5]), { success: true, data: { id: 5, phone: PHONE, company_id: 18 } }],
    [page([5]), exact(), page([])], [page([5]), { success: false, meta: { message: PHONE } }],
  ])('returns unknown for incomplete/contradictory data %#', async (...bodies) => {
    expect(await setup(bodies).lookup.find(PHONE, 17)).toEqual({ outcome: 'unknown' });
  });
  it('fully reads two pages and detects drift in total count', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => i + 1);
    const full = [page(ids.slice(0, 10), 11), page([11], 11)];
    const bodies = [...full, ...ids.map(id => exact(id, id === 1 ? PHONE : OTHER)), ...full];
    const { lookup, fetch } = setup(bodies);
    expect(await lookup.find(PHONE, 17)).toEqual({ outcome: 'unique', companyId: 17, clientId: 1 });
    expect(fetch).toHaveBeenCalledTimes(15);
    expect(await setup([full[0], page([11], 12)]).lookup.find(PHONE, 17)).toEqual({ outcome: 'unknown' });
  });
  it.each([401, 403, 404, 408, 429, 500, 302])('fails closed on HTTP %s', async status => {
    const { lookup, fetch } = setup();
    fetch.mockResolvedValue(new Response(PHONE, { status }));
    expect(await lookup.find(PHONE, 17)).toEqual({ outcome: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects foreign companies and disabled runtime without requests', async () => {
    const { lookup, fetch, limiter } = setup();
    expect(await lookup.find(PHONE, 18)).toEqual({ outcome: 'unknown' });
    expect(await new YclientsClientLookup({ runtime: { ...config, enabled: false }, fetch, limiter }).find(PHONE, 17)).toEqual({ outcome: 'unknown' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds response bytes and discards provider errors', async () => {
    const { lookup, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response('x'.repeat(CLIENT_LOOKUP_BUDGET.responseBytes + 1)));
    expect(await lookup.find(PHONE, 17)).toEqual({ outcome: 'unknown' });
    fetch.mockRejectedValueOnce(new Error(`private ${PHONE}`));
    expect(await lookup.find(PHONE, 17)).toEqual({ outcome: 'unknown' });
  });
  it('times out stalled calls and never dispatches queued work after deadline', async () => {
    jest.useFakeTimers();
    try {
      let queued: (() => Promise<unknown>) | undefined;
      const fetch = jest.fn();
      const limiter = { run: <T>(work: () => Promise<T>): Promise<T> => { queued = work; return new Promise(() => {}); } };
      const lookup = new YclientsClientLookup({ runtime: config, fetch, limiter });
      const result = lookup.find(PHONE, 17);
      await jest.advanceTimersByTimeAsync(CLIENT_LOOKUP_BUDGET.totalMilliseconds);
      expect(await result).toEqual({ outcome: 'unknown' });
      await expect(queued!()).rejects.toThrow('Lookup unavailable');
      expect(fetch).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });
  it('a request abort is unknown and is never retried', async () => {
    const { lookup, fetch } = setup();
    fetch.mockRejectedValueOnce(new DOMException('private provider URL', 'TimeoutError'));
    expect(await lookup.find(PHONE, 17)).toEqual({ outcome: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
