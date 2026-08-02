# Migration 028: backend admin capability grants

## Purpose

This storage-only migration allows a normal backend player account to receive
an independently revocable administrative capability without changing the
immutable `backend_auth.accounts.role` binding.

It does not delete or recreate an account, change a player's profile, grant
access to Gor or any other environment-specific account, expose an HTTP
endpoint, or switch the frontend. Gor remains a `player`, so his matches,
rating, profile, Telegram identity, and history stay intact.

## Storage contract

`backend_auth.admin_capability_events` is an append-only operator audit stream.
It contains deterministic `event_order`, account binding, the only supported
capability (`club_admin`), the event (`granted` or `revoked`), a closed reason
code, and the application timestamp.

The active state is the newest event for an account and capability ordered by
`event_order DESC`:

- newest event `granted` means access is active;
- newest event `revoked` means access is inactive;
- no event means access is inactive.

The account foreign key is indexed by
`admin_capability_events_account_latest_idx`. No row is created by the
migration, and no environment account UUID is committed to the repository.

## Privilege boundary

`backend_auth_app` receives only `SELECT` on the event table. It receives no
sequence privilege and cannot grant, revoke, rewrite, or delete capability
history. `PUBLIC` receives nothing. Capability provisioning is an explicit
database-operator action performed as `backend_auth_owner` while the backend is
stopped.

The backend must authorize administrative work only when:

1. the Bearer principal's account is active; and
2. either its immutable role is `club_admin`, or its newest `club_admin`
   capability event is `granted`.

The repository must evaluate the account and newest event in one transaction.
Every future capability writer must lock the target `accounts` row before
inserting an event, so concurrent grant/revoke operations are serialized before
the identity order is allocated.
The frontend must consume a backend capability result; the legacy Supabase
`public.profiles.role` is not authoritative for this grant.

## Files

- `028_backend_admin_capability_grants_PRECHECK.sql` — read-only baseline.
- `028_backend_admin_capability_grants.sql` — creates the empty event stream.
- `028_backend_admin_capability_grants_POSTCHECK.sql` — exact catalog, ACL,
  constraint, and index validation.
- `028_backend_admin_capability_grants_ROLLBACK.sql` — removes only unused,
  empty storage under `ACCESS EXCLUSIVE` locks.
- `028_backend_admin_capability_grants_README.md` — this runbook.

## Test rollout

1. Confirm the test repository is clean and at the reviewed commit.
2. Stop the backend and keep every `backend_auth` writer frozen.
3. Create and publish a database backup.
4. Run PRECHECK and save its JSON object and checksum.
5. Apply migration 028 with `ON_ERROR_STOP=1`.
6. Run POSTCHECK and save its JSON object and checksum.
7. Confirm all pre-existing row counts and fingerprints are unchanged, the
   table count and sequence count each increased by one, the constraint count
   increased by eight, and the new table is empty.
8. Roll out the reviewed backend capability reader.
9. With the backend still stopped, insert one reviewed `granted` event for the
   exact Gor account UUID using a fresh UUID and current Unix time. Re-read the
   event and the account binding before restarting the backend.
10. Verify Gor remains `role=player,status=active`, receives admin access, and
    retains player profile, rating, matches, and Telegram login.

Never update `backend_auth.accounts.role`, delete Gor, reuse a grant event UUID,
or store the environment-specific account UUID in this migration.

## Rollback

Rollback is allowed only while the event table is empty and all writers remain
stopped. It locks `accounts` and the event table in dependency order before the
emptiness check. After Gor receives the first event, rollback must refuse and a
reviewed forward migration must be used.

## Next slice

After migration review and rollout:

1. change the backend admin authorization boundary to accept the newest active
   capability event as well as a dedicated `club_admin` role;
2. add repository/service regressions for player without grant, granted player,
   revoked player, blocked player, and dedicated admin;
3. expose backend admin capability to the authenticated frontend session;
4. replace the frontend's Supabase admin-role check;
5. provision Gor on test only after those checks pass.
