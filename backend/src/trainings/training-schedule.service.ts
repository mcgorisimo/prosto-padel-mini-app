import type { YclientsTrainingScheduleClient } from './yclients-training-schedule.client';
import { TRAINING_SCHEDULE_POLICY } from './training-schedule.policy';
import type { TrainingScheduleResponse } from './training-schedule.types';

export interface TrainingScheduleClock {
  nowMilliseconds(): number;
}

export interface TrainingScheduleServiceConfiguration {
  readonly provider: Pick<YclientsTrainingScheduleClient, 'read'>;
  readonly clock?: TrainingScheduleClock;
}

type TimedResponse = Readonly<{ response: TrainingScheduleResponse; expiresAt: number }>;

const EMPTY = Object.freeze([] as const);

export class TrainingScheduleService {
  private readonly clock: TrainingScheduleClock;
  private cache: TimedResponse | undefined;
  private lastSuccessfulAt: string | undefined;
  private inFlight: Promise<TrainingScheduleResponse> | undefined;

  constructor(private readonly configuration: TrainingScheduleServiceConfiguration) {
    this.clock = configuration.clock ?? { nowMilliseconds: () => Date.now() };
  }

  read(): Promise<TrainingScheduleResponse> {
    const now = this.readClock();
    if (this.cache !== undefined && now < this.cache.expiresAt) {
      return Promise.resolve(this.cache.response);
    }
    if (this.inFlight !== undefined) return this.inFlight;
    this.inFlight = this.refresh(now).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async refresh(startedAt: number): Promise<TrainingScheduleResponse> {
    let result: Awaited<ReturnType<YclientsTrainingScheduleClient['read']>>;
    try {
      result = await this.configuration.provider.read(startedAt);
    } catch {
      result = Object.freeze({ outcome: 'unavailable' as const });
    }
    const completedAt = this.readClock();
    let response: TrainingScheduleResponse;
    let ttl: number = TRAINING_SCHEDULE_POLICY.failureCacheTtlMilliseconds;
    if (result.outcome === 'loaded') {
      const lastUpdatedAt = new Date(completedAt).toISOString();
      this.lastSuccessfulAt = lastUpdatedAt;
      response = result.sessions.length === 0
        ? Object.freeze({ outcome: 'empty' as const, sessions: EMPTY, lastUpdatedAt })
        : Object.freeze({
            outcome: 'loaded' as const,
            sessions: Object.freeze(result.sessions.map(({ singleVisitPriceRubles: _price, ...session }) => Object.freeze(session))),
            lastUpdatedAt,
          });
      ttl = TRAINING_SCHEDULE_POLICY.cacheTtlMilliseconds;
    } else if (result.outcome === 'disabled') {
      this.lastSuccessfulAt = undefined;
      response = Object.freeze({ outcome: 'not_configured' as const, sessions: EMPTY });
    } else if (this.lastSuccessfulAt !== undefined) {
      response = Object.freeze({ outcome: 'stale' as const, sessions: EMPTY, lastUpdatedAt: this.lastSuccessfulAt });
    } else if (result.outcome === 'invalid_response') {
      response = Object.freeze({ outcome: 'error' as const, sessions: EMPTY });
    } else {
      response = Object.freeze({ outcome: 'unavailable' as const, sessions: EMPTY });
    }
    this.cache = Object.freeze({ response, expiresAt: completedAt + ttl });
    return response;
  }

  private readClock(): number {
    const value = this.clock.nowMilliseconds();
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid training schedule clock');
    return value;
  }
}
