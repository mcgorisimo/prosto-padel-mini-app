import { readFileSync } from 'node:fs';

function artifact(suffix: string): string {
  return readFileSync(
    require.resolve(
      `../../../docs/migrations/044_backend_match_waitlist_offers${suffix}`,
    ),
    'utf8',
  ).toLowerCase();
}

describe('migration 044 waitlist offer contract', () => {
  const migration = artifact('.sql');

  it('reserves one active 15-minute offer without weakening FIFO identity', () => {
    expect(migration).toContain('match_waitlist_offers_one_active_match');
    expect(migration).toContain("where status='active'");
    expect(migration).toContain(
      'foreign key (entry_id, match_id, account_id)',
    );
    expect(migration).toContain("command_type='accept'");
    expect(migration).toContain("command_type='decline'");
  });

  it('stores no message body, Telegram identifier, contact or payment field', () => {
    expect(migration).not.toMatch(/chat_id|telegram|phone|email|message_body/iu);
    expect(migration).not.toMatch(
      /paymentstatus|ownerpaid|holdamount|prepay/iu,
    );
  });

  it('ships read-only gates and a guarded, empty-only rollback', () => {
    expect(artifact('_PRECHECK.sql')).toContain('offers_target_absent');
    expect(artifact('_POSTCHECK.sql')).toContain('relation_fingerprint');
    const rollback = artifact('_ROLLBACK.sql');
    expect(rollback).toContain('rollback_blocked');
    expect(rollback).toContain('waitlist offer history exists');
    expect(rollback).toContain(
      'drop table backend_match.match_waitlist_offers restrict',
    );
    expect(artifact('_README.md')).toContain('unapplied_local_artifact');
  });
});
