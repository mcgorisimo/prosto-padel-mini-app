import { deterministicUuid } from '../../test/deterministic-uuid';
import { aggregateCommandSequence } from './aggregate-command-sequence';
import { unixEpochSeconds } from './auth.types';
import {
  SESSION_REVOKE_REASONS,
  SessionCommandId,
  SessionCommandPersistenceRecord,
  SessionId,
  SessionRequestDigest,
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

  it('validates UUID session-family, command and account IDs at runtime', () => {
    for (const guard of [isSessionId, isSessionCommandId, isSessionAccountId]) {
      expect(guard(deterministicUuid('session-id'))).toBe(true);
      expect(guard('safe-value')).toBe(false);
      expect(guard('')).toBe(false);
      expect(guard(' padded ')).toBe(false);
      expect(guard('control\nvalue')).toBe(false);
      expect(guard('x'.repeat(257))).toBe(false);
    }
  });

  it('keeps request digests as bounded opaque values', () => {
    expect(isSessionRequestDigest('safe-value')).toBe(true);
    expect(isSessionRequestDigest(' padded ')).toBe(false);
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

  it('keeps terminal persistence records free of credential references', () => {
    const record: SessionCommandPersistenceRecord = {
      sessionId: deterministicUuid('session') as SessionId,
      commandId: deterministicUuid('session-command') as SessionCommandId,
      commandSequence: aggregateCommandSequence(1),
      commandType: 'expire_session',
      requestDigest: 'safe-request-digest' as SessionRequestDigest,
      appliedAt: unixEpochSeconds(1_784_635_500),
      result: {
        type: 'session_expired',
        expiration: {
          expiredAt: unixEpochSeconds(1_784_635_500),
          commandId: deterministicUuid(
            'session-command',
          ) as SessionCommandId,
        },
      },
    };

    expect(record).not.toHaveProperty('presentedCredential');
    expect(record).not.toHaveProperty('nextCredential');
    expect(record).not.toHaveProperty('credential');
  });
});
