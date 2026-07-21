import { AccountId } from './account.types';
import {
  isPlayerProfile,
  validatePlayerAccountWithProfileCreation,
} from './player-profile.types';
import { deterministicUuid } from '../../test/deterministic-uuid';

const ACCOUNT_ID = deterministicUuid('player-account') as AccountId;

describe('player profile contracts', () => {
  it('keeps the profile contract to accountId only', () => {
    expect(isPlayerProfile({ accountId: ACCOUNT_ID })).toBe(true);
    expect(
      isPlayerProfile({ accountId: ACCOUNT_ID, name: 'must-not-persist' }),
    ).toBe(false);
  });

  it('validates one atomic player account/profile creation binding', () => {
    const result = validatePlayerAccountWithProfileCreation({
      account: { accountId: ACCOUNT_ID, role: 'player', status: 'active' },
      playerProfile: { accountId: ACCOUNT_ID },
    });

    expect(result).toMatchObject({ outcome: 'validated' });
    if (result.outcome === 'validated') {
      expect(Object.isFrozen(result.binding)).toBe(true);
      expect(Object.isFrozen(result.binding.account)).toBe(true);
      expect(Object.isFrozen(result.binding.playerProfile)).toBe(true);
    }
  });

  it('rejects a profile belonging to another account', () => {
    expect(
      validatePlayerAccountWithProfileCreation({
        account: { accountId: ACCOUNT_ID, role: 'player', status: 'active' },
        playerProfile: {
          accountId: deterministicUuid('other-account') as AccountId,
        },
      }),
    ).toEqual({
      outcome: 'rejected',
      reason: 'player_profile_account_mismatch',
    });
  });
});
