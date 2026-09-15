import { accountId } from '../accounts/account.types';
import { CrmBindingService } from './crm-binding.service';
import { ClosedCrmBindingStore, VerifiedPhoneProof } from './crm-binding.types';
import { PostgresCrmBindingStore } from './postgres-crm-binding.store';
import { PostgresTransaction, PostgresTransactionRunner } from '../database/postgres-transaction';

const A = accountId('11111111-1111-4111-8111-111111111111');
const B = accountId('22222222-2222-4222-8222-222222222222');
const proof = (owner = A): VerifiedPhoneProof => ({ accountId: owner, phone: '+79991112233', contactVersion: 2,
  profileRevision: 3, challengeId: '33333333-3333-4333-8333-333333333333', subjectDigest: 'ab'.repeat(32),
  digestKeyVersion: 1, verifiedAt: 1000, observedAt: 1001 });

// Deterministic transactional fake; no SQL/migration is executed. Serial commit
// and unique-index behavior model the DB boundary, not a PostgreSQL integration claim.
function harness() {
  const proofs = new Map([[A, proof()], [B, proof(B)]]);
  const rows: Record<string, unknown>[] = [];
  const calls: string[] = [];
  let active = false;
  let tail: Promise<unknown> = Promise.resolve();
  const read = jest.fn(async (_tx: PostgresTransaction, owner: typeof A) => proofs.get(owner));
  const query = jest.fn(async (sql: string, args: readonly unknown[] = []) => {
    calls.push(sql);
    if (sql.startsWith('SELECT account_id')) {
      const matched = rows.filter(r => r.account_id === args[0] && r.company_id === String(args[1]));
      return { rowCount: matched.length, rows: matched };
    }
    if (sql.startsWith('INSERT')) {
      const [owner, company, client, version, revision, , digest, keyVersion] = args;
      if (rows.some(r => r.company_id === String(company) && (r.account_id === owner || r.client_id === String(client)))) return { rowCount: 0, rows: [] };
      rows.push({ account_id: owner, company_id: String(company), client_id: String(client), contact_version: String(version),
        profile_revision: String(revision), subject_digest: digest, digest_key_version: keyVersion });
      return { rowCount: 1, rows: [{ account_id: owner }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const tx = { query } as unknown as PostgresTransaction;
  const transactions = { runInTransaction: <T>(work: (tx: PostgresTransaction) => Promise<T>) => {
    const result = tail.then(async () => {
      active = true;
      try { return await work(tx); } finally { active = false; }
    });
    tail = result.catch(() => undefined);
    return result;
  } } as Pick<PostgresTransactionRunner, 'runInTransaction'>;
  const store = new PostgresCrmBindingStore(transactions, { read });
  const find = jest.fn(async () => {
    expect(active).toBe(false);
    return { outcome: 'unique' as const, companyId: 17, clientId: 5 };
  });
  const service = new CrmBindingService({ store, companyId: 17, lookup: { find } });
  return { proofs, rows, calls, read, query, store, find, service, transactions };
}

describe('CRM binding transaction and owner boundary', () => {
  it('closed runtime does not read DB or call YCLIENTS', async () => {
    const find = jest.fn();
    const service = new CrmBindingService({ store: new ClosedCrmBindingStore(), lookup: { find }, companyId: 17 });
    expect(await service.bind(A)).toEqual({ outcome: 'not_configured' });
    expect(await service.status(A)).toEqual({ outcome: 'not_configured' });
    expect(find).not.toHaveBeenCalled();
  });
  it('saves only internal IDs and evidence once, and repeats idempotently', async () => {
    const h = harness();
    expect(await h.service.status(A)).toEqual({ outcome: 'not_linked' });
    expect(await h.service.bind(A)).toEqual({ outcome: 'linked' });
    expect(await h.service.bind(A)).toEqual({ outcome: 'linked' });
    expect(await h.service.status(A)).toEqual({ outcome: 'linked' });
    expect(h.rows).toHaveLength(1);
    expect(h.find).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.rows)).not.toContain(proof().phone);
  });
  it('unconfirmed and expired initial proofs cannot search', async () => {
    const h = harness();
    h.proofs.delete(A);
    expect(await h.service.bind(A)).toEqual({ outcome: 'phone_verification_required' });
    h.proofs.set(A, { ...proof(), observedAt: 1600 });
    expect(await h.service.bind(A)).toEqual({ outcome: 'phone_verification_required' });
    expect(h.find).not.toHaveBeenCalled();
  });
  it.each([
    { contactVersion: 4 }, { profileRevision: 5 }, { challengeId: '44444444-4444-4444-8444-444444444444' },
    { phone: '+79992223344' }, { observedAt: 1600 }, { subjectDigest: 'cd'.repeat(32) },
  ])('revalidates proof after network without keeping DB locks %#', async change => {
    const h = harness();
    h.find.mockImplementationOnce(async () => {
      h.proofs.set(A, { ...proof(), ...change });
      return { outcome: 'unique', companyId: 17, clientId: 5 };
    });
    expect(await h.service.bind(A)).toEqual({ outcome: 'phone_verification_required' });
    expect(h.rows).toHaveLength(0);
  });
  it('phone change and return to original cannot revive an existing binding', async () => {
    const h = harness();
    await h.service.bind(A);
    h.proofs.delete(A);
    expect(await h.service.status(A)).toEqual({ outcome: 'phone_verification_required' });
    h.proofs.set(A, { ...proof(), profileRevision: 5 });
    expect(await h.service.bind(A)).toEqual({ outcome: 'review_required' });
    expect(await h.service.status(A)).toEqual({ outcome: 'review_required' });
    expect(h.rows[0].profile_revision).toBe('3');
  });
  it('two concurrent owners cannot occupy the same company/client binding', async () => {
    const h = harness();
    expect(await Promise.all([h.store.save(proof(), 17, 5), h.store.save(proof(B), 17, 5)]))
      .toEqual([{ outcome: 'linked' }, { outcome: 'review_required' }]);
    expect(h.rows).toHaveLength(1);
  });
  it('concurrent saves are idempotent for the same owner but never overwrite a different client', async () => {
    const h = harness();
    expect(await Promise.all([h.store.save(proof(), 17, 5), h.store.save(proof(), 17, 5)]))
      .toEqual([{ outcome: 'linked' }, { outcome: 'linked' }]);
    expect(await h.store.save(proof(), 17, 6)).toEqual({ outcome: 'review_required' });
    expect(h.rows[0].client_id).toBe('5');
  });
  it('company scope is part of both ownership and uniqueness', async () => {
    const h = harness();
    await h.store.save(proof(), 17, 5);
    expect(await h.store.save(proof(B), 18, 5)).toEqual({ outcome: 'linked' });
    expect((await h.store.snapshot(A, 18))).not.toHaveProperty('binding', expect.anything());
    h.find.mockResolvedValueOnce({ outcome: 'unique', companyId: 18, clientId: 9 });
    expect(await h.service.bind(B)).toEqual({ outcome: 'unknown' });
  });
  it('double click does not duplicate network work and retry reads fresh state', async () => {
    const h = harness();
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    h.find.mockImplementationOnce(async () => { await wait; return { outcome: 'unique', companyId: 17, clientId: 5 }; });
    const first = h.service.bind(A);
    expect(await h.service.bind(A)).toEqual({ outcome: 'unknown' });
    release();
    expect(await first).toEqual({ outcome: 'linked' });
    h.proofs.delete(A);
    expect(await h.service.bind(A)).toEqual({ outcome: 'phone_verification_required' });
    expect(h.find).toHaveBeenCalledTimes(1);
  });
  it.each(['no_match', 'review_required', 'unknown'] as const)('safe outcome %s makes no binding', async outcome => {
    const h = harness();
    const service = new CrmBindingService({ store: h.store, companyId: 17, lookup: { find: async () => ({ outcome }) } });
    expect(await service.bind(A)).toEqual({ outcome });
    expect(h.rows).toHaveLength(0);
  });
  it('a negative result also rejects a phone changed during search', async () => {
    const h = harness();
    const service = new CrmBindingService({ store: h.store, companyId: 17, lookup: { find: async () => {
      h.proofs.delete(A); return { outcome: 'no_match' };
    } } });
    expect(await service.bind(A)).toEqual({ outcome: 'phone_verification_required' });
  });
  it('suppresses provider/DB exceptions; retry reads saved state', async () => {
    const h = harness();
    h.find.mockRejectedValueOnce(new Error(proof().phone));
    expect(await h.service.bind(A)).toEqual({ outcome: 'unknown' });
    await h.service.bind(A);
    h.read.mockRejectedValueOnce(new Error('private SQL detail'));
    expect(await h.service.status(A)).toEqual({ outcome: 'unknown' });
    expect(await h.service.bind(A)).toEqual({ outcome: 'linked' });
  });
  it('an uncertain commit returns unknown; retry reconciles without another CRM call', async () => {
    const h = harness();
    const uncertain = { runInTransaction: async <T>(work: (tx: PostgresTransaction) => Promise<T>) => {
      await h.transactions.runInTransaction(work);
      throw new Error('private connection/commit details');
    } };
    const store = new PostgresCrmBindingStore(uncertain, { read: h.read });
    expect(await store.save(proof(), 17, 5)).toEqual({ outcome: 'unknown' });
    expect(await h.service.bind(A)).toEqual({ outcome: 'linked' });
    expect(h.rows).toHaveLength(1);
    expect(h.find).not.toHaveBeenCalled();
  });
  it('separate service processes converge on one binding after independent searches', async () => {
    const h = harness();
    // Another process may hold its own short transaction during this search.
    h.find.mockImplementation(async () => ({ outcome: 'unique', companyId: 17, clientId: 5 }));
    const other = new CrmBindingService({ store: h.store, lookup: { find: h.find }, companyId: 17 });
    expect(await Promise.all([h.service.bind(A), other.bind(A)])).toEqual([{ outcome: 'linked' }, { outcome: 'linked' }]);
    expect(h.rows).toHaveLength(1);
  });
  it('checks owner identity even when an adapter returns a foreign snapshot', async () => {
    const h = harness();
    h.read.mockResolvedValueOnce(proof(B));
    expect(await h.service.bind(A)).toEqual({ outcome: 'unknown' });
    expect(h.find).not.toHaveBeenCalled();
  });
});
