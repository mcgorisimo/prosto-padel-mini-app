import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  CONTACT_VERIFICATION_ABUSE_SCOPES,
  DEFAULT_CONTACT_VERIFICATION_POLICY,
  CONTACT_VERIFICATION_FIELDS,
  CONTACT_VERIFICATION_METHODS,
  ContactCheckoutEligibility,
  ContactCheckoutVerificationSnapshot,
  ContactVerificationAbuseScope,
  ContactVerificationAuditEvent,
  ContactVerificationChallengeId,
  ContactVerificationDeliveryPort,
  ContactVerificationDeliveryRequest,
  ContactVerificationRateLimitPort,
  ContactVerificationRateLimitRequest,
  ContactVerificationSourceDigest,
  EmailContactVerificationState,
  PhoneContactVerificationState,
  contactVerificationIdempotencyKey,
  contactVerificationRequestDigest,
  contactVerificationSourceDigest,
  contactVerificationSubjectDigest,
  createContactVerificationAuditEvent,
  evaluateContactCheckoutEligibility,
  isContactVerificationSourceDigest,
  newContactVerificationChallengeId,
  newContactVerificationCommandId,
} from './contact-verification.contracts';

const ACCOUNT_ID = deterministicUuid('contact-account') as AccountId;
const CHALLENGE_ID = deterministicUuid(
  'contact-challenge',
) as ContactVerificationChallengeId;
const NOW = unixEpochSeconds(1_787_500_000);
const EXPIRES_AT = unixEpochSeconds(1_787_500_300);

describe('contact verification provider-neutral contracts', () => {
  it('keeps phone and email fields separate from their allowed methods', () => {
    expect(CONTACT_VERIFICATION_FIELDS).toEqual(['phone', 'email']);
    expect(CONTACT_VERIFICATION_METHODS).toEqual([
      'phone_sms_otp',
      'email_code',
      'email_link',
    ]);
    expect(Object.isFrozen(CONTACT_VERIFICATION_FIELDS)).toBe(true);
    expect(Object.isFrozen(CONTACT_VERIFICATION_METHODS)).toBe(true);
  });

  it('defines account, contact and network abuse scopes', () => {
    const scopes: readonly ContactVerificationAbuseScope[] =
      CONTACT_VERIFICATION_ABUSE_SCOPES;
    expect(CONTACT_VERIFICATION_ABUSE_SCOPES).toEqual([
      'account',
      'contact',
      'network',
    ]);
    expect(scopes).toHaveLength(3);
    expect(Object.isFrozen(CONTACT_VERIFICATION_ABUSE_SCOPES)).toBe(true);
  });

  it('pins bounded provider-neutral expiry, attempt and resend budgets', () => {
    expect(DEFAULT_CONTACT_VERIFICATION_POLICY).toEqual({
      phone_sms_otp: { ttlSeconds: 600, maxAttempts: 5 },
      email_code: { ttlSeconds: 600, maxAttempts: 5 },
      email_link: { ttlSeconds: 900, maxAttempts: 5 },
      resendCooldownSeconds: 60,
      startsPer15Minutes: 3,
      startsPer24Hours: 10,
    });
    expect(Object.isFrozen(DEFAULT_CONTACT_VERIFICATION_POLICY)).toBe(true);
  });

  it('accepts bounded opaque idempotency keys and only protected digests', () => {
    expect(contactVerificationIdempotencyKey('request-1')).toBe('request-1');
    expect(contactVerificationRequestDigest('a'.repeat(64))).toBe(
      'a'.repeat(64),
    );
    expect(contactVerificationSubjectDigest('b'.repeat(64))).toBe(
      'b'.repeat(64),
    );
    expect(contactVerificationSourceDigest('c'.repeat(64))).toBe(
      'c'.repeat(64),
    );
    expect(isContactVerificationSourceDigest('c'.repeat(64))).toBe(true);

    for (const invalid of ['', ' padded ', 'line\nbreak']) {
      expect(() => contactVerificationIdempotencyKey(invalid)).toThrow(
        TypeError,
      );
    }
    for (const invalid of ['short', 'A'.repeat(64), 'g'.repeat(64)]) {
      expect(() => contactVerificationRequestDigest(invalid)).toThrow(
        TypeError,
      );
      expect(() => contactVerificationSubjectDigest(invalid)).toThrow(
        TypeError,
      );
      expect(() => contactVerificationSourceDigest(invalid)).toThrow(TypeError);
    }
  });

  it('generates canonical internal challenge and command IDs', () => {
    expect(newContactVerificationChallengeId()).toMatch(/^[0-9a-f-]{36}$/u);
    expect(newContactVerificationCommandId()).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('keeps delivery secrets transient and method-specific', async () => {
    const received: ContactVerificationDeliveryRequest[] = [];
    const port: ContactVerificationDeliveryPort = {
      deliver: async (request) => {
        received.push({ ...request });
        return { outcome: 'accepted' };
      },
    };
    const requests: readonly ContactVerificationDeliveryRequest[] = [
      {
        method: 'phone_sms_otp',
        challengeId: CHALLENGE_ID,
        dispatchId: deterministicUuid('phone-dispatch'),
        destination: '+79990000000',
        plaintextCode: '123456',
        expiresAt: EXPIRES_AT,
      },
      {
        method: 'email_code',
        challengeId: CHALLENGE_ID,
        dispatchId: deterministicUuid('email-code-dispatch'),
        destination: 'player@example.com',
        plaintextCode: '654321',
        expiresAt: EXPIRES_AT,
      },
      {
        method: 'email_link',
        challengeId: CHALLENGE_ID,
        dispatchId: deterministicUuid('email-link-dispatch'),
        destination: 'player@example.com',
        singleUseToken: 'opaque-random-token',
        expiresAt: EXPIRES_AT,
      },
    ];

    for (const request of requests) {
      await expect(port.deliver(request)).resolves.toEqual({
        outcome: 'accepted',
      });
    }
    expect(received.map(({ method }) => method)).toEqual([
      'phone_sms_otp',
      'email_code',
      'email_link',
    ]);
  });

  it('requires one atomic scoped abuse decision for start and resend', async () => {
    const sourceDigest: ContactVerificationSourceDigest =
      contactVerificationSourceDigest('e'.repeat(64));
    const common = {
      accountId: ACCOUNT_ID,
      field: 'phone' as const,
      method: 'phone_sms_otp' as const,
      contactValueDigest: contactVerificationSubjectDigest('d'.repeat(64)),
      sourceDigest,
      now: NOW,
      requiredScopes: CONTACT_VERIFICATION_ABUSE_SCOPES,
    };
    const requests: readonly ContactVerificationRateLimitRequest[] = [
      { ...common, operation: 'start' },
      { ...common, operation: 'resend', challengeId: CHALLENGE_ID },
    ];
    const port: ContactVerificationRateLimitPort = {
      consume: async () => ({
        outcome: 'allowed',
        decisionId: deterministicUuid('rate-decision'),
        checkedAt: NOW,
      }),
    };

    for (const request of requests) {
      await expect(port.consume(request)).resolves.toMatchObject({
        outcome: 'allowed',
        checkedAt: NOW,
      });
      expect(request.requiredScopes).toEqual(['account', 'contact', 'network']);
    }
    expect(requests[1]).toMatchObject({
      operation: 'resend',
      challengeId: CHALLENGE_ID,
    });
  });

  it('creates an allowlisted PII-safe audit event', () => {
    const event: ContactVerificationAuditEvent =
      createContactVerificationAuditEvent({
        eventId: deterministicUuid('contact-audit'),
        eventType: 'challenge_transition',
        occurredAt: NOW,
        accountId: ACCOUNT_ID,
        challengeId: CHALLENGE_ID,
        field: 'email',
        method: 'email_link',
        outcome: 'verified',
      });

    expect(event).toEqual({
      eventId: deterministicUuid('contact-audit'),
      eventType: 'challenge_transition',
      occurredAt: NOW,
      accountId: ACCOUNT_ID,
      challengeId: CHALLENGE_ID,
      field: 'email',
      method: 'email_link',
      outcome: 'verified',
    });
    for (const forbidden of [
      'destination',
      'contactValueDigest',
      'sourceDigest',
      'verifierDigest',
      'idempotencyKey',
      'provider',
      'rawResponse',
    ]) {
      expect(event).not.toHaveProperty(forbidden);
    }
  });

  it('allowlists a PII-safe resend reservation audit outcome', () => {
    expect(
      createContactVerificationAuditEvent({
        eventId: deterministicUuid('resend-reserved-audit'),
        eventType: 'challenge_transition',
        occurredAt: NOW,
        accountId: ACCOUNT_ID,
        challengeId: CHALLENGE_ID,
        field: 'phone',
        method: 'phone_sms_otp',
        outcome: 'resend_reserved',
      }),
    ).toMatchObject({ outcome: 'resend_reserved' });
  });

  it('rejects extra audit metadata instead of copying PII or provider data', () => {
    expect(() =>
      createContactVerificationAuditEvent({
        eventId: deterministicUuid('unsafe-contact-audit'),
        eventType: 'challenge_transition',
        occurredAt: NOW,
        accountId: ACCOUNT_ID,
        challengeId: CHALLENGE_ID,
        field: 'phone',
        method: 'phone_sms_otp',
        outcome: 'rate_limited',
        destination: '+79990000000',
      }),
    ).toThrow('Contact verification audit event is invalid');
  });

  it('keeps app access independent while checkout requires both current contact proofs', () => {
    const phone: PhoneContactVerificationState = {
      field: 'phone',
      status: 'unverified',
      contactVersion: 2,
    };
    const email: EmailContactVerificationState = {
      field: 'email',
      status: 'pending',
      contactVersion: 4,
    };
    const snapshot: ContactCheckoutVerificationSnapshot = {
      accountId: ACCOUNT_ID,
      phone,
      email,
    };
    const notReady: ContactCheckoutEligibility =
      evaluateContactCheckoutEligibility(snapshot);
    expect(notReady).toEqual({
      eligible: false,
      reason: 'contacts_not_verified',
      missing: ['phone', 'email'],
    });

    const ready = evaluateContactCheckoutEligibility({
      accountId: ACCOUNT_ID,
      phone: {
        field: 'phone',
        status: 'verified',
        contactVersion: 2,
        verifiedVersion: 2,
        method: 'phone_sms_otp',
        verifiedAt: NOW,
      },
      email: {
        field: 'email',
        status: 'verified',
        contactVersion: 4,
        verifiedVersion: 4,
        method: 'email_link',
        verifiedAt: NOW,
      },
    });
    expect(ready).toEqual({ eligible: true });
  });

  it('fails checkout closed when a proof belongs to an old contact version', () => {
    expect(
      evaluateContactCheckoutEligibility({
        accountId: ACCOUNT_ID,
        phone: {
          field: 'phone',
          status: 'verified',
          contactVersion: 3,
          verifiedVersion: 2,
          method: 'phone_sms_otp',
          verifiedAt: NOW,
        },
        email: {
          field: 'email',
          status: 'verified',
          contactVersion: 1,
          verifiedVersion: 1,
          method: 'email_code',
          verifiedAt: NOW,
        },
      }),
    ).toEqual({
      eligible: false,
      reason: 'contacts_not_verified',
      missing: ['phone'],
    });
  });
});
