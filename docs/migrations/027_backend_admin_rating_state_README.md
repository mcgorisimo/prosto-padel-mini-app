# Migration 027: backend admin rating state

## Purpose

This storage-only migration prepares the backend-owned administrative rating
and verification writer. It does not expose an HTTP endpoint, switch the
frontend, provision a `club_admin`, or change any current player state.

The existing Supabase admin RPC updates `public.profiles`. Backend match
eligibility and the server rating writer instead use
`backend_auth.player_rating_states`; the two stores are not synchronized.
Migration 027 creates the immutable backend command/audit boundary needed to
retire that split-brain write path safely.

## Storage contract

`backend_auth.player_rating_admin_commands` is both:

- the immutable audit record for one administrative decision; and
- the idempotency binding for the client-supplied `command_id`.

Each row stores:

- the administrative actor account and target player account;
- a 32-byte digest of the exact canonical request;
- the fixed command type `set_player_rating_state`;
- the stable result type;
- rating and verification values before and after the command; and
- the application timestamp.

The result shape constraint permits exactly four outcomes:

- `rating_updated`;
- `verification_updated`;
- `rating_and_verification_updated`;
- `rating_state_unchanged`.

The actor foreign key references `backend_auth.accounts`, not
`player_profiles`, because a backend `club_admin` is deliberately not a player.
The target foreign key references the canonical player rating state.

Indexes cover actor history and target history. Both foreign-key leading
columns are indexed. The audit relation has no user trigger and is not exposed
through Supabase's `public` schema or Data API.

## Privilege boundary

Migration 026 already grants `backend_auth_app` column-level update access to:

- `player_rating_states.rating`;
- `player_rating_states.updated_at`.

Migration 027 adds only:

- `player_rating_states.is_verified` column-level `UPDATE`;
- `SELECT` and `INSERT` on the immutable command table.

It does not grant table-level `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, or
`TRIGGER`. The application cannot update or delete audit rows and cannot update
`account_id` or `created_at` in the current state table.

Database privileges are not end-user authorization. The later repository and
service must still fail closed unless all of the following are true:

1. the Bearer principal is an active `club_admin`;
2. the target is an active `player` with a complete rating state;
3. the request shape, UUIDs, digest, rating precision, and timestamp are valid;
4. an existing `command_id` has the same actor, target, and request digest;
5. the target rating row is locked before reading its old state and before
   inserting the command.

The later runtime transaction must lock the actor and target `accounts` rows in
ascending `account_id` order, then lock the target `player_rating_states` row,
update the state, and insert the command. This keeps the relation order
`accounts`, `player_rating_states`, `player_rating_admin_commands`, matching
account provisioning and rollback. It must make no external call while holding
those locks.

## Administrative identity boundary

Backend roles are currently exclusive: `player` or `club_admin`. The existing
player profile endpoint intentionally rejects `club_admin`. Therefore the MVP
admin flow requires a dedicated backend administrative account; promoting a
playing account would remove it from the player contour.

Migration 027 does not create or promote that account. Administrative account
provisioning and the frontend's current Supabase `admin` role mapping remain
separate reviewed steps.

## Files

- `027_backend_admin_rating_state_PRECHECK.sql` — read-only validation and
  baseline JSON.
- `027_backend_admin_rating_state.sql` — creates one append-only relation and
  adds the one column privilege.
- `027_backend_admin_rating_state_POSTCHECK.sql` — read-only exact allowlists,
  ACL checks, and post-migration JSON.
- `027_backend_admin_rating_state_ROLLBACK.sql` — removes the unused storage
  only while it is empty.
- `027_backend_admin_rating_state_README.md` — this runbook.

## Test rollout

Use the normal migration-cycle database and stop on the first error:

1. Confirm the repository is clean and at the reviewed commit.
2. Stop the backend and every other writer to `backend_auth` and
   `backend_match`. Keep the write freeze active through the POSTCHECK snapshot.
3. Create and publish a database backup.
4. Run `027_backend_admin_rating_state_PRECHECK.sql` and save its single JSON
   object plus checksum.
5. Apply `027_backend_admin_rating_state.sql` with `ON_ERROR_STOP=1`.
6. Run `027_backend_admin_rating_state_POSTCHECK.sql` and save its single JSON
   object plus checksum.
7. Compare the snapshots before releasing the write freeze:
   - both `ready` values are true and migration names match;
   - backend-auth table count increases by one;
   - backend-auth constraint count increases by nine;
   - user-trigger count is unchanged;
   - all pre-existing row counts are unchanged;
   - all pre-existing fingerprints except `player_rating_states` are unchanged;
   - `player_rating_admin_commands` contains zero rows and has a fingerprint;
   - `player_rating_states` row count is unchanged and its fingerprint changes
     only because `is_verified` became updateable by `backend_auth_app`.
8. Confirm the exact updateable-column allowlist is
   `rating,is_verified,updated_at` and no table-level update exists.
9. Restart the unchanged backend image only after every comparison succeeds.
10. Only then begin the separate backend repository/API implementation.

No backend or frontend rebuild is required for this storage-only rollout, but
the controlled backend stop/start is required to make the PRECHECK and
POSTCHECK row-count evidence deterministic.

## Rollback

Rollback is allowed only before the first administrative command and while all
backend writers remain stopped.

The rollback acquires `ACCESS EXCLUSIVE` locks in dependency order on
`accounts`, `player_rating_states`, and `player_rating_admin_commands`, checks
the audit table while writes are blocked, revokes only `is_verified` update
access, drops the empty audit table, and restores the migration 026
fingerprint.

If any command exists, rollback refuses. Preserve the audit and use a reviewed
forward migration instead.

## Next slice

After a successful POSTCHECK:

1. implement a keyset-paginated backend admin player list;
2. implement the idempotent rating-state command transaction;
3. enforce `club_admin` in the backend service, never only in the UI;
4. add unit and repository tests, including concurrent rating/admin writes;
5. roll out the backend and verify authorization boundaries;
6. then switch the three admin frontend files from Supabase to backend.
