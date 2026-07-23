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
import { AuthenticationOperationId, unixEpochSeconds } from './auth.types';

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

  it('supports either an existing or attempted operation for Telegram proof audit', () => {
    const operationId = deterministicUuid(
      'audit-existing-operation',
    ) as AuthenticationOperationId;
    const attemptedOperationId = deterministicUuid(
      'audit-attempted-operation',
    ) as AuthenticationOperationId;

    expect(
      createSecurityAuditMetadata('telegram_proof_consumption', {
        operationId,
      }),
    ).toEqual({ operationId });
    expect(
      createSecurityAuditMetadata('telegram_proof_consumption', {
        attemptedOperationId,
      }),
    ).toEqual({ attemptedOperationId });
  });

  it('requires exactly one Telegram proof operation reference', () => {
    const operationId = deterministicUuid(
      'audit-existing-operation',
    ) as AuthenticationOperationId;
    const attemptedOperationId = deterministicUuid(
      'audit-attempted-operation',
    ) as AuthenticationOperationId;

    expect(() => {
      // @ts-expect-error Existing and attempted operation references are exclusive.
      createSecurityAuditMetadata('telegram_proof_consumption', {
        operationId,
        attemptedOperationId,
      });
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error Explicit undefined still means the conflicting key is present.
      createSecurityAuditMetadata('telegram_proof_consumption', {
        operationId,
        attemptedOperationId: undefined,
      });
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error A Telegram proof audit requires one operation reference.
      createSecurityAuditMetadata('telegram_proof_consumption', {});
    }).toThrow(TypeError);
  });

  it('does not expose attemptedOperationId to other audit event types', () => {
    const accountId = deterministicUuid('audit-account') as AccountId;
    const attemptedOperationId = deterministicUuid(
      'audit-attempted-operation',
    ) as AuthenticationOperationId;

    expect(() => {
      // @ts-expect-error attemptedOperationId belongs only to Telegram proof audit.
      createSecurityAuditMetadata('account_created', {
        accountId,
        role: 'player',
        attemptedOperationId,
      });
    }).toThrow(TypeError);
  });

  it.each([
    ['operationId', 'not-an-operation-id'],
    ['operationId', 123],
    ['attemptedOperationId', 'not-an-attempted-operation-id'],
    ['attemptedOperationId', { id: 'not-an-operation-id' }],
  ])('rejects invalid runtime value for %s', (field, value) => {
    expect(() =>
      createSecurityAuditMetadata('telegram_proof_consumption', {
        [field]: value,
      } as never),
    ).toThrow(new TypeError('Security audit metadata is invalid'));
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
