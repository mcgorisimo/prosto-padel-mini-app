import {
  MAX_OTP_ATTEMPTS,
  OTP_CANCEL_REASONS,
  isOtpAttemptCount,
  isOtpCancelReason,
  isOtpChallengeId,
  isOtpCommandId,
  isOtpRequestDigest,
  isOtpVerifierDigest,
} from './otp.types';

describe('OTP primitive contracts', () => {
  it.each([isOtpChallengeId, isOtpCommandId])(
    'accepts a bounded opaque ID',
    (guard) => {
      expect(guard('otp-value-1')).toBe(true);
    },
  );

  it.each([isOtpChallengeId, isOtpCommandId])(
    'rejects unsafe opaque IDs',
    (guard) => {
      for (const value of ['', ' ', ' padded', 'padded ', 'line\nbreak', 'x'.repeat(257)]) {
        expect(guard(value)).toBe(false);
      }
    },
  );

  it.each([isOtpVerifierDigest, isOtpRequestDigest])(
    'accepts only lowercase 64-character SHA-256-compatible digests',
    (guard) => {
      expect(guard('a'.repeat(64))).toBe(true);
      expect(guard('a'.repeat(63))).toBe(false);
      expect(guard('A'.repeat(64))).toBe(false);
      expect(guard('g'.repeat(64))).toBe(false);
    },
  );

  it('bounds attempt counts from one through the configured maximum', () => {
    expect(isOtpAttemptCount(1)).toBe(true);
    expect(isOtpAttemptCount(MAX_OTP_ATTEMPTS)).toBe(true);
    for (const value of [0, -1, 1.5, MAX_OTP_ATTEMPTS + 1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isOtpAttemptCount(value)).toBe(false);
    }
  });

  it.each(OTP_CANCEL_REASONS)('accepts cancel reason %s', (reason) => {
    expect(isOtpCancelReason(reason)).toBe(true);
  });

  it('rejects arbitrary cancel reasons', () => {
    expect(isOtpCancelReason('provider_failure')).toBe(false);
  });
});
