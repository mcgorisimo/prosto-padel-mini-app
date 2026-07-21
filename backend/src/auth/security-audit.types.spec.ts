import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  SECURITY_AUDIT_EVENT_TYPES,
  SECURITY_AUDIT_FORBIDDEN_VALUE_TYPES,
  SECURITY_AUDIT_OUTCOMES,
  SecurityAuditEventId,
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from './security-audit.types';
import { unixEpochSeconds } from './auth.types';

describe('security audit contracts', () => {
  it('keeps event types and outcomes closed', () => {
    expect(SECURITY_AUDIT_EVENT_TYPES).toEqual([
      'account_created',
      'account_status_changed',
      'external_identity_linked',
      'external_identity_unlinked',
      'external_identity_transfer_blocked',
      'authentication_operation_terminal',
      'telegram_proof_consumption',
      'otp_challenge_transition',
      'session_family_created',
      'session_family_transition',
      'session_credential_rotation',
      'fresh_authentication_issued',
      'reauthentication_grant_issued',
      'reauthentication_grant_transition',
      'persisted_auth_state_rejected',
    ]);
    expect(SECURITY_AUDIT_OUTCOMES).toEqual([
      'success',
      'idempotent_retry',
      'denied',
      'expired',
      'replay_detected',
      'conflict',
      'invalid_state',
      'dependency_failure',
    ]);
  });

  it('explicitly forbids secret and PII value categories', () => {
    expect(SECURITY_AUDIT_FORBIDDEN_VALUE_TYPES).toEqual([
      'telegram_subject',
      'phone',
      'raw_init_data',
      'otp',
      'session_credential',
      'lookup_digest',
      'credential_digest',
      'idempotency_key',
      'ciphertext',
      'name',
      'username',
      'photo_url',
      'pepper',
      'encryption_key',
    ]);
  });

  it('constructs only exact typed metadata and an immutable event', () => {
    const accountId = deterministicUuid('audit-account') as AccountId;
    const metadata = createSecurityAuditMetadata('account_created', {
      accountId,
      role: 'player',
    });
    const event = createSecurityAuditEvent({
      eventId: deterministicUuid('audit-event') as SecurityAuditEventId,
      eventType: 'account_created',
      outcome: 'success',
      occurredAt: unixEpochSeconds(1_784_635_200),
      metadata,
    });

    expect(event).toEqual({
      eventId: deterministicUuid('audit-event'),
      eventType: 'account_created',
      outcome: 'success',
      occurredAt: 1_784_635_200,
      metadata: { accountId, role: 'player' },
    });
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it.each([
    ['telegramSubject', '123456789'],
    ['phone', '+79990000000'],
    ['rawInitData', 'query_id=secret'],
    ['otp', '123456'],
    ['sessionCredential', 'secret'],
    ['lookupDigest', 'a'.repeat(64)],
    ['credentialDigest', 'b'.repeat(64)],
    ['idempotencyKey', 'key'],
    ['ciphertext', 'ciphertext'],
    ['name', 'Test'],
    ['username', 'test_user'],
    ['photoUrl', 'https://example.test/photo'],
    ['pepper', 'secret'],
    ['encryptionKey', 'secret'],
  ])('rejects forbidden metadata field %s', (field, value) => {
    expect(() =>
      createSecurityAuditMetadata('account_created', {
        accountId: deterministicUuid('audit-account') as AccountId,
        role: 'player',
        [field]: value,
      } as never),
    ).toThrow(TypeError);
  });
});
