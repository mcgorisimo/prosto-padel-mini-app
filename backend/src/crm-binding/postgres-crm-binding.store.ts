import { AccountId, isAccountId } from '../accounts/account.types';
import { PostgresTransaction, PostgresTransactionRunner } from '../database/postgres-transaction';
import { decodePostgresBigint } from '../database/postgres-codecs';
import { BindingSnapshot, CrmBinding, CrmBindingResponse, CrmBindingStore, VerifiedPhoneProof, freshProof, sameBinding, sameProof } from './crm-binding.types';
import { PhoneProofReader } from './postgres-phone-proof.reader';
import { positiveId } from './yclients-client-lookup';

export class PostgresCrmBindingStore implements CrmBindingStore {
  constructor(private readonly transactions: Pick<PostgresTransactionRunner, 'runInTransaction'>,
    private readonly proofs: PhoneProofReader) {}

  private async binding(tx: PostgresTransaction, accountId: AccountId, companyId: number): Promise<CrmBinding | undefined> {
    const selected = await tx.query(`SELECT account_id, company_id, client_id, contact_version,
      profile_revision, encode(subject_digest, 'hex') AS subject_digest, digest_key_version
      FROM backend_auth.yclients_client_bindings WHERE account_id=$1 AND company_id=$2`, [accountId, companyId]);
    if (selected.rowCount !== selected.rows.length || selected.rows.length > 1) throw new Error();
    if (!selected.rows.length) return undefined;
    const row = selected.rows[0];
    const binding: CrmBinding = { accountId: row.account_id,
      companyId: decodePostgresBigint(row.company_id), clientId: decodePostgresBigint(row.client_id),
      contactVersion: decodePostgresBigint(row.contact_version), profileRevision: decodePostgresBigint(row.profile_revision),
      subjectDigest: row.subject_digest, digestKeyVersion: row.digest_key_version };
    if (binding.accountId !== accountId || binding.companyId !== companyId ||
        !positiveId(binding.clientId) || !positiveId(binding.contactVersion) || !positiveId(binding.profileRevision) ||
        !positiveId(binding.digestKeyVersion) || typeof binding.subjectDigest !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(binding.subjectDigest)) throw new Error();
    return binding;
  }

  private async prepare(tx: PostgresTransaction, accountId: AccountId, companyId: number): Promise<void> {
    if (!isAccountId(accountId) || !positiveId(companyId)) throw new Error();
    await tx.query("SET LOCAL lock_timeout='2s'");
    await tx.query("SET LOCAL statement_timeout='3s'");
    // Serializes this owner's binds across processes. Released before network.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`crm-binding:${accountId}`]);
  }

  async snapshot(accountId: AccountId, companyId: number): Promise<BindingSnapshot> {
    try {
      return await this.transactions.runInTransaction(async tx => {
        await this.prepare(tx, accountId, companyId);
        const proof = await this.proofs.read(tx, accountId);
        if (!proof) return { outcome: 'phone_verification_required' };
        if (proof.accountId !== accountId) throw new Error();
        return { outcome: 'ready', proof, binding: await this.binding(tx, accountId, companyId) };
      });
    } catch { throw new Error('Client binding unavailable'); }
  }

  async save(proof: VerifiedPhoneProof, companyId: number, clientId: number): Promise<CrmBindingResponse> {
    try {
      if (!positiveId(clientId)) return { outcome: 'unknown' };
      return await this.transactions.runInTransaction(async tx => {
        await this.prepare(tx, proof.accountId, companyId);
        const current = await this.proofs.read(tx, proof.accountId);
        if (!current || !sameProof(proof, current) || !freshProof(current)) return { outcome: 'phone_verification_required' };
        const existing = await this.binding(tx, proof.accountId, companyId);
        if (existing) return { outcome: sameBinding(existing, current, companyId) && existing.clientId === clientId ? 'linked' : 'review_required' };
        // Both unique constraints are authoritative across processes and owners.
        const inserted = await tx.query(`INSERT INTO backend_auth.yclients_client_bindings
          (account_id, company_id, client_id, contact_version, profile_revision, challenge_id,
           subject_digest, digest_key_version, linked_at)
          VALUES ($1,$2,$3,$4,$5,$6,decode($7,'hex'),$8,$9)
          ON CONFLICT DO NOTHING RETURNING account_id`, [current.accountId, companyId, clientId,
          current.contactVersion, current.profileRevision, current.challengeId,
          current.subjectDigest, current.digestKeyVersion, current.observedAt]);
        if (inserted.rowCount === 1 && inserted.rows[0]?.account_id === proof.accountId) return { outcome: 'linked' };
        if (inserted.rowCount !== 0 || inserted.rows.length !== 0) throw new Error();
        return { outcome: 'review_required' };
      });
    } catch { return { outcome: 'unknown' }; }
  }
}
