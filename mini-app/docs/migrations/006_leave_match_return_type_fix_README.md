# 006 Leave Match Return-Type Fix

## Purpose

`001_security_and_atomic_join.sql` defines `public.leave_match(uuid)` with
`returns jsonb`. PostgreSQL cannot change that return type to `public.matches`
with `CREATE OR REPLACE FUNCTION`, so the original `002_match_leave_rpc.sql`
cannot safely replace an applied `001` function.

This kit fixes only that deployment problem. It does not alter tables or
existing rows, and it does not change the frontend contract.

## Files

- `006_leave_match_return_type_fix_PRECHECK.sql` — read-only catalog inspection.
- `006_leave_match_return_type_fix.sql` — transactional replacement.
- `006_leave_match_return_type_fix_POSTCHECK.sql` — read-only verification.
- `006_leave_match_return_type_fix_ROLLBACK.sql` — state-aware rollback.

## Supported Starting States

The migration accepts exactly these states for `public.leave_match(uuid)`:

- `absent` — the function has not been installed;
- `legacy_jsonb` — the function from `001` is installed;
- `current_matches` — the current `002` logic returning `public.matches` is
  already installed.

An unexpected return type, a `public.matches` function without the expected
`002` safety checks, a set-returning function, a missing `public.matches` type,
or another `leave_match` overload aborts the migration before the existing
function is dropped.

## Replacement and Atomicity

The migration runs `DROP FUNCTION` and `CREATE FUNCTION` in one transaction.
This is required to change the return type. If creation, grants, or comments
fail, PostgreSQL rolls back the whole transaction and restores the previous
function automatically.

The new function body is the current logic from `002_match_leave_rpc.sql`:

- locks one match row with `SELECT ... FOR UPDATE`;
- derives the player from `auth.uid()`;
- rejects the owner and organizer slot;
- rejects non-participants, started/final matches, and paid slots;
- removes only the current user from `participants` and `filledSlots`;
- updates both fields atomically and returns the updated `public.matches` row;
- grants execution only to `authenticated`.

## Manual Staging Application

Do not run any file from this kit on production first.

1. In the **staging** Supabase SQL Editor, run
   `006_leave_match_return_type_fix_PRECHECK.sql`.
2. Confirm all of the following in its single JSON result:
   - `precheck.precheck_ok` is `true`;
   - `precheck.detected_state` is `absent`, `legacy_jsonb`, or
     `current_matches`;
   - `precheck.extra_leave_match_overloads` is empty.
3. Save the reported `detected_state` with the staging rollout notes.
4. In the same staging project, run the complete
   `006_leave_match_return_type_fix.sql` file as one SQL Editor execution.
5. Run `006_leave_match_return_type_fix_POSTCHECK.sql`.
6. Confirm `postcheck.postcheck_ok` is `true`. Also confirm:
   - the result type is `public.matches` (PostgreSQL may display `matches`);
   - `checks.signature_and_return_type_ok`, `security_ok`, `grants_ok`,
     `core_logic_ok`, `rollback_marker_ok`, and `no_extra_overloads` are all
     `true`.
7. Only after the catalog checks pass, run the existing targeted staging
   leave-match scenario. Do not run the full E2E suite for this migration.
8. Do not apply to production until the staging result and targeted scenario
   have been reviewed.

## Rollback

Run `006_leave_match_return_type_fix_ROLLBACK.sql` only on the staging project
where `006` was applied. It reads the state recorded in the function comment:

- `legacy_jsonb` — restores the exact legacy implementation from `001`, its
  `jsonb` response envelope, and authenticated-only execution;
- `absent` — removes `public.leave_match(uuid)`;
- `current_matches` — performs no change because the previous version already
  had the current return type.

The rollback is transactional and aborts without changes if its marker is
missing. After rollback, rerun the PRECHECK and compare `detected_state` with
the value saved in step 3.

The legacy rollback intentionally restores legacy behavior, including its lack
of `filledSlots` and paid-slot handling. Use it only to return staging to the
recorded pre-migration state.
