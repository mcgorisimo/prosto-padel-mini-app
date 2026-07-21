import { AccountId } from '../accounts/account.types';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  ExternalIdentityReference,
} from '../accounts/external-identity.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  AUTHENTICATION_INTENTS,
  AdminStepUpState,
  AuthenticatedPrincipal,
  SessionMetadata,
  VerifiedExternalIdentity,
  VerifiedTelegramIdentity,
  isAuthenticationCommandId,
  isAuthenticationIdempotencyKey,
  isAuthenticationIntent,
  isAuthenticationOperationId,
  isAuthenticationProofReference,
  isAuthenticationProofFingerprint,
  isAuthenticationRequestDigest,
  isUnixEpochSeconds,
  otpAuthenticationProofReference,
  telegramAuthenticationProofReference,
  unixEpochSeconds,
} from './auth.types';
import { OtpChallengeId } from './otp.types';

describe('authentication contracts', () => {
  const issuedAt = new Date('2026-01-01T10:00:00.000Z');
  const expiresAt = new Date('2026-01-01T11:00:00.000Z');

  it('defines all provider-neutral external identity providers', () => {
    expect(EXTERNAL_IDENTITY_PROVIDERS).toEqual([
      'telegram',
      'apple',
      'google',
      'phone',
    ]);
    expect(Object.isFrozen(EXTERNAL_IDENTITY_PROVIDERS)).toBe(true);
  });

  it('defines provider-neutral authentication intents', () => {
    expect(AUTHENTICATION_INTENTS).toEqual([
      'sign_in',
      'sign_up',
      'link_identity',
      'fresh_authentication',
      'account_recovery',
    ]);
    expect(Object.isFrozen(AUTHENTICATION_INTENTS)).toBe(true);
  });

  it('does not accept arbitrary strings as authentication intents', () => {
    type AuthenticationIntent = (typeof AUTHENTICATION_INTENTS)[number];

    // @ts-expect-error Authentication intents are a closed provider-neutral union.
    const intent: AuthenticationIntent = 'telegram_login_button';
    expect(AUTHENTICATION_INTENTS).not.toContain(intent);
    expect(isAuthenticationIntent('sign_in')).toBe(true);
    expect(isAuthenticationIntent('telegram_login_button')).toBe(false);
  });

  it('validates UUID authentication aggregate and command IDs at runtime', () => {
    for (const guard of [isAuthenticationOperationId, isAuthenticationCommandId]) {
      expect(guard(deterministicUuid('authentication-id'))).toBe(true);
      expect(guard('safe-value')).toBe(false);
      expect(guard('')).toBe(false);
      expect(guard(' padded ')).toBe(false);
      expect(guard('control\nvalue')).toBe(false);
      expect(guard('x'.repeat(257))).toBe(false);
    }
  });

  it('keeps idempotency keys and request digests as bounded opaque values', () => {
    for (const guard of [
      isAuthenticationIdempotencyKey,
      isAuthenticationRequestDigest,
    ]) {
      expect(guard('safe-value')).toBe(true);
      expect(guard('')).toBe(false);
      expect(guard(' padded ')).toBe(false);
    }
  });

  it('creates closed Telegram and OTP proof references', () => {
    const telegram = telegramAuthenticationProofReference(
      'a'.repeat(64) as never,
    );
    const otp = otpAuthenticationProofReference(
      deterministicUuid('otp-challenge') as OtpChallengeId,
    );

    expect(isAuthenticationProofReference(telegram)).toBe(true);
    expect(isAuthenticationProofReference(otp)).toBe(true);
    expect(
      isAuthenticationProofReference({
        type: 'otp_challenge',
        challengeId: 'otp-challenge',
      }),
    ).toBe(false);
  });

  it('accepts only a lowercase SHA-256 proof fingerprint', () => {
    expect(isAuthenticationProofFingerprint('a'.repeat(64))).toBe(true);
    expect(isAuthenticationProofFingerprint('A'.repeat(64))).toBe(false);
    expect(isAuthenticationProofFingerprint('a'.repeat(63))).toBe(false);
    expect(isAuthenticationProofFingerprint('proof-fingerprint')).toBe(false);
  });

  it('accepts only finite non-negative integer Unix epoch seconds', () => {
    expect(unixEpochSeconds(1_784_635_200)).toBe(1_784_635_200);
    expect(isUnixEpochSeconds(1_784_635_200)).toBe(true);

    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(isUnixEpochSeconds(invalid)).toBe(false);
      expect(() => unixEpochSeconds(invalid)).toThrow(TypeError);
    }
  });

  it('supports provider-neutral external identity references', () => {
    const reference: ExternalIdentityReference = {
      provider: 'phone',
      subject: 'normalized-subject-format-to-be-defined',
    };

    expect(reference.provider).toBe('phone');
  });

  it('represents a verified Telegram identity without an account ID', () => {
    const identity: VerifiedTelegramIdentity = {
      provider: 'telegram',
      subject: '123456789',
      authDate: issuedAt,
      verifiedAt: issuedAt,
      firstName: 'Test',
      username: 'test_user',
    };
    const externalIdentity: VerifiedExternalIdentity = identity;

    expect(externalIdentity.provider).toBe('telegram');
  });

  it('keeps session metadata independent from its transport', () => {
    const telegramSession: SessionMetadata = {
      sessionId: 'telegram-test-session',
      issuedAt,
      expiresAt,
      authProvider: 'telegram',
      externalIdentitySubject: '123456789',
    };
    const futureProviderSession: SessionMetadata = {
      sessionId: 'future-provider-test-session',
      issuedAt,
      expiresAt,
      authProvider: 'google',
      externalIdentitySubject: 'future-provider-subject',
    };

    expect(telegramSession.authProvider).toBe('telegram');
    expect(futureProviderSession.authProvider).toBe('google');
  });

  it('represents both admin step-up states', () => {
    const notVerified: AdminStepUpState = { status: 'not_verified' };
    const verified: AdminStepUpState = {
      status: 'verified',
      method: 'totp',
      verifiedAt: issuedAt,
      expiresAt,
    };

    expect(notVerified.status).toBe('not_verified');
    expect(verified.status).toBe('verified');
  });

  it('identifies an authenticated principal by its internal account ID', () => {
    const accountId = deterministicUuid('principal-account') as AccountId;
    const principal: AuthenticatedPrincipal = {
      accountId,
      role: 'club_admin',
      accountStatus: 'active',
      session: {
        sessionId: 'principal-test-session',
        issuedAt,
        expiresAt,
        authProvider: 'telegram',
        externalIdentitySubject: '123456789',
      },
      adminStepUp: { status: 'not_verified' },
    };

    expect(principal.accountId).toBe(accountId);
  });
});
