import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { InternalUuid } from '../common/internal-uuid';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { PostgresAdminPlayerRatingRepository } from './postgres-admin-player-rating.repository';

const ADMIN_ID = deterministicUuid('postgres-admin-rating-admin') as AccountId;
const PLAYER_ID = deterministicUuid('postgres-admin-rating-player') as AccountId;
const OTHER_PLAYER_ID = deterministicUuid('postgres-admin-rating-other') as AccountId;
const COMMAND_ID = deterministicUuid('postgres-admin-rating-command') as InternalUuid;
const DIGEST = 'a'.repeat(64);
const NOW = unixEpochSeconds(1_800_000_000);

function result(rows: readonly Record<string, unknown>[]) {
  return { command: '', rowCount: rows.length, oid: 0, fields: [], rows: [...rows] };
}

function commandRow(digest = DIGEST) {
  return {
    command_id: COMMAND_ID,
    actor_account_id: ADMIN_ID,
    target_account_id: PLAYER_ID,
    request_digest: Buffer.from(digest, 'hex'),
    result_type: 'rating_and_verification_updated',
    rating_before: '3.00',
    rating_after: '4.25',
    is_verified_before: false,
    is_verified_after: true,
    applied_at: String(NOW),
  };
}

describe('PostgresAdminPlayerRatingRepository', () => {
  it('uses account-id keyset pagination and returns only a bounded active-player page', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(result([{ id: ADMIN_ID, role: 'club_admin', status: 'active' }]))
      .mockResolvedValueOnce(result([
        { account_id: PLAYER_ID, first_name: 'One', last_name: null, username: null, phone: null, side_preference: 'Both', rating: '3.00', is_verified: false },
        { account_id: OTHER_PLAYER_ID, first_name: 'Two', last_name: null, username: null, phone: null, side_preference: null, rating: '4.00', is_verified: true },
      ]));
    const repository = new PostgresAdminPlayerRatingRepository();
    const page = await repository.listPlayers({ query }, {
      actorAccountId: ADMIN_ID,
      search: 'One',
      verification: 'all',
      limit: 1,
    });
    expect(page).toEqual({
      outcome: 'listed',
      players: [{ accountId: PLAYER_ID, firstName: 'One', sidePreference: 'Both', rating: 3, isVerified: false }],
      nextAfterAccountId: PLAYER_ID,
    });
    expect(query.mock.calls[1][0]).toContain('accounts.id > $1::uuid');
    expect(query.mock.calls[1][0]).toContain('ORDER BY accounts.id');
    expect(query.mock.calls[1][1]).toEqual([null, '%One%', null, 2]);
  });

  it('fails closed when the persisted actor is not an active club admin', async () => {
    const query = jest.fn().mockResolvedValue(result([{ id: ADMIN_ID, role: 'player', status: 'active' }]));
    const repository = new PostgresAdminPlayerRatingRepository();
    await expect(repository.listPlayers({ query }, {
      actorAccountId: ADMIN_ID,
      verification: 'all',
      limit: 20,
    })).resolves.toEqual({ outcome: 'forbidden' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('locks accounts in id order, locks rating state, updates it, then appends the immutable command', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(result([
        { id: ADMIN_ID, role: 'club_admin', status: 'active' },
        { id: PLAYER_ID, role: 'player', status: 'active' },
      ]))
      .mockResolvedValueOnce(result([{ account_id: PLAYER_ID, rating: '3.00', is_verified: false, updated_at: String(NOW + 10) }]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ account_id: PLAYER_ID, rating: '4.25', is_verified: true, updated_at: String(NOW + 10) }]))
      .mockResolvedValueOnce(result([commandRow()]));
    const repository = new PostgresAdminPlayerRatingRepository();
    const applied = await repository.setRatingState({ query }, {
      commandId: COMMAND_ID,
      actorAccountId: ADMIN_ID,
      targetAccountId: PLAYER_ID,
      requestDigest: DIGEST,
      rating: 4.25,
      isVerified: true,
      appliedAt: NOW,
    });
    expect(applied).toEqual({ outcome: 'applied', command: {
      commandId: COMMAND_ID,
      actorAccountId: ADMIN_ID,
      targetAccountId: PLAYER_ID,
      resultType: 'rating_and_verification_updated',
      ratingBefore: 3,
      ratingAfter: 4.25,
      isVerifiedBefore: false,
      isVerifiedAfter: true,
      appliedAt: NOW,
    } });
    expect(query.mock.calls[0][0]).toContain('ORDER BY id');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(query.mock.calls[1][0]).toContain('FOR UPDATE OF rating_states');
    expect(query.mock.calls[3][0]).toContain('UPDATE backend_auth.player_rating_states');
    expect(query.mock.calls[3][0]).toContain('GREATEST(updated_at, $4)');
    expect(query.mock.calls[3][0]).toContain('AND rating = $5');
    expect(query.mock.calls[3][0]).toContain('AND is_verified = $6');
    expect(query.mock.calls[4][0]).toContain('INSERT INTO backend_auth.player_rating_admin_commands');
  });

  it('reconstructs an idempotent retry from immutable command data without updating current state', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(result([
        { id: ADMIN_ID, role: 'club_admin', status: 'active' },
        { id: PLAYER_ID, role: 'player', status: 'active' },
      ]))
      .mockResolvedValueOnce(result([{ account_id: PLAYER_ID, rating: '5.00', is_verified: true, updated_at: String(NOW + 20) }]))
      .mockResolvedValueOnce(result([commandRow()]));
    const repository = new PostgresAdminPlayerRatingRepository();
    const retried = await repository.setRatingState({ query }, {
      commandId: COMMAND_ID,
      actorAccountId: ADMIN_ID,
      targetAccountId: PLAYER_ID,
      requestDigest: DIGEST,
      rating: 4.25,
      isVerified: true,
      appliedAt: NOW,
    });
    expect(retried.outcome).toBe('applied');
    if (retried.outcome === 'applied') {
      expect(retried.command.ratingBefore).toBe(3);
      expect(retried.command.ratingAfter).toBe(4.25);
    }
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('rejects command-id reuse with a changed request digest', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(result([
        { id: ADMIN_ID, role: 'club_admin', status: 'active' },
        { id: PLAYER_ID, role: 'player', status: 'active' },
      ]))
      .mockResolvedValueOnce(result([{ account_id: PLAYER_ID, rating: '3.00', is_verified: false, updated_at: String(NOW) }]))
      .mockResolvedValueOnce(result([commandRow('b'.repeat(64))]));
    const repository = new PostgresAdminPlayerRatingRepository();
    await expect(repository.setRatingState({ query }, {
      commandId: COMMAND_ID,
      actorAccountId: ADMIN_ID,
      targetAccountId: PLAYER_ID,
      requestDigest: DIGEST,
      rating: 4.25,
      isVerified: true,
      appliedAt: NOW,
    })).resolves.toEqual({ outcome: 'request_conflict' });
  });
});
