import { AccountId } from '../accounts/account.types';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  ExternalIdentityReference,
} from '../accounts/external-identity.types';
import {
  AUTHENTICATION_INTENTS,
  AdminStepUpState,
  AuthenticatedPrincipal,
  SessionMetadata,
  VerifiedExternalIdentity,
  VerifiedTelegramIdentity,
  isUnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';

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
      'link_identity',
      'fresh_authentication',
      'manual_recovery',
      'identity_transfer',
      'account_deletion',
    ]);
    expect(Object.isFrozen(AUTHENTICATION_INTENTS)).toBe(true);
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
    const principal: AuthenticatedPrincipal = {
      accountId: '00000000-0000-4000-8000-000000000001' as AccountId,
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

    expect(principal.accountId).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
  });
});
