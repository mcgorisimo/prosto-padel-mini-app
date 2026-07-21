import {
  ACCOUNT_STATUSES,
  USER_ROLES,
  isAccountId,
} from './account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';

describe('account contracts', () => {
  it('defines only user account roles', () => {
    expect(USER_ROLES).toEqual(['player', 'club_admin']);
    expect(USER_ROLES).not.toContain('system');
    expect(Object.isFrozen(USER_ROLES)).toBe(true);
  });

  it('defines the complete account lifecycle statuses', () => {
    expect(ACCOUNT_STATUSES).toEqual([
      'active',
      'blocked',
      'pending_deletion',
      'anonymized',
    ]);
    expect(Object.isFrozen(ACCOUNT_STATUSES)).toBe(true);
  });

  it('accepts only canonical UUID account IDs', () => {
    expect(isAccountId(deterministicUuid('account'))).toBe(true);
    expect(isAccountId('account-1')).toBe(false);
    expect(isAccountId('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
