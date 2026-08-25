import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AcceptPlayerOnboardingLegalPolicyInput } from './player-onboarding-legal-acceptance-writer';
import { PostgresPlayerOnboardingLegalAcceptanceWriter } from './postgres-player-onboarding-legal-acceptance-writer';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'player-onboarding-legal-acceptance-writer',
) as AccountId;

function result(rows: readonly QueryResultRow[]): QueryResult<QueryResultRow> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];

  constructor(private readonly queue: QueryResult<QueryResultRow>[]) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const next = this.queue.shift();
    if (next === undefined) throw new Error('Unexpected query');
    return next as QueryResult<Row>;
  }
}

function input(): AcceptPlayerOnboardingLegalPolicyInput {
  return {
    accountId: ACCOUNT_ID,
    flowVersion: 'tma_legal_reconsent_v1',
    acceptedAt: unixEpochSeconds(1_800_000_000),
    consents: [
      { kind: 'cancellation', documentVersion: 'cancellation-2026-08-26-v1' },
      {
        kind: 'personal_data_processing',
        documentVersion: 'personal-data-consent-2026-08-26-v1',
      },
      { kind: 'terms', documentVersion: 'terms-2026-08-26-v1' },
    ],
  };
}

describe('PostgresPlayerOnboardingLegalAcceptanceWriter', () => {
  it('appends the exact current evidence set for completed onboarding and verifies it', async () => {
    const transaction = new FakeTransaction([
      result([
        {
          account_id: ACCOUNT_ID,
          status: 'completed',
          current_step: 'completed',
        },
      ]),
      result([]),
      result([
        {
          consent_kind: 'cancellation',
          document_version: 'cancellation-2026-08-26-v1',
        },
        {
          consent_kind: 'personal_data_processing',
          document_version: 'personal-data-consent-2026-08-26-v1',
        },
        {
          consent_kind: 'privacy',
          document_version: 'privacy-test-2026-08-23-v1',
        },
        { consent_kind: 'terms', document_version: 'terms-2026-08-26-v1' },
      ]),
    ]);

    await expect(
      new PostgresPlayerOnboardingLegalAcceptanceWriter().accept(
        transaction,
        input(),
      ),
    ).resolves.toEqual({ outcome: 'accepted' });
    expect(transaction.calls[1].text).toContain('ON CONFLICT');
    expect(transaction.calls[1].values).toEqual([
      ACCOUNT_ID,
      'cancellation',
      'cancellation-2026-08-26-v1',
      'personal_data_processing',
      'personal-data-consent-2026-08-26-v1',
      'terms',
      'terms-2026-08-26-v1',
      'tma_legal_reconsent_v1',
      1_800_000_000,
    ]);
  });

  it('does not append re-consent before onboarding is completed', async () => {
    const transaction = new FakeTransaction([
      result([
        {
          account_id: ACCOUNT_ID,
          status: 'in_progress',
          current_step: 'level_survey',
        },
      ]),
    ]);

    await expect(
      new PostgresPlayerOnboardingLegalAcceptanceWriter().accept(
        transaction,
        input(),
      ),
    ).resolves.toEqual({ outcome: 'incomplete' });
    expect(transaction.calls).toHaveLength(1);
  });

  it('fails closed when only historical privacy evidence exists', async () => {
    const transaction = new FakeTransaction([
      result([
        {
          account_id: ACCOUNT_ID,
          status: 'completed',
          current_step: 'completed',
        },
      ]),
      result([]),
      result([
        {
          consent_kind: 'privacy',
          document_version: 'privacy-test-2026-08-23-v1',
        },
      ]),
    ]);

    await expect(
      new PostgresPlayerOnboardingLegalAcceptanceWriter().accept(
        transaction,
        input(),
      ),
    ).resolves.toEqual({ outcome: 'conflict' });
  });
});
