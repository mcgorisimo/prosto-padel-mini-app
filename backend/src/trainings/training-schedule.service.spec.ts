import { TRAINING_SCHEDULE_POLICY } from './training-schedule.policy';
import { TrainingScheduleService } from './training-schedule.service';

const START = '2030-03-17T08:00:00.000Z';
const SESSION = Object.freeze({
  id: '11111111-1111-5111-8111-111111111111',
  title: 'Групповая тренировка Новички D/D+',
  startsAt: START,
  durationSeconds: 3_600,
  courtName: 'Корт №4',
  capacity: 4,
  occupied: 1,
  remaining: 3,
  singleVisitPriceRubles: 2_500,
});

describe('TrainingScheduleService cache and freshness boundary', () => {
  it('coalesces concurrent refreshes, caches for five minutes and never exposes price', async () => {
    let resolveProvider!: (value: unknown) => void;
    const provider = { read: jest.fn(() => new Promise((resolve) => { resolveProvider = resolve; })) };
    let now = Date.parse('2030-03-17T00:00:00.000Z');
    const service = new TrainingScheduleService({ provider: provider as never, clock: { nowMilliseconds: () => now } });
    const first = service.read();
    const second = service.read();
    expect(provider.read).toHaveBeenCalledTimes(1);
    resolveProvider({ outcome: 'loaded', sessions: [SESSION] });
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ outcome: 'loaded' }),
      expect.objectContaining({ outcome: 'loaded' }),
    ]);
    const loaded = await first;
    expect(loaded).toEqual({
      outcome: 'loaded',
      sessions: [{ id: SESSION.id, title: SESSION.title, startsAt: START, durationSeconds: 3_600,
        courtName: 'Корт №4', capacity: 4, occupied: 1, remaining: 3 }],
      lastUpdatedAt: '2030-03-17T00:00:00.000Z',
    });
    expect(JSON.stringify(loaded)).not.toContain('2500');

    now += TRAINING_SCHEDULE_POLICY.cacheTtlMilliseconds - 1;
    await service.read();
    expect(provider.read).toHaveBeenCalledTimes(1);
  });

  it('removes stale rows after a failed refresh and negative-caches the failure', async () => {
    const provider = { read: jest.fn()
      .mockResolvedValueOnce({ outcome: 'loaded', sessions: [SESSION] })
      .mockResolvedValueOnce({ outcome: 'unavailable' }) };
    let now = Date.parse('2030-03-17T00:00:00.000Z');
    const service = new TrainingScheduleService({ provider: provider as never, clock: { nowMilliseconds: () => now } });
    await service.read();
    now += TRAINING_SCHEDULE_POLICY.cacheTtlMilliseconds;
    await expect(service.read()).resolves.toEqual({
      outcome: 'stale', sessions: [], lastUpdatedAt: '2030-03-17T00:00:00.000Z',
    });
    await service.read();
    expect(provider.read).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ outcome: 'disabled' }, { outcome: 'not_configured', sessions: [] }],
    [{ outcome: 'loaded', sessions: [] }, { outcome: 'empty', sessions: [], lastUpdatedAt: '2030-03-17T00:00:00.000Z' }],
    [{ outcome: 'invalid_response' }, { outcome: 'error', sessions: [] }],
    [{ outcome: 'unauthorized' }, { outcome: 'unavailable', sessions: [] }],
  ])('maps provider result %j without stale data', async (providerResult, expected) => {
    const now = Date.parse('2030-03-17T00:00:00.000Z');
    const service = new TrainingScheduleService({
      provider: { read: jest.fn().mockResolvedValue(providerResult) } as never,
      clock: { nowMilliseconds: () => now },
    });
    await expect(service.read()).resolves.toEqual(expected);
  });
});
