import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MATCH_WAITLIST_OFFER_SWEEP_BATCH_SIZE,
  MATCH_WAITLIST_OFFER_SWEEP_INTERVAL_MILLISECONDS,
  readMatchWaitlistOfferEnabled,
} from '../config/match-waitlist-offer.config';
import { MatchWaitlistService } from './match-waitlist.service';

@Injectable()
export class MatchWaitlistOfferExpiryProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MatchWaitlistOfferExpiryProcessor.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly service: MatchWaitlistService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!readMatchWaitlistOfferEnabled(this.config)) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, MATCH_WAITLIST_OFFER_SWEEP_INTERVAL_MILLISECONDS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.service.sweepExpiredOffers(
        MATCH_WAITLIST_OFFER_SWEEP_BATCH_SIZE,
      );
    } catch {
      this.logger.error('Waitlist offer expiry sweep failed');
    } finally {
      this.running = false;
    }
  }
}
