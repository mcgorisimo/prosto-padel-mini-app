import { QueryResult } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from '../auth/auth.types';
import { PostgresYclientsNotificationReconciliationRepository } from './postgres-yclients-notification-reconciliation.repository';
import { PostgresTransaction } from './postgres-transaction';

function result(rows: readonly Record<string, unknown>[]): QueryResult {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

describe('PostgresYclientsNotificationReconciliationRepository', () => {
  it('claims only nearest fully-bound active reservations with a row lock and lease', async () => {
    const now = unixEpochSeconds(1_800_000_000);
    const query = jest.fn().mockResolvedValue(result([]));
    const repository =
      new PostgresYclientsNotificationReconciliationRepository();
    await expect(
      repository.claimNext({ query } as unknown as PostgresTransaction, {
        leaseOwner: deterministicUuid('yclients-lease-owner'),
        now,
        leaseUntil: unixEpochSeconds(Number(now) + 60),
        horizonUntil: unixEpochSeconds(Number(now) + 604_800),
        minimumIntervalSeconds: 300,
      }),
    ).resolves.toBeNull();
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("reservation.status='confirmed'");
    expect(sql).toContain('yclients_record_hash_ciphertext IS NOT NULL');
    expect(sql).toContain('FOR UPDATE OF reservation SKIP LOCKED');
    expect(sql).toContain('LIMIT 1');
    expect(sql).not.toMatch(
      /insert into backend_reservation|delete from|yclients.*records/iu,
    );
  });
});
