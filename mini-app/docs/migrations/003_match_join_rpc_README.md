# 003 Match Join RPC

## What It Adds

`003_match_join_rpc.sql` adds `public.join_match(p_match_id uuid)` for safe self-join into public matches.

The function is `SECURITY DEFINER`, uses fixed `search_path = public, pg_temp`, accepts only `p_match_id`, and derives the player from `auth.uid()`.

## Behavior

- Locks the target `public.matches` row with `SELECT ... FOR UPDATE`.
- Rejects unauthenticated calls.
- Rejects missing matches.
- Rejects organizer self-join.
- Allows only `type = 'match'` and `isPrivate = false`.
- Allows only currently joinable statuses used by the app flow: `open`, `searching`, `upcoming`, `confirmed`.
- Rejects matches that already started.
- Rejects duplicate membership in either `participants` or `filledSlots`.
- Reads the player row from `public.profiles`; no user id, rating, profile, or slot data is accepted from the client.
- Converts `profiles.rating` to the current test/frontend `ratingIdx` bands and checks it against `matches.ratingMin` / `matches.ratingMax`.
- Uses the existing app persistence capacity rule: 4 filled slots.
- Appends the server-built player slot to the compact `filledSlots` array. In the current app data model, `filledSlots` is compacted with `filter(Boolean)`, so the first free slot is the next array position after existing filled slots.
- Adds `auth.uid()::text` to `participants` once.
- Updates `updated_at`.
- Returns the updated `public.matches` row.

The slot object is built from `public.profiles` with the existing frontend/live fixture keys:

- `id`
- `firstName`
- `lastName`
- `ratingIdx`
- `numericRating`
- `isVerified`
- `isOrganizer`

This intentionally mirrors the current self-join slot written by `MatchDetailsScreen.jsx`. Existing live fixture slots may contain additional public profile fields such as `username` and `sidePreference`, but the current frontend self-join path does not write them.

## Status Rules

The status update mirrors the current `deriveParticipantsAndStatus` behavior in `src/App.jsx`:

- `searching` stays `searching`;
- `confirmed` stays `confirmed` only when the match is full, otherwise becomes `open`;
- other non-final statuses become `upcoming` when 4 slots are filled, otherwise `open`.

## Concurrency

Concurrent joins serialize on the locked `matches` row. If only one slot is left, the first transaction appends the player and commits; the second transaction sees the updated `filledSlots` count after acquiring the lock and raises `Match has no free slots`.

## Grants

The migration revokes execution from `public` and `anon`, and grants execution only to `authenticated`.

## How To Apply On Staging

1. Apply `003_match_join_rpc.sql` manually in the staging Supabase SQL Editor.
2. Run `003_match_join_rpc_POSTCHECK.sql`.
3. Confirm `postcheck.postcheck_ok` is `true`.
4. Only after frontend is switched to this RPC, run targeted live tests for `SC-008` and `SC-027`.

Do not apply this to production until staging is green.

## Rollback

`003_match_join_rpc_ROLLBACK.sql` revokes grants and drops only `public.join_match(uuid)`.

It does not delete tables, matches, messages, profiles, or any user data.

## Known Boundary

This migration follows the current `App.jsx` persistence rule that treats 4 filled slots as full. The display layer also derives a visual capacity from `courtType`, but frontend code was intentionally not changed in this stage.
