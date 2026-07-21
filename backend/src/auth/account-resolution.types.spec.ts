import { AccountId } from '../accounts/account.types';
import {
  ExternalIdentityKey,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  ExistingAccountResolution,
  NewAccountRequiredResolution,
  accountResolutionConflict,
  isValidAccountResolutionOutcome,
  newAccountRequired,
  resolveExistingAccountStatus,
} from './account-resolution.types';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001' as AccountId;

function identityKey(
  provider: ExternalIdentityKey['provider'] = 'telegram',
  namespace = 'telegram:bot:123',
  subject = '123456789',
): ExternalIdentityKey {
  return {
    provider,
    namespace: externalIdentityNamespace(namespace),
    lookup: {
      kind: 'canonical_subject',
      subject: trustProviderCanonicalizedExternalIdentitySubject(subject),
    },
  };
}

describe('account resolution contracts', () => {
  it('resolves an active existing account', () => {
    const resolution = resolveExistingAccountStatus(
      identityKey(),
      ACCOUNT_ID,
      'active',
    );

    expect(resolution).toMatchObject({
      type: 'existing_account',
      accountId: ACCOUNT_ID,
      accountStatus: 'active',
    });
  });

  it('requires an AccountId for an existing account outcome', () => {
    // @ts-expect-error Existing accounts cannot omit their branded AccountId.
    const resolution: ExistingAccountResolution = {
      type: 'existing_account',
      accountStatus: 'active',
      identityKey: identityKey(),
    };

    expect(resolution).not.toHaveProperty('accountId');
  });

  it('requires future player account creation without inventing an AccountId', () => {
    const resolution = newAccountRequired(identityKey());

    expect(resolution).toMatchObject({
      type: 'new_account_required',
      accountDraft: { initialRole: 'player' },
    });
    expect(resolution).not.toHaveProperty('accountId');
  });

  it('does not allow an AccountId on new account required', () => {
    const key = identityKey();
    const resolution: NewAccountRequiredResolution = {
      type: 'new_account_required',
      identityKey: key,
      accountDraft: { initialRole: 'player' },
      // @ts-expect-error A not-yet-created account has no AccountId.
      accountId: ACCOUNT_ID,
    };

    expect(resolution).toHaveProperty('accountId', ACCOUNT_ID);
  });

  it('does not allow a club admin role in a new account draft', () => {
    const resolution: NewAccountRequiredResolution = {
      type: 'new_account_required',
      identityKey: identityKey(),
      accountDraft: {
        // @ts-expect-error New account resolution is restricted to player.
        initialRole: 'club_admin',
      },
    };

    expect(isValidAccountResolutionOutcome(resolution)).toBe(false);
  });

  it('maps a blocked account to a safe blocked outcome', () => {
    const resolution = resolveExistingAccountStatus(
      identityKey(),
      ACCOUNT_ID,
      'blocked',
    );

    expect(resolution).toMatchObject({
      type: 'blocked',
      reason: 'account_blocked',
      accountId: ACCOUNT_ID,
      accountStatus: 'blocked',
    });
  });

  it('does not grant access to a pending-deletion account', () => {
    const resolution = resolveExistingAccountStatus(
      identityKey(),
      ACCOUNT_ID,
      'pending_deletion',
    );

    expect(resolution).toMatchObject({
      type: 'blocked',
      reason: 'account_pending_deletion',
      accountStatus: 'pending_deletion',
    });
  });

  it('does not resolve an anonymized account as active', () => {
    const resolution = resolveExistingAccountStatus(
      identityKey(),
      ACCOUNT_ID,
      'anonymized',
    );

    expect(resolution).toEqual({
      type: 'conflict',
      reason: 'account_anonymized',
      identityKey: identityKey(),
    });
    expect(resolution).not.toHaveProperty('accountId');
  });

  it('returns conflict without selecting an account for ambiguous resolution', () => {
    const resolution = accountResolutionConflict(
      identityKey(),
      'ambiguous_account_resolution',
    );

    expect(resolution).toMatchObject({
      type: 'conflict',
      reason: 'ambiguous_account_resolution',
    });
    expect(resolution).not.toHaveProperty('accountId');
  });

  it('returns conflict for incompatible identity linking', () => {
    expect(
      accountResolutionConflict(
        identityKey(),
        'identity_already_linked_incompatibly',
      ),
    ).toMatchObject({
      type: 'conflict',
      reason: 'identity_already_linked_incompatibly',
    });
  });

  it('rejects invalid runtime inputs in account-resolution factories', () => {
    expect(() =>
      resolveExistingAccountStatus(
        identityKey(),
        '' as AccountId,
        'active',
      ),
    ).toThrow(TypeError);
    expect(() =>
      accountResolutionConflict(
        identityKey(),
        'database_conflict' as never,
      ),
    ).toThrow(TypeError);
  });

  it('rejects undeclared sensitive fields on a conflict outcome', () => {
    const outcome = {
      type: 'conflict',
      reason: 'ambiguous_account_resolution',
      identityKey: identityKey(),
      accountIds: [ACCOUNT_ID],
    };

    expect(isValidAccountResolutionOutcome(outcome)).toBe(false);
  });

  it('preserves provider and namespace in every outcome', () => {
    const key = identityKey('google', 'google:client:456', 'google-subject');
    const outcomes = [
      resolveExistingAccountStatus(key, ACCOUNT_ID, 'active'),
      newAccountRequired(key),
      resolveExistingAccountStatus(key, ACCOUNT_ID, 'blocked'),
      accountResolutionConflict(key, 'intent_incompatible_with_current_binding'),
    ];

    for (const outcome of outcomes) {
      expect(outcome.identityKey.provider).toBe('google');
      expect(outcome.identityKey.namespace).toBe('google:client:456');
    }
  });
});
