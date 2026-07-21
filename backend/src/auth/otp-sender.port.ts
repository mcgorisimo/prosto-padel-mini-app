import { UnixEpochSeconds } from './auth.types';
import { OtpChallengeId } from './otp.types';

/**
 * A transient delivery request. Plaintext code and destination must never be
 * copied into OtpChallengeState or logged by the domain state machine.
 */
export interface OtpSenderRequest {
  readonly channel: 'sms';
  readonly challengeId: OtpChallengeId;
  readonly destination: string;
  readonly plaintextCode: string;
  readonly expiresAt: UnixEpochSeconds;
}

export type OtpSenderOutcome =
  /** Accepted by the sender adapter; this is not proof of user delivery. */
  | { readonly outcome: 'accepted' }
  | { readonly outcome: 'unavailable' };

export interface OtpSenderPort {
  send(request: OtpSenderRequest): Promise<OtpSenderOutcome>;
}
