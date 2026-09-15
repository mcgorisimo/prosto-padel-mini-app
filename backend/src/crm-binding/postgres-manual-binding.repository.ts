import { randomUUID } from 'node:crypto';
import { AccountId, isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  PostgresTransaction,
  PostgresTransactionRunner,
} from '../database/postgres-transaction';
import { decodePostgresBigint } from '../database/postgres-codecs';
import {
  ManualBindingRepository,
  ManualDraft,
  ManualResult,
} from './manual-binding.types';
import { positiveId } from './yclients-client-lookup';

export class PostgresManualBindingRepository implements ManualBindingRepository {
  constructor(
    private readonly transactions: Pick<
      PostgresTransactionRunner,
      'runInTransaction'
    >,
  ) {}
  private async contextIn(
    tx: PostgresTransaction,
    actor: AccountId,
    target: AccountId,
  ) {
    if (!isAccountId(actor) || !isAccountId(target))
      throw new Error('Invalid context');
    await tx.query("SET LOCAL lock_timeout='2s'");
    await tx.query("SET LOCAL statement_timeout='3s'");
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `crm-binding:${target}`,
    ]);
    const result = await tx.query(
      'SELECT revision FROM backend_auth.lock_manual_crm_context($1,$2)',
      [actor, target],
    );
    if (result.rows.length !== result.rowCount || result.rows.length > 1)
      throw new Error('Invalid context');
    if (!result.rows.length) return undefined;
    const revision = decodePostgresBigint(result.rows[0].revision);
    if (!positiveId(revision)) throw new Error('Invalid context');
    return revision;
  }
  async context(actor: AccountId, target: AccountId) {
    const revision = await this.transactions.runInTransaction((tx) =>
      this.contextIn(tx, actor, target),
    );
    return revision === undefined
      ? { outcome: 'forbidden' as const }
      : { outcome: 'ready' as const, revision };
  }
  private hydrate(row: Record<string, unknown>): ManualDraft {
    if (
      !isInternalUuid(row.draft_id) ||
      !isAccountId(row.actor_id) ||
      !isAccountId(row.target_id) ||
      !['prepared', 'committed'].includes(String(row.state)) ||
      typeof row.client_version !== 'string'
    )
      throw new Error('Invalid draft');
    const value = {
      draftId: row.draft_id,
      actorId: row.actor_id,
      targetId: row.target_id,
      companyId: decodePostgresBigint(row.company_id),
      clientId: decodePostgresBigint(row.client_id),
      profileRevision: decodePostgresBigint(row.profile_revision),
      clientVersion: row.client_version,
      expiresAt: decodePostgresBigint(row.expires_at),
      state: row.state as 'prepared' | 'committed',
    };
    if (
      ![
        value.companyId,
        value.clientId,
        value.profileRevision,
        value.expiresAt,
      ].every(positiveId)
    )
      throw new Error('Invalid draft');
    return value;
  }
  async prepare(
    actor: AccountId,
    target: AccountId,
    company: number,
    client: number,
    revision: number,
    version: string,
  ) {
    return this.transactions.runInTransaction(async (tx) => {
      if ((await this.contextIn(tx, actor, target)) !== revision)
        return undefined;
      const result = await tx.query(
        `INSERT INTO backend_auth.manual_crm_binding_drafts
        (draft_id,actor_id,target_id,company_id,client_id,profile_revision,client_version,created_at,expires_at,state)
        SELECT $1,$2,$3,$4,$5,$6,$7,instant.now,instant.now+300,'prepared'
        FROM (SELECT floor(extract(epoch from clock_timestamp()))::bigint AS now) instant
        WHERE (SELECT count(*) FROM backend_auth.manual_crm_binding_drafts
          WHERE actor_id=$2 AND created_at > extract(epoch from clock_timestamp())-60) < 3
        RETURNING *`,
        [randomUUID(), actor, target, company, client, revision, version],
      );
      if (result.rowCount === 0) return undefined;
      if (result.rowCount !== 1 || result.rows.length !== 1)
        throw new Error('Invalid draft');
      return this.hydrate(result.rows[0]);
    });
  }
  private async draftIn(
    tx: PostgresTransaction,
    actor: AccountId,
    target: AccountId,
    company: number,
    draftId: string,
  ) {
    const result = await tx.query(
      `SELECT * FROM backend_auth.manual_crm_binding_drafts
      WHERE draft_id=$1 AND actor_id=$2 AND target_id=$3 AND company_id=$4
      AND (state='committed' OR expires_at > extract(epoch from clock_timestamp())) FOR UPDATE`,
      [draftId, actor, target, company],
    );
    if (result.rowCount === 0) return undefined;
    if (result.rowCount !== 1 || result.rows.length !== 1)
      throw new Error('Invalid draft');
    return this.hydrate(result.rows[0]);
  }
  async readDraft(
    actor: AccountId,
    target: AccountId,
    company: number,
    draftId: string,
  ) {
    return this.transactions.runInTransaction(async (tx) => {
      const revision = await this.contextIn(tx, actor, target);
      if (revision === undefined) return undefined;
      const draft = await this.draftIn(tx, actor, target, company, draftId);
      return draft?.profileRevision === revision ? draft : undefined;
    });
  }
  async commit(input: ManualDraft): Promise<ManualResult> {
    return this.transactions.runInTransaction(async (tx) => {
      const revision = await this.contextIn(tx, input.actorId, input.targetId);
      if (revision === undefined) return { outcome: 'forbidden' };
      const draft = await this.draftIn(
        tx,
        input.actorId,
        input.targetId,
        input.companyId,
        input.draftId,
      );
      if (
        !draft ||
        draft.profileRevision !== revision ||
        draft.clientId !== input.clientId ||
        draft.clientVersion !== input.clientVersion
      )
        return { outcome: 'review_required' };
      const inserted = await tx.query(
        `INSERT INTO backend_auth.yclients_client_bindings
        (account_id,company_id,client_id,profile_revision,linked_at,evidence_method,admin_actor_id,admin_draft_id)
        VALUES ($1,$2,$3,$4,floor(extract(epoch from clock_timestamp()))::bigint,'admin_attested',$5,$6)
        ON CONFLICT DO NOTHING RETURNING account_id`,
        [
          draft.targetId,
          draft.companyId,
          draft.clientId,
          draft.profileRevision,
          draft.actorId,
          draft.draftId,
        ],
      );
      if (!inserted.rowCount) {
        const existing = await tx.query(
          `SELECT client_id,profile_revision,evidence_method FROM backend_auth.yclients_client_bindings
          WHERE account_id=$1 AND company_id=$2`,
          [draft.targetId, draft.companyId],
        );
        if (
          existing.rowCount !== 1 ||
          existing.rows[0].evidence_method !== 'admin_attested' ||
          decodePostgresBigint(existing.rows[0].client_id) !== draft.clientId ||
          decodePostgresBigint(existing.rows[0].profile_revision) !== revision
        )
          return { outcome: 'review_required' };
      }
      await tx.query(
        `UPDATE backend_auth.manual_crm_binding_drafts SET state='committed',
        confirmed_at=floor(extract(epoch from clock_timestamp()))::bigint WHERE draft_id=$1 AND state='prepared'`,
        [draft.draftId],
      );
      return { outcome: 'linked' };
    });
  }
  async ownStatus(accountId: AccountId, companyId: number) {
    return this.transactions.runInTransaction(async (tx) => {
      const result = await tx.query(
        `SELECT b.profile_revision,p.crm_phone_revision,b.evidence_method
        FROM backend_auth.accounts a JOIN backend_auth.player_profile_details p ON p.account_id=a.id
        LEFT JOIN backend_auth.yclients_client_bindings b ON b.account_id=a.id AND b.company_id=$2
        WHERE a.id=$1 AND a.role='player' AND a.status='active'`,
        [accountId, companyId],
      );
      if (result.rowCount !== 1) return { outcome: 'review_required' as const };
      const row = result.rows[0];
      if (row.profile_revision === null)
        return { outcome: 'not_linked' as const };
      return {
        outcome:
          row.evidence_method === 'admin_attested' &&
          decodePostgresBigint(row.profile_revision) ===
            decodePostgresBigint(row.crm_phone_revision)
            ? ('linked' as const)
            : ('review_required' as const),
      };
    });
  }
}
