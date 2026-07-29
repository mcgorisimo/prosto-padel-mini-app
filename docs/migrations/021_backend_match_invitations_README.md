# Migration 021 — backend-owned match invitations

Migration 021 adds private PostgreSQL storage for invitations belonging to
`backend_match.matches`. It does not copy or modify Supabase
`public.match_invitations`.

## Model

- `backend_match.match_invitations` stores the reserved slot and the
  `pending`, `accepted`, `declined` or `cancelled` lifecycle.
- `backend_match.match_invitation_commands` is an immutable idempotency ledger.
- The command ledger snapshots the resulting match status so a retry is not
  changed by later join or leave transitions.
- A pending invitation reserves exactly one backend slot (`2`, `3` or `4`).
- One player and one slot can each have only one pending invitation per match.
- Acceptance adds the invited player through the existing match state machine
  and closes the invitation in the same PostgreSQL transaction.

No plaintext session credential, Telegram identifier, phone, email or profile
name is stored in these relations.

## Scope

This migration changes no existing rows and does not alter migrations 015–020.
It does not add frontend behavior, notifications, Realtime, chat or waitlist.
The application role receives only the required `SELECT`, column-level
`INSERT`, and invitation terminal-state `UPDATE` privileges. It receives no
`DELETE`, schema `CREATE`, owner membership or grant option.

## Manual test rollout

1. Create and verify a database backup.
2. Run `021_backend_match_invitations_PRECHECK.sql`.
3. Review the PRECHECK result and stop on any error.
4. Apply `021_backend_match_invitations.sql`.
5. Run `021_backend_match_invitations_POSTCHECK.sql`.
6. Deploy the backend only after POSTCHECK succeeds.
7. Test create, incoming/outgoing list, accept, decline and cancel using two
   Telegram test accounts.
8. Verify that ordinary join cannot consume a slot reserved by a pending
   invitation and that repeated commands are idempotent.
9. Check backend and PostgreSQL logs for errors without logging credentials or
   request digests.

SQL files are never applied automatically by this repository.

## Rollback

Run `021_backend_match_invitations_ROLLBACK.sql` only before real invitation
history exists. It locks both new tables in a fixed order and refuses to
continue when either contains a row. It then drops only the two objects created
by migration 021. It never removes `backend_match`, matches, participants,
commands, accounts, profiles or rating state.

Once real invitations exist, use a separate reviewed fail-forward migration;
do not delete invitation history to force this rollback.
