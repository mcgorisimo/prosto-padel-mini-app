import type { YclientsApiConfiguration } from '../config/yclients-api.config';
import { TRAINING_SCHEDULE_POLICY } from './training-schedule.policy';
import { YclientsTrainingScheduleClient } from './yclients-training-schedule.client';

const NOW = Date.parse('2030-03-17T00:00:00.000Z');
const START = Math.floor(Date.parse('2030-03-17T08:00:00.000Z') / 1_000);
const EVENT_ID = 918_273;

const runtime = (patch: Partial<YclientsApiConfiguration> = {}): YclientsApiConfiguration => Object.freeze({
  enabled: true,
  bookingWriteEnabled: false,
  baseUrl: 'https://api.example.test/vendor',
  companyId: TRAINING_SCHEDULE_POLICY.companyId,
  partnerToken: 'synthetic-partner-token',
  userToken: 'synthetic-user-token',
  ...patch,
});
const searchRow = (patch: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  company_id: TRAINING_SCHEDULE_POLICY.companyId,
  service_id: TRAINING_SCHEDULE_POLICY.serviceIds[0],
  staff_id: 404,
  date: '2030-03-17 11:00:00',
  timestamp: START,
  length: 3_600,
  capacity: 4,
  records_count: 1,
  comment: 'SYNTHETIC_PRIVATE_MARKER',
  service: {
    id: TRAINING_SCHEDULE_POLICY.serviceIds[0],
    title: 'Групповая тренировка Новички D/D+',
    price_min: 2_500,
    price_max: 2_500,
  },
  staff: { id: 404, name: 'Корт №4' },
  resource_instances: [],
  ...patch,
});
const searchResponse = (rows: unknown[]) => new Response(JSON.stringify({
  success: true,
  data: rows,
  meta: { count: rows.length },
}), { status: 200 });
const exactResponse = (patch: Record<string, unknown> = {}, status = 200) => new Response(JSON.stringify({
  data: {
    type: 'record',
    id: String(EVENT_ID),
    attributes: {
      service_id: TRAINING_SCHEDULE_POLICY.serviceIds[0],
      timestamp: START,
      length: 3_600,
      capacity: 4,
      clients_count: 2,
      client: { phone: 'SYNTHETIC_PRIVATE_MARKER' },
      ...patch,
    },
  },
}), { status });

function client(fetch: jest.Mock, runtimePatch: Partial<YclientsApiConfiguration> = {}) {
  return new YclientsTrainingScheduleClient({
    runtime: runtime(runtimePatch),
    requestTimeoutMilliseconds: 1_000,
    fetch,
    limiter: { run: (request) => request() },
  });
}

describe('YCLIENTS group training read boundary', () => {
  it('uses only bounded GETs and derives occupied from exact clients_count, never records_count', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(searchResponse([searchRow()])).mockResolvedValueOnce(exactResponse());
    const result = await client(fetch).read(NOW);

    expect(result).toEqual({ outcome: 'loaded', sessions: [{
      id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      title: 'Групповая тренировка Новички D/D+',
      startsAt: '2030-03-17T08:00:00.000Z',
      durationSeconds: 3_600,
      courtName: 'Корт №4',
      capacity: 4,
      occupied: 2,
      remaining: 2,
      singleVisitPriceRubles: 2_500,
    }] });
    expect(JSON.stringify(result)).not.toContain(String(EVENT_ID));
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_MARKER');
    expect(fetch).toHaveBeenCalledTimes(2);
    const searchUrl = fetch.mock.calls[0][0] as URL;
    expect(searchUrl.pathname).toBe(`/vendor/api/v1/activity/${TRAINING_SCHEDULE_POLICY.companyId}/search/`);
    expect(searchUrl.searchParams.get('from')).toBe('2030-03-17');
    expect(searchUrl.searchParams.get('till')).toBe('2030-03-24');
    expect(searchUrl.searchParams.getAll('service_ids[]')).toEqual([String(TRAINING_SCHEDULE_POLICY.serviceIds[0])]);
    expect(searchUrl.searchParams.get('count')).toBe(String(TRAINING_SCHEDULE_POLICY.maximumSessions));
    const exactUrl = fetch.mock.calls[1][0] as URL;
    expect(exactUrl.pathname).toBe(`/vendor/api/v2/companies/${TRAINING_SCHEDULE_POLICY.companyId}/activities/${EVENT_ID}`);
    for (const [, init] of fetch.mock.calls) expect(init).toEqual(expect.objectContaining({ method: 'GET' }));
  });

  it('publishes a coach only when the provider supplies a separate resource', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(searchResponse([searchRow({
      staff: { id: 404, name: 'Анна' },
      resource_instances: [{ id: 91, resource_id: 9, title: 'Корт №2' }],
    })])).mockResolvedValueOnce(exactResponse({ clients_count: 0 }));
    const result = await client(fetch).read(NOW);
    expect(result).toEqual({ outcome: 'loaded', sessions: [expect.objectContaining({
      courtName: 'Корт №2', coachName: 'Анна', occupied: 0, remaining: 4,
    })] });
  });

  it.each([
    ['unapproved service', searchRow({ service_id: 999, service: { id: 999, title: 'Чужое занятие' } }), exactResponse()],
    ['capacity mismatch', searchRow(), exactResponse({ capacity: 5 })],
    ['time mismatch', searchRow(), exactResponse({ timestamp: START + 60 })],
    ['invalid occupied count', searchRow(), exactResponse({ clients_count: -1 })],
  ])('fails closed on %s', async (_name, row, exact) => {
    const fetch = jest.fn().mockResolvedValueOnce(searchResponse([row])).mockResolvedValueOnce(exact);
    await expect(client(fetch).read(NOW)).resolves.toEqual({ outcome: 'invalid_response' });
  });

  it('returns disabled for any company outside the reviewed publication scope', async () => {
    const fetch = jest.fn();
    await expect(client(fetch, { companyId: 123 }).read(NOW)).resolves.toEqual({ outcome: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps auth and transient failures without provider bodies or retry', async () => {
    const fetch = jest.fn().mockResolvedValue(new Response('SYNTHETIC_PRIVATE_MARKER', { status: 403 }));
    await expect(client(fetch).read(NOW)).resolves.toEqual({ outcome: 'unauthorized' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
