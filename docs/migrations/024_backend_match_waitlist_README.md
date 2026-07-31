# Migration 024 — backend-owned match waitlist

Migration 024 adds private PostgreSQL storage for the FIFO waitlist belonging
to `backend_match.matches`. It does not copy or modify Supabase
`public.match_waitlist` rows.

## Model

- `backend_match.match_waitlist_entries` stores the `waiting`, `promoted`,
  `left` and `skipped` lifecycle.
- `backend_match.match_waitlist_commands` is an immutable idempotency ledger
  for client-originated join and leave commands.
- One account can have only one active waiting entry per match.
- FIFO order is defined by `(joined_at, id)` under the match row lock.
- Promotion closes the waiting entry in the same future transaction that
  creates the backend participant; no client-controlled participant binding is
  stored in the waitlist tables.
- Historical entries are retained, so leaving and later joining again creates
  a new entry without rewriting prior history.

No plaintext session credential, Telegram identifier, phone, email, profile
name or Supabase identifier is stored in these relations.

## Scope

This is a storage-only migration. It changes no existing rows and does not
alter migrations 015–023. The new backend waitlist starts empty; legacy
Supabase matches continue using their existing waitlist until their provider
flow is retired.

The migration does not add API endpoints, frontend behavior, Realtime or a
notification center. Promotion notifications remain a separate backend-owned
slice. The application role receives only `SELECT`, column-level `INSERT`, and
entry lifecycle `UPDATE` privileges. It receives no `DELETE`, table-wide
`INSERT` or `UPDATE`, schema `CREATE`, owner membership or grant option.

## Manual test rollout

1. Create and verify a database backup.
2. Run `024_backend_match_waitlist_PRECHECK.sql`.
3. Review the PRECHECK result and stop on any error.
4. Apply `024_backend_match_waitlist.sql`.
5. Run `024_backend_match_waitlist_POSTCHECK.sql`.
6. Confirm that both new tables are empty and existing relation row counts and
   fingerprints match the PRECHECK snapshot.
7. Deploy no backend or frontend waitlist behavior until its separate reviewed
   implementation is ready.

SQL files are never applied automatically by this repository.

## Future transaction contract

The backend lifecycle must lock the match row first and use the same lock order
for join, leave and promotion. Eligibility must use backend-owned active
participants, pending invitations and trusted rating state. Promotion must
select the first eligible `waiting` entry in `(joined_at, id)` order and create
the participant plus close the entry in one PostgreSQL transaction.

Client requests must not supply account IDs, command IDs, queue positions,
entry versions or participant IDs. Deterministic internal IDs and request
digests must be derived from the request key using operation-specific domains.

## Rollback

Run `024_backend_match_waitlist_ROLLBACK.sql` only before real waitlist history
exists. It takes `ACCESS EXCLUSIVE` locks on both new tables in a fixed order,
checks emptiness while those locks are held, and then drops only the two objects
created by migration 024.

Once real history exists, use a separate reviewed fail-forward migration; do
not delete entries or command bindings to force this rollback.
