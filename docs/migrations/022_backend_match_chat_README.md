# Migration 022 — backend-owned match chat storage

Migration 022 adds private PostgreSQL storage for messages belonging to
`backend_match.matches`. It does not copy or modify Supabase
`public.messages`.

## Model

- `backend_match.match_messages` is an immutable message log.
- Every message belongs to one backend-owned match and one trusted backend
  player profile.
- Message identifiers, sender identifiers and timestamps are backend-owned.
- Message bodies are non-empty, trimmed and limited to 2,000 characters.
- `backend_match.match_message_commands` is an immutable idempotency ledger.
- The command foreign key binds the message, match and actor together, so a
  command cannot claim a sender different from the stored message sender.
- The `(match_id, created_at DESC, id DESC)` index supports stable keyset
  pagination without `OFFSET`.

No plaintext session credential, Telegram identifier, phone, email or profile
name is stored in these relations. The message body is user content and must
not be copied into logs, database exception text or audit metadata.

## No legacy backfill

Migration 022 performs no backfill. There is no reviewed identity bridge
between Supabase `auth.uid()` / `public.matches` and backend account / match
identifiers. Guessing that mapping could attach a private conversation to the
wrong backend account or match.

Existing Supabase chat data remains unchanged and continues to belong only to
legacy matches. Backend-owned matches start with an empty backend chat.

## Scope and permissions

This migration changes no existing rows and does not alter migrations
015–021. It adds no backend repository, HTTP endpoint, frontend behavior,
Supabase Realtime publication, RLS policy, polling or WebSocket support.

The private `backend_match` schema remains owned by the existing NOLOGIN role
`backend_auth_owner`. Runtime role `backend_auth_app` receives only:

- table-level `SELECT` on the two new relations;
- column-level `INSERT` on the exact persistence columns.

It receives no table-level `INSERT`, `UPDATE`, `DELETE`, schema `CREATE`,
owner membership or grant option. Neither Supabase browser role receives any
access.

## Manual test rollout

1. Create and verify a database backup.
2. Run `022_backend_match_chat_PRECHECK.sql`.
3. Review and save the PRECHECK JSON; stop on any error.
4. Apply `022_backend_match_chat.sql`.
5. Run `022_backend_match_chat_POSTCHECK.sql`.
6. Compare PRECHECK and POSTCHECK catalog counts, row counts and fingerprints.
   Existing five `backend_match` relations must be unchanged, and both new
   chat relations must contain zero rows.
7. Deploy no backend or frontend chat code until POSTCHECK succeeds.

SQL files are never applied automatically by this repository.

## Rollback

Run `022_backend_match_chat_ROLLBACK.sql` only before real chat history exists.
It locks both tables in the same fixed parent-then-child order used by future
writes, verifies the migration fingerprints while those locks are held, and
refuses to continue when either contains a row. It then drops only the two
relations created by migration 022.

It never removes `backend_match`, matches, participants, match commands,
invitations, invitation commands, accounts, profiles or legacy Supabase
messages.

Once real chat history exists, use a separately reviewed fail-forward
migration; do not delete messages to force this rollback.

## Next slice

After a successful test POSTCHECK, implement a bearer-protected backend
repository and HTTP API for match-scoped keyset reads and idempotent message
sends. The first frontend version should use provider-neutral HTTP polling
only while the chat is open; Supabase Realtime is intentionally outside this
storage migration.
