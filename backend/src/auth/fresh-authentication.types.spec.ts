import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { UnixEpochSeconds, unixEpochSeconds } from './auth.types';
import {
  FRESH_AUTHENTICATION_VERIFICATION_METHODS,
  FreshAuthenticationEvidenceId,
  FreshAuthenticationEvidenceInput,
  createFreshAuthenticationEvidence,
  isFreshAuthenticationEvidence,
  isFreshAuthenticationEvidenceValidAt,
  isFreshAuthenticationVerificationMethod,
} from './fresh-authentication.types';
import { SessionId } from './session.types';

const ACCOUNT_ID = deterministicUuid('account-1') as AccountId;
const SESSION_ID = deterministicUuid('session-1') as SessionId;
const EVIDENCE_ID = deterministicUuid(
  'evidence-1',
) as FreshAuthenticationEvidenceId;
const AUTHENTICATED_AT = unixEpochSeconds(1_784_635_200);
const EXPIRES_AT = unixEpochSeconds(1_784_635_500);

function evidenceInput(
  overrides: Partial<FreshAuthenticationEvidenceInput> = {},
): FreshAuthenticationEvidenceInput {
  return {
    evidenceId: EVIDENCE_ID,
    accountId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    verificationMethod: 'external_identity',
    authenticatedAt: AUTHENTICATED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

describe('fresh authentication evidence', () => {
  it.each(FRESH_AUTHENTICATION_VERIFICATION_METHODS)(
    'creates immutable evidence for %s',
    (verificationMethod) => {
      const result = createFreshAuthenticationEvidence(
        evidenceInput({ verificationMethod }),
      );

      expect(result).toEqual({
        outcome: 'created',
        evidence: {
          evidenceId: EVIDENCE_ID,
          accountId: ACCOUNT_ID,
          sessionId: SESSION_ID,
          verificationMethod,
          authenticatedAt: AUTHENTICATED_AT,
          expiresAt: EXPIRES_AT,
        },
      });
      if (result.outcome === 'created') {
        expect(Object.isFrozen(result.evidence)).toBe(true);
        expect(isFreshAuthenticationEvidence(result.evidence)).toBe(true);
      }
    },
  );

  it('keeps verification methods closed', () => {
    expect(FRESH_AUTHENTICATION_VERIFICATION_METHODS).toEqual([
      'external_identity',
      'otp',
      'admin_totp',
    ]);
    expect(isFreshAuthenticationVerificationMethod('external_identity')).toBe(
      true,
    );
    expect(isFreshAuthenticationVerificationMethod('telegram')).toBe(false);
  });

  it.each([
    ['evidenceId', '', 'invalid_evidence_id'],
    ['accountId', ' padded ', 'invalid_account_id'],
    ['sessionId', 'session\n1', 'invalid_session_id'],
    ['verificationMethod', 'telegram', 'invalid_verification_method'],
  ] as const)(
    'rejects invalid %s without exposing its value',
    (field, value, evidenceReason) => {
      const result = createFreshAuthenticationEvidence(
        evidenceInput({ [field]: value } as Partial<FreshAuthenticationEvidenceInput>),
      );

      expect(result).toEqual({
        outcome: 'rejected',
        reason: 'invalid_fresh_authentication_evidence',
        evidenceReason,
      });
    },
  );

  it.each([
    ['authenticatedAt', Number.NaN, 'invalid_authenticated_at'],
    ['authenticatedAt', Number.POSITIVE_INFINITY, 'invalid_authenticated_at'],
    ['authenticatedAt', -1, 'invalid_authenticated_at'],
    ['authenticatedAt', AUTHENTICATED_AT + 0.5, 'invalid_authenticated_at'],
    ['expiresAt', Number.NaN, 'invalid_expires_at'],
    ['expiresAt', Number.POSITIVE_INFINITY, 'invalid_expires_at'],
    ['expiresAt', -1, 'invalid_expires_at'],
    ['expiresAt', EXPIRES_AT + 0.5, 'invalid_expires_at'],
  ] as const)(
    'rejects invalid time %s=%p',
    (field, value, evidenceReason) => {
      const result = createFreshAuthenticationEvidence(
        evidenceInput({
          [field]: value as UnixEpochSeconds,
        } as Partial<FreshAuthenticationEvidenceInput>),
      );

      expect(result).toEqual({
        outcome: 'rejected',
        reason: 'invalid_fresh_authentication_evidence',
        evidenceReason,
      });
    },
  );

  it.each([
    [EXPIRES_AT, EXPIRES_AT],
    [EXPIRES_AT, AUTHENTICATED_AT],
  ])('rejects evidence window %p..%p', (authenticatedAt, expiresAt) => {
    expect(
      createFreshAuthenticationEvidence(
        evidenceInput({ authenticatedAt, expiresAt }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_fresh_authentication_evidence',
      evidenceReason: 'invalid_evidence_window',
    });
  });

  it('uses an exclusive expiry boundary', () => {
    const result = createFreshAuthenticationEvidence(evidenceInput());
    if (result.outcome !== 'created') {
      throw new Error('Expected valid evidence');
    }

    expect(
      isFreshAuthenticationEvidenceValidAt(
        result.evidence,
        unixEpochSeconds(EXPIRES_AT - 1),
      ),
    ).toBe(true);
    expect(isFreshAuthenticationEvidenceValidAt(result.evidence, EXPIRES_AT)).toBe(
      false,
    );
    expect(
      isFreshAuthenticationEvidenceValidAt(
        result.evidence,
        unixEpochSeconds(EXPIRES_AT + 1),
      ),
    ).toBe(false);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative time', -1],
    ['fractional time', EXPIRES_AT - 0.5],
  ] as const)('rejects invalid validity time %s', (_description, now) => {
    const result = createFreshAuthenticationEvidence(evidenceInput());
    if (result.outcome !== 'created') {
      throw new Error('Expected valid evidence');
    }

    expect(isFreshAuthenticationEvidenceValidAt(result.evidence, now)).toBe(
      false,
    );
  });

  it('projects safe fields and does not retain mutable input', () => {
    const mutableInput = {
      ...evidenceInput(),
      rawProof: 'raw-proof',
      telegramInitData: 'init-data',
      otpCode: '123456',
      rawToken: 'raw-token',
      personalData: { name: 'Test' },
    };
    const result = createFreshAuthenticationEvidence(mutableInput);
    if (result.outcome !== 'created') {
      throw new Error('Expected valid evidence');
    }

    mutableInput.accountId = deterministicUuid('account-2') as AccountId;
    mutableInput.sessionId = deterministicUuid('session-2') as SessionId;
    mutableInput.personalData.name = 'Changed';

    expect(result.evidence.accountId).toBe(ACCOUNT_ID);
    expect(result.evidence.sessionId).toBe(SESSION_ID);
    for (const field of [
      'rawProof',
      'telegramInitData',
      'otpCode',
      'rawToken',
      'personalData',
    ]) {
      expect(result.evidence).not.toHaveProperty(field);
    }
  });
});
