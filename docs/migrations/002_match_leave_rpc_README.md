# 002 Match Leave RPC

## What It Adds

`002_match_leave_rpc.sql` adds `public.leave_match(p_match_id uuid)` for safe participant self-leave.

The function is `SECURITY DEFINER`, uses fixed `search_path = public, pg_temp`, accepts only `p_match_id`, and derives the user from `auth.uid()`.

## Behavior

- Locks the target `public.matches` row with `SELECT ... FOR UPDATE`.
- Rejects unauthenticated calls.
- Rejects missing matches.
- Rejects organizer self-leave.
- Allows only a real participant whose `auth.uid()` exists in both `participants` and `filledSlots`.
- Rejects completed, cancelled, disputed, pending-confirmation, or already-started matches.
- Treats the current frontend/live-fixture slot shape as the source for per-participant payment fields:
  - expected slot fields include `id`, `firstName`, `lastName`, `username`, `ratingIdx`, `numericRating`, `isVerified`, `sidePreference`, `isOrganizer`;
  - optional payment indicators are checked only if present on the slot: `paymentStatus`, `payment_status`, `paid`, `isPaid`.
- Removes only the current user's slot objects from `filledSlots`.
- Removes only `auth.uid()::text` from `participants`.
- Updates `updated_at`.
- If a public `match` in `upcoming` or `confirmed` becomes incomplete, returns it to `open`.
- Returns the updated `public.matches` row.

The function is atomic: either `filledSlots` and `participants` are updated together, or no row changes are committed.

## Grants

The migration revokes execution from `public` and `anon`, and grants execution only to `authenticated`.

## How To Apply On Staging

1. Apply `002_match_leave_rpc.sql` manually in the staging Supabase SQL Editor.
2. Run `002_match_leave_rpc_POSTCHECK.sql`.
3. Confirm `postcheck.postcheck_ok` is `true`.
4. Run the targeted live test `SC-022`.

Do not apply this to production until staging is green.

## Rollback

`002_match_leave_rpc_ROLLBACK.sql` revokes grants and drops only `public.leave_match(uuid)`.

If an older draft function with the same name from `001_security_and_atomic_join.sql` had been applied before this migration, rollback removes the name entirely. Reapply the older function manually only if that older behavior is intentionally needed.
