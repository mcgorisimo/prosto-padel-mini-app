import { ConfigService } from '@nestjs/config';
import { MatchWaitlistOfferExpiryProcessor } from './match-waitlist-offer-expiry.processor';
import { MatchWaitlistService } from './match-waitlist.service';

function config(enabled: boolean): ConfigService {
  return {
    get: jest.fn().mockReturnValue(enabled),
  } as unknown as ConfigService;
}

describe('MatchWaitlistOfferExpiryProcessor', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not schedule database work while offers are disabled', async () => {
    const sweepExpiredOffers = jest.fn().mockResolvedValue(0);
    const processor = new MatchWaitlistOfferExpiryProcessor(
      { sweepExpiredOffers } as unknown as MatchWaitlistService,
      config(false),
    );

    processor.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(sweepExpiredOffers).not.toHaveBeenCalled();
    processor.onModuleDestroy();
  });

  it('runs one bounded sweep at a time and stops cleanly', async () => {
    let finishFirst: (() => void) | undefined;
    const first = new Promise<number>((resolve) => {
      finishFirst = () => resolve(1);
    });
    const sweepExpiredOffers = jest.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(0);
    const processor = new MatchWaitlistOfferExpiryProcessor(
      { sweepExpiredOffers } as unknown as MatchWaitlistService,
      config(true),
    );

    processor.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(sweepExpiredOffers).toHaveBeenCalledTimes(1);
    expect(sweepExpiredOffers).toHaveBeenCalledWith(25);
    finishFirst?.();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(sweepExpiredOffers).toHaveBeenCalledTimes(2);
    processor.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(sweepExpiredOffers).toHaveBeenCalledTimes(2);
  });
});
