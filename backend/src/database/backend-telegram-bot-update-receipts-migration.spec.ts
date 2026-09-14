import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function artifact(name: string): string {
  return readFileSync(
    join(
      __dirname,
      '../../../docs/migrations',
      `045_backend_telegram_bot_update_receipts${name}.sql`,
    ),
    'utf8',
  );
}

describe('migration 045 Telegram bot update receipts', () => {
  it('stores only bounded per-bot receipts with no Telegram payload or identity', () => {
    const migration = artifact('');

    expect(migration).toContain(
      'create table backend_notification.telegram_bot_update_receipts',
    );
    expect(migration).toContain('constraint telegram_bot_update_receipts_pkey');
    expect(migration).toContain('update_id between 0 and 2147483647');
    expect(migration).toContain("'045_backend_telegram_bot_update_receipts:'");
    expect(migration).not.toMatch(
      /chat_id|telegram_id|username|first_name|last_name|message_text|update_body|bot_token/iu,
    );
  });

  it('keeps apply, precheck, postcheck and rollback fail closed', () => {
    const migration = artifact('');
    const precheck = artifact('_PRECHECK');
    const postcheck = artifact('_POSTCHECK');
    const rollback = artifact('_ROLLBACK');

    for (const sql of [migration, precheck, postcheck, rollback]) {
      expect(sql).toContain('expected_database');
      expect(sql).toContain('ON_ERROR_STOP');
    }
    expect(migration).toContain('migration 043 differs');
    expect(precheck).toContain('migration_045_target_absent');
    expect(postcheck).toContain('migration_045_fingerprint_matches');
    expect(postcheck).toContain('receipts_start_empty');
    expect(rollback).toContain('target differs');
  });
});
