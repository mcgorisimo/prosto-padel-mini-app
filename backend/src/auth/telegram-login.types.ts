import { UnixEpochSeconds } from './auth.types';

export interface TelegramLoginInput {
  readonly rawInitData: string;
  readonly now: UnixEpochSeconds;
  readonly requestKey: string;
}

export type TelegramLoginRejectionReason =
  | 'invalid_telegram_data'
  | 'telegram_proof_expired'
  | 'proof_replayed'
  | 'request_conflict'
  | 'account_unavailable'
  | 'temporary_conflict'
  | 'dependency_unavailable'
  | 'internal_failure';

/**
 * The plaintext credential exists only for the duration of one orchestration
 * execution. A later request cannot recover it from PostgreSQL after an
 * uncertain HTTP response and must start a new Telegram login workflow.
 */
export type TelegramLoginResult =
  | {
      readonly outcome: 'authenticated';
      readonly credential: string;
      readonly expiresAt: UnixEpochSeconds;
      readonly accountKind: 'existing' | 'new';
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: TelegramLoginRejectionReason;
    };
