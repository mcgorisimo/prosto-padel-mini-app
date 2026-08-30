import { QueryResult, QueryResultRow } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchWaitlistOfferCommandId,
  MatchWaitlistOfferId,
  MatchWaitlistOfferRequestDigest,
} from '../matches/match-waitlist-offer.types';
import { MatchWaitlistEntryId } from '../matches/match-waitlist.types';
import { MatchId } from '../matches/match.types';
import { PostgresMatchWaitlistOfferRepository } from './postgres-match-waitlist-offer.repository';
import { PostgresTransaction } from './postgres-transaction';

const MATCH_ID = deterministicUuid('waitlist-offer-repository-match') as MatchId;
const ACCOUNT_ID = deterministicUuid('waitlist-offer-repository-account') as AccountId;
const ENTRY_ID = deterministicUuid('waitlist-offer-repository-entry') as MatchWaitlistEntryId;
const OFFER_ID = deterministicUuid('waitlist-offer-repository-offer') as MatchWaitlistOfferId;
const COMMAND_ID = deterministicUuid('waitlist-offer-repository-command') as MatchWaitlistOfferCommandId;
const DIGEST = 'b'.repeat(64) as MatchWaitlistOfferRequestDigest;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(Number(NOW) + 900);

class FakeTransaction implements PostgresTransaction {
  readonly calls: { readonly text: string; readonly values: readonly unknown[] }[] = [];

  constructor(private readonly queued: readonly QueryResult<QueryResultRow>[]) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.queued[this.calls.length - 1];
    if (response === undefined) throw new Error('Unexpected query');
    return response as QueryResult<Row>;
  }
}

function result<Row extends QueryResultRow>(
  rows: readonly Row[],
  command = 'SELECT',
): QueryResult<Row> {
  return { command, rowCount: rows.length, oid: 0, fields: [], rows: [...rows] };
}

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_ID,
    starts_at: String(Number(NOW) + 3_600),
    kind: 'match',
    visibility: 'public',
    scenario: 'social',
    status: 'confirmed',
    ...overrides,
  };
}

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OFFER_ID,
    entry_id: ENTRY_ID,
    match_id: MATCH_ID,
    account_id: ACCOUNT_ID,
    slot_number: 2,
    status: 'active',
    offered_at: String(NOW),
    expires_at: String(EXPIRES_AT),
    updated_at: String(NOW),
    resolved_at: null,
    version: '1',
    ...overrides,
  };
}

function actionInput() {
  return {
    commandId: COMMAND_ID,
    offerId: OFFER_ID,
    matchId: MATCH_ID,
    accountId: ACCOUNT_ID,
    action: 'accept' as const,
    requestDigest: DIGEST,
    now: NOW,
  };
}

describe('PostgresMatchWaitlistOfferRepository', () => {
  it('locks the match and creates one concrete active slot offer', async () => {
    const transaction = new FakeTransaction([
      result([matchRow()]),
      result([]),
      result([{ slot_number: 2 }]),
      result([offerRow()], 'INSERT'),
    ]);

    await expect(new PostgresMatchWaitlistOfferRepository().create(
      transaction,
      {
        offerId: OFFER_ID,
        entryId: ENTRY_ID,
        matchId: MATCH_ID,
        accountId: ACCOUNT_ID,
        now: NOW,
        expiresAt: EXPIRES_AT,
      },
    )).resolves.toMatchObject({
      outcome: 'created',
      offer: { offerId: OFFER_ID, slotNumber: 2, status: 'active' },
    });
    expect(transaction.calls[0].text).toContain('FOR UPDATE');
    expect(transaction.calls[2].text).toContain('match_invitations');
    expect(transaction.calls[3].text).toContain(
      'participants.account_id = entries.account_id',
    );
    expect(transaction.calls[3].text).toContain(
      'invitations.invited_account_id = entries.account_id',
    );
    expect(transaction.calls[3].values).toEqual([
      OFFER_ID,
      ENTRY_ID,
      MATCH_ID,
      ACCOUNT_ID,
      2,
      NOW,
      EXPIRES_AT,
    ]);
  });

  it('returns an immutable accepted result for an exact command retry', async () => {
    const transaction = new FakeTransaction([
      result([{ locked: '' }]),
      result([{
        command_id: COMMAND_ID,
        offer_id: OFFER_ID,
        match_id: MATCH_ID,
        actor_account_id: ACCOUNT_ID,
        request_digest: Buffer.from(DIGEST, 'hex'),
        command_type: 'accept',
        result_type: 'accepted',
        applied_at: String(NOW),
        offer_status: 'accepted',
        offer_version: '2',
      }]),
    ]);

    await expect(new PostgresMatchWaitlistOfferRepository().readAction(
      transaction,
      actionInput(),
    )).resolves.toEqual({
      outcome: 'idempotent_retry',
      mutation: {
        offerId: OFFER_ID,
        matchId: MATCH_ID,
        status: 'accepted',
        appliedAt: NOW,
        version: 2,
      },
    });
    expect(transaction.calls).toHaveLength(2);
    expect(transaction.calls[0].text).toContain('pg_advisory_xact_lock');
    expect(transaction.calls[1].text).toContain('match_waitlist_offer_commands');
  });

  it('resolves the offer and queue entry before recording the command result', async () => {
    const transaction = new FakeTransaction([
      result([{ id: OFFER_ID }], 'UPDATE'),
      result([{ id: ENTRY_ID }], 'UPDATE'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);

    await expect(new PostgresMatchWaitlistOfferRepository().resolve(
      transaction,
      { ...actionInput(), entryId: ENTRY_ID, status: 'accepted' },
    )).resolves.toMatchObject({
      offerId: OFFER_ID,
      status: 'accepted',
      version: 2,
    });
    expect(transaction.calls[0].values).toEqual([
      OFFER_ID,
      ENTRY_ID,
      MATCH_ID,
      ACCOUNT_ID,
      'accepted',
      NOW,
    ]);
    expect(transaction.calls[2].values[4]).toEqual(Buffer.from(DIGEST, 'hex'));
  });

  it('cancels an active offer and releases its queue entry when the match closes', async () => {
    const transaction = new FakeTransaction([
      result([matchRow({ status: 'cancelled' })]),
      result([offerRow()]),
      result([{ id: OFFER_ID }], 'UPDATE'),
      result([{ id: ENTRY_ID }], 'UPDATE'),
    ]);

    await expect(new PostgresMatchWaitlistOfferRepository().expireForMatch(
      transaction,
      { matchId: MATCH_ID, now: NOW },
    )).resolves.toMatchObject({
      outcome: 'cancelled',
      offer: { status: 'cancelled', resolvedAt: NOW, version: 2 },
    });
    expect(transaction.calls[2].values[4]).toBe('cancelled');
    expect(transaction.calls[3].values[3]).toBe('skipped');
  });

  it('finds both expired offers and offers invalidated by match state', async () => {
    const transaction = new FakeTransaction([
      result([{ match_id: MATCH_ID }]),
    ]);

    await expect(new PostgresMatchWaitlistOfferRepository().listDueMatchIds(
      transaction,
      { now: NOW, limit: 25 },
    )).resolves.toEqual([MATCH_ID]);
    expect(transaction.calls[0].text).toContain('offers.expires_at <= $1');
    expect(transaction.calls[0].text).toContain('matches.status NOT IN');
    expect(transaction.calls[0].values).toEqual([NOW, 25]);
  });
});
