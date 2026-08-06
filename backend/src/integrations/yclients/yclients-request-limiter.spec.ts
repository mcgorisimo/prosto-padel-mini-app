import {
  YclientsConservativeRequestLimiter,
  YclientsRequestLimiterClock,
} from './yclients-request-limiter';

class FakeClock implements YclientsRequestLimiterClock {
  now = 0;
  readonly sleeps: number[] = [];

  nowMilliseconds(): number {
    return this.now;
  }

  async sleep(milliseconds: number): Promise<void> {
    this.sleeps.push(milliseconds);
    this.now += milliseconds;
  }
}

describe('YclientsConservativeRequestLimiter', () => {
  it('serializes in-flight requests and defaults to one start per second', async () => {
    const clock = new FakeClock();
    const limiter = new YclientsConservativeRequestLimiter({ clock });
    const starts: number[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = limiter.run(
      () =>
        new Promise<string>((resolve) => {
          starts.push(clock.now);
          releaseFirst = () => resolve('first');
        }),
    );
    const second = limiter.run(async () => {
      starts.push(clock.now);
      return 'second';
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(starts).toEqual([0]);
    releaseFirst?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'second',
    ]);
    expect(starts).toEqual([0, 1_000]);
    expect(clock.sleeps).toEqual([1_000]);
  });

  it('also enforces the per-minute ceiling with a mocked clock', async () => {
    const clock = new FakeClock();
    const limiter = new YclientsConservativeRequestLimiter({
      clock,
      minimumIntervalMilliseconds: 200,
      maximumRequestsPerMinute: 2,
    });
    const starts: number[] = [];

    for (let index = 0; index < 3; index += 1) {
      await limiter.run(async () => {
        starts.push(clock.now);
      });
    }

    expect(starts).toEqual([0, 200, 60_000]);
    expect(clock.sleeps).toEqual([200, 59_800]);
  });

  it.each([
    { minimumIntervalMilliseconds: 199 },
    { maximumRequestsPerMinute: 201 },
    { minimumIntervalMilliseconds: 0 },
    { maximumRequestsPerMinute: 0 },
  ])('rejects unsafe provider ceilings %#', (options) => {
    expect(
      () => new YclientsConservativeRequestLimiter(options),
    ).toThrow('Invalid YCLIENTS request limiter configuration');
  });

  it('releases the queue after a failed request without retrying it', async () => {
    const clock = new FakeClock();
    const limiter = new YclientsConservativeRequestLimiter({ clock });
    const failed = jest.fn().mockRejectedValue(new Error('opaque failure'));
    const next = jest.fn().mockResolvedValue('ok');

    await expect(limiter.run(failed)).rejects.toThrow('opaque failure');
    await expect(limiter.run(next)).resolves.toBe('ok');

    expect(failed).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([1_000]);
  });
});
