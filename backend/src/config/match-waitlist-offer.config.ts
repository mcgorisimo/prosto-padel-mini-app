import { ConfigService } from '@nestjs/config';

export const MATCH_WAITLIST_OFFER_CONFIG_KEYS = Object.freeze({
  enabled: 'MATCH_WAITLIST_OFFERS_ENABLED',
} as const);

export const MATCH_WAITLIST_OFFER_TTL_SECONDS = 15 * 60;
export const MATCH_WAITLIST_OFFER_SWEEP_INTERVAL_MILLISECONDS = 1_000;
export const MATCH_WAITLIST_OFFER_SWEEP_BATCH_SIZE = 25;

export function readMatchWaitlistOfferEnabled(config: ConfigService): boolean {
  return config.get<boolean>(MATCH_WAITLIST_OFFER_CONFIG_KEYS.enabled) === true;
}
