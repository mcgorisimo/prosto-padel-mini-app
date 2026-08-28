import { readFileSync } from 'node:fs';

function artifact(suffix: string): string {
  return readFileSync(
    require.resolve(
      `../../../docs/migrations/043_backend_telegram_notification_intents${suffix}`,
    ),
    'utf8',
  ).toLowerCase();
}

describe('migration 043 Telegram notification intents contract', () => {
  const migration = artifact('.sql');

  it('keeps recipient identity, category preferences and pending work durable', () => {
    expect(migration).toContain(
      'primary key (event_key, recipient_account_id)',
    );
    expect(migration).toContain('telegram_match_activity_enabled boolean');
    expect(migration).toContain('telegram_chat_messages_enabled boolean');
    expect(migration).toContain('telegram_match_reminders_enabled boolean');
    expect(migration).toContain('telegram_booking_updates_enabled boolean');
    expect(migration).toContain("where status='pending'");
    expect(migration).toContain('yclients_reconciliation_leases');
    expect(migration).toContain('034_backend_match_reservation_links');
    expect(migration).not.toContain(
      "('backend_reservation.court_reservations',\n       '033_backend_reservation_persistence')",
    );
  });

  it('contains no provider payload, PII, payment state or YCLIENTS write', () => {
    expect(migration).not.toMatch(
      /phone|email|telegram_proof|record_hash_ciphertext\s+text/iu,
    );
    expect(migration).not.toMatch(
      /paymentstatus|ownerpaid|holdamount|prepay/iu,
    );
    expect(migration).not.toMatch(
      /insert into yclients|update yclients|delete from yclients/iu,
    );
  });

  it('ships explicit precheck, postcheck and guarded rollback artifacts', () => {
    expect(artifact('_PRECHECK.sql')).toContain('target_schema_absent');
    const postcheck = artifact('_POSTCHECK.sql');
    const rollback = artifact('_ROLLBACK.sql');
    expect(postcheck).toContain('rate_budget_ready');
    expect(postcheck).toContain('relation_fingerprint');
    expect(postcheck).toContain(
      'backend_notification.telegram_delivery_rate_budget',
    );
    expect(postcheck).toContain(
      'backend_notification.yclients_reconciliation_leases',
    );
    expect(postcheck).toContain('column acl differs');
    expect(rollback).toContain('rollback_blocked');
    expect(rollback).toContain('schema inventory differs');
    expect(rollback).toContain('043_backend_telegram_notification_intents:');
    expect(rollback).toContain('drop schema backend_notification restrict');
    expect(rollback).not.toContain('drop schema backend_notification cascade');
    expect(rollback).toContain('038_backend_account_notification_preferences:');
    expect(artifact('_README.md')).toContain('unapplied_local_artifact');
  });
});
