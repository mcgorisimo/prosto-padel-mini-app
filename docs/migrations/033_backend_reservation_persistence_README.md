# Migration 033: backend reservation persistence

Status: `prepared_for_review`, `not_applied`. Applying this migration, connecting
runtime code, or updating Selectel requires a separate explicit owner approval.

## Purpose and boundaries

This expand-only migration prepares a new `backend_reservation` schema with:

- `court_reservations`;
- `reservation_operations`;
- normalized `reservation_slot_holds` for current and reschedule-target intervals;
- one-to-one encrypted `reservation_operation_client_snapshots`;
- append-only `reservation_admin_read_audit_events`.

It does not modify existing tables, endpoints, controllers, modules, environment
configuration, webhook behavior, or YCLIENTS writes. It performs no backfill and
inserts no reservation or client data. Runtime remains disconnected.

## Privacy and access contract

Raw `fullName`, `phone`, `email`, and YCLIENTS record hash are never columns.
Application-layer AEAD produces ciphertext, nonce, authentication tag, algorithm
metadata, and key versions. Each client snapshot uses its own random data
encryption key (DEK); PostgreSQL stores only the AEAD-wrapped DEK. Per-snapshot
crypto erase nulls the wrapped-DEK ciphertext/nonce/tag/algorithm/key version and
sets `crypto_destroyed_at`. A transition trigger makes this irreversible while
retaining the opaque content ciphertext for audit. Plain DEKs, wrapping keys and
HMAC keys stay outside PostgreSQL. Keyed digests support equality/idempotency
without plain PII hashes.

Decryption remains backend-only. Future runtime wiring must enforce:

- owner-scoped reads for an authenticated owner;
- full snapshot reads for authenticated `club_admin` only after backend RBAC;
- denial of another player's data;
- fail-closed insertion of one admin-read audit event before returning decrypted
  data;
- exclusion of PII, ciphertext, keys, and provider bodies from logs/errors/traces.

The audit relation stores only actor, reservation/operation references, time,
fixed purpose/endpoint codes, and UUID request/correlation metadata. It has no
JSON or free-form payload. The application role receives append-only column
privileges; update/delete/truncate are also rejected by immutable triggers.

The existing `backend_auth.security_audit_events` ledger is not reused: its
event/aggregate allowlists and `operation_id` FK are auth-specific. Reuse would
require altering an existing migration-015 table and still would not provide a
reservation-operation FK or bounded purpose/endpoint fields.

## Concurrency and provider boundaries

- `(owner_account_id, idempotency_key)` binds idempotent retries.
- A partial unique index permits one `pending`/`unknown` operation per reservation.
- `reservation_slot_holds` is the single allocation relation. Its GiST exclusion
  rejects every overlapping `[starts_at, ends_at)` interval between different
  reservations for the same company/resource, not only equal start times.
- A reservation current hold remains active through `unknown`, `cancel_pending`,
  and `reschedule_pending`. Starting reschedule inserts a second
  `reschedule_target` hold linked by FK to that exact reschedule operation, so the
  old and proposed intervals are held together.
- An INSERT guard verifies that a current hold exactly matches its reservation
  interval and that a target hold exactly matches its immutable reschedule
  operation. Hold binding/interval fields cannot be updated; release is
  optimistic-versioned and irreversible.
- Confirmed reschedule atomically releases both old/current and pending-target
  rows before inserting the new current hold. Rejected reschedule releases only
  its target hold. Unknown never releases either hold.
- Reservation updates carry a positive optimistic `version`; repository wiring
  must combine row locking with version comparison.
- DB CHECK constraints permit create only from `unbooked`/`rejected`, and
  reschedule/cancel only from previous status `confirmed`.
- YCLIENTS record ID and keyed record-hash bindings are company-scoped.
- `external_api_id` is persisted as a positive server-derived value and has a
  non-unique lookup index only. No uniqueness/idempotency claim is made until the
  YCLIENTS provider contract is confirmed.
- Appointment and provider client IDs have lookup indexes only; no unsupported
  uniqueness assumption is encoded.

The migration requires the canonical `btree_gist` extension installed by the
existing backend match foundation; migration 033 never installs or alters it.

The migration cannot enforce authorization or atomic audit-on-read by itself.
Those are mandatory future repository/service transaction tests before any
runtime wiring. Direct database access is not an end-user authorization surface.

## Files and ordering

1. `033_backend_reservation_persistence_PRECHECK.sql` — read-only foundation and
   absence check.
2. `033_backend_reservation_persistence.sql` — atomic expand-only schema creation.
3. `033_backend_reservation_persistence_POSTCHECK.sql` — read-only exact catalog,
   ACL, fingerprint, immutability, and empty-state validation.
4. `033_backend_reservation_persistence_ROLLBACK.sql` — guarded empty-schema-only
   rollback.

The migration is intentionally one-shot and transactional. A second invocation
fails closed on the existing target before DDL; it does not partially repair or
silently accept drift.

## Future approved application procedure

These commands are documented but must not be run until the owner separately
approves applying migration 033:

1. Confirm the exact reviewed commit and a clean test checkout.
2. Create and verify a Selectel test database backup.
3. Run PRECHECK and archive its output/checksum.
4. Apply migration 033 with `ON_ERROR_STOP=1`.
5. Run POSTCHECK and archive its output/checksum.
6. Keep reservation runtime wiring disabled; verify existing backend health and
   auth flows remain unchanged.
7. Review and deploy repository/encryption/RBAC/audit code in a later commit.

## Rollback boundary

Rollback locks all five relations and succeeds only while all are empty. After
the first reservation, operation, slot hold, snapshot, or audit event, it
refuses and a reviewed forward migration must preserve history. The rollback
contains no `CASCADE` and never modifies pre-existing schemas or tables.
