const PROVIDER_MINIMUM_INTERVAL_MILLISECONDS = 200;
const PROVIDER_MAXIMUM_REQUESTS_PER_MINUTE = 200;
const DEFAULT_MINIMUM_INTERVAL_MILLISECONDS = 1_000;
const DEFAULT_MAXIMUM_REQUESTS_PER_MINUTE = 60;
const MINUTE_MILLISECONDS = 60_000;

export interface YclientsRequestLimiterClock {
  nowMilliseconds(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface YclientsRequestLimiterOptions {
  readonly clock?: YclientsRequestLimiterClock;
  readonly minimumIntervalMilliseconds?: number;
  readonly maximumRequestsPerMinute?: number;
}

const systemClock: YclientsRequestLimiterClock = Object.freeze({
  nowMilliseconds: (): number => Date.now(),
  sleep: (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
});

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/**
 * Serializes requests and caps their start rate below both documented YCLIENTS
 * ceilings. It never retries an operation.
 */
export class YclientsConservativeRequestLimiter {
  private readonly clock: YclientsRequestLimiterClock;
  private readonly minimumIntervalMilliseconds: number;
  private readonly maximumRequestsPerMinute: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly requestStarts: number[] = [];

  constructor(options: YclientsRequestLimiterOptions = {}) {
    const minimumIntervalMilliseconds =
      options.minimumIntervalMilliseconds ??
      DEFAULT_MINIMUM_INTERVAL_MILLISECONDS;
    const maximumRequestsPerMinute =
      options.maximumRequestsPerMinute ??
      DEFAULT_MAXIMUM_REQUESTS_PER_MINUTE;
    if (
      !positiveSafeInteger(minimumIntervalMilliseconds) ||
      minimumIntervalMilliseconds < PROVIDER_MINIMUM_INTERVAL_MILLISECONDS ||
      !positiveSafeInteger(maximumRequestsPerMinute) ||
      maximumRequestsPerMinute > PROVIDER_MAXIMUM_REQUESTS_PER_MINUTE
    ) {
      throw new TypeError('Invalid YCLIENTS request limiter configuration');
    }

    this.clock = options.clock ?? systemClock;
    this.minimumIntervalMilliseconds = minimumIntervalMilliseconds;
    this.maximumRequestsPerMinute = maximumRequestsPerMinute;
  }

  async run<T>(request: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: (() => void) | undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      await this.waitForPermit();
      this.requestStarts.push(this.readClock());
      return await request();
    } finally {
      release?.();
    }
  }

  private readClock(): number {
    const value = this.clock.nowMilliseconds();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('Invalid YCLIENTS request limiter clock');
    }
    return value;
  }

  private async waitForPermit(): Promise<void> {
    for (;;) {
      const now = this.readClock();
      while (
        this.requestStarts.length > 0 &&
        this.requestStarts[0] <= now - MINUTE_MILLISECONDS
      ) {
        this.requestStarts.shift();
      }

      const lastStartedAt = this.requestStarts.at(-1);
      const intervalWait =
        lastStartedAt === undefined
          ? 0
          : lastStartedAt + this.minimumIntervalMilliseconds - now;
      const minuteWait =
        this.requestStarts.length < this.maximumRequestsPerMinute
          ? 0
          : this.requestStarts[
              this.requestStarts.length - this.maximumRequestsPerMinute
            ] +
            MINUTE_MILLISECONDS -
            now;
      const waitMilliseconds = Math.max(intervalWait, minuteWait, 0);
      if (waitMilliseconds === 0) return;
      await this.clock.sleep(waitMilliseconds);
    }
  }
}
