import { AccountId } from './account.types';
import {
  ExternalIdentityId,
  ExternalIdentityLookupDigestAlias,
  ExternalIdentityState,
  UnlinkExternalIdentityTransitionContext,
  isLinkExternalIdentityCommand,
  isExternalIdentityState,
  isUnlinkExternalIdentityCommand,
  isUnlinkExternalIdentityTransitionContext,
  linkExternalIdentity,
  unlinkExternalIdentity,
} from './external-identity-lifecycle.types';
import {
  EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from './external-identity-lookup-digest.port';
import {
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from './external-identity.types';
import { deterministicUuid } from '../../test/deterministic-uuid';

const IDENTITY_ID = deterministicUuid('identity') as ExternalIdentityId;
const ACCOUNT_ID = deterministicUuid('account') as AccountId;
const OTHER_IDENTITY_ID = deterministicUuid(
  'other-identity',
) as ExternalIdentityId;
const WRONG_CONTEXT_IDENTITY_ID = deterministicUuid(
  'wrong-context-identity',
) as ExternalIdentityId;
const NAMESPACE = externalIdentityNamespace('telegram:bot:123');

function alias(
  digestVersion: number,
  pepperVersion: number,
  digestCharacter: string,
): ExternalIdentityLookupDigestAlias {
  return {
    identityId: IDENTITY_ID,
    algorithm: EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
    provider: 'telegram',
    namespace: NAMESPACE,
    digest: externalIdentityLookupDigest(digestCharacter.repeat(64)),
    digestVersion: externalIdentityLookupDigestVersion(digestVersion),
    pepperVersion:
      externalIdentityLookupDigestPepperVersion(pepperVersion),
  };
}

function linkedState(): ExternalIdentityState {
  return {
    identityId: IDENTITY_ID,
    accountId: ACCOUNT_ID,
    provider: 'telegram',
    namespace: NAMESPACE,
    lookupDigestAliases: [alias(1, 1, 'a'), alias(1, 2, 'b')],
    status: 'linked',
    isPrimary: true,
  };
}

function unlinkContext(
  overrides: Partial<UnlinkExternalIdentityTransitionContext> = {},
): UnlinkExternalIdentityTransitionContext {
  return {
    identityId: IDENTITY_ID,
    accountId: ACCOUNT_ID,
    hasOtherLinkedIdentity: true,
    replacementPrimaryIdentityId: OTHER_IDENTITY_ID,
    ...overrides,
  } as UnlinkExternalIdentityTransitionContext;
}

describe('external identity lifecycle contracts', () => {
  it('allows multiple versioned aliases without a canonical subject', () => {
    const state = linkedState();

    expect(isExternalIdentityState(state)).toBe(true);
    expect(state.lookupDigestAliases).toHaveLength(2);
    expect(state).not.toHaveProperty('subject');
    expect(state.lookupDigestAliases[0]).not.toHaveProperty('subject');
  });

  it('retains the historical owner across unlink and relink', () => {
    const initial = linkedState();
    const unlinked = unlinkExternalIdentity(initial, {
      identityId: IDENTITY_ID,
      accountId: ACCOUNT_ID,
    }, unlinkContext());

    expect(unlinked).toMatchObject({
      outcome: 'transitioned',
      state: { status: 'unlinked', accountId: ACCOUNT_ID, isPrimary: false },
    });
    const relinked = linkExternalIdentity(unlinked.state, {
      identityId: IDENTITY_ID,
      accountId: ACCOUNT_ID,
      makePrimary: false,
    });
    expect(relinked).toMatchObject({
      outcome: 'transitioned',
      state: { status: 'linked', accountId: ACCOUNT_ID },
    });
  });

  it('returns a typed refusal for another account', () => {
    const state = linkedState();
    const result = linkExternalIdentity(state, {
      identityId: IDENTITY_ID,
      accountId: deterministicUuid('other-account') as AccountId,
      makePrimary: false,
    });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'identity_historically_reserved_for_another_account',
      state,
    });
  });

  it('allows unlink only when another linked identity remains', () => {
    const result = unlinkExternalIdentity(
      linkedState(),
      { identityId: IDENTITY_ID, accountId: ACCOUNT_ID },
      unlinkContext(),
    );

    expect(result).toMatchObject({
      outcome: 'transitioned',
      state: {
        status: 'unlinked',
        accountId: ACCOUNT_ID,
        isPrimary: false,
      },
    });
    expect(isExternalIdentityState(result.state)).toBe(true);
  });

  it('rejects unlink of the last login method', () => {
    const state = linkedState();
    const result = unlinkExternalIdentity(
      state,
      { identityId: IDENTITY_ID, accountId: ACCOUNT_ID },
      unlinkContext({
        hasOtherLinkedIdentity: false,
        replacementPrimaryIdentityId: null,
      }),
    );

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'last_login_method_cannot_be_unlinked',
      state,
    });
  });

  it('rejects unlink context calculated for another account', () => {
    const state = linkedState();
    const result = unlinkExternalIdentity(
      state,
      { identityId: IDENTITY_ID, accountId: ACCOUNT_ID },
      unlinkContext({
        accountId: deterministicUuid('other-account') as AccountId,
      }),
    );

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'unlink_context_binding_conflict',
      state,
    });
  });

  it('rejects unlink context calculated for another identity', () => {
    const state = linkedState();
    const result = unlinkExternalIdentity(
      state,
      { identityId: IDENTITY_ID, accountId: ACCOUNT_ID },
      unlinkContext({ identityId: WRONG_CONTEXT_IDENTITY_ID }),
    );

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'unlink_context_binding_conflict',
      state,
    });
  });

  it('requires a replacement when unlinking the primary identity', () => {
    const state = linkedState();
    const result = unlinkExternalIdentity(
      state,
      { identityId: IDENTITY_ID, accountId: ACCOUNT_ID },
      unlinkContext({ replacementPrimaryIdentityId: null }),
    );

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'replacement_primary_identity_required',
      state,
    });
  });

  it('rejects the unlinked identity as its own primary replacement', () => {
    const state = linkedState();
    const context = unlinkContext({
      replacementPrimaryIdentityId: IDENTITY_ID,
    });
    const result = unlinkExternalIdentity(
      state,
      { identityId: IDENTITY_ID, accountId: ACCOUNT_ID },
      context,
    );

    expect(isUnlinkExternalIdentityTransitionContext(context)).toBe(false);
    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'invalid_unlink_transition_context',
      state,
    });
  });

  it.each([
    undefined,
    {},
    {
      identityId: IDENTITY_ID,
      accountId: ACCOUNT_ID,
      hasOtherLinkedIdentity: 'true',
      replacementPrimaryIdentityId: OTHER_IDENTITY_ID,
    },
    {
      ...unlinkContext(),
      unexpected: true,
    },
  ])('rejects missing or damaged unlink context %#', (context) => {
    const state = linkedState();
    const result = unlinkExternalIdentity(
      state,
      { identityId: IDENTITY_ID, accountId: ACCOUNT_ID },
      context as UnlinkExternalIdentityTransitionContext,
    );

    expect(isUnlinkExternalIdentityTransitionContext(context)).toBe(false);
    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'invalid_unlink_transition_context',
      state,
    });
  });

  it('keeps an unlinked identity reserved for its historical owner', () => {
    const initial = linkedState();
    const unlinked = unlinkExternalIdentity(
      initial,
      { identityId: IDENTITY_ID, accountId: ACCOUNT_ID },
      unlinkContext(),
    );
    const otherAccountId = deterministicUuid('other-account') as AccountId;
    const relink = linkExternalIdentity(unlinked.state, {
      identityId: IDENTITY_ID,
      accountId: otherAccountId,
      makePrimary: false,
    });

    expect(unlinked.state.accountId).toBe(ACCOUNT_ID);
    expect(relink).toEqual({
      outcome: 'rejected',
      reason: 'identity_historically_reserved_for_another_account',
      state: unlinked.state,
    });
  });

  it('runtime-validates lifecycle commands before transition', () => {
    const invalidLink = {
      identityId: IDENTITY_ID,
      accountId: ACCOUNT_ID,
      makePrimary: 'false',
    };
    const extraFieldUnlink = {
      identityId: IDENTITY_ID,
      accountId: ACCOUNT_ID,
      unexpected: true,
    };

    expect(isLinkExternalIdentityCommand(invalidLink)).toBe(false);
    expect(isUnlinkExternalIdentityCommand(extraFieldUnlink)).toBe(false);
    const result = linkExternalIdentity(
      linkedState(),
      invalidLink as unknown as Parameters<typeof linkExternalIdentity>[1],
    );
    const invalidUnlink = unlinkExternalIdentity(
      linkedState(),
      extraFieldUnlink as unknown as Parameters<
        typeof unlinkExternalIdentity
      >[1],
      unlinkContext(),
    );
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_external_identity_command',
    });
    expect(invalidUnlink).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_external_identity_command',
    });
    expect(isExternalIdentityState(result.state)).toBe(true);
    expect(isExternalIdentityState(invalidUnlink.state)).toBe(true);
  });

  it('rejects duplicate digest/pepper version aliases', () => {
    expect(
      isExternalIdentityState({
        ...linkedState(),
        lookupDigestAliases: [alias(1, 1, 'a'), alias(1, 1, 'b')],
      }),
    ).toBe(false);
  });
});
