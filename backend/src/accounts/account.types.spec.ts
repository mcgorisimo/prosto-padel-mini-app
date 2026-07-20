import {
  ACCOUNT_STATUSES,
  USER_ROLES,
} from './account.types';

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
});
