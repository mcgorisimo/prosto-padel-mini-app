# Migration 026: backend match rating applications

## Purpose

Migration 026 prepares the storage and least-privilege boundary for
server-calculated rating changes after a backend-owned match result is
confirmed.

It creates no frontend flow and does not calculate or change any rating during
the migration. Supabase profiles, ratings, result RPCs, and auth data are not
read, copied, or modified.

## Why a new storage slice is required

The legacy flow calculates doubles Elo in `src/lib/ratingEngine.js`, derives
match counts from client-loaded matches, and sends ready-made `after` values to
the Supabase RPC. That is not a trusted rating boundary.

The backend already owns:

- neutral current state in `backend_auth.player_rating_states`;
- an immutable four-player lineup snapshot;
- score submission and opposing-team confirmation;
- an idempotent confirmation command inside one PostgreSQL transaction.

Migration 026 adds the missing immutable audit records and permits the backend
application role to update only `rating` and `updated_at`. It does not permit
the application to change `is_verified`.

## Relations

### `backend_match.match_rating_applications`

One immutable application per confirmed rated result and per match. It stores:

- the exact result and match binding;
- confirmed result version and winning team;
- both team rating averages before the match;
- the expected team 1 score;
- formula version `doubles_elo_v1`;
- confirming account and server application time.

### `backend_match.match_rating_changes`

Exactly four rows are written by the later backend transaction, one for every
locked lineup cell. Each immutable row stores:

- result, match, account, team, and court side;
- rating before, applied delta, and rating after;
- number of previously applied backend rated matches;
- selected K-factor and expected score;
- application time.

Keys prevent more than one change for an account or lineup cell in one result.
Foreign keys bind every change to the application and current backend rating
state. Indexes support player history and match-result reads.

## Formula contract for the later backend writer

The migration records formula version `doubles_elo_v1`; the later pure backend
calculator must implement the legacy product rule using trusted data:

1. Team rating is the arithmetic mean of the two locked player ratings.
2. `expectedTeam1 = 1 / (1 + 10 ^ ((team2Average - team1Average) / 4))`.
3. A player's K-factor is `0.4` before 10 previously applied backend rated
   matches and `0.1` afterwards.
4. Actual score is `1` for a winning-team player and `0` for a losing-team
   player.
5. Raw delta is `K * (actual - expected)`. Preserve the legacy team-2 rule by
   negating the team-1 raw delta rather than independently recomputing it.
6. Before adding the delta to the player's rating, round it exactly as the
   legacy JavaScript engine does:
   `roundedDelta = Math.round(rawDelta * 1000) / 1000`. This ordering is part
   of formula version `doubles_elo_v1`, including JavaScript's negative
   half-value behaviour.
7. Add `roundedDelta` to `before`, clamp to `0.00..10.00`, and store the result
   at the existing `numeric(4,2)` backend precision. Stored `rating_delta`
   equals the final persisted `after - before` exactly; it is therefore the
   effective two-decimal change, not the intermediate three-decimal value.

The backend calculator tests must include a rounding boundary where the
ordering is observable. For example, a `2.50 / 2.50` team losing to a
`2.50 / 2.66` team with K-factor `0.4` produces raw delta
`-0.1953956435...`, legacy `roundedDelta = -0.195`, and persisted rating
`2.31`; directly rounding `before + rawDelta` would incorrectly produce
`2.30`.

The previous-match count comes only from committed
`match_rating_changes`. Supabase history and client-loaded match lists are not
inputs. Migration 019 deliberately started the backend contour at `3.00`, so
all backend match counts begin at zero.

## Required confirmation transaction

The following backend slice must remain one short transaction:

1. lock the match and submitted result using the existing order;
2. verify that the match is a rating match and the four result accounts are
   distinct trusted lineup members;
3. lock all four `player_rating_states` rows in ascending `account_id` order;
4. fail closed if a state is missing, malformed, or not rating-verified;
5. calculate all four changes from the same locked before-state;
6. insert one application and four change rows;
7. update the four current ratings and timestamps;
8. confirm the result, complete the match, and insert the idempotent result
   command;
9. commit everything together.

A retry of the same confirmation command returns its immutable command result
without applying ratings again. A second command cannot rate an already
confirmed result. Unique application keys are the final database guard.

Non-rating matches continue through result confirmation without inserting
rating records or updating player ratings.

## Privileges

`backend_auth_owner` owns both new tables. `backend_auth_app` receives:

- `SELECT` and `INSERT` on the two immutable audit tables;
- column-level `UPDATE` only for
  `backend_auth.player_rating_states.rating` and `updated_at`.

The application receives no audit-table update/delete/truncate privileges and
no update privilege for `account_id`, `is_verified`, or `created_at`.

## Manual test rollout

1. Update the test repository to the reviewed migration commit.
2. Freeze all result-confirmation mutations before PRECHECK. Keep the freeze
   active until the rating-aware backend writer is deployed and healthy. If no
   route-level switch exists, use a short maintenance window for confirmation
   requests; submitting or disputing a result is outside this freeze.
3. Create and publish a database backup.
4. Run `026_backend_match_rating_applications_PRECHECK.sql` and save its JSON.
   It refuses rollout when a backend rating result is already confirmed and
   therefore requires explicit reconciliation.
5. Apply `026_backend_match_rating_applications.sql` with `ON_ERROR_STOP=1`.
   The migration takes `ACCESS EXCLUSIVE` locks on `matches` and
   `match_results` before repeating the gap check, so an in-flight confirmation
   cannot cross the migration transaction.
6. Run `026_backend_match_rating_applications_POSTCHECK.sql` and save its JSON.
7. Confirm that existing row counts and fingerprints are unchanged except for
   the intentional `player_rating_states` ACL fingerprint change.
8. Confirm both new tables are empty and `confirmed_rating_results` is zero.
9. Roll out the backend rating writer only after POSTCHECK succeeds. Repeat the
   confirmed-result gap query immediately before restoring confirmation
   traffic, verify writer health, and only then end the freeze.

Expected catalog delta in `backend_match` is two tables and twenty-two
constraints. The migration adds no user trigger.

## Rollback

`026_backend_match_rating_applications_ROLLBACK.sql` acquires
`player_rating_states` and both audit tables with `ACCESS EXCLUSIVE` locks
before checking emptiness. It refuses rollback as soon as any application or
change row exists.

For an unused migration it revokes the two rating update columns, drops only
the two empty audit tables, and restores the exact migration 019 relation
comment/fingerprint. After the first real rating application, use a reviewed
forward migration; never delete rating history.
