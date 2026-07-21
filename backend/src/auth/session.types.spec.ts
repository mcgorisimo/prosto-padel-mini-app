import {
  SESSION_REVOKE_REASONS,
  isSessionAccountId,
  isSessionCommandId,
  isSessionCredentialDigest,
  isSessionCredentialGeneration,
  isSessionId,
  isSessionRequestDigest,
  isSessionRevokeReason,
} from './session.types';

describe('session contracts', () => {
  it('defines a closed provider-neutral revoke reason union', () => {
    expect(SESSION_REVOKE_REASONS).toEqual([
      'user_sign_out',
      'administrator',
      'account_blocked',
      'security_event',
      'superseded',
    ]);
    expect(Object.isFrozen(SESSION_REVOKE_REASONS)).toBe(true);
    expect(isSessionRevokeReason('security_event')).toBe(true);
    expect(isSessionRevokeReason('database_error')).toBe(false);
  });

  it('validates opaque session identifiers at runtime', () => {
    const guards = [
      isSessionId,
      isSessionCommandId,
      isSessionRequestDigest,
      isSessionAccountId,
    ];

    for (const guard of guards) {
      expect(guard('safe-value')).toBe(true);
      expect(guard('')).toBe(false);
      expect(guard(' padded ')).toBe(false);
      expect(guard('control\nvalue')).toBe(false);
      expect(guard('x'.repeat(257))).toBe(false);
    }
  });

  it('accepts only a lowercase SHA-256 credential digest', () => {
    expect(isSessionCredentialDigest('a'.repeat(64))).toBe(true);
    expect(isSessionCredentialDigest('A'.repeat(64))).toBe(false);
    expect(isSessionCredentialDigest('a'.repeat(63))).toBe(false);
    expect(isSessionCredentialDigest('not-a-digest')).toBe(false);
  });

  it('accepts only positive safe-integer credential generations', () => {
    expect(isSessionCredentialGeneration(1)).toBe(true);
    expect(isSessionCredentialGeneration(Number.MAX_SAFE_INTEGER)).toBe(true);

    for (const invalid of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(isSessionCredentialGeneration(invalid)).toBe(false);
    }
  });
});
