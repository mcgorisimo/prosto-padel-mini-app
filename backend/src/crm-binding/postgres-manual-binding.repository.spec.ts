import { accountId } from '../accounts/account.types';
import {
  PostgresTransaction,
  PostgresTransactionRunner,
} from '../database/postgres-transaction';
import { PostgresManualBindingRepository } from './postgres-manual-binding.repository';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const A = accountId('11111111-1111-4111-8111-111111111111');
const B = accountId('22222222-2222-4222-8222-222222222222');
const D = '33333333-3333-4333-8333-333333333333';
const draft = {
  draftId: D,
  actorId: A,
  targetId: B,
  companyId: 17,
  clientId: 5,
  profileRevision: 2,
  clientVersion: '2026-09-15T12:00:00+03:00',
  expiresAt: 1900000300,
  state: 'prepared' as const,
};
const row = {
  draft_id: D,
  actor_id: A,
  target_id: B,
  company_id: '17',
  client_id: '5',
  profile_revision: '2',
  client_version: draft.clientVersion,
  expires_at: '1900000300',
  state: 'prepared',
};
function setup() {
  let revision: number | undefined = 2;
  let stored = { ...row };
  let binding: Record<string, unknown> | undefined;
  let expired = false;
  const mutations: string[] = [];
  const query = jest.fn(async (sql: string) => {
    let rows: Record<string, unknown>[] = [];
    if (sql.startsWith('SELECT revision'))
      rows = revision === undefined ? [] : [{ revision: String(revision) }];
    if (sql.startsWith('SELECT * FROM')) rows = expired ? [] : [stored];
    if (sql.startsWith('INSERT INTO backend_auth.yclients')) {
      if (!binding) {
        binding = {
          client_id: '5',
          profile_revision: '2',
          evidence_method: 'admin_attested',
        };
        rows = [{ account_id: B }];
      }
      mutations.push(sql);
    }
    if (sql.startsWith('SELECT client_id')) rows = binding ? [binding] : [];
    if (sql.startsWith('UPDATE backend_auth.manual')) {
      stored = { ...stored, state: 'committed' };
      mutations.push(sql);
    }
    return { rows, rowCount: rows.length };
  });
  let queue = Promise.resolve<unknown>(undefined);
  const transactions = {
    runInTransaction: <T>(work: (tx: PostgresTransaction) => Promise<T>) => {
      const task = queue.then(() =>
        work({ query } as unknown as PostgresTransaction),
      );
      queue = task.catch(() => {});
      return task;
    },
  } as Pick<PostgresTransactionRunner, 'runInTransaction'>;
  return {
    repository: new PostgresManualBindingRepository(transactions),
    query,
    mutations,
    revoke: () => {
      revision = undefined;
    },
    changePhone: () => {
      revision = 3;
    },
    expire: () => {
      expired = true;
    },
    occupy: () => {
      binding = {
        client_id: '6',
        profile_revision: '2',
        evidence_method: 'admin_attested',
      };
    },
  };
}
describe('manual binding persistence adversarial regressions (mocked PostgreSQL)', () => {
  it('serial concurrent confirmation keeps one binding and repeats idempotently', async () => {
    const h = setup();
    expect(
      await Promise.all([
        h.repository.commit(draft),
        h.repository.commit(draft),
      ]),
    ).toEqual([{ outcome: 'linked' }, { outcome: 'linked' }]);
    const draftRead = h.query.mock.calls.find((c) =>
      c[0].startsWith('SELECT * FROM'),
    )![0];
    expect(draftRead).toContain(
      'actor_id=$2 AND target_id=$3 AND company_id=$4',
    );
  });
  it.each(['revoke', 'changePhone', 'expire'] as const)(
    'rechecks %s before commit',
    async (change) => {
      const h = setup();
      h[change]();
      expect((await h.repository.commit(draft)).outcome).toBe(
        change === 'revoke' ? 'forbidden' : 'review_required',
      );
      expect(h.mutations).toHaveLength(0);
    },
  );
  it('does not replace an occupied binding', async () => {
    const h = setup();
    h.occupy();
    expect(await h.repository.commit(draft)).toEqual({
      outcome: 'review_required',
    });
    expect(h.mutations.some((sql) => sql.startsWith('UPDATE'))).toBe(false);
  });
  it('does not use a forged draft client ID', async () => {
    const h = setup();
    expect(await h.repository.commit({ ...draft, clientId: 6 })).toEqual({
      outcome: 'review_required',
    });
    expect(h.mutations).toHaveLength(0);
  });
  it('locks same owner before account/profile context, matching the automatic path', async () => {
    const h = setup();
    await h.repository.commit(draft);
    const sql = h.query.mock.calls.map((c) => c[0]);
    expect(
      sql.findIndex((s) => s.includes('pg_advisory_xact_lock')),
    ).toBeLessThan(sql.findIndex((s) => s.includes('lock_manual_crm_context')));
  });
  it('restricts durable evidence and DB capabilities in migration artifacts', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../docs/migrations/047_backend_manual_crm_binding.sql',
      ),
      'utf8',
    );
    expect(sql).toContain(
      "evidence_method='admin_attested' and contact_version is null and challenge_id is null",
    );
    expect(sql).toContain('confirmed_at is not null');
    expect(sql).toContain('grant update(state,confirmed_at)');
    expect(sql).toContain(
      'lock table backend_auth.admin_capability_events in share mode',
    );
    expect(sql).toContain("is distinct from 'granted'");
    expect(sql).toContain('for update');
    expect(sql).not.toMatch(/grant.*(?:delete|truncate).*to backend_auth_app/);
  });
});
