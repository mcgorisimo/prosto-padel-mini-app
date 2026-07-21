import { deterministicUuid } from '../../test/deterministic-uuid';
import { aggregateCommandSequence } from './aggregate-command-sequence';
import { unixEpochSeconds } from './auth.types';
import {
  MAX_OTP_ATTEMPTS,
  OTP_CANCEL_REASONS,
  OtpChallengeId,
  OtpCommandId,
  OtpCommandPersistenceRecord,
  OtpRequestDigest,
  OtpVerifierDigest,
  isOtpAttemptCount,
  isOtpCancelReason,
  isOtpChallengeId,
  isOtpCommandId,
  isOtpRequestDigest,
  isOtpVerifierDigest,
} from './otp.types';

describe('OTP primitive contracts', () => {
  it.each([isOtpChallengeId, isOtpCommandId])(
    'accepts a canonical UUID',
    (guard) => {
      expect(guard(deterministicUuid('otp-value-1'))).toBe(true);
    },
  );

  it.each([isOtpChallengeId, isOtpCommandId])(
    'rejects non-UUID IDs',
    (guard) => {
      for (const value of ['', 'otp-value-1', ' padded', 'line\nbreak']) {
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

  it('stores only a protected digest for a submitted OTP', () => {
    const record: OtpCommandPersistenceRecord = {
      challengeId: deterministicUuid('otp-challenge') as OtpChallengeId,
      commandId: deterministicUuid('otp-command') as OtpCommandId,
      commandSequence: aggregateCommandSequence(1),
      commandType: 'submit_otp',
      requestDigest: 'a'.repeat(64) as OtpRequestDigest,
      appliedAt: unixEpochSeconds(1_784_635_200),
      presentedDigest: 'b'.repeat(64) as OtpVerifierDigest,
      result: { type: 'incorrect_code', attemptsRemaining: 2 },
    };

    expect(record.presentedDigest).toBe('b'.repeat(64));
    expect(record).not.toHaveProperty('otp');
    expect(record).not.toHaveProperty('destination');
  });
});
