import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLEANUP = readFileSync(
  resolve(
    __dirname,
    '../../../docs/migrations/D2_legacy_unbound_reservation_cleanup.sql',
  ),
  'utf8',
);
const MIGRATION_033 = readFileSync(
  resolve(
    __dirname,
    '../../../docs/migrations/033_backend_reservation_persistence.sql',
  ),
  'utf8',
);

const TARGET_IDS = Object.freeze([
  '1e1fa95a-c042-4141-a922-29a0d78bf61f',
  '3d49b170-61a6-4b77-b497-ad62b4f414f6',
  '4257aa93-00ee-4c2d-b971-1111a07a71f5',
  '48c74dee-5248-4f75-8fc7-cfafc4a3223c',
  '94105b19-c497-4ff3-816b-bc28691daab5',
  '953f1810-9a65-4a1b-bee5-c2b9d9cd4f12',
  'b286b04e-66af-4237-84fb-10bc2a9c99c9',
  'd7a8a984-7131-4047-94da-38e39c5b597a',
]);
const PENDING_IDS = Object.freeze([
  '1e1fa95a-c042-4141-a922-29a0d78bf61f',
  '4257aa93-00ee-4c2d-b971-1111a07a71f5',
  '48c74dee-5248-4f75-8fc7-cfafc4a3223c',
  '94105b19-c497-4ff3-816b-bc28691daab5',
  'd7a8a984-7131-4047-94da-38e39c5b597a',
]);
const UNKNOWN_IDS = Object.freeze([
  '3d49b170-61a6-4b77-b497-ad62b4f414f6',
  '953f1810-9a65-4a1b-bee5-c2b9d9cd4f12',
  'b286b04e-66af-4237-84fb-10bc2a9c99c9',
]);
const NEGATIVE_CONTROL = '2cf39988-358d-4009-b64c-c017d3c1d0b5';
const EXPECTED_SHA256 =
  'f6a9e06ea416198a248d586db604cf3a4e9eb3b8ef3a6c80be7b49e743eb8142';

function executableSql(value: string): string {
  return value
    .replace(/^\s*--.*$/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function updatedColumnSets(table: string): string[][] {
  const pattern = new RegExp(
    `update backend_reservation\\.${table} \\w+\\s+set ([\\s\\S]*?)\\s+where`,
    'giu',
  );

  return [...CLEANUP.matchAll(pattern)].map((match) =>
    match[1]
      .split(',')
      .map((assignment) => assignment.trim().match(/^([a-z_]+)\s*=/iu)?.[1])
      .filter((column): column is string => column !== undefined),
  );
}

function declaredStatusSets(name: 'pending' | 'unknown'): string[][] {
  const pattern = new RegExp(
    `v_${name}_ids constant uuid\\[\\] := array\\[([\\s\\S]*?)\\]::uuid\\[\\];`,
    'gu',
  );

  return [...CLEANUP.matchAll(pattern)].map((match) =>
    [...match[1].matchAll(/'([0-9a-f-]{36})'/gu)]
      .map((id) => id[1])
      .sort(),
  );
}

describe('D2 legacy unbound reservation cleanup script contract', () => {
  it('is cryptographically pinned to the reviewed exact script bytes', () => {
    const canonicalGitBytes = CLEANUP.replace(/\r\n/gu, '\n');

    expect(CLEANUP).not.toMatch(/\r(?!\n)/u);
    expect(createHash('sha256').update(canonicalGitBytes).digest('hex')).toBe(
      EXPECTED_SHA256,
    );
  });

  it('contains only the eight closed targets and one immutable negative control', () => {
    const ids = [
      ...CLEANUP.matchAll(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
      ),
    ].map((match) => match[0].toLowerCase());

    expect([...new Set(ids)].sort()).toEqual(
      [...TARGET_IDS, NEGATIVE_CONTROL].sort(),
    );
    for (const id of TARGET_IDS) {
      expect(ids.filter((candidate) => candidate === id).length).toBeGreaterThan(1);
    }
    expect(ids.filter((id) => id === NEGATIVE_CONTROL).length).toBeGreaterThan(1);
  });

  it('pins the current five-pending and three-unknown precheck split', () => {
    expect(declaredStatusSets('pending')).toEqual([
      [...PENDING_IDS].sort(),
      [...PENDING_IDS].sort(),
    ]);
    expect(declaredStatusSets('unknown')).toEqual([
      [...UNKNOWN_IDS].sort(),
      [...UNKNOWN_IDS].sort(),
    ]);
    expect(CLEANUP.match(/if v_count <> 5 then/gu)).toHaveLength(2);
    expect(CLEANUP).not.toContain('if v_count <> 6 then');
    expect(CLEANUP).toContain(
      "('3d49b170-61a6-4b77-b497-ad62b4f414f6'::uuid, 'unknown'::text)",
    );
  });

  it('atomically claims a no-clobber path before transaction and backup', () => {
    const sql = executableSql(CLEANUP);
    const claim =
      '/cleanup-artifacts/d2-legacy-unbound-reservations-claim';
    const backup = `${claim}/backup.jsonl`;
    const claimIndex = CLEANUP.indexOf(`mkdir -m 0700 ${claim}`);
    const transactionIndex = CLEANUP.indexOf('begin isolation level serializable');
    const backupIndex = CLEANUP.indexOf(`\\g ${backup}`);
    const firstUpdateIndex = CLEANUP.search(
      /update backend_reservation\.(court_reservations|reservation_operations|reservation_slot_holds)/iu,
    );

    expect(CLEANUP).toContain('\\set ON_ERROR_STOP on');
    expect(CLEANUP).toContain('\\pset format unaligned');
    expect(CLEANUP).toContain('\\pset tuples_only on');
    expect(sql).toContain('begin isolation level serializable');
    expect(sql).toContain("set local statement_timeout = '30s'");
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain('set local role backend_auth_owner');
    expect(CLEANUP).toContain(`umask 077 && mkdir -m 0700 ${claim}`);
    expect(CLEANUP).toContain(`stat -c '%u:%a' ${claim}`);
    expect(CLEANUP).toContain('= "0:700"');
    expect(CLEANUP).not.toContain(`test ! -e ${backup}`);
    expect(CLEANUP).not.toMatch(/\\!\s+(rm|rmdir)\b/u);
    expect(CLEANUP).toContain(`chmod 0600 ${backup}`);
    expect(CLEANUP).toContain(
      `stat -c '%u:%a' ${backup}`,
    );
    expect(CLEANUP).toContain('= "0:600"');
    expect(CLEANUP).toContain(`wc -l < ${backup}`);
    expect(CLEANUP).toContain(`sync ${backup}`);
    expect(CLEANUP).toContain(`sync -f ${claim}`);
    expect(CLEANUP).toContain('sync -f /cleanup-artifacts');
    expect(claimIndex).toBeGreaterThan(0);
    expect(transactionIndex).toBeGreaterThan(claimIndex);
    expect(backupIndex).toBeGreaterThan(transactionIndex);
    expect(firstUpdateIndex).toBeGreaterThan(backupIndex);
  });

  it('locks the closed rows in reservation-operation-hold-snapshot order', () => {
    const precheck = CLEANUP.slice(
      CLEANUP.indexOf('do $precheck$'),
      CLEANUP.indexOf('$precheck$;') + '$precheck$;'.length,
    );
    const reservation = precheck.indexOf(
      'from backend_reservation.court_reservations reservation_row',
    );
    const operation = precheck.indexOf(
      'from backend_reservation.reservation_operations operation_row',
    );
    const hold = precheck.indexOf(
      'from backend_reservation.reservation_slot_holds hold_row',
    );
    const snapshot = precheck.indexOf(
      'from backend_reservation.reservation_operation_client_snapshots snapshot_row',
    );

    expect(reservation).toBeGreaterThan(0);
    expect(operation).toBeGreaterThan(reservation);
    expect(hold).toBeGreaterThan(operation);
    expect(snapshot).toBeGreaterThan(hold);
    expect(precheck.match(/for update;/gu)).toHaveLength(4);
    expect(precheck).toContain('pg_try_advisory_xact_lock(2079564, 20260809)');
  });

  it('uses exact precheck counts and never broadens the target set', () => {
    const precheck = CLEANUP.slice(
      CLEANUP.indexOf('do $precheck$'),
      CLEANUP.indexOf('$precheck$;') + '$precheck$;'.length,
    );

    expect(precheck).toContain('if v_count <> 9 then');
    expect(precheck.match(/if v_count <> 8 then/gu)).toHaveLength(7);
    expect(precheck).toContain("reservation_row.status = 'cancelled'");
    expect(precheck).toContain('reservation_row.terminal_at is not null');
    expect(precheck).toContain('and hold_row.released_at is null');
    expect(precheck).toContain('if v_cleanup_at < v_latest_updated_at then');
    expect(precheck).toContain('operation_row.actor_account_id = operation_row.owner_account_id');
    expect(precheck).toContain("operation_row.operation_type = 'create'");
    expect(precheck).toContain('snapshot_row.crypto_destroyed_at is null');
  });

  it('encodes only the migration-033 compatible terminal transition', () => {
    const sql = executableSql(CLEANUP);
    const migration = executableSql(MIGRATION_033);

    expect(sql).toContain("set status = 'unknown'");
    expect(sql).toContain("set status = 'rejected'");
    expect(sql).toContain("set status = 'reconciled'");
    expect(sql).toContain("reconciliation_outcome = 'rejected'");
    expect(sql).toContain(
      "rejection_reason = 'admin_confirmed_legacy_unbound_cleanup'",
    );
    expect(sql).toContain('reconciliation_attempts = operation_row.reconciliation_attempts + 1');
    expect(sql).toContain('released_at = v_cleanup_at');
    expect(migration).toContain(
      "status = any (array['cancelled', 'rejected']::text[]) and terminal_at is not null",
    );
    expect(migration).toContain(
      "status <> all (array[ 'confirmed', 'reschedule_pending', 'cancel_pending', 'cancelled' ]::text[]) or yclients_record_hash_ciphertext is not null",
    );
    expect(migration).toContain(
      "status = 'reconciled' and unknown_at is not null and terminal_at is not null and reconciled_at is not null",
    );
  });

  it('updates only terminal metadata and releases holds without deletion', () => {
    const sql = executableSql(CLEANUP);

    expect(updatedColumnSets('court_reservations')).toEqual([
      ['status', 'version', 'updated_at', 'status_changed_at', 'terminal_at'],
      ['status', 'version', 'updated_at', 'status_changed_at', 'terminal_at'],
    ]);
    expect(updatedColumnSets('reservation_operations')).toEqual([
      ['status', 'unknown_at', 'version', 'updated_at'],
      [
        'status',
        'terminal_at',
        'reconciled_at',
        'reconciliation_outcome',
        'rejection_reason',
        'reconciliation_attempts',
        'last_reconciliation_at',
        'version',
        'updated_at',
      ],
    ]);
    expect(updatedColumnSets('reservation_slot_holds')).toEqual([
      ['released_at', 'updated_at', 'version'],
    ]);
    expect(sql).not.toMatch(/\bdelete\s+from\b/u);
    expect(sql).not.toMatch(/\btruncate\b/u);
    expect(sql).not.toMatch(/\b(drop|alter|create)\s+(table|schema)\b/u);
    expect(sql).not.toMatch(
      /\bupdate\s+backend_reservation\.reservation_operation_client_snapshots\b/u,
    );
    expect(sql).not.toMatch(/\b(payment_status|owner_paid|hold_amount|prepay)\b/u);
  });

  it('requires postcheck before the single commit and emits only fixed safe counts', () => {
    const sql = executableSql(CLEANUP);
    const postcheckIndex = sql.indexOf('do $postcheck$');
    const commitIndex = sql.indexOf('commit;');

    expect(postcheckIndex).toBeGreaterThan(0);
    expect(commitIndex).toBeGreaterThan(postcheckIndex);
    expect(sql.match(/\bcommit;/gu)).toHaveLength(1);
    expect(sql).toContain('if v_count <> 0 then raise exception');
    expect(sql).toContain('if v_count <> 8 then raise exception');
    expect(sql).toContain("select 'd2_legacy_unbound_cleanup_pass'::text as result");
    expect(sql).toContain('8::integer as reservations_rejected');
    expect(sql).toContain('8::integer as holds_released');
  });
});
